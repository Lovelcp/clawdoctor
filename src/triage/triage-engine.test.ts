import { describe, it, expect } from "vitest";
import { triageAlertOnly } from "./triage-engine.js";
import type { DiseaseInstance } from "../types/domain.js";

function createDiseaseInstance(
  overrides: Partial<DiseaseInstance> = {},
): DiseaseInstance {
  const now = Date.now();
  return {
    id: "test-instance-001",
    definitionId: "INFRA-001",
    severity: "critical",
    evidence: [],
    confidence: 1.0,
    firstDetectedAt: now,
    lastSeenAt: now,
    status: "active",
    context: {},
    ...overrides,
  };
}

describe("triageAlertOnly", () => {
  it("returns triage level 'red' for any disease", () => {
    const disease = createDiseaseInstance();
    const result = triageAlertOnly(disease);

    expect(result.level).toBe("red");
  });

  it("includes the disease definitionId", () => {
    const disease = createDiseaseInstance({ definitionId: "CST-010" });
    const result = triageAlertOnly(disease);

    expect(result.diseaseId).toBe("CST-010");
  });

  it("extracts agentId from disease context when present", () => {
    const disease = createDiseaseInstance({
      context: { agentId: "main" },
    });
    const result = triageAlertOnly(disease);

    expect(result.agentId).toBe("main");
  });

  it("leaves agentId undefined when not in context", () => {
    const disease = createDiseaseInstance({ context: {} });
    const result = triageAlertOnly(disease);

    expect(result.agentId).toBeUndefined();
  });

  it("provides reason in both en and zh", () => {
    const disease = createDiseaseInstance();
    const result = triageAlertOnly(disease);

    expect(result.reason.en).toBeTruthy();
    expect(result.reason.zh).toBeTruthy();
  });

  it("returns red for warning severity too (Phase 1 = always red)", () => {
    const disease = createDiseaseInstance({ severity: "warning" });
    const result = triageAlertOnly(disease);

    expect(result.level).toBe("red");
  });

  it("returns red for info severity too (Phase 1 = always red)", () => {
    const disease = createDiseaseInstance({ severity: "info" });
    const result = triageAlertOnly(disease);

    expect(result.level).toBe("red");
  });
});
