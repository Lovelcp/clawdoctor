import { describe, it, expect } from "vitest";
import {
  apdexScore,
  linearScore,
  computeDepartmentScore,
  computeOverallScore,
  computeSecurityDepartmentScore,
} from "./health-scorer.js";
import { scoreToGrade } from "../types/scoring.js";
import type { DepartmentScore } from "../types/scoring.js";
import type { Department, Severity } from "../types/domain.js";

// ─── apdexScore ──────────────────────────────────────────────────────────────

describe("apdexScore", () => {
  it("returns null for empty values (no data = unknown, not healthy)", () => {
    expect(apdexScore([], { satisfied: 0.9, frustrated: 0.5 }, true)).toBeNull();
  });

  it("returns 100 when all values are satisfied (higherIsBetter=true)", () => {
    const values = [0.95, 1.0, 0.92];
    const result = apdexScore(values, { satisfied: 0.9, frustrated: 0.5 }, true);
    expect(result).toBe(100);
  });

  it("returns 50 when all values are tolerating (higherIsBetter=true)", () => {
    // tolerating: v >= frustrated but < satisfied
    const values = [0.7, 0.6, 0.8];
    const result = apdexScore(values, { satisfied: 0.9, frustrated: 0.5 }, true);
    // all tolerating → (0 + 3*0.5) / 3 * 100 = 50
    expect(result).toBe(50);
  });

  it("returns 0 when all values are frustrated (higherIsBetter=true)", () => {
    const values = [0.1, 0.2, 0.3];
    const result = apdexScore(values, { satisfied: 0.9, frustrated: 0.5 }, true);
    // all frustrated (below 0.5) → 0
    expect(result).toBe(0);
  });

  it("returns 100 when all satisfied (higherIsBetter=false)", () => {
    // lower is better: satisfied means v <= satisfied threshold
    const values = [100, 150, 120];
    const result = apdexScore(values, { satisfied: 200, frustrated: 500 }, false);
    expect(result).toBe(100);
  });

  it("returns 0 when all frustrated (higherIsBetter=false)", () => {
    // all above the frustrated threshold
    const values = [600, 700, 800];
    const result = apdexScore(values, { satisfied: 200, frustrated: 500 }, false);
    expect(result).toBe(0);
  });

  it("correctly mixes satisfied + tolerating + frustrated", () => {
    // higherIsBetter=true, satisfied>=0.9, tolerating>=0.5<0.9, frustrated<0.5
    // [1.0 (satisfied), 0.7 (tolerating), 0.3 (frustrated)]
    const values = [1.0, 0.7, 0.3];
    const result = apdexScore(values, { satisfied: 0.9, frustrated: 0.5 }, true);
    // (1 + 1*0.5 + 0) / 3 * 100 = 1.5/3*100 = 50
    expect(result).toBeCloseTo(50, 5);
  });
});

// ─── linearScore ─────────────────────────────────────────────────────────────

