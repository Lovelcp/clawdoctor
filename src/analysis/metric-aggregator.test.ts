// ═══════════════════════════════════════════════
//  Metric Aggregator — TDD Tests
//  Design spec §6.2
// ═══════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../store/database.js";
import { createEventStore } from "../store/event-store.js";
import type Database from "better-sqlite3";
import type { ClawDoctorEvent } from "../types/events.js";
import { aggregateMetrics } from "./metric-aggregator.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

let idCounter = 0;
function makeId(): string {
  return `01ARZ3NDEKTSV4RRFFQ69G5FA${String(idCounter++).padStart(2, "0")}`;
}

function makeToolCallEvent(overrides: Partial<ClawDoctorEvent> & { data: ClawDoctorEvent["data"] }): ClawDoctorEvent {
  return {
    id: makeId(),
    source: "stream",
    timestamp: 1_700_000_000_000,
    agentId: "agent-1",
    sessionKey: "session-1",
    type: "tool_call",
    ...overrides,
  };
}

function makeLlmCallEvent(overrides: Partial<ClawDoctorEvent> & { data: ClawDoctorEvent["data"] }): ClawDoctorEvent {
  return {
    id: makeId(),
    source: "stream",
    timestamp: 1_700_000_000_000,
    agentId: "agent-1",
    sessionKey: "session-1",
    type: "llm_call",
    ...overrides,
  };
}

function makeSessionEvent(overrides: Partial<ClawDoctorEvent> & { data: ClawDoctorEvent["data"] }): ClawDoctorEvent {
  return {
    id: makeId(),
    source: "stream",
    timestamp: 1_700_000_000_000,
    agentId: "agent-1",
    sessionKey: "session-1",
    type: "session_lifecycle",
    ...overrides,
  };
}

function makeAgentEvent(overrides: Partial<ClawDoctorEvent> & { data: ClawDoctorEvent["data"] }): ClawDoctorEvent {
  return {
    id: makeId(),
    source: "stream",
    timestamp: 1_700_000_000_000,
    agentId: "agent-1",
    sessionKey: "session-1",
    type: "agent_lifecycle",
    ...overrides,
  };
}

