// ═══════════════════════════════════════════════
//  Follow-up Verdict Tests (TDD)
// ═══════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { computeFollowUpVerdict } from "./followup.js";
import type { MetricSnapshot } from "../types/domain.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshot(
  metrics: Record<string, number>,
  diseaseId = "SK-001",
): MetricSnapshot {
  return {
    timestamp: Date.now(),
    metrics,
    diseaseId,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeFollowUpVerdict", () => {

  // ─── resolved ─────────────────────────────────────────────────────────────

  it("returns resolved when lower-is-worse metric improves >= 20%", () => {
    // successRate: lower is worse; increased from 0.5 to 0.65 → +30% → improvement
    const before = makeSnapshot({ "skill.successRate": 0.5 });
    const after = makeSnapshot({ "skill.successRate": 0.65 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("resolved");
  });

  it("returns resolved when higher-is-worse metric decreases >= 20%", () => {
    // errorCount: higher is worse; decreased from 100 to 70 → -30% → improvement
    const before = makeSnapshot({ "skill.errorCount": 100 });
    const after = makeSnapshot({ "skill.errorCount": 70 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("resolved");
  });

  it("returns resolved when average across metrics is >= 20%", () => {
    // successRate: +30%, errorCount: -40% (improvement) → avg +35%
    const before = makeSnapshot({ "skill.successRate": 0.5, "skill.errorCount": 50 });
    const after = makeSnapshot({ "skill.successRate": 0.65, "skill.errorCount": 30 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("resolved");
  });

  // ─── improving ────────────────────────────────────────────────────────────

  it("returns improving when average improvement is between 5% and 20%", () => {
    // successRate: 0.5 → 0.55 = +10% improvement
    const before = makeSnapshot({ "skill.successRate": 0.5 });
    const after = makeSnapshot({ "skill.successRate": 0.55 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("improving");
  });

  it("returns improving for small improvement in higher-is-worse metric", () => {
    // errorCount: 100 → 90 → -10% → +10% normalized improvement
    const before = makeSnapshot({ "skill.errorCount": 100 });
    const after = makeSnapshot({ "skill.errorCount": 90 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("improving");
  });

  // ─── unchanged ────────────────────────────────────────────────────────────

  it("returns unchanged when change is below 5%", () => {
    // successRate: 0.5 → 0.52 = +4% → below improving threshold
    const before = makeSnapshot({ "skill.successRate": 0.5 });
    const after = makeSnapshot({ "skill.successRate": 0.52 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("unchanged");
  });

  it("returns unchanged when metrics are identical", () => {
    const before = makeSnapshot({ "skill.successRate": 0.7 });
    const after = makeSnapshot({ "skill.successRate": 0.7 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("unchanged");
  });

  // ─── worsened ─────────────────────────────────────────────────────────────

  it("returns worsened when lower-is-worse metric decreases > 5%", () => {
    // successRate: 0.7 → 0.63 = -10% → worsened
    const before = makeSnapshot({ "skill.successRate": 0.7 });
    const after = makeSnapshot({ "skill.successRate": 0.63 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("worsened");
  });

  it("returns worsened without rollback suggestion when change is between -5% and -15%", () => {
    // successRate: 0.7 → 0.63 = -10%
    const before = makeSnapshot({ "skill.successRate": 0.7 });
    const after = makeSnapshot({ "skill.successRate": 0.63 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("worsened");
    if (verdict.status === "worsened") {
      expect(verdict.suggestRollback).toBe(false);
    }
  });

  it("returns worsened with rollback suggestion when change is <= -15%", () => {
    // successRate: 0.8 → 0.64 = -20% → suggest rollback
    const before = makeSnapshot({ "skill.successRate": 0.8 });
    const after = makeSnapshot({ "skill.successRate": 0.64 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("worsened");
    if (verdict.status === "worsened") {
      expect(verdict.suggestRollback).toBe(true);
    }
  });

  // ─── no shared keys ────────────────────────────────────────────────────────

  it("returns unchanged with message when no shared metric keys", () => {
    const before = makeSnapshot({ "skill.successRate": 0.7 });
    const after = makeSnapshot({ "memory.fileCount": 10 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("unchanged");
    expect(verdict.message.en).toContain("No shared metrics");
  });

  // ─── zero before-value handling ───────────────────────────────────────────

  it("handles zero before-values by skipping those metrics", () => {
    // "skill.errorCount" before = 0 → skipped; "skill.successRate" +25% → resolved
    const before = makeSnapshot({ "skill.errorCount": 0, "skill.successRate": 0.6 });
    const after = makeSnapshot({ "skill.errorCount": 5, "skill.successRate": 0.75 });

    const verdict = computeFollowUpVerdict(before, after);
    // Only successRate counted: +25% → resolved
    expect(verdict.status).toBe("resolved");
  });

  it("returns unchanged when all before-values are zero", () => {
    const before = makeSnapshot({ "skill.successRate": 0 });
    const after = makeSnapshot({ "skill.successRate": 0.5 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("unchanged");
    expect(verdict.message.en).toContain("zero");
  });

  // ─── verdict message contains percent ────────────────────────────────────

  it("verdict message includes percentage information", () => {
    const before = makeSnapshot({ "skill.successRate": 0.5 });
    const after = makeSnapshot({ "skill.successRate": 0.65 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.message.en).toMatch(/\d+%/);
  });

  // ─── multiple metrics mixed ───────────────────────────────────────────────

  it("averages across multiple metrics for final verdict", () => {
    // successRate: 0.6 → 0.66 = +10% (lower-is-worse = improvement)
    // errorCount: 20 → 18 = -10% (higher-is-worse = improvement)
    // Average = +10% → improving
    const before = makeSnapshot({ "skill.successRate": 0.6, "skill.errorCount": 20 });
    const after = makeSnapshot({ "skill.successRate": 0.66, "skill.errorCount": 18 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("improving");
  });

  // ─── cache hit rate (lower-is-worse) ─────────────────────────────────────

  it("treats cache hit rate as lower-is-worse metric", () => {
    // cacheHitRate: 0.1 → 0.15 = +50% → resolved
    const before = makeSnapshot({ "cost.cacheHitRate": 0.1 });
    const after = makeSnapshot({ "cost.cacheHitRate": 0.15 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("resolved");
  });

  // ─── token count (higher-is-worse) ───────────────────────────────────────

  it("treats token count as higher-is-worse metric", () => {
    // tokenCount: 100000 → 75000 = -25% → improvement of 25% → resolved
    const before = makeSnapshot({ "cost.totalTokenCount": 100000 });
    const after = makeSnapshot({ "cost.totalTokenCount": 75000 });

    const verdict = computeFollowUpVerdict(before, after);
    expect(verdict.status).toBe("resolved");
  });
});