describe("linearScore", () => {
  it("returns null for null input (no data = unknown)", () => {
    expect(linearScore(null, { warning: 100_000, critical: 500_000 })).toBeNull();
  });

  it("returns 100 at warning boundary (daily tokens higher_is_worse: warning=100K, critical=500K)", () => {
    // lo=critical=500K, hi=warning=100K → but that makes hi < lo
    // For higher_is_worse: warning < critical; lo=critical=500K, hi=warning=100K
    // value=100K → (100K - 500K)/(100K - 500K) * 100 = (-400K)/(-400K)*100 = 100
    const result = linearScore(100_000, { warning: 100_000, critical: 500_000 });
    expect(result).toBe(100);
  });

  it("returns 0 at critical boundary (daily tokens higher_is_worse)", () => {
    // value=500K → (500K - 500K)/(100K - 500K)*100 = 0/(-400K)*100 = 0
    const result = linearScore(500_000, { warning: 100_000, critical: 500_000 });
    expect(result).toBe(0);
  });

  it("returns 50 at midpoint between warning and critical", () => {
    // midpoint of 100K and 500K is 300K
    // (300K - 500K)/(100K - 500K)*100 = (-200K)/(-400K)*100 = 50
    const result = linearScore(300_000, { warning: 100_000, critical: 500_000 });
    expect(result).toBeCloseTo(50, 5);
  });

  it("works for lower_is_worse direction (success rate: warning=0.75, critical=0.50)", () => {
    // lo=critical=0.50, hi=warning=0.75
    // value=0.75 → (0.75-0.50)/(0.75-0.50)*100 = 100 (at warning = healthy)
    expect(linearScore(0.75, { warning: 0.75, critical: 0.50 })).toBe(100);
    // value=0.50 → (0.50-0.50)/(0.75-0.50)*100 = 0 (at critical = failing)
    expect(linearScore(0.50, { warning: 0.75, critical: 0.50 })).toBe(0);
    // value=0.625 → (0.625-0.50)/(0.75-0.50)*100 = 50
    expect(linearScore(0.625, { warning: 0.75, critical: 0.50 })).toBeCloseTo(50, 5);
  });

  it("clamps to 0 when value is worse than critical", () => {
    // higher_is_worse: value > critical
    const result = linearScore(700_000, { warning: 100_000, critical: 500_000 });
    expect(result).toBe(0);
  });

  it("clamps to 100 when value is better than warning", () => {
    // higher_is_worse: value < warning
    const result = linearScore(50_000, { warning: 100_000, critical: 500_000 });
    expect(result).toBe(100);
  });

  it("returns 50 for degenerate case (warning === critical)", () => {
    const result = linearScore(100, { warning: 100, critical: 100 });
    expect(result).toBe(50);
  });
});

// ─── computeDepartmentScore ───────────────────────────────────────────────────

describe("computeDepartmentScore", () => {
  it("returns null score and N/A grade when all metrics are null", () => {
    const result = computeDepartmentScore([
      { metric: "m1", score: null },
      { metric: "m2", score: null },
    ]);
    expect(result.score).toBeNull();
    expect(result.grade).toBe("N/A");
    expect(result.coverage).toBe(0);
  });

  it("returns average of evaluable scores", () => {
    const result = computeDepartmentScore([
      { metric: "m1", score: 80 },
      { metric: "m2", score: 60 },
      { metric: "m3", score: null },
    ]);
    expect(result.score).toBeCloseTo(70, 5);
    expect(result.grade).toBe("B");
  });

  it("computes coverage as evaluable / total", () => {
    const result = computeDepartmentScore([
      { metric: "m1", score: 80 },
      { metric: "m2", score: null },
    ]);
    expect(result.coverage).toBeCloseTo(0.5, 5);
    expect(result.evaluatedDiseases).toBe(1);
    expect(result.skippedDiseases).toBe(1);
  });

  it("returns coverage=1 when all metrics have scores", () => {
    const result = computeDepartmentScore([
      { metric: "m1", score: 90 },
      { metric: "m2", score: 95 },
    ]);
    expect(result.coverage).toBe(1);
    expect(result.score).toBeCloseTo(92.5, 5);
    expect(result.grade).toBe("A");
  });
});

// ─── computeOverallScore ──────────────────────────────────────────────────────

