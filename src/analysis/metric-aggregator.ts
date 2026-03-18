// ═══════════════════════════════════════════════
//  Metric Aggregator
//  Design spec §6.2
// ═══════════════════════════════════════════════

import type Database from "better-sqlite3";
import { createEventStore } from "../store/event-store.js";
import type {
  ClawDoctorEvent,
  ToolCallData,
  LLMCallData,
  SessionLifecycleData,
  AgentLifecycleData,
  SubagentEventData,
  MemorySnapshotData,
  ConfigSnapshotData,
  PluginSnapshotData,
} from "../types/events.js";

// ─── MetricSet interface (spec §6.2) ─────────────────────────────────────────

export interface MetricSet {
  timeRange: { from: number; to: number };
  agentId: string;

  skill: {
    toolCallCount: number;
    toolSuccessRate: number;
    toolErrorRate: number;
    avgToolDurationMs: number | null;    // null if no durationMs data (snapshot mode)
    topErrorTools: Array<{ tool: string; errorCount: number; errorMessages: string[] }>;
    repeatCallPatterns: Array<{ tool: string; params: string; count: number }>;
    unusedPlugins: string[];
    tokenPerToolCall: Record<string, number>;
    contextTokenRatio: Record<string, number>;
  };

  memory: {
    fileCount: number;
    totalSizeBytes: number;
    avgAgeDays: number;
    staleFiles: Array<{ path: string; ageDays: number }>;
  };

  behavior: {
    sessionCount: number;
    avgMessagesPerSession: number;
    agentSuccessRate: number;
    avgStepsPerSession: number;
    subagentSpawnCount: number;
    subagentFailureRate: number;
    verboseRatio: number | null;
  };

