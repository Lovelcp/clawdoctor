// ═══════════════════════════════════════════════
//  Token Budget Enforcement
//  Truncates LLM input payloads to stay within a token budget.
// ═══════════════════════════════════════════════

import type { RawSample } from "./prompts.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";

// ─── Token estimation ─────────────────────────────────────────────────────────

/**
 * Estimate token count for an arbitrary value by serialising to JSON.
 * Uses the standard approximation: characters / 4 ≈ tokens.
 */
function estimateTokens(data: unknown): number {
  return JSON.stringify(data).length / 4;
}

// ─── Input shape accepted by truncateForBudget ────────────────────────────────

export interface TruncatableInput {
  /** Optional raw samples — dropped first when over budget. */
  samples?: RawSample[];
  /** Optional MetricSet — detail fields trimmed when still over budget. */
  metrics?: MetricSet;
  /** Suspect list — NEVER dropped. */
  [key: string]: unknown;
}

// ─── truncateForBudget ────────────────────────────────────────────────────────

/**
 * Enforce a token budget on an LLM input payload.
 *
 * Truncation order (spec):
 *   1. Pass through unchanged if already under budget.
 *   2. Drop raw samples first (reduce array length progressively).
 *   3. Truncate MetricSet details:
 *        - cost.tokensBySession  → keep at most 10 entries
 *        - skill.topErrorTools[*].errorMessages → drop the array (set to [])
 *   4. Suspect list is never dropped.
 *
 * @param input      Payload to potentially truncate (not mutated).
 * @param maxTokens  Maximum allowed token budget.
 * @returns          A (possibly truncated) copy of the input.
 */
export function truncateForBudget(
  input: TruncatableInput,
  maxTokens: number,
): TruncatableInput {
  // Step 1: already under budget — pass through unchanged.
  if (estimateTokens(input) <= maxTokens) {
    return input;
  }

  // Work on a shallow clone so we never mutate the original.
  let result: TruncatableInput = { ...input };

  // Step 2: Drop raw samples progressively until under budget or exhausted.
  if (Array.isArray(result.samples) && result.samples.length > 0) {
    // Try removing samples one by one from the end.
    let samples = [...result.samples];
    while (samples.length > 0 && estimateTokens({ ...result, samples }) > maxTokens) {
      samples = samples.slice(0, samples.length - 1);
    }
    result = { ...result, samples };

    if (estimateTokens(result) <= maxTokens) {
      return result;
    }
  }

  // Step 3: Truncate MetricSet details.
  if (result.metrics != null) {
    const metrics = result.metrics as MetricSet;

    // 3a. cost.tokensBySession → keep at most 10 entries
    const truncatedCost = {
      ...metrics.cost,
      tokensBySession: metrics.cost.tokensBySession.slice(0, 10),
    };

    // 3b. skill.topErrorTools[*].errorMessages → drop (set to [])
    const truncatedSkill = {
      ...metrics.skill,
      topErrorTools: metrics.skill.topErrorTools.map((entry) => ({
        ...entry,
        errorMessages: [] as string[],
      })),
    };

    const truncatedMetrics: MetricSet = {
      ...metrics,
      cost: truncatedCost,
      skill: truncatedSkill,
    };

    result = { ...result, metrics: truncatedMetrics };
  }

  return result;
}
