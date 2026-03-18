// ═══════════════════════════════════════════════
//  CI Integration Tests: determineExitCode
// ═══════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { determineExitCode } from "./checkup.js";

describe("determineExitCode", () => {
  it("returns 0 with no --fail-on option", () => {
    const diseases = [{ severity: "critical" }, { severity: "warning" }];
    expect(determineExitCode(diseases)).toBe(0);
  });

  it("returns 1 with --fail-on critical and a critical disease exists", () => {
    const diseases = [{ severity: "critical" }];
    expect(determineExitCode(diseases, "critical")).toBe(1);
  });

  it("returns 0 with --fail-on critical but only warnings present", () => {
    const diseases = [{ severity: "warning" }, { severity: "info" }];
    expect(determineExitCode(diseases, "critical")).toBe(0);
  });

  it("returns 1 with --fail-on warning and a warning exists", () => {
    const diseases = [{ severity: "warning" }];
    expect(determineExitCode(diseases, "warning")).toBe(1);
  });

  it("returns 0 with no diseases", () => {
    expect(determineExitCode([], "critical")).toBe(0);
  });
});
