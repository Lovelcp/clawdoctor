// ═══════════════════════════════════════════════
//  Analysis Pipeline
//  Design spec §6 — orchestrates collect → aggregate → rules → LLM → score
// ═══════════════════════════════════════════════

import { ulid } from "ulid";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { collectSnapshot } from "../collector/snapshot-collector.js";
import { openDatabase } from "../store/database.js";
import { createEventStore } from "../store/event-store.js";
import { createDiagnosisStore } from "../store/diagnosis-store.js";
import { createScoreStore } from "../store/score-store.js";
import { createPrescriptionStore } from "../store/prescription-store.js";
import { createCausalChainStore } from "../store/causal-chain-store.js";
import { aggregateMetrics } from "./metric-aggregator.js";
import { evaluateRules, resolveMetricValue } from "./rule-engine.js";
import {
  computeDepartmentScore,
  computeOverallScore,
  computeSecurityDepartmentScore,
  linearScore,
} from "./health-scorer.js";
import { getDiseaseRegistry, createMergedRegistry } from "../diseases/registry.js";
import type { ClawDoctorPlugin } from "../plugins/plugin-types.js";
import { loadConfig } from "../config/loader.js";
import { resolveLLMProvider } from "../llm/provider.js";
import { analyzeLLM } from "../llm/llm-analyzer.js";
import { parseCausalChains } from "../llm/causal-linker.js";
import { createRawSampleProvider } from "../raw-samples/raw-sample-provider.js";
import { generatePrescription } from "../prescription/prescription-generator.js";
import type { Department, DiseaseInstance, CausalChain, Prescription } from "../types/domain.js";
import type { HealthScore, DataCoverage } from "../types/scoring.js";
import type { RuleResult } from "./rule-engine.js";
import type { ClawDoctorConfig } from "../types/config.js";

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CheckupOptions {
  agentId: string;
  stateDir: string;        // e.g. ~/.openclaw
  workspaceDir: string;
  departments?: Department[];
  since?: number;          // unix ms
  noLlm: boolean;
  configPath?: string;     // override config file path
  dbPath?: string;         // override database file path
  plugins?: ClawDoctorPlugin[]; // pre-loaded community plugins
}

export interface CheckupResult {
  healthScore: HealthScore;
  diseases: DiseaseInstance[];
  ruleResults: RuleResult[];
  causalChains?: CausalChain[];
  prescriptions?: Prescription[];
  llmAvailable: boolean;
  llmDegradationReason?: string;
}

// ─── Department → metric mappings ─────────────────────────────────────────────
// Maps each department to the metric keys used for linear scoring.
// Each entry is { metric, direction } where direction drives which threshold is "worst".

interface MetricSpec {
  metric: string;
  direction: "higher_is_worse" | "lower_is_worse";
}

const DEPARTMENT_METRICS: Record<Department, MetricSpec[]> = {
  vitals: [
    { metric: "vitals.gatewayUnreachable",   direction: "higher_is_worse" },
    { metric: "vitals.configParseFailure",   direction: "higher_is_worse" },
    { metric: "vitals.pluginLoadErrors",     direction: "higher_is_worse" },
    { metric: "vitals.diskUsageMB",          direction: "higher_is_worse" },
  ],
  skill: [
    { metric: "skill.successRate",           direction: "lower_is_worse"  },
    { metric: "skill.errorBurstCount",       direction: "higher_is_worse" },
    { metric: "skill.repetitionCount",       direction: "higher_is_worse" },
    { metric: "skill.avgDurationMs",         direction: "higher_is_worse" },
  ],
  memory: [
    { metric: "memory.staleAgeDays",         direction: "higher_is_worse" },
    { metric: "memory.totalFiles",           direction: "higher_is_worse" },
    { metric: "memory.totalSizeKB",          direction: "higher_is_worse" },
  ],
  behavior: [
    { metric: "behavior.taskCompletionRate", direction: "lower_is_worse"  },
    { metric: "behavior.avgStepsPerTask",    direction: "higher_is_worse" },
    { metric: "behavior.verboseRatio",       direction: "higher_is_worse" },
  ],
  cost: [
    { metric: "cost.dailyTokens",            direction: "higher_is_worse" },
    { metric: "cost.cacheHitRate",           direction: "lower_is_worse"  },
  ],
  security: [
    { metric: "security.exposedCredentials", direction: "higher_is_worse" },
    { metric: "security.unsandboxedPlugins", direction: "higher_is_worse" },
  ],
  infra: [],  // populated by monitor probes, not snapshot-based checkup
};