describe("computeOverallScore", () => {
  const makeDepScore = (score: number | null): DepartmentScore => ({
    score,
    grade: score === null ? "N/A" : scoreToGrade(score),
    weight: 0,
    coverage: score === null ? 0 : 1,
    evaluatedDiseases: score === null ? 0 : 1,
    skippedDiseases: score === null ? 1 : 0,
    activeDiseases: 0,
    criticalCount: 0,
    warningCount: 0,
    infoCount: 0,
  });

  it("skips departments with null scores and re-normalizes weights", () => {
    const departments: Record<Department, DepartmentScore> = {
      vitals: makeDepScore(80),
      skill: makeDepScore(null),   // skipped
      memory: makeDepScore(60),
      behavior: makeDepScore(null), // skipped
      cost: makeDepScore(null),     // skipped
      security: makeDepScore(null), // skipped
    };
    const weights: Record<Department, number> = {
      vitals: 0.08,
      skill: 0.26,
      memory: 0.14,
      behavior: 0.26,
      cost: 0.11,
      security: 0.15,
    };
    const result = computeOverallScore(departments, weights);
    // Only vitals(80, w=0.08) and memory(60, w=0.14) are evaluable
    // Re-normalized: vitals=0.08/(0.08+0.14), memory=0.14/(0.08+0.14)
    // overall = (80*0.08 + 60*0.14) / (0.08+0.14) = (6.4+8.4)/0.22 = 14.8/0.22 ≈ 67.27
    expect(result.overall).toBeCloseTo(67.27, 1);
    expect(result.grade).toBe("C"); // 50-69 = C
  });

  it("returns { overall: 0, grade: 'N/A' } when all departments have null scores", () => {
    const departments: Record<Department, DepartmentScore> = {
      vitals: makeDepScore(null),
      skill: makeDepScore(null),
      memory: makeDepScore(null),
      behavior: makeDepScore(null),
      cost: makeDepScore(null),
      security: makeDepScore(null),
    };
    const weights: Record<Department, number> = {
      vitals: 0.08,
      skill: 0.26,
      memory: 0.14,
      behavior: 0.26,
      cost: 0.11,
      security: 0.15,
    };
    const result = computeOverallScore(departments, weights);
    expect(result.overall).toBe(0);
    expect(result.grade).toBe("N/A");
  });
});

// ─── computeSecurityDepartmentScore ──────────────────────────────────────────

describe("computeSecurityDepartmentScore", () => {
  it("forces score to 0 and grade to F when any critical security disease exists", () => {
    const diseases: Array<{ severity: Severity }> = [
      { severity: "critical" },
      { severity: "warning" },
    ];
    const metricScores = [
      { metric: "m1", score: 90 },
      { metric: "m2", score: 85 },
    ];
    const result = computeSecurityDepartmentScore(diseases, metricScores);
    expect(result.score).toBe(0);
    expect(result.grade).toBe("F");
  });

  it("uses normal department scoring when no critical security disease exists", () => {
    const diseases: Array<{ severity: Severity }> = [
      { severity: "warning" },
      { severity: "info" },
    ];
    const metricScores = [
      { metric: "m1", score: 90 },
      { metric: "m2", score: 80 },
    ];
    const result = computeSecurityDepartmentScore(diseases, metricScores);
    expect(result.score).toBeCloseTo(85, 5);
    expect(result.grade).toBe("B"); // 85 is in the 70-89 range → B
  });

  it("uses normal department scoring when disease list is empty", () => {
    const metricScores = [{ metric: "m1", score: 70 }];
    const result = computeSecurityDepartmentScore([], metricScores);
    expect(result.score).toBe(70);
    expect(result.grade).toBe("B");
  });
});

// ─── scoreToGrade boundaries ──────────────────────────────────────────────────

describe("scoreToGrade boundaries", () => {
  it("maps 90 → A", () => expect(scoreToGrade(90)).toBe("A"));
  it("maps 89.9 → B", () => expect(scoreToGrade(89.9)).toBe("B"));
  it("maps 70 → B", () => expect(scoreToGrade(70)).toBe("B"));
  it("maps 69.9 → C", () => expect(scoreToGrade(69.9)).toBe("C"));
  it("maps 50 → C", () => expect(scoreToGrade(50)).toBe("C"));
  it("maps 49.9 → D", () => expect(scoreToGrade(49.9)).toBe("D"));
  it("maps 25 → D", () => expect(scoreToGrade(25)).toBe("D"));
  it("maps 24.9 → F", () => expect(scoreToGrade(24.9)).toBe("F"));
  it("maps 0 → F", () => expect(scoreToGrade(0)).toBe("F"));
  it("maps null → N/A", () => expect(scoreToGrade(null)).toBe("N/A"));
  it("maps 100 → A", () => expect(scoreToGrade(100)).toBe("A"));
});