  cost: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    cacheHitRate: number | null;
    tokensByModel: Record<string, number>;
    tokensByTool: Record<string, number>;
    tokensBySession: Array<{ sessionKey: string; tokens: number }>;
    dailyTrend: Array<{ date: string; tokens: number }>;
  };

  security: {
    sandboxEnabled: boolean;
    pluginSources: Record<string, string>;
    channelAllowLists: Record<string, boolean>;
    credentialPatternHits: Array<{ file: string; line: number; pattern: string }>;
  };

  vitals: {
    gatewayReachable: boolean;
    configValid: boolean;
    configWarnings: string[];
    pluginLoadErrors: Array<{ pluginId: string; error: string }>;
    openclawVersion: string;
    diskUsageBytes: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Converts a unix millisecond timestamp to a UTC date string "YYYY-MM-DD".
 */
function msToDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Stale file threshold: files not modified for >= STALE_DAYS days.
 */
const STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── aggregateMetrics ────────────────────────────────────────────────────────

/**
 * Queries the events table for the given agentId and timeRange, then aggregates
 * by event type into a MetricSet.
 *
 * Uses source-priority merge from event-store: for sessions that have stream
 * events, snapshot events for those sessions are excluded.
 */
export function aggregateMetrics(
  db: Database.Database,
  agentId: string,
  timeRange: { from: number; to: number },
): MetricSet {
  const store = createEventStore(db);

  // Fetch all events using source-priority merge, then filter by time range.
  // queryEventsWithSourcePriority already handles stream-over-snapshot priority.
  const allEvents = store.queryEventsWithSourcePriority({ agentId }).filter(
    (e) => e.timestamp >= timeRange.from && e.timestamp <= timeRange.to,
  );

  // ─── Partition by type ────────────────────────────────────────────────────

  const toolCallEvents = allEvents.filter((e): e is ClawDoctorEvent & { type: "tool_call"; data: ToolCallData } =>
    e.type === "tool_call"
  );
  const llmCallEvents = allEvents.filter((e): e is ClawDoctorEvent & { type: "llm_call"; data: LLMCallData } =>
    e.type === "llm_call"
  );
  const sessionEvents = allEvents.filter((e): e is ClawDoctorEvent & { type: "session_lifecycle"; data: SessionLifecycleData } =>
    e.type === "session_lifecycle"
  );
  const agentEvents = allEvents.filter((e): e is ClawDoctorEvent & { type: "agent_lifecycle"; data: AgentLifecycleData } =>
    e.type === "agent_lifecycle"
  );
  const subagentEvents = allEvents.filter((e): e is ClawDoctorEvent & { type: "subagent_event"; data: SubagentEventData } =>
    e.type === "subagent_event"
  );

  // For snapshot-type events, use the latest one (highest timestamp).
  const memorySnapshots = allEvents
    .filter((e): e is ClawDoctorEvent & { type: "memory_snapshot"; data: MemorySnapshotData } => e.type === "memory_snapshot")
    .sort((a, b) => b.timestamp - a.timestamp);

  const configSnapshots = allEvents
    .filter((e): e is ClawDoctorEvent & { type: "config_snapshot"; data: ConfigSnapshotData } => e.type === "config_snapshot")
    .sort((a, b) => b.timestamp - a.timestamp);

  const pluginSnapshots = allEvents
    .filter((e): e is ClawDoctorEvent & { type: "plugin_snapshot"; data: PluginSnapshotData } => e.type === "plugin_snapshot")
    .sort((a, b) => b.timestamp - a.timestamp);

  // ─── Skill metrics ────────────────────────────────────────────────────────

  const toolCallCount = toolCallEvents.length;
  const successCount = toolCallEvents.filter((e) => (e.data as ToolCallData).success).length;
  const failCount = toolCallCount - successCount;

  const toolSuccessRate = toolCallCount > 0 ? successCount / toolCallCount : 0;
  const toolErrorRate = toolCallCount > 0 ? failCount / toolCallCount : 0;

  // avgToolDurationMs: null if no events have durationMs
  const eventsWithDuration = toolCallEvents.filter((e) => (e.data as ToolCallData).durationMs !== undefined);
  let avgToolDurationMs: number | null = null;
  if (eventsWithDuration.length > 0) {
    const total = eventsWithDuration.reduce((sum, e) => sum + ((e.data as ToolCallData).durationMs as number), 0);
    avgToolDurationMs = total / eventsWithDuration.length;
  }

  // topErrorTools: aggregate failed tool calls by toolName
  const errorToolMap = new Map<string, { errorCount: number; errorMessages: string[] }>();
  for (const e of toolCallEvents) {
    const d = e.data as ToolCallData;
    if (!d.success) {
      const entry = errorToolMap.get(d.toolName) ?? { errorCount: 0, errorMessages: [] };
      entry.errorCount++;
      if (d.error) {
        entry.errorMessages.push(d.error);
      }
      errorToolMap.set(d.toolName, entry);
    }
  }
  const topErrorTools = Array.from(errorToolMap.entries())
    .map(([tool, v]) => ({ tool, errorCount: v.errorCount, errorMessages: v.errorMessages }))
    .sort((a, b) => b.errorCount - a.errorCount);

  // repeatCallPatterns: group by (toolName, JSON.stringify(paramsSummary))
  const repeatMap = new Map<string, { tool: string; params: string; count: number }>();
  for (const e of toolCallEvents) {
    const d = e.data as ToolCallData;
    const paramsKey = JSON.stringify(d.paramsSummary ?? {});
    const key = `${d.toolName}::${paramsKey}`;
    const entry = repeatMap.get(key) ?? { tool: d.toolName, params: paramsKey, count: 0 };
    entry.count++;
    repeatMap.set(key, entry);
  }
  const repeatCallPatterns = Array.from(repeatMap.values())
    .filter((p) => p.count >= 2)
    .sort((a, b) => b.count - a.count);

  // unusedPlugins: plugins that registered tools but those tools were never called
  // Derived from plugin_snapshot + tool_call events
  const calledTools = new Set(toolCallEvents.map((e) => (e.data as ToolCallData).toolName));
  const unusedPlugins: string[] = [];
  if (pluginSnapshots.length > 0) {
    const latestPlugin = pluginSnapshots[0];
    for (const plugin of (latestPlugin.data as PluginSnapshotData).plugins) {
      if (plugin.status !== "loaded") continue;
      const allToolsUnused = plugin.registeredTools.length > 0 &&
        plugin.registeredTools.every((t) => !calledTools.has(t));
      if (allToolsUnused) {
        unusedPlugins.push(plugin.id);
      }
    }
  }

  // tokenPerToolCall and contextTokenRatio: these require cross-event LLM data
  // per skill. Without a direct association between llm_call and tool_call events
  // (they share sessionKey but not a direct link), we leave these empty maps.
  const tokenPerToolCall: Record<string, number> = {};
  const contextTokenRatio: Record<string, number> = {};

  // ─── Cost metrics ─────────────────────────────────────────────────────────

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  const tokensByModel: Record<string, number> = {};
  const tokensBySessionMap = new Map<string, number>();
  const dailyTrendMap = new Map<string, number>();

  for (const e of llmCallEvents) {
    const d = e.data as LLMCallData;
    const input = d.inputTokens ?? 0;
    const output = d.outputTokens ?? 0;
    const cacheRead = d.cacheReadTokens ?? 0;
    const cacheWrite = d.cacheWriteTokens ?? 0;
    const total = input + output;

    totalInputTokens += input;
    totalOutputTokens += output;
    totalCacheReadTokens += cacheRead;
    totalCacheWriteTokens += cacheWrite;

    // tokensByModel: input + output per model
    tokensByModel[d.model] = (tokensByModel[d.model] ?? 0) + total;

    // tokensBySession
    const sk = e.sessionKey ?? "(none)";
    tokensBySessionMap.set(sk, (tokensBySessionMap.get(sk) ?? 0) + total);

    // dailyTrend
    const dateStr = msToDateString(e.timestamp);
    dailyTrendMap.set(dateStr, (dailyTrendMap.get(dateStr) ?? 0) + total);
  }

  // cacheHitRate: null if cacheRead+input === 0, else cacheRead/(cacheRead+input)
  let cacheHitRate: number | null = null;
  if (totalCacheReadTokens + totalInputTokens > 0) {
    cacheHitRate = totalCacheReadTokens / (totalCacheReadTokens + totalInputTokens);
  }

  const tokensBySession = Array.from(tokensBySessionMap.entries())
    .map(([sessionKey, tokens]) => ({ sessionKey, tokens }))
    .sort((a, b) => b.tokens - a.tokens);

  const dailyTrend = Array.from(dailyTrendMap.entries())
    .map(([date, tokens]) => ({ date, tokens }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // tokensByTool: not directly associable without explicit linking — leave empty
  const tokensByTool: Record<string, number> = {};

  // ─── Behavior metrics ─────────────────────────────────────────────────────

  const sessionStartEvents = sessionEvents.filter((e) => (e.data as SessionLifecycleData).event === "start");
  const sessionEndEvents = sessionEvents.filter((e) => (e.data as SessionLifecycleData).event === "end");

  const sessionCount = sessionStartEvents.length;

  // avgMessagesPerSession: average messageCount from session end events that have it
  const endEventsWithMsgCount = sessionEndEvents.filter(
    (e) => (e.data as SessionLifecycleData).messageCount !== undefined
  );
  const avgMessagesPerSession =
    endEventsWithMsgCount.length > 0
      ? endEventsWithMsgCount.reduce((sum, e) => sum + ((e.data as SessionLifecycleData).messageCount as number), 0) /
        endEventsWithMsgCount.length
      : 0;

  // agentSuccessRate: from agent_lifecycle end events
  const agentEndEvents = agentEvents.filter((e) => (e.data as AgentLifecycleData).event === "end");
  const agentSuccessEvents = agentEndEvents.filter((e) => (e.data as AgentLifecycleData).success === true);
  const agentSuccessRate = agentEndEvents.length > 0 ? agentSuccessEvents.length / agentEndEvents.length : 0;

  // avgStepsPerSession: tool calls per session
  const toolCallsBySession = new Map<string, number>();
  for (const e of toolCallEvents) {
    const sk = e.sessionKey ?? "(none)";
    toolCallsBySession.set(sk, (toolCallsBySession.get(sk) ?? 0) + 1);
  }
  const sessionKeys = Array.from(toolCallsBySession.keys());
  const avgStepsPerSession =
    sessionKeys.length > 0
      ? Array.from(toolCallsBySession.values()).reduce((s, n) => s + n, 0) / sessionKeys.length
      : 0;

  // subagentSpawnCount and subagentFailureRate
  const subagentSpawned = subagentEvents.filter((e) => (e.data as SubagentEventData).event === "spawned");
  const subagentEnded = subagentEvents.filter((e) => (e.data as SubagentEventData).event === "ended");
  const subagentSpawnCount = subagentSpawned.length;
  const subagentFailed = subagentEnded.filter((e) => {
    const outcome = (e.data as SubagentEventData).outcome;
    return outcome !== undefined && outcome !== "ok";
  });
  const subagentFailureRate = subagentEnded.length > 0 ? subagentFailed.length / subagentEnded.length : 0;

  // verboseRatio: totalOutputTokens / toolCallCount (null if no tool calls)
  const verboseRatio = toolCallCount > 0 ? totalOutputTokens / toolCallCount : null;

  // ─── Memory metrics ───────────────────────────────────────────────────────

  let memoryFileCount = 0;
  let memoryTotalSizeBytes = 0;
  let memoryAvgAgeDays = 0;
  let memoryStaleFiles: Array<{ path: string; ageDays: number }> = [];

  if (memorySnapshots.length > 0) {
    const latest = memorySnapshots[0];
    const snap = latest.data as MemorySnapshotData;
    const nowMs = Date.now();

    memoryFileCount = snap.totalCount;
    memoryTotalSizeBytes = snap.totalSizeBytes;

    if (snap.files.length > 0) {
      const ageDaysArr = snap.files.map((f) => (nowMs - f.modifiedAt) / DAY_MS);
      memoryAvgAgeDays = ageDaysArr.reduce((s, d) => s + d, 0) / ageDaysArr.length;

      memoryStaleFiles = snap.files
        .map((f, i) => ({ path: f.path, ageDays: ageDaysArr[i] }))
        .filter((f) => f.ageDays >= STALE_DAYS)
        .sort((a, b) => b.ageDays - a.ageDays);
    }
  }

  // ─── Vitals + Security ────────────────────────────────────────────────────

  // Defaults
  let vitalsConfigValid = false;
  let vitalsConfigWarnings: string[] = [];
  let vitalsGatewayReachable = false;
  let vitalsOpenclawVersion = "unknown";
  let vitalsDiskUsageBytes = 0;

  let securitySandboxEnabled = false;
  let securityChannelAllowLists: Record<string, boolean> = {};
  let securityCredentialPatternHits: Array<{ file: string; line: number; pattern: string }> = [];

  if (configSnapshots.length > 0) {
    const latestConfig = configSnapshots[0];
    const snap = latestConfig.data as ConfigSnapshotData;

    // Presence of a valid config snapshot means config was readable → valid
    vitalsConfigValid = true;
    securitySandboxEnabled = snap.sandboxEnabled ?? false;
  }

  // Plugin load errors + plugin sources from latest plugin_snapshot
  let vitalsPluginLoadErrors: Array<{ pluginId: string; error: string }> = [];
  let securityPluginSources: Record<string, string> = {};

  if (pluginSnapshots.length > 0) {
    const latestPlugin = pluginSnapshots[0];
    const snap = latestPlugin.data as PluginSnapshotData;

    for (const plugin of snap.plugins) {
      securityPluginSources[plugin.id] = plugin.source;
      if (plugin.status === "error" && plugin.error) {
        vitalsPluginLoadErrors.push({ pluginId: plugin.id, error: plugin.error });
      }
    }
  }

  // ─── Assemble MetricSet ───────────────────────────────────────────────────

  return {
    timeRange,
    agentId,

    skill: {
      toolCallCount,
      toolSuccessRate,
      toolErrorRate,
      avgToolDurationMs,
      topErrorTools,
      repeatCallPatterns,
      unusedPlugins,
      tokenPerToolCall,
      contextTokenRatio,
    },

    memory: {
      fileCount: memoryFileCount,
      totalSizeBytes: memoryTotalSizeBytes,
      avgAgeDays: memoryAvgAgeDays,
      staleFiles: memoryStaleFiles,
    },

    behavior: {
      sessionCount,
      avgMessagesPerSession,
      agentSuccessRate,
      avgStepsPerSession,
      subagentSpawnCount,
      subagentFailureRate,
      verboseRatio,
    },

    cost: {
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      cacheHitRate,
      tokensByModel,
      tokensByTool,
      tokensBySession,
      dailyTrend,
    },

    security: {
      sandboxEnabled: securitySandboxEnabled,
      pluginSources: securityPluginSources,
      channelAllowLists: securityChannelAllowLists,
      credentialPatternHits: securityCredentialPatternHits,
    },

    vitals: {
      gatewayReachable: vitalsGatewayReachable,
      configValid: vitalsConfigValid,
      configWarnings: vitalsConfigWarnings,
      pluginLoadErrors: vitalsPluginLoadErrors,
      openclawVersion: vitalsOpenclawVersion,
      diskUsageBytes: vitalsDiskUsageBytes,
    },
  };
}
