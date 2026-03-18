import { describe, it, expect } from "vitest";
import { getDiseaseRegistry } from "./registry.js";
import type { RuleDetection } from "../types/domain.js";

// Valid metric keys from ClawInsightConfig thresholds (§4.1)
const VALID_METRIC_KEYS = new Set([
  "skill.successRate",
  "skill.avgDurationMs",
  "skill.errorBurstCount",
  "skill.singleCallTokens",
  "skill.zombieDays",
  "skill.repetitionCount",
  "skill.contextTokenRatio",
  "memory.staleAgeDays",
  "memory.totalFiles",
  "memory.totalSizeKB",
  "memory.conflictCount",
  "behavior.taskCompletionRate",
  "behavior.avgStepsPerTask",
  "behavior.loopDetectionThreshold",
  "behavior.verboseRatio",
  "cost.dailyTokens",
  "cost.cacheHitRate",
  "cost.singleCallTokens",
  "cost.luxurySessionTokenCeiling",
  "cost.spikeMultiplier",
  "cost.failedSessionTokenRatio",
  "cost.compactionTokenRatio",
  "security.exposedCredentials",
  "security.unsandboxedPlugins",
  "vitals.diskUsageMB",
  // Additional vitals metrics used by VIT-001~004
  "vitals.gatewayUnreachable",
  "vitals.configParseFailure",
  "vitals.gatewayVersionDelta",
  "vitals.pluginLoadErrors",
  // Additional skill metrics
  "skill.emptyResultRate",
  // Additional security metrics
  "security.injectionPatternCount",
  "security.unsignedSkills",
  "security.permissionOverreachCount",
  "security.openDmChannels",
  "security.staleCredentials",
  // Behavior metrics
  "behavior.abortRate",
]);

describe("getDiseaseRegistry", () => {
  const registry = getDiseaseRegistry();

  it("contains exactly 43 disease definitions", () => {
    expect(registry.getAll()).toHaveLength(43);
  });

  it("returns correct counts per department", () => {
    const all = registry.getAll();
    const byCounts: Record<string, number> = {};
    for (const d of all) {
      byCounts[d.department] = (byCounts[d.department] ?? 0) + 1;
    }
    expect(byCounts["vitals"]).toBe(5);
    expect(byCounts["skill"]).toBe(10);
    expect(byCounts["memory"]).toBe(7);
    expect(byCounts["behavior"]).toBe(7);
    expect(byCounts["cost"]).toBe(6);
    expect(byCounts["security"]).toBe(8);
  });

  it("lookup by ID returns correct disease (SK-001)", () => {
    const sk001 = registry.getById("SK-001");
    expect(sk001).toBeDefined();
    expect(sk001?.name.en).toBe("Token Obesity");
    expect(sk001?.name.zh).toBe("Token 肥胖症");
  });

  it("getByDepartment returns correct diseases for vitals", () => {
    const vitals = registry.getByDepartment("vitals");
    expect(vitals).toHaveLength(5);
    expect(vitals.every((d) => d.department === "vitals")).toBe(true);
  });

  it("every disease has en + zh names", () => {
    for (const disease of registry.getAll()) {
      expect(disease.name.en, `${disease.id} missing name.en`).toBeTruthy();
      expect(disease.name.zh, `${disease.id} missing name.zh`).toBeTruthy();
    }
  });

  it("every disease has en + zh descriptions", () => {
    for (const disease of registry.getAll()) {
      expect(
        disease.description.en,
        `${disease.id} missing description.en`
      ).toBeTruthy();
      expect(
        disease.description.zh,
        `${disease.id} missing description.zh`
      ).toBeTruthy();
    }
  });

  it("rule-based diseases have valid metric keys", () => {
    for (const disease of registry.getAll()) {
      const det = disease.detection;
      if (det.type === "rule") {
        expect(
          VALID_METRIC_KEYS.has(det.metric),
          `${disease.id} has invalid metric key: ${det.metric}`
        ).toBe(true);
      } else if (det.type === "hybrid") {
        expect(
          VALID_METRIC_KEYS.has(det.preFilter.metric),
          `${disease.id} hybrid preFilter has invalid metric key: ${det.preFilter.metric}`
        ).toBe(true);
      }
    }
  });

  it("all disease IDs are unique", () => {
    const ids = registry.getAll().map((d) => d.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("getById returns undefined for unknown ID", () => {
    expect(registry.getById("UNKNOWN-999")).toBeUndefined();
  });

  it("rule-based diseases have warning threshold < critical for higher_is_worse", () => {
    for (const disease of registry.getAll()) {
      const det = disease.detection;
      const ruleDetections: RuleDetection[] = [];
      if (det.type === "rule") ruleDetections.push(det);
      if (det.type === "hybrid") ruleDetections.push(det.preFilter);

      for (const rule of ruleDetections) {
        if (rule.direction === "higher_is_worse") {
          expect(
            rule.defaultThresholds.warning,
            `${disease.id} warning should be < critical for higher_is_worse`
          ).toBeLessThan(rule.defaultThresholds.critical);
        } else {
          // lower_is_worse: warning > critical
          expect(
            rule.defaultThresholds.warning,
            `${disease.id} warning should be > critical for lower_is_worse`
          ).toBeGreaterThan(rule.defaultThresholds.critical);
        }
      }
    }
  });

  it("VIT diseases are all rule type", () => {
    const vitals = registry.getByDepartment("vitals");
    expect(vitals.every((d) => d.detection.type === "rule")).toBe(true);
  });

  it("CST diseases are all rule type", () => {
    const cost = registry.getByDepartment("cost");
    expect(cost.every((d) => d.detection.type === "rule")).toBe(true);
  });

  it("SK-002/005/010 are hybrid type", () => {
    for (const id of ["SK-002", "SK-005", "SK-010"]) {
      const d = registry.getById(id);
      expect(d?.detection.type, `${id} should be hybrid`).toBe("hybrid");
    }
  });

  it("SK-003/008 are LLM type", () => {
    for (const id of ["SK-003", "SK-008"]) {
      const d = registry.getById(id);
      expect(d?.detection.type, `${id} should be llm`).toBe("llm");
    }
  });

  it("MEM-001/002/004 are LLM type", () => {
    for (const id of ["MEM-001", "MEM-002", "MEM-004"]) {
      const d = registry.getById(id);
      expect(d?.detection.type, `${id} should be llm`).toBe("llm");
    }
  });

  it("MEM-006/007 are hybrid type", () => {
    for (const id of ["MEM-006", "MEM-007"]) {
      const d = registry.getById(id);
      expect(d?.detection.type, `${id} should be hybrid`).toBe("hybrid");
    }
  });

  it("BHV-002 is hybrid type", () => {
    expect(registry.getById("BHV-002")?.detection.type).toBe("hybrid");
  });

  it("SEC-005 is hybrid type", () => {
    expect(registry.getById("SEC-005")?.detection.type).toBe("hybrid");
  });
});
