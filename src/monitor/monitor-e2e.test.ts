// ===============================================
//  Monitor E2E Smoke Test
//  Integration test with file-based SQLite (not :memory:)
//  Verifies the full pipeline: engine → probes → events → chart
// ===============================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMonitorEngine } from "./monitor-engine.js";
import { openDatabase } from "../store/database.js";
import { createChartStore } from "../chart/chart-store.js";
import { createEventStore } from "../store/event-store.js";
import { readMonitorState } from "./monitor-state.js";
import { DEFAULT_CONFIG } from "../types/config.js";
import type { ClawDoctorConfig } from "../types/config.js";
import type { ShellExecutor } from "./probe.js";
import type { PageChannel } from "../page/page-channel.js";
import type Database from "better-sqlite3";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Monitor E2E Smoke Test", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;
  let stateDir: string;

  beforeEach(() => {
    vi.useFakeTimers();

    // Create temp directory structure
    tmpDir = mkdtempSync(join(tmpdir(), "monitor-e2e-"));
    stateDir = tmpDir;
    dbPath = join(tmpDir, "clawdoctor.db");
    db = openDatabase(dbPath);

    // Create mock stateDir with a fake old session
    const sessionsDir = join(tmpDir, "sessions", "old-session");
    mkdirSync(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, "events.jsonl");
    writeFileSync(sessionFile, '{"type":"llm_call"}\n');
    // Set mtime to 3 hours ago (exceeds 2h threshold)
    const oldTime = new Date(Date.now() - 3 * 3_600_000);
    utimesSync(sessionFile, oldTime, oldTime);
  });

  afterEach(async () => {
    vi.useRealTimers();
    try {
      db.close();
    } catch {
      // ignore
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("runs full pipeline: probes → events → chart → state file → graceful stop", async () => {
    // Config: enable gateway (ok) and session (will detect stale session)
    const config: ClawDoctorConfig = {
      ...structuredClone(DEFAULT_CONFIG),
      monitor: {
        ...DEFAULT_CONFIG.monitor,
        probes: {
          ...DEFAULT_CONFIG.monitor.probes,
          gateway: { enabled: true, intervalMs: 50, params: {} },
          session: { enabled: true, intervalMs: 50, params: {} },
          cost: { enabled: false, intervalMs: 300_000, spikeMultiplier: 3 },
          cron: { enabled: false, intervalMs: 60_000, params: {} },
          auth: { enabled: false, intervalMs: 60_000, params: {} },
          budget: { enabled: false, intervalMs: 300_000, dailyLimitUsd: 10 },
        },
      },
    };

    // Mock ShellExecutor: gateway returns ok
    const exec: ShellExecutor = vi
      .fn<ShellExecutor>()
      .mockResolvedValue({
        stdout: "running",
        stderr: "",
        exitCode: 0,
      });

    // Mock page channel to track dispatched alerts
    const sentMessages: unknown[] = [];
    const channel: PageChannel = {
      type: "webhook",
      send: vi.fn().mockImplementation(async (msg) => {
        sentMessages.push(msg);
        return { success: true };
      }),
    };

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec,
      pageChannels: [channel],
    });

    // Start engine
    engine.start();

    // Let probes run (first run is immediate via setTimeout(0))
    await vi.advanceTimersByTimeAsync(0);

    // ── Verify: events written to SQLite ──
    const eventStore = createEventStore(db);
    const events = eventStore.queryEvents({
      agentId: "monitor",
      type: "probe_result",
    });
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Verify at least one event has probe_result data
    const probeEvent = events[0];
    expect(probeEvent.type).toBe("probe_result");

    // ── Verify: chart entries created ──
    const chartStore = createChartStore(db);
    const chartEntries = chartStore.query({ limit: 50 });
    // Session probe should detect the old session and create a chart entry
    const sessionChartEntry = chartEntries.find(
      (e) => e.diseaseId === "BHV-010",
    );
    expect(sessionChartEntry).toBeDefined();

    // ── Verify: page alerts dispatched for stale session ──
    expect(channel.send).toHaveBeenCalled();

    // ── Verify: state file written ──
    const state = readMonitorState(stateDir);
    expect(state).not.toBeNull();
    expect(state!.pid).toBe(process.pid);

    // ── Graceful stop ──
    await engine.stop();

    // ── Verify: state file cleaned up ──
    expect(readMonitorState(stateDir)).toBeNull();

    // ── Verify: final chart entry written ──
    const finalEntries = chartStore.query({ limit: 50 });
    expect(
      finalEntries.some((e) => e.action === "monitor-stopped"),
    ).toBe(true);
  });

  it("writes probe_result events to file-based SQLite", async () => {
    const config: ClawDoctorConfig = {
      ...structuredClone(DEFAULT_CONFIG),
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
      },
    };

    const exec: ShellExecutor = vi
      .fn<ShellExecutor>()
      .mockResolvedValue({
        stdout: "",
        stderr: "not found",
        exitCode: 1,
      });

    const engine = createMonitorEngine(config, {
      db,
      stateDir,
      exec,
      pageChannels: [],
    });

    engine.start();
    await vi.advanceTimersByTimeAsync(0);

    // Close engine
    await engine.stop();

    // Reopen database to verify persistence
    db.close();
    const db2 = openDatabase(dbPath);
    const eventStore = createEventStore(db2);
    const events = eventStore.queryEvents({
      agentId: "monitor",
      type: "probe_result",
    });
    expect(events.length).toBeGreaterThanOrEqual(1);

    const chartStore = createChartStore(db2);
    const entries = chartStore.query({ limit: 50 });
    // Should have INFRA-001 chart entry + monitor-stopped
    expect(entries.length).toBeGreaterThanOrEqual(2);

    db2.close();
  });
});
