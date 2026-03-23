import { describe, it, expect, vi } from "vitest";
import { matchFindingToDisease } from "./probe-disease-match.js";
import type { DiseaseRegistry } from "../diseases/registry.js";
import type { Finding } from "../types/monitor.js";
import type { DiseaseDefinition } from "../types/domain.js";

// --- Stub registry ---

function createStubRegistry(
  diseases: DiseaseDefinition[],
): DiseaseRegistry {
  return {
    getAll: () => diseases,
    getById: (id: string) => diseases.find((d) => d.id === id),
    getByDepartment: (dept) => diseases.filter((d) => d.department === dept),
  };
}

const INFRA_001: DiseaseDefinition = {
  id: "INFRA-001",
  department: "infra",
  category: "connectivity",
  name: { en: "Gateway Cardiac Arrest", zh: "网关心脏骤停" },
  description: { en: "Gateway down", zh: "网关离线" },
  rootCauses: [{ en: "Crashed", zh: "崩溃" }],
  detection: {
    type: "rule",
    metric: "infra.gatewayProcessDown",
    direction: "higher_is_worse",
    defaultThresholds: { warning: 1, critical: 1 },
  },
  prescriptionTemplate: {
    level: "guided",
    actionTypes: ["command"],
    promptTemplate: "Restart gateway",
    estimatedImprovementTemplate: { en: "Restore connectivity", zh: "恢复连接" },
    risk: "low",
  },
  relatedDiseases: [],
  defaultSeverity: "critical",
  tags: ["infra"],
};

describe("matchFindingToDisease", () => {
  it("matches a finding with a known disease code to a DiseaseInstance", () => {
    const registry = createStubRegistry([INFRA_001]);
    const finding: Finding = {
      code: "INFRA-001",
      message: { en: "Gateway is not running" },
      severity: "critical",
      context: { pid: null },
    };

    const result = matchFindingToDisease(finding, registry);

    expect(result).not.toBeNull();
    expect(result!.definitionId).toBe("INFRA-001");
    expect(result!.severity).toBe("critical");
    expect(result!.confidence).toBe(1.0);
    expect(result!.status).toBe("active");
    expect(result!.id).toBeTruthy();
    expect(result!.evidence).toHaveLength(1);
    expect(result!.evidence[0].type).toBe("metric");
  });

  it("returns null for an unknown disease code", () => {
    const registry = createStubRegistry([INFRA_001]);
    const finding: Finding = {
      code: "UNKNOWN-999",
      message: { en: "Unknown issue" },
      severity: "warning",
      context: {},
    };

    const result = matchFindingToDisease(finding, registry);

    expect(result).toBeNull();
  });

  it("preserves finding context in the disease instance", () => {
    const registry = createStubRegistry([INFRA_001]);
    const finding: Finding = {
      code: "INFRA-001",
      message: { en: "Gateway down" },
      severity: "critical",
      context: { pid: null, host: "localhost" },
    };

    const result = matchFindingToDisease(finding, registry);

    expect(result).not.toBeNull();
    expect(result!.context).toEqual({ pid: null, host: "localhost" });
  });

  it("uses finding severity rather than disease defaultSeverity", () => {
    const registry = createStubRegistry([INFRA_001]);
    const finding: Finding = {
      code: "INFRA-001",
      message: { en: "Gateway intermittent" },
      severity: "warning",
      context: {},
    };

    const result = matchFindingToDisease(finding, registry);

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
  });

  it("generates unique IDs for each match", () => {
    const registry = createStubRegistry([INFRA_001]);
    const finding: Finding = {
      code: "INFRA-001",
      message: { en: "Gateway down" },
      severity: "critical",
      context: {},
    };

    const result1 = matchFindingToDisease(finding, registry);
    const result2 = matchFindingToDisease(finding, registry);

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.id).not.toBe(result2!.id);
  });
});
