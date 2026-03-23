import { describe, it, expect } from "vitest";
import type {
  ProbeId,
  ProbeStatus,
  ProbeConfig,
  ProbeResult,
  Finding,
  ProbeError,
  ProbeStats,
  TriageLevel,
  TriageResult,
  PagePriority,
  PageMessage,
  SendResult,
  ChartEntry,
  ChartOutcome,
  MonitorStateFile,
  MonitorStatus,
} from "./monitor.js";

describe("monitor types", () => {
  it("ProbeResult satisfies the type contract", () => {
    const result: ProbeResult = {
      probeId: "gateway",
      status: "ok",
      findings: [],
      metrics: { uptime: 100 },
      timestamp: Date.now(),
    };
    expect(result.probeId).toBe("gateway");
    expect(result.status).toBe("ok");
  });

  it("Finding uses existing Severity type", () => {
    const finding: Finding = {
      code: "INFRA-001",
      message: { en: "Gateway down", zh: "网关离线" },
      severity: "critical",
      context: { pid: null },
    };
    expect(finding.severity).toBe("critical");
  });

  it("ChartEntry fields are optional where spec requires", () => {
    const entry: ChartEntry = {
      id: "test",
      timestamp: Date.now(),
      action: "probe-error",
      outcome: "failed",
      details: {},
    };
    expect(entry.probeId).toBeUndefined();
    expect(entry.diseaseId).toBeUndefined();
    expect(entry.triageLevel).toBeUndefined();
  });

  it("ProbeConfig has required fields", () => {
    const config: ProbeConfig = {
      id: "gateway",
      intervalMs: 60_000,
      enabled: true,
      params: {},
    };
    expect(config.id).toBe("gateway");
    expect(config.intervalMs).toBe(60_000);
    expect(config.enabled).toBe(true);
  });

  it("ProbeError captures error details", () => {
    const err: ProbeError = {
      probeId: "session",
      error: "Connection refused",
      timestamp: Date.now(),
    };
    expect(err.probeId).toBe("session");
    expect(err.error).toBe("Connection refused");
  });

  it("ProbeStats tracks run history", () => {
    const stats: ProbeStats = {
      lastRunAt: Date.now(),
      lastStatus: "ok",
      runCount: 10,
      consecutiveErrors: 0,
      totalErrors: 2,
    };
    expect(stats.runCount).toBe(10);
    expect(stats.consecutiveErrors).toBe(0);
  });

  it("TriageResult carries disease context", () => {
    const result: TriageResult = {
      level: "red",
      diseaseId: "INFRA-001",
      agentId: "main",
      reason: { en: "Gateway unreachable", zh: "网关不可达" },
    };
    expect(result.level).toBe("red");
    expect(result.diseaseId).toBe("INFRA-001");
  });

  it("PageMessage supports i18n title and body", () => {
    const msg: PageMessage = {
      priority: "critical",
      title: { en: "Alert", zh: "警报" },
      body: { en: "Gateway is down", zh: "网关已离线" },
      diseaseId: "INFRA-001",
      probeId: "gateway",
      timestamp: Date.now(),
    };
    expect(msg.priority).toBe("critical");
    expect(msg.title.en).toBe("Alert");
  });

  it("SendResult reports success or failure", () => {
    const ok: SendResult = { success: true };
    expect(ok.success).toBe(true);
    expect(ok.error).toBeUndefined();

    const fail: SendResult = { success: false, error: "timeout" };
    expect(fail.success).toBe(false);
    expect(fail.error).toBe("timeout");
  });

  it("MonitorStateFile captures full monitor state", () => {
    const state: MonitorStateFile = {
      pid: 12345,
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
      probeStats: {
        gateway: {
          lastRunAt: Date.now(),
          lastStatus: "ok",
          runCount: 5,
          consecutiveErrors: 0,
          totalErrors: 0,
        },
      },
      pendingConsents: 0,
      todayInterventions: { executed: 3, failed: 1 },
    };
    expect(state.pid).toBe(12345);
    expect(state.probeStats["gateway"]?.runCount).toBe(5);
  });

  it("MonitorStatus includes running flag", () => {
    const status: MonitorStatus = {
      running: true,
      pid: 12345,
      startedAt: Date.now(),
      probeStats: {},
      pendingConsents: 0,
      todayInterventions: { executed: 0, failed: 0 },
    };
    expect(status.running).toBe(true);
  });

  it("ChartOutcome covers all valid states", () => {
    const outcomes: ChartOutcome[] = ["success", "failed", "skipped", "expired", "cancelled"];
    expect(outcomes).toHaveLength(5);
  });

  it("PagePriority covers all valid levels", () => {
    const priorities: PagePriority[] = ["info", "warning", "critical", "emergency"];
    expect(priorities).toHaveLength(4);
  });

  it("ProbeId covers all valid probe identifiers", () => {
    const ids: ProbeId[] = ["gateway", "cron", "auth", "session", "budget", "cost"];
    expect(ids).toHaveLength(6);
  });
});
