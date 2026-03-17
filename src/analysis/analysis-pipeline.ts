// ═══════════════════════════════════════════════
//  Analysis Pipeline
//  Design spec §6 — orchestrates collect → aggregate → rules → score
// ═══════════════════════════════════════════════

import { ulid } from "ulid";
import { join } from "node:path";
import { collectSnapshot } from "../collector/snapshot-collector.js";
import { openDatabase } from "../store/database.js";
import { createEventStore } from "../store/event-store.js";
import { createDiagnosisStore } from "../store/diagnosis-store.js";
import { createScoreStore } from "../store/score-store.js";
import { aggregateMetrics } from "./metric-aggregator.js";
import { evaluateRules, resolveMetricValue } from "./rule-engine.js";
import {
  computeDepartmentScore,
  computeOverallScore,
  computeSecurityDepartmentScore,
  linearScore,
} from "./health-scorer.js";
import { getDiseaseRegistry } from "../diseases/registry.js";
import { loadConfig } from "../config/loader.js";
import type { Department, DiseaseInstance } from "../types/domain.js";
import type { HealthScore, DataCoverage } from "../types/scoring.js";
import type { RuleResult } from "./rule-engine.js";
import type { ClawDocConfig } from "../types/config.js";

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CheckupOptions {
  agentId: string;
  stateDir: string;        // e.g. ~/.openclaw
  workspaceDir: string;
  departments?: Department[];
  since?: number;          // unix ms
  noLlm: boolean;
  configPath?: string;     // override config file path
}

export interface CheckupResult {
  healthScore: HealthScore;
  diseases: DiseaseInstance[];
  ruleResults: RuleResult[];
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
};

// ─── runCheckup ───────────────────────────────────────────────────────────────

export async function runCheckup(opts: CheckupOptions): Promise<CheckupResult> {
  const { agentId, stateDir, workspaceDir, since, noLlm, configPath: explicitConfigPath } = opts;

  // ── 1. Load config ────────────────────────────────────────────────────────
  // Try explicit configPath first, then standard location inside stateDir
  const configFilePath = explicitConfigPath ?? join(stateDir, "clawdoc.json");
  const config: ClawDocConfig = loadConfig(configFilePath);

  // ── 2. Open in-memory SQLite ──────────────────────────────────────────────
  const db = openDatabase(":memory:");

  try {
    const eventStore = createEventStore(db);
    const diagnosisStore = createDiagnosisStore(db);
    const scoreStore = createScoreStore(db);
    const registry = getDiseaseRegistry();

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

    // ── 6. Evaluate rules ────────────────────────────────────────────────────
    const ruleResults = evaluateRules(metrics, config, registry);

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
        context: {},
      };
      return instance;
    });

    // Persist diagnoses
    for (const disease of diseases) {
      try {
        diagnosisStore.insertDiagnosis(agentId, disease);
      } catch {
        // Ignore errors (e.g. duplicate in edge cases)
      }
    }

    // ── 8. Compute department scores ─────────────────────────────────────────
    // For each department, resolve linear scores for each metric spec.
    // Track total/evaluable metrics across all departments for DataCoverage.
    let totalMetrics = 0;
    let evaluableMetrics = 0;
    const skippedDiseases: DataCoverage["skippedDiseases"] = [];

    const departmentScores: Partial<Record<Department, ReturnType<typeof computeDepartmentScore>>> = {};

    const allDepartments: Department[] = ["vitals", "skill", "memory", "behavior", "cost", "security"];

    for (const dept of allDepartments) {
      const specs = DEPARTMENT_METRICS[dept];
      const metricScores = specs.map((spec) => {
        const threshold = config.thresholds[spec.metric];
        const rawValue = resolveMetricValue(spec.metric, metrics);

        let score: number | null = null;

        if (rawValue !== null && threshold !== undefined) {
          // Build linearScore-compatible threshold:
          // linearScore: lo = critical (0), hi = warning (100)
          // For lower_is_worse: invert so that a value at "critical" maps to score=0
          //   i.e. pass threshold as-is (warning > critical for lower_is_worse)
          // For higher_is_worse: warning < critical — pass as-is (lo=critical, hi=warning)
          score = linearScore(rawValue, threshold);
        } else if (rawValue === null) {
          // Track which diseases are skipped due to no data.
          // Find diseases in this department whose metric is this spec.metric
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

    // Also track skipped LLM-detection diseases
    for (const disease of registry.getAll()) {
      if (disease.detection.type === "llm" || disease.detection.type === "hybrid") {
        if (noLlm) {
          skippedDiseases.push({ diseaseId: disease.id, reason: "llm_disabled" });
        }
      }
    }

    // ── 9. Compute overall score ──────────────────────────────────────────────
    const fullyScored = departmentScores as Record<Department, ReturnType<typeof computeDepartmentScore>>;
    const { overall, grade: overallGrade } = computeOverallScore(fullyScored, config.weights);

    // ── 10. Build HealthScore with DataCoverage ───────────────────────────────
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

    // ── 12. Persist health score ──────────────────────────────────────────────
    scoreStore.insertHealthScore({
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
    });

    return { healthScore, diseases, ruleResults };
  } finally {
    // ── 13. Close db ─────────────────────────────────────────────────────────
    db.close();
  }
}
