// ═══════════════════════════════════════════════
//  Follow-up Verdict
//  Computes improvement verdict from before/after metric snapshots
//  Design spec §7.2
// ═══════════════════════════════════════════════

import type { MetricSnapshot, FollowUpVerdict } from "../types/domain.js";

// ─── Thresholds ────────────────────────────────────────────────────────────────

/** Minimum average improvement (fraction) to consider "resolved" */
const RESOLVED_THRESHOLD = 0.20;       // >= 20% average improvement

/** Minimum average improvement (fraction) to consider "improving" */
const IMPROVING_THRESHOLD = 0.05;      // >= 5% average improvement

/** Threshold below which we say it's "worsened" (negative) */
const WORSENED_THRESHOLD = -0.05;      // <= -5% average change

/** Worsening level at which we suggest rollback */
const SUGGEST_ROLLBACK_THRESHOLD = -0.15;  // <= -15% average change

// ─── computeFollowUpVerdict ───────────────────────────────────────────────────

/**
 * Computes the follow-up verdict from before/after metric snapshots.
 *
 * Compares all metric keys present in BOTH snapshots.
 * If no shared keys exist, returns "needs_data" via "unchanged" with a note.
 *
 * For each metric, changePercent = (after - before) / |before|
 * The overall verdict is based on the average changePercent across all metrics,
 * with direction normalization: metrics where "lower is better" (heuristically
 * determined by name prefix) are negated before averaging.
 *
 * Thresholds:
 *   >= RESOLVED_THRESHOLD  → resolved
 *   >= IMPROVING_THRESHOLD → improving
 *   <= WORSENED_THRESHOLD  → worsened (suggestRollback if <= SUGGEST_ROLLBACK_THRESHOLD)
 *   otherwise              → unchanged
 */
export function computeFollowUpVerdict(
  before: MetricSnapshot,
  after: MetricSnapshot,
): FollowUpVerdict {
  const beforeKeys = Object.keys(before.metrics);
  const afterKeys = new Set(Object.keys(after.metrics));
  const sharedKeys = beforeKeys.filter((k) => afterKeys.has(k));

  if (sharedKeys.length === 0) {
    return {
      status: "unchanged",
      message: { en: "No shared metrics between before and after snapshots; cannot determine verdict." },
    };
  }

  // ─── Compute per-metric change ──────────────────────────────────────────────
  let totalNormalizedChange = 0;
  let counted = 0;

  for (const key of sharedKeys) {
    const beforeVal = before.metrics[key];
    const afterVal = after.metrics[key];

    if (beforeVal === 0) {
      // Avoid division by zero; skip this metric
      continue;
    }

    const rawChange = (afterVal - beforeVal) / Math.abs(beforeVal);

    // Heuristic: for "higher is worse" metrics (e.g. error counts, durations,
    // token counts), a decrease is an improvement. We detect these by name.
    const isHigherWorse = isHigherWorseMetric(key);

    // Normalize: positive = improvement, negative = worsening
    const normalizedChange = isHigherWorse ? -rawChange : rawChange;

    totalNormalizedChange += normalizedChange;
    counted++;
  }

  if (counted === 0) {
    return {
      status: "unchanged",
      message: { en: "All before-metrics were zero; cannot compute change percentage." },
    };
  }

  const avgChange = totalNormalizedChange / counted;
  const avgPercent = Math.round(avgChange * 100);

  // ─── Verdict ────────────────────────────────────────────────────────────────

  if (avgChange >= RESOLVED_THRESHOLD) {
    return {
      status: "resolved",
      message: { en: `Metrics improved by ~${avgPercent}% on average. The disease appears resolved.` },
    };
  }

  if (avgChange >= IMPROVING_THRESHOLD) {
    return {
      status: "improving",
      message: { en: `Metrics improved by ~${avgPercent}% on average. The prescription is working.` },
    };
  }

  if (avgChange <= WORSENED_THRESHOLD) {
    const suggestRollback = avgChange <= SUGGEST_ROLLBACK_THRESHOLD;
    return {
      status: "worsened",
      message: { en: `Metrics changed by ~${avgPercent}% on average. The condition has worsened.${suggestRollback ? " Consider rolling back the prescription." : ""}` },
      suggestRollback,
    };
  }

  return {
    status: "unchanged",
    message: { en: `Metrics changed by ~${avgPercent}% on average. No significant improvement detected.` },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Heuristic: determine if a higher metric value is worse (bad → decrease is good).
 *
 * Examples of higher-is-worse:
 *   - error counts, failure rates, durations, token counts, disk usage
 *
 * Examples of lower-is-worse:
 *   - success rates, cache hit rates, coverage scores
 */
function isHigherWorseMetric(key: string): boolean {
  const lk = key.toLowerCase();

  // Explicit lower-is-worse patterns (higher value = good)
  if (
    lk.includes("successrate") ||
    lk.includes("success_rate") ||
    lk.includes("hitrate") ||
    lk.includes("hit_rate") ||
    lk.includes("coverage") ||
    lk.includes("score") ||
    lk.includes("completionrate") ||
    lk.includes("completion_rate")
  ) {
    return false;
  }

  // Explicit higher-is-worse patterns (higher value = bad)
  if (
    lk.includes("error") ||
    lk.includes("fail") ||
    lk.includes("duration") ||
    lk.includes("token") ||
    lk.includes("disk") ||
    lk.includes("count") ||
    lk.includes("latency") ||
    lk.includes("spike") ||
    lk.includes("stale") ||
    lk.includes("zombie")
  ) {
    return true;
  }

  // Default: lower is worse (assume "higher = better" for unknown metrics)
  return false;
}