// ─── runCheckup ───────────────────────────────────────────────────────────────

export async function runCheckup(opts: CheckupOptions): Promise<CheckupResult> {
  const { agentId, stateDir, workspaceDir, since, noLlm, configPath: explicitConfigPath, plugins } = opts;

  // ── 1. Load config ────────────────────────────────────────────────────────
  // Try explicit configPath first, then standard location inside stateDir
  const configFilePath = explicitConfigPath ?? join(stateDir, "clawdoctor.json");
  const config: ClawDoctorConfig = loadConfig(configFilePath);

  // ── 2. Open persistent SQLite ───────────────────────────────────────────
  const dbDir = join(homedir(), ".clawdoctor");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = opts.dbPath ?? join(dbDir, "clawdoctor.db");
  const db = openDatabase(dbPath);

  try {
    const eventStore = createEventStore(db);
    const diagnosisStore = createDiagnosisStore(db);
    const scoreStore = createScoreStore(db);
    const prescriptionStore = createPrescriptionStore(db);
    const causalChainStore = createCausalChainStore(db);
    const baseRegistry = getDiseaseRegistry();
    const registry = plugins && plugins.length > 0
      ? createMergedRegistry(baseRegistry, plugins)
      : baseRegistry;

    // ── 3. Collect snapshot events ──────────────────────────────────────────
    const events = await collectSnapshot({
      agentId,
      stateDir,
      workspaceDir,
      since,
      configPath: explicitConfigPath,
    });

    // ── 4. Insert events into event store ───────────────────────────────────
    for (const event of events) {
      try {
        eventStore.insertEvent(event);
      } catch {
        // Ignore duplicate-key errors on re-runs with overlapping data
      }
    }

    // ── 5. Aggregate metrics ─────────────────────────────────────────────────
    const now = Date.now();
    const timeRange = {
      from: since ?? 0,
      to: now,
    };
    const metrics = aggregateMetrics(db, agentId, timeRange);

    // ── 6. Evaluate rules (now includes hybrid preFilter + custom plugin rules)
    const customRules: Record<string, import("../plugins/plugin-types.js").CustomRuleEvaluator> = {};
    if (opts.plugins) {
      for (const p of opts.plugins) {
        if (p.rules) Object.assign(customRules, p.rules);
      }
    }
    const ruleResults = evaluateRules(
      metrics, config, registry,
      Object.keys(customRules).length > 0 ? customRules : undefined,
    );

    // ── 7. Convert RuleResults → DiseaseInstance[] ───────────────────────────
    const diseases: DiseaseInstance[] = ruleResults.map((r) => {
      const instance: DiseaseInstance = {
        id: ulid(now),
        definitionId: r.diseaseId,
        severity: r.severity,
        evidence: r.evidence,
        confidence: r.confidence,
        firstDetectedAt: now,
        lastSeenAt: now,
        status: "active",
        context: {
          dataTimeRange: { from: timeRange.from, to: timeRange.to },
        },
      };
      return instance;
    });

    // ── 7b. Dedup: clean previous pending data for this agent ───────────────
    try {
      prescriptionStore.deletePendingByAgent(agentId);
    } catch {
      // Ignore if no previous data
    }
    try {
      causalChainStore.deleteByAgent(agentId);
    } catch {
      // Ignore if no previous data
    }

    // ── 8. LLM Analysis step ─────────────────────────────────────────────────
    let causalChains: CausalChain[] | undefined;
    let prescriptions: Prescription[] | undefined;
    let llmAvailable = false;
    let llmDegradationReason: string | undefined;

    if (!noLlm) {
      const providerResult = resolveLLMProvider(config);

      if (providerResult.provider !== null) {
        llmAvailable = true;
        const provider = providerResult.provider;

        try {
          // Collect suspects (hybrid diseases with status="suspect") + LLM-only diseases
          const suspects = ruleResults.filter((r) => r.status === "suspect");
          const llmOnlyDiseases = registry.getAll().filter(
            (d) => d.detection.type === "llm"
          );

          // Create RawSampleProvider for fetching raw data
          const rawSampleProvider = createRawSampleProvider({ stateDir, workspaceDir });

          // Run 3-round LLM analysis
          const llmResult = await analyzeLLM({
            provider,
            suspects,
            llmOnlyDiseases,
            metrics,
            rawSampleProvider,
            agentId,
            config: {
              maxTokensPerCheckup: config.llm.maxTokensPerCheckup ?? 100_000,
              maxTokensPerDiagnosis: config.llm.maxTokensPerDiagnosis ?? 4_096,
            },
          });

          if (llmResult.error) {
            llmDegradationReason = llmResult.error;
          }

          // Convert LLM confirmed diagnoses → DiseaseInstance[]
          for (const confirmed of llmResult.confirmed) {
            const llmDisease: DiseaseInstance = {
              id: ulid(now),
              definitionId: confirmed.diseaseId,
              severity: (confirmed.severity as DiseaseInstance["severity"]) ?? "warning",
              evidence: confirmed.evidence.map((e) => ({
                type: "llm_analysis" as const,
                description: { en: e.description },
                dataReference: e.dataReference,
                confidence: confirmed.confidence,
              })),
              confidence: confirmed.confidence,
              firstDetectedAt: now,
              lastSeenAt: now,
              status: "active",
              context: {
                ...(confirmed.rootCause ? { rootCause: confirmed.rootCause } : {}),
                dataTimeRange: { from: timeRange.from, to: timeRange.to },
              },
            };

            // If this was a suspect (hybrid), upgrade the existing disease entry
            const existingIdx = diseases.findIndex(
              (d) => d.definitionId === confirmed.diseaseId
            );
            if (existingIdx >= 0) {
              // Merge LLM evidence into the existing entry, upgrade from suspect
              const existing = diseases[existingIdx];
              diseases[existingIdx] = {
                ...existing,
                evidence: [...existing.evidence, ...llmDisease.evidence],
                confidence: Math.max(existing.confidence, llmDisease.confidence),
                context: { ...existing.context, ...llmDisease.context },
              };
            } else {
              // New LLM-only disease
              diseases.push(llmDisease);
            }
          }

          // Remove suspect-only diseases that were NOT confirmed by LLM
          // (they stay as suspects if LLM didn't analyze them or ruled them out)
          // We keep them — rule engine flagged them so they may be useful info

          // Parse causal chains from LLM result
          causalChains = parseCausalChains(llmResult.causalChains, diseases);

          // Generate prescriptions for confirmed diseases
          const confirmedDiseases = diseases.filter((d) => {
            // Only generate prescriptions for diseases that were rule-confirmed or LLM-confirmed
            const ruleResult = ruleResults.find((r) => r.diseaseId === d.definitionId);
            const isRuleConfirmed = ruleResult?.status === "confirmed";
            const isLlmConfirmed = llmResult.confirmed.some(
              (c) => c.diseaseId === d.definitionId
            );
            return isRuleConfirmed || isLlmConfirmed;
          });

          prescriptions = [];
          for (const disease of confirmedDiseases) {
            const definition = registry.getById(disease.definitionId);
            if (!definition) continue;
            try {
              const rx = await generatePrescription(
                disease, definition, provider, { metrics }
              );
              prescriptions.push(rx);
            } catch {
              // Skip prescription generation on failure — non-fatal
            }
          }

          // Backfill causal chain prescriptions
          if (causalChains && causalChains.length > 0 && prescriptions.length > 0) {
            for (const chain of causalChains) {
              // Find prescription for the root cause disease
              const rootDiseaseId = chain.rootCause.diseaseId;
              const rootRx = prescriptions.find(
                (rx) => {
                  const d = diseases.find((di) => di.id === rx.diagnosisId);
                  return d?.definitionId === rootDiseaseId;
                }
              );
              if (rootRx) {
                chain.unifiedPrescription = rootRx;
              }
            }
          }

        } catch (err: unknown) {
          // LLM failure is non-fatal — degrade gracefully
          llmDegradationReason = err instanceof Error ? err.message : String(err);
        }
      } else {
        // Provider not available — record reason
        llmDegradationReason = (providerResult as { reason: string }).reason;
      }
    } else {
      llmDegradationReason = "llm_disabled_by_flag";
    }

    // ── 9. Persist diagnoses (reconcile) ─────────────────────────────────────
    // Query previous active diagnoses for this agent to reconcile
    const previousDiagnoses = diagnosisStore.queryDiagnoses({
      agentId,
      status: "active",
    });

    // Build a set of currently detected disease definition IDs
    const currentDiseaseDefIds = new Set(diseases.map((d) => d.definitionId));

    // Resolve disappeared diseases (previously active but no longer detected)
    for (const prev of previousDiagnoses) {
      if (!currentDiseaseDefIds.has(prev.definitionId)) {
        try {
          diagnosisStore.updateDiagnosisStatus(prev.id, "resolved", now);
        } catch {
          // Ignore errors during reconciliation
        }
      }
    }

    // Build a set of previously active disease definition IDs
    const previousDefIds = new Set(previousDiagnoses.map((d) => d.definitionId));

    // Insert new diagnoses or update re-detected ones
    for (const disease of diseases) {
      if (previousDefIds.has(disease.definitionId)) {
        // Re-detected — update last_seen on the existing record
        const existing = previousDiagnoses.find(
          (p) => p.definitionId === disease.definitionId
        );
        if (existing) {
          try {
            // We don't have an updateLastSeen method, so we use the status update
            // as a proxy. The diagnosis is still active — no status change needed.
            // For Phase 2, we insert a fresh record to capture updated evidence.
            diagnosisStore.insertDiagnosis(agentId, disease);
          } catch {
            // Ignore duplicate errors
          }
        }
      } else {
        // New disease — insert
        try {
          diagnosisStore.insertDiagnosis(agentId, disease);
        } catch {
          // Ignore errors (e.g. duplicate in edge cases)
        }
      }
    }

    // ── 10. Persist prescriptions ────────────────────────────────────────────
    if (prescriptions && prescriptions.length > 0) {
      for (const rx of prescriptions) {
        try {
          prescriptionStore.insertPrescription(rx);
        } catch {
          // Ignore errors
        }
      }
    }

    // ── 11. Persist causal chains ────────────────────────────────────────────
    if (causalChains && causalChains.length > 0) {
      for (const chain of causalChains) {
        try {
          causalChainStore.insertChain(agentId, chain);
        } catch {
          // Ignore errors
        }
      }
    }

    // ── 12. Compute department scores ─────────────────────────────────────────
    // For each department, resolve linear scores for each metric spec.
    // Track total/evaluable metrics across all departments for DataCoverage.
    let totalMetrics = 0;
    let evaluableMetrics = 0;
    const skippedDiseases: DataCoverage["skippedDiseases"] = [];

    const departmentScores: Partial<Record<Department, ReturnType<typeof computeDepartmentScore>>> = {};

    const allDepartments: Department[] = ["vitals", "skill", "memory", "behavior", "cost", "security", "infra"];

    for (const dept of allDepartments) {
      const specs = DEPARTMENT_METRICS[dept];
      const metricScores = specs.map((spec) => {
        const threshold = config.thresholds[spec.metric];
        const rawValue = resolveMetricValue(spec.metric, metrics);

        let score: number | null = null;

        if (rawValue !== null && threshold !== undefined) {
          score = linearScore(rawValue, threshold);
        } else if (rawValue === null) {
          // Track which diseases are skipped due to no data.
          const deptDiseases = registry.getByDepartment(dept).filter(
            (d) => d.detection.type === "rule" && (d.detection as { metric: string }).metric === spec.metric
          );
          for (const d of deptDiseases) {
            skippedDiseases.push({ diseaseId: d.id, reason: "no_data" });
          }
        }

        return { metric: spec.metric, score };
      });

      totalMetrics += metricScores.length;
      evaluableMetrics += metricScores.filter((m) => m.score !== null).length;

      // Security uses special CVSS rule
      if (dept === "security") {
        const secDiseases = diseases.filter((d) => {
          const def = registry.getById(d.definitionId);
          return def?.department === "security";
        });
        departmentScores[dept] = computeSecurityDepartmentScore(secDiseases, metricScores);
      } else {
        departmentScores[dept] = computeDepartmentScore(metricScores);
      }

      // Set weight from config
      if (departmentScores[dept]) {
        departmentScores[dept]!.weight = config.weights[dept] ?? 0;
      }

      // Count active diseases, criticals, warnings for each department
      const deptDiseaseInstances = diseases.filter((d) => {
        const def = registry.getById(d.definitionId);
        return def?.department === dept;
      });
      if (departmentScores[dept]) {
        departmentScores[dept]!.activeDiseases = deptDiseaseInstances.length;
        departmentScores[dept]!.criticalCount = deptDiseaseInstances.filter(
          (d) => d.severity === "critical"
        ).length;
        departmentScores[dept]!.warningCount = deptDiseaseInstances.filter(
          (d) => d.severity === "warning"
        ).length;
        departmentScores[dept]!.infoCount = deptDiseaseInstances.filter(
          (d) => d.severity === "info"
        ).length;
      }
    }

    // Also track skipped LLM-detection diseases when LLM is not available
    if (!llmAvailable || noLlm) {
      for (const disease of registry.getAll()) {
        if (disease.detection.type === "llm" || disease.detection.type === "hybrid") {
          skippedDiseases.push({ diseaseId: disease.id, reason: "llm_disabled" });
        }
      }
    }

    // ── 13. Compute overall score ──────────────────────────────────────────────
    const fullyScored = departmentScores as Record<Department, ReturnType<typeof computeDepartmentScore>>;
    const { overall, grade: overallGrade } = computeOverallScore(fullyScored, config.weights);

    // ── 14. Build HealthScore with DataCoverage ───────────────────────────────
    const coverage: DataCoverage = {
      evaluableMetrics,
      totalMetrics,
      ratio: totalMetrics > 0 ? evaluableMetrics / totalMetrics : 0,
      skippedDiseases,
    };

    const healthScore: HealthScore = {
      overall,
      overallGrade,
      dataMode: "snapshot",
      coverage,
      departments: fullyScored,
    };

    // ── 15. Persist health score with full JSON ───────────────────────────────
    scoreStore.insertHealthScoreWithJson(
      {
        id: ulid(now),
        agentId,
        timestamp: now,
        dataMode: "snapshot",
        coverage: coverage.ratio,
        overall: overall,
        vitals: departmentScores.vitals?.score ?? null,
        skill: departmentScores.skill?.score ?? null,
        memory: departmentScores.memory?.score ?? null,
        behavior: departmentScores.behavior?.score ?? null,
        cost: departmentScores.cost?.score ?? null,
        security: departmentScores.security?.score ?? null,
      },
      JSON.stringify(healthScore),
    );

    return {
      healthScore,
      diseases,
      ruleResults,
      causalChains,
      prescriptions,
      llmAvailable,
      llmDegradationReason,
    };
  } finally {
    // ── 16. Close db ─────────────────────────────────────────────────────────
    db.close();
  }
}
