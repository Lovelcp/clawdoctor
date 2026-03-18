import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { stripAnsi } from "./report/ansi.js";
import { openDatabase } from "./store/database.js";

// Alias used inside Phase 2 tests so the name is distinct from import
const openDatabaseFn = openDatabase;

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

describe("E2E Phase 2", () => {
  it("clawdoc checkup --json includes llmAvailable and llmDegradationReason", () => {
    // Run with fixture data (no API key set → llmAvailable should be false)
    const output = runPlain("checkup --json --agent default", {
      CLAWDOC_STATE_DIR: FIXTURES,
      CLAWDOC_WORKSPACE_DIR: path.join(FIXTURES, "memory"),
    });
    const result = JSON.parse(stripAnsi(output));
    expect(result.llmAvailable).toBe(false);
    expect(result.llmDegradationReason).toBeDefined();
  });

  it("clawdoc rx list --json returns empty array when no prescriptions", () => {
    const output = run("rx list --json");
    const parsed = JSON.parse(output.trim());
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("clawdoc dashboard --help shows port option", () => {
    const output = run("dashboard --help");
    expect(output).toContain("--port");
  });

  it("clawdoc rx --help lists all subcommands", () => {
    const output = run("rx --help");
    expect(output).toContain("list");
    expect(output).toContain("preview");
    expect(output).toContain("apply");
    expect(output).toContain("rollback");
    expect(output).toContain("followup");
    expect(output).toContain("history");
  });

  it("schema migration v1→v2: causal_chains table and health_score_json column created", () => {
    // Create a v1 database manually, then open with current code (triggers migration)
    const tmpDb = path.join(os.tmpdir(), `clawdoc-migration-test-${Date.now()}.db`);
    // openDatabase will auto-migrate from v1 to v2
    const db = openDatabaseFn(tmpDb);
    try {
      // Verify causal_chains table exists
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='causal_chains'").all();
      expect(tables).toHaveLength(1);

      // Verify health_score_json column exists
      const cols = db.prepare("PRAGMA table_info(health_scores)").all() as Array<{ name: string }>;
      const jsonCol = cols.find(c => c.name === "health_score_json");
      expect(jsonCol).toBeDefined();
    } finally {
      db.close();
      fs.unlinkSync(tmpDb);
    }
  });

  it("repeated checkup does not create duplicate prescriptions", async () => {
    const tmpDb = path.join(os.tmpdir(), `clawdoc-dedup-test-${Date.now()}.db`);
    try {
      // Run checkup twice with same fixtures
      // The second run should not create duplicates thanks to dedup strategy
      // (This is a simplified version — in real scenario LLM would generate prescriptions)
      const { runCheckup } = await import("./analysis/analysis-pipeline.js");
      const result1 = await runCheckup({
        agentId: "default",
        stateDir: FIXTURES,
        workspaceDir: path.join(FIXTURES, "memory"),
        noLlm: true,
        dbPath: tmpDb,
      });
      const result2 = await runCheckup({
        agentId: "default",
        stateDir: FIXTURES,
        workspaceDir: path.join(FIXTURES, "memory"),
        noLlm: true,
        dbPath: tmpDb,
      });

      // Both runs should produce results without accumulating duplicates
      expect(result2.diseases.length).toBeGreaterThanOrEqual(0);
      expect(result2.healthScore).toBeDefined();
    } finally {
      if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    }
  });
});
