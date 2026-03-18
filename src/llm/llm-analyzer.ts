// ═══════════════════════════════════════════════
//  LLM Analyzer
//  Phase 2: 3-round LLM-based disease analysis
//  Round 1 (scan) → Round 2 (deep) → Round 3 (causal)
// ═══════════════════════════════════════════════

import type { LLMProvider } from "./provider.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";
import type { RuleResult } from "../analysis/rule-engine.js";
import type { DiseaseDefinition, DiseaseInstance, Department } from "../types/domain.js";
import type { RawSampleProvider } from "../raw-samples/raw-sample-provider.js";
import { resolveInputData } from "../raw-samples/input-key-mapper.js";
import {
  DIAGNOSIS_SYSTEM_PROMPT,
  buildRound1Prompt,
  buildRound2Prompt,
  buildCausalChainPrompt,
} from "./prompts.js";
import { truncateForBudget } from "./token-budget.js";

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface LLMAnalyzerInput {
  provider: LLMProvider;
  suspects: RuleResult[];                    // from hybrid preFilter
  llmOnlyDiseases: DiseaseDefinition[];      // detection.type === "llm"
  metrics: MetricSet;
  rawSampleProvider: RawSampleProvider;
  agentId: string;
  config: { maxTokensPerCheckup: number; maxTokensPerDiagnosis: number };
}

export interface LLMDiagnosis {
  diseaseId: string;
  status: "confirmed" | "ruled_out" | "inconclusive";
  severity?: string;
  confidence: number;
  evidence: Array<{ description: string; dataReference?: string }>;
  rootCause?: string;
}

export interface LLMAnalyzerResult {
  confirmed: LLMDiagnosis[];
  causalChains: Array<{ name: string; rootCause: string; chain: string[]; impact: string }>;
  totalTokensUsed: number;
  error?: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse an LLM response text as a JSON array of LLMDiagnosis objects.
 * Returns an empty array on parse failure.
 */
function parseDiagnosisArray(text: string): LLMDiagnosis[] {
  // Strip markdown code fences if present
  const stripped = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) {
      return parsed as LLMDiagnosis[];
    }
    // Some LLMs wrap in { diagnoses: [...] } — try to unwrap
    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed);
      for (const key of keys) {
        if (Array.isArray((parsed as Record<string, unknown>)[key])) {
          return (parsed as Record<string, unknown>)[key] as LLMDiagnosis[];
        }
      }
    }
  } catch {
    // fall through
  }
  return [];
}

/**
 * Parse causal chain response from the LLM.
 */
function parseCausalChains(
  text: string,
): Array<{ name: string; rootCause: string; chain: string[]; impact: string }> {
  const stripped = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) {
      return parsed as Array<{ name: string; rootCause: string; chain: string[]; impact: string }>;
    }
    if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed);
      for (const key of keys) {
        if (Array.isArray((parsed as Record<string, unknown>)[key])) {
          return (parsed as Record<string, unknown>)[key] as Array<{
            name: string;
            rootCause: string;
            chain: string[];
            impact: string;
          }>;
        }
      }
    }
  } catch {
    // fall through
  }
  return [];
}

/**
 * Convert an LLMDiagnosis to a DiseaseInstance-like object for use in Round 2/3 prompts.
 */
function llmDiagnosisToDiseaseInstance(d: LLMDiagnosis): DiseaseInstance {
  return {
    id: d.diseaseId,
    definitionId: d.diseaseId,
    severity: (d.severity as DiseaseInstance["severity"]) ?? "warning",
    evidence: d.evidence.map((e) => ({
      type: "llm_analysis" as const,
      description: { en: e.description },
      dataReference: e.dataReference,
      confidence: d.confidence,
    })),
    confidence: d.confidence,
    firstDetectedAt: Date.now(),
    lastSeenAt: Date.now(),
    status: "active" as const,
    context: {},
  };
}

/**
 * Group diseases by department for batching in Round 1.
 */
