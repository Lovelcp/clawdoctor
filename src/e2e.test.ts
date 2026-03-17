import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { stripAnsi } from "./report/ansi.js";

const ROOT = path.join(import.meta.dirname, "..");
const FIXTURES = path.join(ROOT, "fixtures");

// Helper to run CLI and capture output
function run(args: string, env?: Record<string, string>): string {
  return execSync(`npx tsx src/bin.ts ${args}`, {
    cwd: ROOT,
    encoding: "utf-8",
    env: { ...process.env, ...env },
    timeout: 30000,
  });
}

// Strip ANSI codes for content assertions on colored terminal output
function runPlain(args: string, env?: Record<string, string>): string {
  return stripAnsi(run(args, env));
}

describe("E2E", () => {
  it("clawdoc checkup --json produces valid JSON with health score", () => {
    // Run checkup against fixtures directory
    // The snapshot collector needs a stateDir with sessions/
    const output = run("checkup --json --agent default", {
      CLAWDOC_STATE_DIR: FIXTURES,
      CLAWDOC_WORKSPACE_DIR: path.join(FIXTURES, "memory"),
    });

    const result = JSON.parse(output);
    expect(result.healthScore).toBeDefined();
    expect(result.healthScore.dataMode).toBe("snapshot");
    expect(typeof result.healthScore.overall).toBe("number");
    expect(result.healthScore.coverage).toBeDefined();
    expect(result.healthScore.coverage.ratio).toBeGreaterThanOrEqual(0);
    expect(result.healthScore.departments).toBeDefined();
  });

  it("clawdoc checkup produces terminal report with Mode: snapshot", () => {
    const output = runPlain("checkup --agent default", {
      CLAWDOC_STATE_DIR: FIXTURES,
      CLAWDOC_WORKSPACE_DIR: path.join(FIXTURES, "memory"),
    });

    expect(output).toContain("ClawDoc Health Report");
    expect(output).toContain("Mode:");
    expect(output).toContain("snapshot");
    expect(output).toContain("Coverage:");
  });

  it("clawdoc config show outputs valid JSON config", () => {
    const output = run("config show");
    expect(output).toContain("locale");
    expect(output).toContain("thresholds");
  });

  it("clawdoc --version outputs version", () => {
    const output = run("--version");
    expect(output.trim()).toBe("0.1.0");
  });

  it("clawdoc --help lists available commands", () => {
    const output = run("--help");
    expect(output).toContain("checkup");
    expect(output).toContain("config");
    expect(output).toContain("skill");
    expect(output).toContain("memory");
    expect(output).toContain("cost");
    expect(output).toContain("security");
  });
});
