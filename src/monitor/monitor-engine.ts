// ===============================================
//  Monitor Engine
//  Orchestrates probe scheduling, disease matching,
//  triage, alerting, and chart recording.
//  Design spec: continuous monitoring §Engine
// ===============================================

import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type { ClawDoctorConfig } from "../types/config.js";
import type { ProbeResult, ProbeId, PageMessage, PagePriority, ChartEntry } from "../types/monitor.js";
import type { PageChannel } from "../page/page-channel.js";
import type { ShellExecutor } from "./probe.js";
import type { EventStore } from "../store/event-store.js";
import type { ChartStore } from "../chart/chart-store.js";
import type { PageDispatcher } from "../page/page-dispatcher.js";
import type { ProbeScheduler, ProbeEntry } from "./probe-scheduler.js";
import type { DiseaseRegistry } from "../diseases/registry.js";
import { openDatabase } from "../store/database.js";
import { createEventStore } from "../store/event-store.js";
import { createChartStore } from "../chart/chart-store.js";
import { createPageDispatcher } from "../page/page-dispatcher.js";
import { createProbeScheduler } from "./probe-scheduler.js";
import { getDiseaseRegistry } from "../diseases/registry.js";
import { matchFindingToDisease } from "./probe-disease-match.js";
import { triageAlertOnly } from "../triage/triage-engine.js";
import { validateMonitorConfig } from "./config-validator.js";
import {
  writeMonitorState,
  deleteMonitorState,
} from "./monitor-state.js";
import { gatewayProbe } from "./probes/gateway-probe.js";
import { sessionProbe } from "./probes/session-probe.js";
import { costProbe } from "./probes/cost-probe.js";

// ─── Dependencies injected into monitor engine ───

export interface MonitorEngineDeps {
  readonly db: Database.Database;
  readonly stateDir: string;
  readonly exec: ShellExecutor;
  readonly pageChannels: readonly PageChannel[];
}

// ─── Monitor Engine interface ───

export interface MonitorEngine {
  start(): void;
  stop(): Promise<void>;
  status(): {
    readonly running: boolean;
    readonly probeStats: Readonly<Record<string, unknown>>;
  };
}

// ─── Constants ───

const HEARTBEAT_INTERVAL_MS = 30_000;
const CONSECUTIVE_ERROR_THRESHOLD = 3;

// ─── Factory ───

