import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sessionProbe } from "./session-probe.js";
import type { ProbeConfig } from "../../types/monitor.js";
import type { ProbeDeps } from "../probe.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function makeDeps(stateDir: string): ProbeDeps {
  return {
    stateDir,
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    store: {} as ProbeDeps["store"],
    db: {} as ProbeDeps["db"],
  };
}

function makeConfig(params: Record<string, unknown> = {}): ProbeConfig {
  return {
    id: "session",
    intervalMs: 60000,
    enabled: true,
    params,
  };
}

describe("sessionProbe", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-probe-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns ok when sessions directory does not exist", async () => {
    const result = await sessionProbe(makeConfig(), makeDeps(tmpDir));

    expect(result.probeId).toBe("session");
    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(0);
  });

  it("returns ok when sessions directory is empty", async () => {
    fs.mkdirSync(path.join(tmpDir, "sessions"));

    const result = await sessionProbe(makeConfig(), makeDeps(tmpDir));

    expect(result.probeId).toBe("session");
    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(0);
  });

  it("returns ok when session files have recent mtime", async () => {
    const sessDir = path.join(tmpDir, "sessions", "session-1");
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, "events.jsonl"), "{}");
    // mtime is now, which is recent

    const result = await sessionProbe(makeConfig(), makeDeps(tmpDir));

    expect(result.probeId).toBe("session");
    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(0);
  });

  it("returns warning with BHV-010 when session file mtime is older than threshold", async () => {
    const sessDir = path.join(tmpDir, "sessions", "session-old");
    fs.mkdirSync(sessDir, { recursive: true });
    const filePath = path.join(sessDir, "events.jsonl");
    fs.writeFileSync(filePath, "{}");

    // Set mtime to 3 hours ago (threshold is 2h = 7200000ms)
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    fs.utimesSync(filePath, threeHoursAgo, threeHoursAgo);

    const result = await sessionProbe(makeConfig(), makeDeps(tmpDir));

    expect(result.probeId).toBe("session");
    expect(result.status).toBe("warning");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe("BHV-010");
    expect(result.findings[0].severity).toBe("warning");
    expect(result.findings[0].message.en).toBeTruthy();
    expect(result.findings[0].context).toHaveProperty("sessionKey", "session-old");
  });

  it("respects custom inactiveThresholdMs parameter", async () => {
    const sessDir = path.join(tmpDir, "sessions", "session-custom");
    fs.mkdirSync(sessDir, { recursive: true });
    const filePath = path.join(sessDir, "events.jsonl");
    fs.writeFileSync(filePath, "{}");

    // Set mtime to 30 minutes ago
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    fs.utimesSync(filePath, thirtyMinAgo, thirtyMinAgo);

    // With default threshold (2h), this should be ok
    const resultDefault = await sessionProbe(makeConfig(), makeDeps(tmpDir));
    expect(resultDefault.status).toBe("ok");

    // With custom threshold (15 min), this should be warning
    const resultCustom = await sessionProbe(
      makeConfig({ inactiveThresholdMs: 15 * 60 * 1000 }),
      makeDeps(tmpDir),
    );
    expect(resultCustom.status).toBe("warning");
    expect(resultCustom.findings).toHaveLength(1);
    expect(resultCustom.findings[0].code).toBe("BHV-010");
  });

  it("reports multiple inactive sessions", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

    for (const name of ["sess-a", "sess-b"]) {
      const sessDir = path.join(tmpDir, "sessions", name);
      fs.mkdirSync(sessDir, { recursive: true });
      const filePath = path.join(sessDir, "events.jsonl");
      fs.writeFileSync(filePath, "{}");
      fs.utimesSync(filePath, threeHoursAgo, threeHoursAgo);
    }

    const result = await sessionProbe(makeConfig(), makeDeps(tmpDir));

    expect(result.status).toBe("warning");
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((f) => f.code === "BHV-010")).toBe(true);
  });

  it("uses latest mtime across all files in a session directory", async () => {
    const sessDir = path.join(tmpDir, "sessions", "session-multi");
    fs.mkdirSync(sessDir, { recursive: true });

    // Old file
    const oldFile = path.join(sessDir, "old.jsonl");
    fs.writeFileSync(oldFile, "{}");
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, threeHoursAgo, threeHoursAgo);

    // Recent file — should make session ok
    const newFile = path.join(sessDir, "new.jsonl");
    fs.writeFileSync(newFile, "{}");

    const result = await sessionProbe(makeConfig(), makeDeps(tmpDir));

    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(0);
  });
});
