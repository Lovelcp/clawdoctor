// ===============================================
//  Probe Interface
//  Design spec: continuous monitoring §Probe
// ===============================================

import type Database from "better-sqlite3";
import type { ProbeConfig, ProbeResult } from "../types/monitor.js";
import type { EventStore } from "../store/event-store.js";

// --- Shell execution result ---

export interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// --- Shell executor function type ---

export type ShellExecutor = (
  bin: string,
  args: readonly string[],
  opts?: { readonly timeoutMs?: number; readonly cwd?: string },
) => Promise<ShellResult>;

// --- Dependencies injected into each probe ---

export interface ProbeDeps {
  readonly stateDir: string;
  readonly exec: ShellExecutor;
  readonly store: EventStore;
  readonly db: Database.Database;
}

// --- Probe function signature ---

export type Probe = (config: ProbeConfig, deps: ProbeDeps) => Promise<ProbeResult>;