export function createMonitorEngine(
  config: ClawDoctorConfig,
  deps: MonitorEngineDeps,
): MonitorEngine {
  let scheduler: ProbeScheduler | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  const startedAt = Date.now();

  // ─── Stores ───

  const eventStore = createEventStore(deps.db);
  const chartStore = createChartStore(deps.db);
  const registry = getDiseaseRegistry();

  const pageDispatcher = createPageDispatcher(
    {
      rateLimit: config.page.rateLimit,
      dedup: config.page.dedup,
    },
    deps.pageChannels,
    deps.db,
  );

  // ─── Build probe entries from config ───

  function buildProbeEntries(): ProbeEntry[] {
    const entries: ProbeEntry[] = [];
    const probeConfigs = config.monitor.probes;

    if (probeConfigs.gateway.enabled) {
      entries.push({
        config: {
          id: "gateway" as ProbeId,
          intervalMs: probeConfigs.gateway.intervalMs,
          enabled: true,
          params: probeConfigs.gateway.params,
        },
        fn: gatewayProbe,
      });
    }

    if (probeConfigs.session.enabled) {
      entries.push({
        config: {
          id: "session" as ProbeId,
          intervalMs: probeConfigs.session.intervalMs,
          enabled: true,
          params: probeConfigs.session.params,
        },
        fn: sessionProbe,
      });
    }

    if (probeConfigs.cost.enabled) {
      entries.push({
        config: {
          id: "cost" as ProbeId,
          intervalMs: probeConfigs.cost.intervalMs,
          enabled: true,
          params: {
            spikeMultiplier: probeConfigs.cost.spikeMultiplier,
            minSessionsForBaseline: probeConfigs.cost.minSessionsForBaseline,
          },
        },
        fn: costProbe,
      });
    }

    return entries;
  }

  // ─── Process a probe result ───

  function processResult(result: ProbeResult): void {
    // 1. Write probe_result event to EventStore
    writeProbeResultEvent(eventStore, result);

    // 2. For each finding: match to disease → triage → page → chart
    for (const finding of result.findings) {
      const disease = matchFindingToDisease(finding, registry);
      if (!disease) continue;

      const triage = triageAlertOnly(disease);

      const pageMsg = buildPageMessage(finding, triage, result.probeId);
      void pageDispatcher.dispatch(pageMsg);

      const chartEntry = buildChartEntry(result, finding, triage);
      chartStore.insert(chartEntry);
    }

    // 3. Check for consecutive errors and send warning page
    if (scheduler) {
      const stats = scheduler.stats();
      const probeStats = stats[result.probeId];
      if (
        probeStats &&
        probeStats.consecutiveErrors >= CONSECUTIVE_ERROR_THRESHOLD
      ) {
        const warningMsg: PageMessage = {
          priority: "warning",
          title: {
            en: `Probe "${result.probeId}" has ${probeStats.consecutiveErrors} consecutive errors`,
            zh: `探针 "${result.probeId}" 已连续出错 ${probeStats.consecutiveErrors} 次`,
          },
          body: {
            en: `The ${result.probeId} probe has failed ${probeStats.consecutiveErrors} times in a row. Please check the monitor logs.`,
            zh: `${result.probeId} 探针已连续失败 ${probeStats.consecutiveErrors} 次，请检查监控日志。`,
          },
          probeId: result.probeId,
          timestamp: Date.now(),
        };
        void pageDispatcher.dispatch(warningMsg);
      }
    }
  }

  // ─── Heartbeat ───

  function writeHeartbeat(): void {
    if (!scheduler || !running) return;

    writeMonitorState(deps.stateDir, {
      pid: process.pid,
      startedAt,
      lastHeartbeat: Date.now(),
      probeStats: scheduler.stats(),
      pendingConsents: 0, // Phase 1: no consents
      todayInterventions: { executed: 0, failed: 0 }, // Phase 1: no interventions
    });
  }

  // ─── Public API ───

  function start(): void {
    // 1. Validate config
    const validation = validateMonitorConfig(config);
    if (validation.errors.length > 0) {
      throw new Error(
        `Monitor config validation failed:\n${validation.errors.join("\n")}`,
      );
    }

    // 2. Build probe entries
    const entries = buildProbeEntries();

    // 3. Create scheduler with onResult callback
    scheduler = createProbeScheduler((result) => {
      processResult(result);
    });

    // 4. Start probe scheduler
    // Probes receive deps through closure — the scheduler passes config
    // but probes also need ProbeDeps. We wrap each probe fn to inject deps.
    const wrappedEntries: ProbeEntry[] = entries.map((entry) => ({
      config: entry.config,
      fn: (probeConfig, _deps) =>
        entry.fn(probeConfig, {
          stateDir: deps.stateDir,
          exec: deps.exec,
          store: eventStore,
          db: deps.db,
        }),
    }));

    scheduler.start(wrappedEntries);
    running = true;

    // 5. Start heartbeat
    writeHeartbeat();
    heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  }

  async function stop(): Promise<void> {
    running = false;

    // Stop heartbeat
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // Stop scheduler (wait for in-flight probes)
    if (scheduler !== null) {
      await scheduler.stop();
    }

    // Write final chart entry
    const finalEntry: ChartEntry = {
      id: ulid(),
      timestamp: Date.now(),
      action: "monitor-stopped",
      outcome: "success",
      details: { reason: "graceful shutdown" },
    };
    chartStore.insert(finalEntry);

    // Delete state file
    deleteMonitorState(deps.stateDir);
  }

  function status(): {
    readonly running: boolean;
    readonly probeStats: Readonly<Record<string, unknown>>;
  } {
    return {
      running,
      probeStats: scheduler ? scheduler.stats() : {},
    };
  }

  return { start, stop, status };
}

// ─── Helpers ───

function writeProbeResultEvent(
  eventStore: EventStore,
  result: ProbeResult,
): void {
  eventStore.insertEvent({
    id: ulid(),
    source: "stream",
    timestamp: result.timestamp,
    agentId: "monitor",
    type: "probe_result",
    data: {
      probeId: result.probeId,
      status: result.status,
      findings: result.findings.map((f) => ({
        code: f.code,
        message: f.message,
        severity: f.severity,
        context: f.context,
      })),
      metrics: result.metrics,
    },
  });
}

function buildPageMessage(
  finding: ProbeResult["findings"][number],
  triage: ReturnType<typeof triageAlertOnly>,
  probeId: ProbeId,
): PageMessage {
  const priorityMap: Record<string, PagePriority> = {
    critical: "critical",
    warning: "warning",
    info: "info",
  };

  return {
    priority: priorityMap[finding.severity] ?? "info",
    title: finding.message,
    body: finding.message,
    diseaseId: finding.code,
    probeId,
    agentId: triage.agentId,
    timestamp: Date.now(),
  };
}

function buildChartEntry(
  result: ProbeResult,
  finding: ProbeResult["findings"][number],
  triage: ReturnType<typeof triageAlertOnly>,
): ChartEntry {
  return {
    id: ulid(),
    timestamp: Date.now(),
    probeId: result.probeId,
    diseaseId: finding.code,
    agentId: triage.agentId,
    triageLevel: triage.level,
    action: "alert-sent",
    outcome: "success",
    details: {
      severity: finding.severity,
      findingCode: finding.code,
    },
  };
}
