// ═══════════════════════════════════════════════
//  Health Scorer
//  Source: design spec §6.6
// ═══════════════════════════════════════════════

import { scoreToGrade } from "../types/scoring.js";
import type { DepartmentScore, Grade } from "../types/scoring.js";
import type { Department, Severity } from "../types/domain.js";

// ─── Apdex Score ─────────────────────────────────────────────────────────────
// Per-event metrics (success rate, duration) → Apdex
// Empty array → null (no data = unknown, NOT healthy)
// Each value is classified as satisfied / tolerating / frustrated.
// Score = (satisfied + tolerating * 0.5) / n * 100

export function apdexScore(
  values: number[],
  threshold: { satisfied: number; frustrated: number },
  higherIsBetter: boolean,
): number | null {
  if (values.length === 0) return null; // NO DATA = UNKNOWN, not healthy

  let satisfied = 0;
  let tolerating = 0;

  for (const v of values) {
    if (higherIsBetter) {
      if (v >= threshold.satisfied) satisfied++;
      else if (v >= threshold.frustrated) tolerating++;
      // else: frustrated, no increment
    } else {
      if (v <= threshold.satisfied) satisfied++;
      else if (v <= threshold.frustrated) tolerating++;
      // else: frustrated, no increment
    }
  }

  return ((satisfied + tolerating * 0.5) / values.length) * 100;
}

// ─── Linear Score ─────────────────────────────────────────────────────────────
// Aggregate metrics → linear threshold mapping.
// Uses { warning, critical } thresholds. Direction is implicit:
//   higher_is_worse: warning < critical  (e.g. daily tokens)
//   lower_is_worse:  warning > critical  (e.g. success rate)
//
// lo = critical (score 0), hi = warning (score 100)
// Clamp to [0, 100].
// null input → null (no data = unknown).

export function linearScore(
  value: number | null,
  threshold: { warning: number; critical: number },
): number | null {
  if (value === null) return null; // NO DATA = UNKNOWN

  const lo = threshold.critical; // worst → score 0
  const hi = threshold.warning;  // OK    → score 100

  if (lo === hi) return 50; // degenerate case

  const raw = ((value - lo) / (hi - lo)) * 100;
  return Math.max(0, Math.min(100, raw));
}

// ─── Department Score Aggregation ────────────────────────────────────────────
// Filters to evaluable (non-null) metric scores.
// If all null → score=null, grade="N/A", coverage=0.
// Otherwise: score = average of evaluable scores, coverage = evaluable/total.

export function computeDepartmentScore(
  metricScores: Array<{ metric: string; score: number | null }>,
): DepartmentScore {
  const evaluable = metricScores.filter((m) => m.score !== null);
  const skipped = metricScores.length - evaluable.length;

  if (evaluable.length === 0) {
    return {
      score: null,
      grade: "N/A",
      weight: 0,
      coverage: 0,
      evaluatedDiseases: 0,
      skippedDiseases: skipped,
      activeDiseases: 0,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
    };
  }

  const avg =
    evaluable.reduce((sum, m) => sum + (m.score as number), 0) / evaluable.length;
  const coverage = evaluable.length / metricScores.length;

  return {
    score: avg,
    grade: scoreToGrade(avg),
    weight: 0,
    coverage,
    evaluatedDiseases: evaluable.length,
    skippedDiseases: skipped,
    activeDiseases: 0,
    criticalCount: 0,
    warningCount: 0,
    infoCount: 0,
  };
}

// ─── Overall Score ───────────────────────────────────────────────────────────
// Weighted average across departments, skipping those with null scores.
// Re-normalizes weights over evaluable departments only.
// If no departments are evaluable: { overall: 0, grade: "N/A" }.

export function computeOverallScore(
  departments: Record<Department, DepartmentScore>,
  weights: Record<Department, number>,
): { overall: number; grade: Grade } {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [dept, depScore] of Object.entries(departments)) {
    if (depScore.score === null) continue; // skip departments with insufficient data
    const w = weights[dept as Department];
    weightedSum += depScore.score * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return { overall: 0, grade: "N/A" };

  // Re-normalize weights to sum to 1 over evaluable departments
  const overall = weightedSum / totalWeight;
  return { overall, grade: scoreToGrade(overall) };
}

// ─── Security Department Score ────────────────────────────────────────────────
// CVSS special rule: if ANY critical security disease exists → force score to 0, grade "F".
// Otherwise: normal department scoring.

export function computeSecurityDepartmentScore(
  diseases: Array<{ severity: Severity }>,
  metricScores: Array<{ metric: string; score: number | null }>,
): DepartmentScore {
  const hasCritical = diseases.some((d) => d.severity === "critical");

  if (hasCritical) {
    // Force score to 0, grade F (CVSS-inspired rule)
    const evaluable = metricScores.filter((m) => m.score !== null);
    const skipped = metricScores.length - evaluable.length;
    return {
      score: 0,
      grade: "F",
      weight: 0,
      coverage: metricScores.length === 0 ? 0 : evaluable.length / metricScores.length,
      evaluatedDiseases: evaluable.length,
      skippedDiseases: skipped,
      activeDiseases: diseases.length,
      criticalCount: diseases.filter((d) => d.severity === "critical").length,
      warningCount: diseases.filter((d) => d.severity === "warning").length,
      infoCount: diseases.filter((d) => d.severity === "info").length,
    };
  }

  return computeDepartmentScore(metricScores);
}
