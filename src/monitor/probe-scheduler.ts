// ===============================================
//  Probe Scheduler — non-overlapping async timers
//  Design spec: continuous monitoring §Scheduler
// ===============================================

import type { ProbeConfig, ProbeResult, ProbeStats, ProbeId } from "../types/monitor.js";
import type { Probe } from "./probe.js";

// --- Probe entry provided at start() ---

export interface ProbeEntry {
  readonly config: ProbeConfig;
  readonly fn: Probe;
}

// --- Scheduler interface ---

export interface ProbeScheduler {
  start(probes: readonly ProbeEntry[]): void;
  stop(): Promise<void>;
  stats(): Readonly<Record<string, ProbeStats>>;
}

// --- Mutable stats tracked per probe (internal only) ---

interface MutableProbeStats {
  lastRunAt: number | null;
  lastStatus: ProbeResult["status"] | null;
  runCount: number;
  consecutiveErrors: number;
  totalErrors: number;
}

// --- Per-probe scheduling state ---

interface ProbeState {
  readonly config: ProbeConfig;
  readonly fn: Probe;
  readonly stats: MutableProbeStats;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
  stopped: boolean;
}

// --- Factory ---

export function createProbeScheduler(
  onResult: (result: ProbeResult) => void,
): ProbeScheduler {
  const probeStates = new Map<string, ProbeState>();

  function scheduleNext(state: ProbeState): void {
    if (state.stopped) return;
    state.timer = setTimeout(() => {
      void runProbe(state);
    }, state.config.intervalMs);
  }

  async function runProbe(state: ProbeState): Promise<void> {
    if (state.stopped) return;

    const runPromise = (async () => {
      try {
        // Pass config with a minimal ProbeDeps — actual deps are injected at integration level
        const result = await state.fn(state.config, undefined as never);
        state.stats.lastRunAt = Date.now();
        state.stats.lastStatus = result.status;
        state.stats.runCount += 1;
        state.stats.consecutiveErrors = 0;
        onResult(result);
      } catch {
        state.stats.lastRunAt = Date.now();
        state.stats.lastStatus = "error";
        state.stats.runCount += 1;
        state.stats.consecutiveErrors += 1;
        state.stats.totalErrors += 1;
      } finally {
        state.inFlight = null;
        scheduleNext(state);
      }
    })();

    state.inFlight = runPromise;
    await runPromise;
  }

  function start(probes: readonly ProbeEntry[]): void {
    for (const probe of probes) {
      const state: ProbeState = {
        config: probe.config,
        fn: probe.fn,
        stats: {
          lastRunAt: null,
          lastStatus: null,
          runCount: 0,
          consecutiveErrors: 0,
          totalErrors: 0,
        },
        timer: null,
        inFlight: null,
        stopped: false,
      };
      probeStates.set(probe.config.id, state);

      // First run is immediate (setTimeout(0))
      state.timer = setTimeout(() => {
        void runProbe(state);
      }, 0);
    }
  }

  async function stop(): Promise<void> {
    const inFlightPromises: Promise<void>[] = [];

    for (const state of probeStates.values()) {
      state.stopped = true;
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (state.inFlight !== null) {
        inFlightPromises.push(state.inFlight);
      }
    }

    await Promise.allSettled(inFlightPromises);
  }

  function stats(): Readonly<Record<string, ProbeStats>> {
    const result: Record<string, ProbeStats> = {};
    for (const [id, state] of probeStates) {
      result[id] = {
        lastRunAt: state.stats.lastRunAt,
        lastStatus: state.stats.lastStatus,
        runCount: state.stats.runCount,
        consecutiveErrors: state.stats.consecutiveErrors,
        totalErrors: state.stats.totalErrors,
      };
    }
    return result;
  }

  return { start, stop, stats };
}
