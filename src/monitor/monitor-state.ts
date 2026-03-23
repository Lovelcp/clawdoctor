// ===============================================
//  Monitor State File
//  Atomic read/write of monitor state for
//  cross-process status inspection.
// ===============================================

import {
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import type { MonitorStateFile } from "../types/monitor.js";

const STATE_FILENAME = "monitor.state";
const STATE_TMP_FILENAME = "monitor.state.tmp";

/**
 * Write monitor state atomically using tmp + rename.
 *
 * This ensures readers never see a partially written file.
 */
export function writeMonitorState(
  stateDir: string,
  state: MonitorStateFile,
): void {
  const tmpPath = join(stateDir, STATE_TMP_FILENAME);
  const finalPath = join(stateDir, STATE_FILENAME);

  const json = JSON.stringify(state, null, 2);
  writeFileSync(tmpPath, json, "utf-8");
  renameSync(tmpPath, finalPath);
}

/**
 * Read monitor state from the state file.
 *
 * Returns null if the file does not exist or cannot be parsed.
 */
export function readMonitorState(
  stateDir: string,
): MonitorStateFile | null {
  const filePath = join(stateDir, STATE_FILENAME);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as MonitorStateFile;
  } catch {
    return null;
  }
}

/**
 * Check whether a process with the given PID is currently running.
 *
 * Uses `process.kill(pid, 0)` which sends signal 0 (existence check)
 * without actually killing the process.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete the monitor state file.
 *
 * Does not throw if the file does not exist.
 */
export function deleteMonitorState(stateDir: string): void {
  const filePath = join(stateDir, STATE_FILENAME);

  try {
    unlinkSync(filePath);
  } catch {
    // File may not exist — that's fine
  }
}