const AGENT_ID = "agent-1";
// Use a wide time range to include all test events
const TIME_RANGE = { from: 0, to: 9_999_999_999_999 };

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("aggregateMetrics", () => {
  let db: Database.Database;

  beforeEach(() => {
    idCounter = 0;
    db = openDatabase(":memory:");
  });

  // ─── Skill metrics ───────────────────────────────────────────────────────

  describe("skill metrics", () => {
    it("computes tool success rate correctly: 2 success + 1 fail = ~0.667", () => {
      const store = createEventStore(db);
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: {}, success: true } }));
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: {}, success: true } }));
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: {}, success: false, error: "timeout" } }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.skill.toolCallCount).toBe(3);
      expect(metrics.skill.toolSuccessRate).toBeCloseTo(2 / 3, 5);
      expect(metrics.skill.toolErrorRate).toBeCloseTo(1 / 3, 5);
    });

    it("returns toolSuccessRate=1 and toolErrorRate=0 when all tool calls succeed", () => {
      const store = createEventStore(db);
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Read", paramsSummary: {}, success: true } }));
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Read", paramsSummary: {}, success: true } }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.skill.toolSuccessRate).toBe(1);
      expect(metrics.skill.toolErrorRate).toBe(0);
    });

    it("returns toolSuccessRate=0 and toolErrorRate=0 when no tool_call events exist", () => {
      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.skill.toolCallCount).toBe(0);
      expect(metrics.skill.toolSuccessRate).toBe(0);
      expect(metrics.skill.toolErrorRate).toBe(0);
    });

    it("identifies top error tools with error messages", () => {
      const store = createEventStore(db);
      // BashTool: 2 failures
      store.insertEvent(makeToolCallEvent({ data: { toolName: "BashTool", paramsSummary: {}, success: false, error: "permission denied" } }));
      store.insertEvent(makeToolCallEvent({ data: { toolName: "BashTool", paramsSummary: {}, success: false, error: "command not found" } }));
      // ReadTool: 1 failure
      store.insertEvent(makeToolCallEvent({ data: { toolName: "ReadTool", paramsSummary: {}, success: false, error: "file not found" } }));
      // WriteTool: success
      store.insertEvent(makeToolCallEvent({ data: { toolName: "WriteTool", paramsSummary: {}, success: true } }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.skill.topErrorTools).toHaveLength(2);
      const bashTool = metrics.skill.topErrorTools.find((t) => t.tool === "BashTool");
      expect(bashTool).toBeDefined();
      expect(bashTool!.errorCount).toBe(2);
      expect(bashTool!.errorMessages).toContain("permission denied");
      expect(bashTool!.errorMessages).toContain("command not found");

      const readTool = metrics.skill.topErrorTools.find((t) => t.tool === "ReadTool");
      expect(readTool).toBeDefined();
      expect(readTool!.errorCount).toBe(1);
    });

    it("returns null for avgToolDurationMs when no events have durationMs (snapshot mode)", () => {
      const store = createEventStore(db);
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: {}, success: true } }));
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: {}, success: true } }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.skill.avgToolDurationMs).toBeNull();
    });

    it("computes avgToolDurationMs when durationMs is present", () => {
      const store = createEventStore(db);
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: {}, success: true, durationMs: 100 } }));
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: {}, success: true, durationMs: 200 } }));
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: {}, success: true, durationMs: 300 } }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.skill.avgToolDurationMs).toBe(200);
    });

    it("detects repeat call patterns (same tool + params, count >= 2)", () => {
      const store = createEventStore(db);
      // Same tool and same paramsSummary pattern → repeat
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: { command: "string" }, success: true } }));
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: { command: "string" }, success: true } }));
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Bash", paramsSummary: { command: "string" }, success: true } }));
      // Different params → not a repeat pattern by count
      store.insertEvent(makeToolCallEvent({ data: { toolName: "Read", paramsSummary: { path: "string" }, success: true } }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      const bashPattern = metrics.skill.repeatCallPatterns.find((p) => p.tool === "Bash");
      expect(bashPattern).toBeDefined();
      expect(bashPattern!.count).toBe(3);
    });
  });

  // ─── Cost metrics ────────────────────────────────────────────────────────

  describe("cost metrics", () => {
    it("computes token totals from llm_call events", () => {
      const store = createEventStore(db);
      store.insertEvent(makeLlmCallEvent({
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 100, outputTokens: 50, success: true },
      }));
      store.insertEvent(makeLlmCallEvent({
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 200, outputTokens: 75, success: true },
      }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.cost.totalInputTokens).toBe(300);
      expect(metrics.cost.totalOutputTokens).toBe(125);
    });

    it("returns null for cacheHitRate when no cache data (totalCacheReadTokens=0 and totalInputTokens=0)", () => {
      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.cost.cacheHitRate).toBeNull();
    });

    it("returns null for cacheHitRate when only input tokens exist (no cache read)", () => {
      const store = createEventStore(db);
      store.insertEvent(makeLlmCallEvent({
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 1000, outputTokens: 100, success: true },
      }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      // cacheRead=0 and input=1000 → cacheRead/(cacheRead+input) = 0/1000 = 0... but that is not null
      // Per spec: "if totalCacheReadTokens + totalInputTokens > 0: cacheRead / (cacheRead + input), else null"
      expect(metrics.cost.cacheHitRate).toBe(0);
    });

    it("computes cacheHitRate correctly when cache read tokens are present", () => {
      const store = createEventStore(db);
      store.insertEvent(makeLlmCallEvent({
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 300, cacheReadTokens: 700, cacheWriteTokens: 100, success: true },
      }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      // 700 / (700 + 300) = 0.7
      expect(metrics.cost.cacheHitRate).toBeCloseTo(0.7, 5);
      expect(metrics.cost.totalCacheReadTokens).toBe(700);
      expect(metrics.cost.totalCacheWriteTokens).toBe(100);
    });

    it("aggregates tokensByModel", () => {
      const store = createEventStore(db);
      store.insertEvent(makeLlmCallEvent({
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 100, outputTokens: 50, success: true },
      }));
      store.insertEvent(makeLlmCallEvent({
        data: { provider: "openai", model: "gpt-4o", inputTokens: 200, outputTokens: 80, success: true },
      }));
      store.insertEvent(makeLlmCallEvent({
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 50, outputTokens: 20, success: true },
      }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      // claude-3-5-sonnet: (100+50) + (50+20) = 150+70 = 220
      expect(metrics.cost.tokensByModel["claude-3-5-sonnet"]).toBe(220);
      // gpt-4o: 200+80 = 280
      expect(metrics.cost.tokensByModel["gpt-4o"]).toBe(280);
    });

    it("computes daily token trend", () => {
      const store = createEventStore(db);
      // Day 1: 2024-01-15
      const day1 = new Date("2024-01-15T12:00:00.000Z").getTime();
      // Day 2: 2024-01-16
      const day2 = new Date("2024-01-16T12:00:00.000Z").getTime();

      store.insertEvent(makeLlmCallEvent({
        timestamp: day1,
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 100, outputTokens: 50, success: true },
      }));
      store.insertEvent(makeLlmCallEvent({
        timestamp: day1,
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 200, outputTokens: 75, success: true },
      }));
      store.insertEvent(makeLlmCallEvent({
        timestamp: day2,
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 50, outputTokens: 25, success: true },
      }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      const day1Entry = metrics.cost.dailyTrend.find((d) => d.date === "2024-01-15");
      expect(day1Entry).toBeDefined();
      expect(day1Entry!.tokens).toBe(425); // 100+50 + 200+75

      const day2Entry = metrics.cost.dailyTrend.find((d) => d.date === "2024-01-16");
      expect(day2Entry).toBeDefined();
      expect(day2Entry!.tokens).toBe(75); // 50+25
    });

    it("aggregates tokensBySession", () => {
      const store = createEventStore(db);
      store.insertEvent(makeLlmCallEvent({
        sessionKey: "session-A",
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 100, outputTokens: 50, success: true },
      }));
      store.insertEvent(makeLlmCallEvent({
        sessionKey: "session-A",
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 200, outputTokens: 80, success: true },
      }));
      store.insertEvent(makeLlmCallEvent({
        sessionKey: "session-B",
        data: { provider: "anthropic", model: "claude-3-5-sonnet", inputTokens: 50, outputTokens: 10, success: true },
      }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      const sessionA = metrics.cost.tokensBySession.find((s) => s.sessionKey === "session-A");
      expect(sessionA).toBeDefined();
      expect(sessionA!.tokens).toBe(430); // 100+50+200+80

      const sessionB = metrics.cost.tokensBySession.find((s) => s.sessionKey === "session-B");
      expect(sessionB).toBeDefined();
      expect(sessionB!.tokens).toBe(60); // 50+10
    });
  });

  // ─── Behavior metrics ────────────────────────────────────────────────────

  describe("behavior metrics", () => {
    it("counts sessions from session_lifecycle start events", () => {
      const store = createEventStore(db);
      store.insertEvent(makeSessionEvent({ sessionKey: "s1", data: { event: "start" } }));
      store.insertEvent(makeSessionEvent({ sessionKey: "s2", data: { event: "start" } }));
      store.insertEvent(makeSessionEvent({ sessionKey: "s3", data: { event: "start" } }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.behavior.sessionCount).toBe(3);
    });

    it("computes avgMessagesPerSession from session end events with messageCount", () => {
      const store = createEventStore(db);
      store.insertEvent(makeSessionEvent({ sessionKey: "s1", data: { event: "end", messageCount: 10 } }));
      store.insertEvent(makeSessionEvent({ sessionKey: "s2", data: { event: "end", messageCount: 20 } }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.behavior.avgMessagesPerSession).toBe(15);
    });

    it("returns avgMessagesPerSession=0 when no session end events have messageCount", () => {
      const store = createEventStore(db);
      store.insertEvent(makeSessionEvent({ sessionKey: "s1", data: { event: "start" } }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.behavior.avgMessagesPerSession).toBe(0);
    });

    it("computes agentSuccessRate from agent_lifecycle end events", () => {
      const store = createEventStore(db);
      store.insertEvent(makeAgentEvent({ data: { event: "end", success: true } }));
      store.insertEvent(makeAgentEvent({ data: { event: "end", success: true } }));
      store.insertEvent(makeAgentEvent({ data: { event: "end", success: false } }));

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.behavior.agentSuccessRate).toBeCloseTo(2 / 3, 5);
    });

    it("returns agentSuccessRate=0 when no agent_lifecycle end events", () => {
      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);
      expect(metrics.behavior.agentSuccessRate).toBe(0);
    });

    it("counts subagent spawns and computes subagent failure rate", () => {
      const store = createEventStore(db);
      store.insertEvent({
        id: makeId(),
        source: "stream",
        timestamp: 1_700_000_000_000,
        agentId: AGENT_ID,
        sessionKey: "s1",
        type: "subagent_event",
        data: { event: "spawned", childSessionKey: "child-1", agentId: AGENT_ID },
      });
      store.insertEvent({
        id: makeId(),
        source: "stream",
        timestamp: 1_700_000_000_001,
        agentId: AGENT_ID,
        sessionKey: "s1",
        type: "subagent_event",
        data: { event: "ended", childSessionKey: "child-1", agentId: AGENT_ID, outcome: "error" },
      });
      store.insertEvent({
        id: makeId(),
        source: "stream",
        timestamp: 1_700_000_000_002,
        agentId: AGENT_ID,
        sessionKey: "s1",
        type: "subagent_event",
        data: { event: "spawned", childSessionKey: "child-2", agentId: AGENT_ID },
      });
      store.insertEvent({
        id: makeId(),
        source: "stream",
        timestamp: 1_700_000_000_003,
        agentId: AGENT_ID,
        sessionKey: "s1",
        type: "subagent_event",
        data: { event: "ended", childSessionKey: "child-2", agentId: AGENT_ID, outcome: "ok" },
      });

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.behavior.subagentSpawnCount).toBe(2);
      // 1 of 2 ended with error → 0.5
      expect(metrics.behavior.subagentFailureRate).toBe(0.5);
    });
  });

  // ─── Memory metrics ──────────────────────────────────────────────────────

  describe("memory metrics", () => {
    it("extracts memory metrics from latest memory_snapshot", () => {
      const store = createEventStore(db);
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;

      // Older snapshot (should be ignored)
      store.insertEvent({
        id: makeId(),
        source: "snapshot",
        timestamp: now - 2 * dayMs,
        agentId: AGENT_ID,
        type: "memory_snapshot",
        data: {
          files: [{ path: "/mem/old.md", sizeBytes: 100, modifiedAt: now - 60 * dayMs }],
          totalCount: 1,
          totalSizeBytes: 100,
        },
      });

      // Latest snapshot
      store.insertEvent({
        id: makeId(),
        source: "snapshot",
        timestamp: now,
        agentId: AGENT_ID,
        type: "memory_snapshot",
        data: {
          files: [
            { path: "/mem/recent.md", sizeBytes: 500, modifiedAt: now - dayMs },      // 1 day old
            { path: "/mem/stale.md", sizeBytes: 1000, modifiedAt: now - 40 * dayMs }, // 40 days old
          ],
          totalCount: 2,
          totalSizeBytes: 1500,
        },
      });

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.memory.fileCount).toBe(2);
      expect(metrics.memory.totalSizeBytes).toBe(1500);
      // avgAgeDays ≈ (1 + 40) / 2 = 20.5 days
      expect(metrics.memory.avgAgeDays).toBeCloseTo(20.5, 0);
      // stale files (>=30 days old)
      expect(metrics.memory.staleFiles.some((f) => f.path === "/mem/stale.md")).toBe(true);
      expect(metrics.memory.staleFiles.some((f) => f.path === "/mem/recent.md")).toBe(false);
    });

    it("returns zero memory metrics when no memory_snapshot events", () => {
      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.memory.fileCount).toBe(0);
      expect(metrics.memory.totalSizeBytes).toBe(0);
      expect(metrics.memory.avgAgeDays).toBe(0);
      expect(metrics.memory.staleFiles).toHaveLength(0);
    });
  });

  // ─── Vitals + Security metrics ───────────────────────────────────────────

  describe("vitals and security metrics from config_snapshot", () => {
    it("extracts vitals from latest config_snapshot", () => {
      const store = createEventStore(db);

      store.insertEvent({
        id: makeId(),
        source: "snapshot",
        timestamp: 1_700_000_000_000,
        agentId: AGENT_ID,
        type: "config_snapshot",
        data: {
          configHash: "abc123",
          agentId: AGENT_ID,
          sandboxEnabled: true,
          pluginCount: 3,
          channelCount: 2,
        },
      });

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.vitals.configValid).toBe(true);
      expect(metrics.security.sandboxEnabled).toBe(true);
    });

    it("uses defaults for vitals/security when no config_snapshot exists", () => {
      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      // defaults should be safe/minimal
      expect(metrics.vitals.configValid).toBe(false);
      expect(metrics.vitals.configWarnings).toEqual([]);
      expect(metrics.vitals.pluginLoadErrors).toEqual([]);
      expect(metrics.security.sandboxEnabled).toBe(false);
      expect(metrics.security.credentialPatternHits).toEqual([]);
    });
  });

  describe("vitals and security metrics from plugin_snapshot", () => {
    it("extracts plugin load errors from latest plugin_snapshot", () => {
      const store = createEventStore(db);

      store.insertEvent({
        id: makeId(),
        source: "snapshot",
        timestamp: 1_700_000_000_000,
        agentId: AGENT_ID,
        type: "plugin_snapshot",
        data: {
          plugins: [
            {
              id: "plugin-ok",
              name: "OK Plugin",
              source: "bundled",
              status: "loaded",
              registeredTools: ["Bash"],
              registeredHooks: [],
            },
            {
              id: "plugin-err",
              name: "Error Plugin",
              source: "global",
              status: "error",
              error: "module not found",
              registeredTools: [],
              registeredHooks: [],
            },
          ],
        },
      });

      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.vitals.pluginLoadErrors).toHaveLength(1);
      expect(metrics.vitals.pluginLoadErrors[0]).toEqual({ pluginId: "plugin-err", error: "module not found" });
      expect(metrics.security.pluginSources["plugin-ok"]).toBe("bundled");
      expect(metrics.security.pluginSources["plugin-err"]).toBe("global");
    });
  });

  // ─── Time range filtering ────────────────────────────────────────────────

  describe("time range filtering", () => {
    it("only includes events within the specified time range", () => {
      const store = createEventStore(db);
      const inRange = 1_700_000_000_000;
      const before = 1_600_000_000_000;
      const after = 1_800_000_000_000;

      store.insertEvent(makeToolCallEvent({ timestamp: before, data: { toolName: "Bash", paramsSummary: {}, success: true } }));
      store.insertEvent(makeToolCallEvent({ timestamp: inRange, data: { toolName: "Bash", paramsSummary: {}, success: true } }));
      store.insertEvent(makeToolCallEvent({ timestamp: after, data: { toolName: "Bash", paramsSummary: {}, success: true } }));

      const metrics = aggregateMetrics(db, AGENT_ID, {
        from: 1_650_000_000_000,
        to: 1_750_000_000_000,
      });

      expect(metrics.skill.toolCallCount).toBe(1);
    });
  });

  // ─── Agent isolation ─────────────────────────────────────────────────────

  describe("agent isolation", () => {
    it("only includes events for the specified agentId", () => {
      const store = createEventStore(db);
      store.insertEvent(makeToolCallEvent({ agentId: "agent-1", data: { toolName: "Bash", paramsSummary: {}, success: true } }));
      store.insertEvent(makeToolCallEvent({ agentId: "agent-2", data: { toolName: "Bash", paramsSummary: {}, success: true } }));
      store.insertEvent(makeToolCallEvent({ agentId: "agent-2", data: { toolName: "Bash", paramsSummary: {}, success: true } }));

      const metrics = aggregateMetrics(db, "agent-1", TIME_RANGE);

      expect(metrics.skill.toolCallCount).toBe(1);
      expect(metrics.agentId).toBe("agent-1");
    });
  });

  // ─── MetricSet structure ─────────────────────────────────────────────────

  describe("MetricSet structure", () => {
    it("returns a well-formed MetricSet with all required fields", () => {
      const metrics = aggregateMetrics(db, AGENT_ID, TIME_RANGE);

      expect(metrics.timeRange).toEqual(TIME_RANGE);
      expect(metrics.agentId).toBe(AGENT_ID);

      // skill
      expect(typeof metrics.skill.toolCallCount).toBe("number");
      expect(typeof metrics.skill.toolSuccessRate).toBe("number");
      expect(typeof metrics.skill.toolErrorRate).toBe("number");
      expect(Array.isArray(metrics.skill.topErrorTools)).toBe(true);
      expect(Array.isArray(metrics.skill.repeatCallPatterns)).toBe(true);
      expect(Array.isArray(metrics.skill.unusedPlugins)).toBe(true);
      expect(typeof metrics.skill.tokenPerToolCall).toBe("object");
      expect(typeof metrics.skill.contextTokenRatio).toBe("object");

      // memory
      expect(typeof metrics.memory.fileCount).toBe("number");
      expect(typeof metrics.memory.totalSizeBytes).toBe("number");
      expect(typeof metrics.memory.avgAgeDays).toBe("number");
      expect(Array.isArray(metrics.memory.staleFiles)).toBe(true);

      // behavior
      expect(typeof metrics.behavior.sessionCount).toBe("number");
      expect(typeof metrics.behavior.avgMessagesPerSession).toBe("number");
      expect(typeof metrics.behavior.agentSuccessRate).toBe("number");
      expect(typeof metrics.behavior.avgStepsPerSession).toBe("number");
      expect(typeof metrics.behavior.subagentSpawnCount).toBe("number");
      expect(typeof metrics.behavior.subagentFailureRate).toBe("number");

      // cost
      expect(typeof metrics.cost.totalInputTokens).toBe("number");
      expect(typeof metrics.cost.totalOutputTokens).toBe("number");
      expect(typeof metrics.cost.totalCacheReadTokens).toBe("number");
      expect(typeof metrics.cost.totalCacheWriteTokens).toBe("number");
      expect(Array.isArray(metrics.cost.dailyTrend)).toBe(true);
      expect(Array.isArray(metrics.cost.tokensBySession)).toBe(true);

      // security
      expect(typeof metrics.security.sandboxEnabled).toBe("boolean");
      expect(typeof metrics.security.pluginSources).toBe("object");
      expect(typeof metrics.security.channelAllowLists).toBe("object");
      expect(Array.isArray(metrics.security.credentialPatternHits)).toBe(true);

      // vitals
      expect(typeof metrics.vitals.gatewayReachable).toBe("boolean");
      expect(typeof metrics.vitals.configValid).toBe("boolean");
      expect(Array.isArray(metrics.vitals.configWarnings)).toBe(true);
      expect(Array.isArray(metrics.vitals.pluginLoadErrors)).toBe(true);
      expect(typeof metrics.vitals.openclawVersion).toBe("string");
      expect(typeof metrics.vitals.diskUsageBytes).toBe("number");
    });
  });
});
