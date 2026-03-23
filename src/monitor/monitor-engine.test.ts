import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMonitorEngine } from "./monitor-engine.js";
import { openDatabase } from "../store/database.js";
import { createChartStore } from "../chart/chart-store.js";
import { createEventStore } from "../store/event-store.js";
import {
  readMonitorState,
  deleteMonitorState,
} from "./monitor-state.js";
import { DEFAULT_CONFIG } from "../types/config.js";
import type { ClawDoctorConfig } from "../types/config.js";
import type { ShellExecutor, ShellResult } from "./probe.js";
import type { PageChannel } from "../page/page-channel.js";
import type Database from "better-sqlite3";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Helpers ───

function createTestConfig(
  overrides: Partial<ClawDoctorConfig> = {},
): ClawDoctorConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...overrides,
    monitor: {
      ...DEFAULT_CONFIG.monitor,
      probes: {
        ...DEFAULT_CONFIG.monitor.probes,
        gateway: { enabled: true, intervalMs: 50, params: {} },
        session: { enabled: false, intervalMs: 60_000, params: {} },
        cost: { enabled: false, intervalMs: 300_000, spikeMultiplier: 3 },
        cron: { enabled: false, intervalMs: 60_000, params: {} },
        auth: { enabled: false, intervalMs: 60_000, params: {} },
        budget: { enabled: false, intervalMs: 300_000, dailyLimitUsd: 10 },
      },
      ...(overrides.monitor ?? {}),
    },
  };
}

function createMockExec(exitCode = 0): ShellExecutor {
  return vi.fn<ShellExecutor>().mockResolvedValue({
    stdout: "running",
    stderr: "",
    exitCode,
  });
}

function createMockPageChannel(): PageChannel {
  return {
    type: "webhook",
    send: vi.fn().mockResolvedValue({ success: true }),
  };
}

describe("MonitorEngine", () => {
  let db: Database.Database;
  let stateDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    db = openDatabase(":memory:");
    stateDir = mkdtempSync(join(tmpdir(), "monitor-engine-test-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    try {
      db.close();
    } catch {
      // ignore
    }
    try {
      rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("starts and runs probes", async () => {
    const exec = createMockExec(0); // gateway returns ok
    const channel = createMockPageChannel();
    const config = createTestConfig();

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec,
      pageChannels: [channel],
    });

    engine.start();

    // First probe run is immediate (setTimeout(0))
    await vi.advanceTimersByTimeAsync(0);

    // Verify exec was called (gateway probe)
    expect(exec).toHaveBeenCalled();

    // Verify probe result event was written
    const eventStore = createEventStore(db);
    const events = eventStore.queryEvents({ agentId: "monitor", type: "probe_result" });
    expect(events.length).toBeGreaterThanOrEqual(1);

    await engine.stop();
  });

  it("writes state file on heartbeat", async () => {
    const exec = createMockExec(0);
    const config = createTestConfig();

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec,
      pageChannels: [],
    });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    // State file should be written immediately on start
    const state = readMonitorState(stateDir);
    expect(state).not.toBeNull();
    expect(state!.pid).toBe(process.pid);

    await engine.stop();
  });

  it("deletes state file on stop", async () => {
    const exec = createMockExec(0);
    const config = createTestConfig();

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec,
      pageChannels: [],
    });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(readMonitorState(stateDir)).not.toBeNull();

    await engine.stop();

    expect(readMonitorState(stateDir)).toBeNull();
  });

  it("dispatches page alert when finding matches a disease", async () => {
    // Gateway returns exit code 1 (not running) + pgrep also fails
    const exec = vi.fn<ShellExecutor>().mockResolvedValue({
      stdout: "",
      stderr: "not found",
      exitCode: 1,
    });
    const channel = createMockPageChannel();
    const config = createTestConfig();

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec,
      pageChannels: [channel],
    });

    engine.start();

    // Run the gateway probe
    await vi.advanceTimersByTimeAsync(0);

    // Page channel should have been called with an alert
    expect(channel.send).toHaveBeenCalled();

    await engine.stop();
  });

  it("writes chart entry when finding matches a disease", async () => {
    const exec = vi.fn<ShellExecutor>().mockResolvedValue({
      stdout: "",
      stderr: "not found",
      exitCode: 1,
    });
    const config = createTestConfig();

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec,
      pageChannels: [],
    });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    // Verify chart entry was written
    const chartStore = createChartStore(db);
    const entries = chartStore.query({ limit: 10 });
    // At least one chart entry for the INFRA-001 finding
    expect(entries.some((e) => e.diseaseId === "INFRA-001")).toBe(true);

    await engine.stop();
  });

  it("writes final chart entry on stop", async () => {
    const exec = createMockExec(0);
    const config = createTestConfig();

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec,
      pageChannels: [],
    });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    await engine.stop();

    const chartStore = createChartStore(db);
    const entries = chartStore.query({ limit: 50 });
    expect(entries.some((e) => e.action === "monitor-stopped")).toBe(true);
  });

  it("reports status correctly", async () => {
    const exec = createMockExec(0);
    const config = createTestConfig();

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec,
      pageChannels: [],
    });

    // Before start
    const beforeStatus = engine.status();
    expect(beforeStatus.running).toBe(false);

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    const afterStatus = engine.status();
    expect(afterStatus.running).toBe(true);
    expect(Object.keys(afterStatus.probeStats)).toContain("gateway");

    await engine.stop();
  });

  it("throws on invalid config", () => {
    const config = createTestConfig({
      weights: {
        vitals: 0.5,
        skill: 0.5,
        memory: 0.5,
        behavior: 0.5,
        cost: 0.5,
        security: 0.5,
        infra: 0.5,
      },
    });

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec: createMockExec(0),
      pageChannels: [],
    });

    expect(() => engine.start()).toThrow("validation failed");
  });

  it("no page alert when gateway is healthy (no findings)", async () => {
    const exec = createMockExec(0);
    const channel = createMockPageChannel();
    const config = createTestConfig();

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec,
      pageChannels: [channel],
    });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    // Gateway is healthy, no page should be sent
    expect(channel.send).not.toHaveBeenCalled();

    await engine.stop();
  });
});
