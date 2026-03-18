// ═══════════════════════════════════════════════
//  Auto-Apply Filter Tests (TDD)
// ═══════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { filterAutoApplicable } from "./auto-apply.js";
import type { Prescription, PrescriptionAction } from "../types/domain.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFileEditAction(): PrescriptionAction {
  return {
    type: "file_edit",
    filePath: "/some/file.ts",
    diff: "--- a\n+++ b\n",
    description: { en: "Edit file" },
  };
}

function makeFileDeleteAction(): PrescriptionAction {
  return {
    type: "file_delete",
    filePath: "/some/file.ts",
    description: { en: "Delete file" },
  };
}

function makeConfigChangeAction(): PrescriptionAction {
  return {
    type: "config_change",
    key: "someKey",
    oldValue: "old",
    newValue: "new",
    description: { en: "Change config" },
  };
}

function makeCommandAction(): PrescriptionAction {
  return {
    type: "command",
    command: "npm run fix",
    description: { en: "Run command" },
  };
}

function makePrescription(
  overrides: Partial<Prescription> & { actions: PrescriptionAction[] },
): Prescription {
  return {
    id: "rx-001",
    diagnosisId: "diag-001",
    level: "guided",
    risk: "low",
    estimatedImprovement: { en: "+10% success rate" },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("filterAutoApplicable", () => {

  it("returns empty array for empty input", () => {
    expect(filterAutoApplicable([])).toEqual([]);
  });

  it("includes guided + low-risk prescription with file_edit actions", () => {
    const rx = makePrescription({ actions: [makeFileEditAction()] });
    expect(filterAutoApplicable([rx])).toHaveLength(1);
    expect(filterAutoApplicable([rx])[0]).toBe(rx);
  });

  it("includes guided + low-risk prescription with file_delete actions", () => {
    const rx = makePrescription({ actions: [makeFileDeleteAction()] });
    expect(filterAutoApplicable([rx])).toHaveLength(1);
  });

  it("includes guided + low-risk prescription with mixed file_edit and file_delete actions", () => {
    const rx = makePrescription({ actions: [makeFileEditAction(), makeFileDeleteAction()] });
    expect(filterAutoApplicable([rx])).toHaveLength(1);
  });

  it("excludes prescription with medium risk", () => {
    const rx = makePrescription({ risk: "medium", actions: [makeFileEditAction()] });
    expect(filterAutoApplicable([rx])).toHaveLength(0);
  });

  it("excludes prescription with high risk", () => {
    const rx = makePrescription({ risk: "high", actions: [makeFileEditAction()] });
    expect(filterAutoApplicable([rx])).toHaveLength(0);
  });

  it("excludes prescription with manual level", () => {
    const rx = makePrescription({ level: "manual", actions: [makeFileEditAction()] });
    expect(filterAutoApplicable([rx])).toHaveLength(0);
  });

  it("excludes prescription with config_change action", () => {
    const rx = makePrescription({ actions: [makeFileEditAction(), makeConfigChangeAction()] });
    expect(filterAutoApplicable([rx])).toHaveLength(0);
  });

  it("excludes prescription with command action", () => {
    const rx = makePrescription({ actions: [makeFileEditAction(), makeCommandAction()] });
    expect(filterAutoApplicable([rx])).toHaveLength(0);
  });

  it("returns only qualifying prescriptions from a mixed list", () => {
    const eligible = makePrescription({ id: "rx-ok", actions: [makeFileEditAction()] });
    const highRisk = makePrescription({ id: "rx-high", risk: "high", actions: [makeFileEditAction()] });
    const manual = makePrescription({ id: "rx-manual", level: "manual", actions: [makeFileEditAction()] });
    const hasCommand = makePrescription({ id: "rx-cmd", actions: [makeCommandAction()] });

    const result = filterAutoApplicable([eligible, highRisk, manual, hasCommand]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rx-ok");
  });

});
