import { describe, it, expect } from "vitest";
import { infraDiseases } from "./infra.js";

describe("infra diseases", () => {
  it("defines 6 diseases", () => {
    expect(infraDiseases).toHaveLength(6);
  });

  it("all diseases have department 'infra'", () => {
    for (const d of infraDiseases) {
      expect(d.department).toBe("infra");
    }
  });

  it("all IDs start with INFRA-", () => {
    for (const d of infraDiseases) {
      expect(d.id).toMatch(/^INFRA-\d{3}$/);
    }
  });

  it("has i18n name and description for en and zh", () => {
    for (const d of infraDiseases) {
      expect(d.name.en).toBeTruthy();
      expect(d.name.zh).toBeTruthy();
      expect(d.description.en).toBeTruthy();
      expect(d.description.zh).toBeTruthy();
    }
  });

  it("INFRA-001 is critical severity", () => {
    const gw = infraDiseases.find((d) => d.id === "INFRA-001");
    expect(gw).toBeDefined();
    expect(gw!.defaultSeverity).toBe("critical");
  });

  it("INFRA-005 is critical severity", () => {
    const budget = infraDiseases.find((d) => d.id === "INFRA-005");
    expect(budget).toBeDefined();
    expect(budget!.defaultSeverity).toBe("critical");
  });

  it("all diseases have rule detection type", () => {
    for (const d of infraDiseases) {
      expect(d.detection.type).toBe("rule");
    }
  });

  it("all diseases have at least one root cause", () => {
    for (const d of infraDiseases) {
      expect(d.rootCauses.length).toBeGreaterThan(0);
    }
  });

  it("all root causes have en and zh", () => {
    for (const d of infraDiseases) {
      for (const rc of d.rootCauses) {
        expect(rc.en).toBeTruthy();
        expect(rc.zh).toBeTruthy();
      }
    }
  });

  it("all diseases have tags", () => {
    for (const d of infraDiseases) {
      expect(d.tags.length).toBeGreaterThan(0);
    }
  });

  it("INFRA-001 name is Gateway Cardiac Arrest", () => {
    const gw = infraDiseases.find((d) => d.id === "INFRA-001");
    expect(gw!.name.en).toBe("Gateway Cardiac Arrest");
    expect(gw!.name.zh).toBe("网关心脏骤停");
  });

  it("IDs are sequential from 001 to 006", () => {
    const ids = infraDiseases.map((d) => d.id).sort();
    expect(ids).toEqual([
      "INFRA-001",
      "INFRA-002",
      "INFRA-003",
      "INFRA-004",
      "INFRA-005",
      "INFRA-006",
    ]);
  });
});
