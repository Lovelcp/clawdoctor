import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeMonitorState,
  readMonitorState,
  isProcessRunning,
  deleteMonitorState,
} from "./monitor-state.js";
import type { MonitorStateFile } from "../types/monitor.js";

function createState(overrides: Partial<MonitorStateFile> = {}): MonitorStateFile {
  return {
    pid: process.pid,
    startedAt: Date.now(),
    lastHeartbeat: Date.now(),
    probeStats: {},
    pendingConsents: 0,
    todayInterventions: { executed: 0, failed: 0 },
    ...overrides,
  };
}

describe("monitor-state", () => {
  const tempDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "clawdoc-state-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    tempDirs.length = 0;
  });

  describe("writeMonitorState + readMonitorState", () => {
    it("writes and reads back a state file", () => {
      const dir = makeTmpDir();
      const state = createState();

      writeMonitorState(dir, state);
      const read = readMonitorState(dir);

      expect(read).not.toBeNull();
      expect(read!.pid).toBe(state.pid);
      expect(read!.startedAt).toBe(state.startedAt);
      expect(read!.lastHeartbeat).toBe(state.lastHeartbeat);
      expect(read!.pendingConsents).toBe(0);
      expect(read!.todayInterventions).toEqual({ executed: 0, failed: 0 });
    });

    it("preserves probeStats in the round trip", () => {
      const dir = makeTmpDir();
      const state = createState({
        probeStats: {
          gateway: {
            lastRunAt: 1000,
            lastStatus: "ok",
            runCount: 5,
            consecutiveErrors: 0,
            totalErrors: 1,
          },
        },
      });

      writeMonitorState(dir, state);
      const read = readMonitorState(dir);

      expect(read).not.toBeNull();
      expect(read!.probeStats["gateway"]).toEqual({
        lastRunAt: 1000,
        lastStatus: "ok",
        runCount: 5,
        consecutiveErrors: 0,
        totalErrors: 1,
      });
    });

    it("overwrites existing state file", () => {
      const dir = makeTmpDir();
      const state1 = createState({ pid: 111 });
      const state2 = createState({ pid: 222 });

      writeMonitorState(dir, state1);
      writeMonitorState(dir, state2);

      const read = readMonitorState(dir);
      expect(read!.pid).toBe(222);
    });
  });

  describe("readMonitorState — missing file", () => {
    it("returns null when state file does not exist", () => {
      const dir = makeTmpDir();
      const read = readMonitorState(dir);
      expect(read).toBeNull();
    });
  });

  describe("deleteMonitorState", () => {
    it("removes the state file", () => {
      const dir = makeTmpDir();
      writeMonitorState(dir, createState());

      deleteMonitorState(dir);

      const read = readMonitorState(dir);
      expect(read).toBeNull();
    });

    it("does not throw when state file does not exist", () => {
      const dir = makeTmpDir();
      expect(() => deleteMonitorState(dir)).not.toThrow();
    });
  });

  describe("isProcessRunning", () => {
    it("returns true for the current process PID", () => {
      expect(isProcessRunning(process.pid)).toBe(true);
    });

    it("returns false for a PID that does not exist", () => {
      // Use a very high PID that almost certainly doesn't exist
      expect(isProcessRunning(9999999)).toBe(false);
    });
  });
});