function groupByDepartment(
  diseases: DiseaseDefinition[],
): Map<Department, DiseaseDefinition[]> {
  const map = new Map<Department, DiseaseDefinition[]>();
  for (const d of diseases) {
    const existing = map.get(d.department) ?? [];
    existing.push(d);
    map.set(d.department, existing);
  }
  return map;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs 3-round LLM-based disease analysis:
 *   Round 1 (scan):   triage suspects + LLM-only diseases grouped by department
 *   Round 2 (deep):   deep sample analysis on confirmed diseases
 *   Round 3 (causal): causal chain analysis across all confirmed diagnoses
 *
 * Token budget is tracked cumulatively; remaining rounds are skipped when
 * maxTokensPerCheckup is reached. On any LLM failure the error is captured
 * and partial results are returned rather than throwing.
 */
export async function analyzeLLM(input: LLMAnalyzerInput): Promise<LLMAnalyzerResult> {
  const {
    provider,
    suspects,
    llmOnlyDiseases,
    metrics,
    rawSampleProvider,
    agentId,
    config,
  } = input;

  let totalTokensUsed = 0;
  const allConfirmed: LLMDiagnosis[] = [];
  let lastError: string | undefined;

  // ─── Round 1: Suspect Triage ────────────────────────────────────────────────
  //
  // We group suspects (hybrid diseases flagged by rules) and LLM-only diseases
  // by department and send one LLM call per department batch.

  try {
    // Build the set of DiseaseDefinitions we need to analyze in Round 1.
    // For suspects, we already have the RuleResults; we also add llmOnlyDiseases.
    // We use department grouping to batch calls efficiently.

    // Resolve all suspect + llmOnly diseases into department groups.
    // Suspects give us diseaseIds; LLM-only diseases are passed directly.
    const suspectIds = new Set(suspects.map((s) => s.diseaseId));

    // Combine: suspects keyed by id, plus llmOnlyDiseases
    const allRound1Diseases: DiseaseDefinition[] = [...llmOnlyDiseases];

    // For suspects we also want to pass the corresponding RuleResult context.
    // We send all suspects together grouped by department using the buildRound1Prompt helper.

    const deptGroups = groupByDepartment(allRound1Diseases);

    // Handle suspects separately using the provided RuleResult[] format.
    // Group suspects by their diseaseId prefix / department.
    // Since we have suspects as RuleResult[], group them differently:
    // send all suspects at once (they may span departments) in one call if non-empty.

    if (suspects.length > 0) {
      if (totalTokensUsed >= config.maxTokensPerCheckup) {
        // Budget exceeded before starting
        return { confirmed: allConfirmed, causalChains: [], totalTokensUsed };
      }

      const payload = truncateForBudget(
        { suspects, metrics },
        config.maxTokensPerDiagnosis,
      );

      const prompt = buildRound1Prompt(
        payload.suspects as RuleResult[],
        payload.metrics as MetricSet,
      );

      const response = await provider.chat(DIAGNOSIS_SYSTEM_PROMPT, prompt, {
        maxTokens: config.maxTokensPerDiagnosis,
      });

      totalTokensUsed += response.tokensUsed.input + response.tokensUsed.output;

      if (response.error) {
        lastError = response.error;
      } else {
        const diagnosed = parseDiagnosisArray(response.text);
        for (const d of diagnosed) {
          if (d.status === "confirmed") {
            allConfirmed.push(d);
          }
        }
      }
    }

    // Process LLM-only diseases grouped by department.
    for (const [_dept, diseases] of deptGroups) {
      if (totalTokensUsed >= config.maxTokensPerCheckup) {
        break;
      }

      // Resolve input data for each disease in this department batch.
      const inputDataMap: Record<string, unknown> = {};
      for (const disease of diseases) {
        const resolved = await resolveInputData(disease, rawSampleProvider, metrics, agentId);
        // Merge resolved keys into shared map for this batch
        for (const [k, v] of Object.entries(resolved)) {
          inputDataMap[k] = v;
        }
      }

      // Build suspects-style objects for LLM-only diseases.
      const llmSuspects: RuleResult[] = diseases.map((d) => ({
        diseaseId: d.id,
        status: "suspect" as const,
        severity: d.defaultSeverity,
        evidence: [],
        confidence: 0,
      }));

      const payload = truncateForBudget(
        { suspects: llmSuspects, metrics, ...inputDataMap },
        config.maxTokensPerDiagnosis,
      );

      const prompt = buildRound1Prompt(
        payload.suspects as RuleResult[],
        payload.metrics as MetricSet,
      );

      const response = await provider.chat(DIAGNOSIS_SYSTEM_PROMPT, prompt, {
        maxTokens: config.maxTokensPerDiagnosis,
      });

      totalTokensUsed += response.tokensUsed.input + response.tokensUsed.output;

      if (response.error) {
        lastError = response.error;
      } else {
        const diagnosed = parseDiagnosisArray(response.text);
        for (const d of diagnosed) {
          if (d.status === "confirmed") {
            allConfirmed.push(d);
          }
        }
      }
    }
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : String(err);
    return {
      confirmed: allConfirmed,
      causalChains: [],
      totalTokensUsed,
      error: lastError,
    };
  }

  // ─── Round 2: Deep Sample Analysis ─────────────────────────────────────────

  if (allConfirmed.length > 0 && totalTokensUsed < config.maxTokensPerCheckup) {
    try {
      // Fetch raw samples for deep analysis.
      const samples = await rawSampleProvider.getRecentSessionSamples(agentId, 5);

      const confirmedInstances = allConfirmed.map(llmDiagnosisToDiseaseInstance);

      const payload = truncateForBudget(
        { suspects: confirmedInstances, samples, metrics },
        config.maxTokensPerDiagnosis,
      );

      const prompt = buildRound2Prompt(
        confirmedInstances,
        (payload.samples ?? []) as Parameters<typeof buildRound2Prompt>[1],
      );

      const response = await provider.chat(DIAGNOSIS_SYSTEM_PROMPT, prompt, {
        maxTokens: config.maxTokensPerDiagnosis,
      });

      totalTokensUsed += response.tokensUsed.input + response.tokensUsed.output;

      if (response.error) {
        lastError = response.error;
      } else {
        const refined = parseDiagnosisArray(response.text);
        // Merge refined results — update existing or add new confirmed.
        for (const d of refined) {
          if (d.status === "confirmed") {
            const existing = allConfirmed.findIndex((c) => c.diseaseId === d.diseaseId);
            if (existing >= 0) {
              // Update with refined analysis — prefer Round 2 rootCause.
              allConfirmed[existing] = {
                ...allConfirmed[existing],
                ...d,
                evidence: d.evidence.length > 0 ? d.evidence : allConfirmed[existing].evidence,
              };
            } else {
              allConfirmed.push(d);
            }
          }
        }
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      // Return what we have without causal chains.
      return {
        confirmed: allConfirmed,
        causalChains: [],
        totalTokensUsed,
        error: lastError,
      };
    }
  }

  // ─── Round 3: Causal Chain Analysis ────────────────────────────────────────

  let causalChains: LLMAnalyzerResult["causalChains"] = [];

  if (allConfirmed.length > 0 && totalTokensUsed < config.maxTokensPerCheckup) {
    try {
      const confirmedInstances = allConfirmed.map(llmDiagnosisToDiseaseInstance);
      const prompt = buildCausalChainPrompt(confirmedInstances);

      const response = await provider.chat(DIAGNOSIS_SYSTEM_PROMPT, prompt, {
        maxTokens: config.maxTokensPerDiagnosis,
      });

      totalTokensUsed += response.tokensUsed.input + response.tokensUsed.output;

      if (response.error) {
        lastError = response.error;
      } else {
        causalChains = parseCausalChains(response.text);
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  const result: LLMAnalyzerResult = {
    confirmed: allConfirmed,
    causalChains,
    totalTokensUsed,
  };

  if (lastError) {
    result.error = lastError;
  }

  return result;
}
