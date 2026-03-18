// ═══════════════════════════════════════════════
//  Stream Collector Tests
//  Design spec: Phase 2, Task 8
// ═══════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerStreamCollector } from "./stream-collector.js";
import type { EventBuffer } from "./event-buffer.js";
import type { OpenClawPluginApi } from "./openclaw-types.js";
import type { ClawInsightEvent } from "../types/events.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Build a minimal mock OpenClawPluginApi that captures hook registrations
 * so they can be invoked in tests.
 */
function createMockApi() {
  const hooks: Record<string, Array<(...args: any[]) => any>> = {};

  const api: OpenClawPluginApi = {
    id: "clawinsight",
    name: "ClawInsight",
    config: {},
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    on: vi.fn((hookName: string, handler: (...args: any[]) => any) => {
      if (!hooks[hookName]) {
        hooks[hookName] = [];
      }
      hooks[hookName].push(handler);
    }),
    registerService: vi.fn(),
    registerCli: vi.fn(),
    registerHttpRoute: vi.fn(),
  };

  /** Fire all handlers registered for a given hook. */
  function fire(hookName: string, event: unknown, ctx: unknown = {}) {
    for (const handler of hooks[hookName] ?? []) {
      handler(event, ctx);
    }
  }

  return { api, fire, hooks };
}

/**
 * Build a minimal mock EventBuffer that records pushed events.
 */
function createMockBuffer() {
  const pushed: ClawInsightEvent[] = [];

  const buffer: EventBuffer = {
    push: vi.fn((event: ClawInsightEvent) => {
      pushed.push(event);
    }),
    stop: vi.fn(),
  };

  return { buffer, pushed };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("registerStreamCollector", () => {
  let mockApi: ReturnType<typeof createMockApi>;
  let mockBuffer: ReturnType<typeof createMockBuffer>;

  beforeEach(() => {
    mockApi = createMockApi();
    mockBuffer = createMockBuffer();
    registerStreamCollector(mockApi.api, mockBuffer.buffer);
  });

  // ── llm_output hook ─────────────────────────────────────────────────────────

  describe("llm_output hook → llm_call event", () => {
    it("creates an llm_call event with provider and model", () => {
      mockApi.fire("llm_output", {
        runId: "run-1",
        sessionId: "sess-1",
        provider: "anthropic",
        model: "claude-opus-4-5",
        assistantTexts: ["hello"],
        usage: { input: 100, output: 50, total: 150 },
      }, { agentId: "agent-1", sessionKey: "key-1", sessionId: "sess-1" });

      expect(mockBuffer.pushed).toHaveLength(1);
      const ev = mockBuffer.pushed[0];
      expect(ev.type).toBe("llm_call");
      expect(ev.source).toBe("stream");
      expect(ev.agentId).toBe("agent-1");
      expect(ev.sessionKey).toBe("key-1");
    });

    it("populates usage token fields from the hook event", () => {
      mockApi.fire("llm_output", {
        provider: "openai",
        model: "gpt-4o",
        usage: { input: 200, output: 80, cacheRead: 10, cacheWrite: 20, total: 300 },
      }, {});

      const ev = mockBuffer.pushed[0];
      expect(ev.type).toBe("llm_call");
      const data = ev.data as import("../types/events.js").LLMCallData;
      expect(data.provider).toBe("openai");
      expect(data.model).toBe("gpt-4o");
      expect(data.inputTokens).toBe(200);
      expect(data.outputTokens).toBe(80);
      expect(data.cacheReadTokens).toBe(10);
      expect(data.cacheWriteTokens).toBe(20);
      expect(data.totalTokens).toBe(300);
      expect(data.success).toBe(true);
    });

    it("assigns a ULID id and stream source to each event", () => {
      mockApi.fire("llm_output", { provider: "anthropic", model: "claude-3" }, {});

      const ev = mockBuffer.pushed[0];
      // ULID is 26 uppercase alphanumeric characters
      expect(ev.id).toMatch(/^[0-9A-Z]{26}$/);
      expect(ev.source).toBe("stream");
    });

    it("sets timestamp to approximately Date.now()", () => {
      const before = Date.now();
      mockApi.fire("llm_output", { provider: "anthropic", model: "claude-3" }, {});
      const after = Date.now();

      const ev = mockBuffer.pushed[0];
      expect(ev.timestamp).toBeGreaterThanOrEqual(before);
      expect(ev.timestamp).toBeLessThanOrEqual(after);
    });

    it("defaults agentId to 'default' when ctx.agentId is missing", () => {
      mockApi.fire("llm_output", { provider: "anthropic", model: "claude-3" }, {});
      expect(mockBuffer.pushed[0].agentId).toBe("default");
    });
  });

  // ── after_tool_call hook ────────────────────────────────────────────────────

  describe("after_tool_call hook → tool_call event", () => {
    it("creates a tool_call event", () => {
      mockApi.fire("after_tool_call", {
        toolName: "bash",
        params: { command: "ls -la", cwd: "/tmp" },
        result: "file1\nfile2",
        durationMs: 123,
      }, { agentId: "agent-1", sessionKey: "key-1", toolName: "bash" });

      expect(mockBuffer.pushed).toHaveLength(1);
      const ev = mockBuffer.pushed[0];
      expect(ev.type).toBe("tool_call");
      expect(ev.source).toBe("stream");
    });

    it("uses summarizeParams instead of raw params", () => {
      mockApi.fire("after_tool_call", {
        toolName: "read_file",
        params: { path: "/etc/passwd", encoding: "utf8", offset: 0 },
        result: "root:x:0:0:...",
      }, {});

      const ev = mockBuffer.pushed[0];
      const data = ev.data as import("../types/events.js").ToolCallData;
      // summarizeParams converts values to type descriptors
      expect(data.paramsSummary).toEqual({
        path: "string",
        encoding: "string",
        offset: "number",
      });
      // raw string value must NOT appear in paramsSummary
      expect(JSON.stringify(data.paramsSummary)).not.toContain("/etc/passwd");
    });

    it("uses summarizeResult instead of raw result", () => {
      mockApi.fire("after_tool_call", {
        toolName: "search",
        params: { query: "hello" },
        result: "some long result string",
      }, {});

      const ev = mockBuffer.pushed[0];
      const data = ev.data as import("../types/events.js").ToolCallData;
      // summarizeResult returns { type, length }
      expect(data.resultSummary).toEqual({ type: "string", length: 23 });
      // raw result value must NOT appear
      expect(JSON.stringify(data.resultSummary)).not.toContain("some long result string");
    });

    it("marks success=false when error is present", () => {
      mockApi.fire("after_tool_call", {
        toolName: "bash",
        params: {},
        error: "command not found",
      }, {});

      const ev = mockBuffer.pushed[0];
      const data = ev.data as import("../types/events.js").ToolCallData;
      expect(data.success).toBe(false);
      expect(data.error).toBe("command not found");
    });

    it("redacts API keys from error strings", () => {
      mockApi.fire("after_tool_call", {
        toolName: "http_request",
        params: {},
        error: "Auth failed: sk-ant-api03-ABCDxyz12345678ABCDxyz12345678ABCD (invalid)",
      }, {});

      const ev = mockBuffer.pushed[0];
      const data = ev.data as import("../types/events.js").ToolCallData;
      expect(data.error).not.toContain("sk-ant-api03-ABCDxyz12345678");
      expect(data.error).toContain("sk-ant-api03-");
    });

    it("preserves durationMs from the hook event", () => {
      mockApi.fire("after_tool_call", {
        toolName: "bash",
        params: {},
        result: null,
        durationMs: 456,
      }, {});

      const data = mockBuffer.pushed[0].data as import("../types/events.js").ToolCallData;
      expect(data.durationMs).toBe(456);
    });
  });

  // ── session_end hook ────────────────────────────────────────────────────────

  describe("session_end hook → session_lifecycle event", () => {
    it("creates a session_lifecycle event with event='end'", () => {
      mockApi.fire("session_end", {
        sessionId: "sess-abc",
        sessionKey: "key-abc",
        messageCount: 42,
        durationMs: 30000,
      }, { agentId: "agent-2", sessionKey: "key-abc", sessionId: "sess-abc" });

      expect(mockBuffer.pushed).toHaveLength(1);
      const ev = mockBuffer.pushed[0];
      expect(ev.type).toBe("session_lifecycle");
      expect(ev.source).toBe("stream");
      expect(ev.agentId).toBe("agent-2");
      expect(ev.sessionKey).toBe("key-abc");
    });

    it("sets data.event='end' with correct messageCount and durationMs", () => {
      mockApi.fire("session_end", {
        sessionId: "sess-1",
        messageCount: 10,
        durationMs: 5000,
      }, {});

      const data = mockBuffer.pushed[0].data as import("../types/events.js").SessionLifecycleData;
      expect(data.event).toBe("end");
      expect(data.messageCount).toBe(10);
      expect(data.durationMs).toBe(5000);
    });
  });

  // ── agent_end hook ──────────────────────────────────────────────────────────

  describe("agent_end hook → agent_lifecycle event", () => {
    it("creates an agent_lifecycle event with event='end'", () => {
      mockApi.fire("agent_end", {
        messages: [],
        success: true,
        durationMs: 12000,
      }, { agentId: "agent-3", sessionKey: "key-3", trigger: "user" });

      expect(mockBuffer.pushed).toHaveLength(1);
      const ev = mockBuffer.pushed[0];
      expect(ev.type).toBe("agent_lifecycle");
      const data = ev.data as import("../types/events.js").AgentLifecycleData;
      expect(data.event).toBe("end");
      expect(data.success).toBe(true);
      expect(data.durationMs).toBe(12000);
      expect(data.trigger).toBe("user");
    });
  });

  // ── subagent_ended hook ─────────────────────────────────────────────────────

  describe("subagent_ended hook → subagent_event", () => {
    it("creates a subagent_event with event='ended'", () => {
      mockApi.fire("subagent_ended", {
        targetSessionKey: "child-key",
        targetKind: "subagent",
        reason: "completed",
        outcome: "ok",
      }, { agentId: "parent-agent", childSessionKey: "child-key" });

      expect(mockBuffer.pushed).toHaveLength(1);
      const ev = mockBuffer.pushed[0];
      expect(ev.type).toBe("subagent_event");
      const data = ev.data as import("../types/events.js").SubagentEventData;
      expect(data.event).toBe("ended");
      expect(data.childSessionKey).toBe("child-key");
      expect(data.outcome).toBe("ok");
    });
  });

  // ── after_compaction hook ───────────────────────────────────────────────────

  describe("after_compaction hook → compaction_event", () => {
    it("creates a compaction_event with reconstructed messageCountBefore", () => {
      // after_compaction gives us messageCount (after) and compactedCount (how many removed)
      mockApi.fire("after_compaction", {
        messageCount: 20,
        compactedCount: 80,
        tokenCount: 5000,
      }, { agentId: "agent-1" });

      expect(mockBuffer.pushed).toHaveLength(1);
      const ev = mockBuffer.pushed[0];
      expect(ev.type).toBe("compaction_event");
      const data = ev.data as import("../types/events.js").CompactionEventData;
      // messageCountBefore = messageCount + compactedCount = 20 + 80 = 100
      expect(data.messageCountBefore).toBe(100);
      expect(data.messageCountAfter).toBe(20);
      expect(data.tokenCountAfter).toBe(5000);
    });
  });

  // ── buffer interaction ──────────────────────────────────────────────────────

  describe("buffer push interaction", () => {
    it("pushes every captured event to the buffer", () => {
      mockApi.fire("llm_output", { provider: "anthropic", model: "claude-3" }, {});
      mockApi.fire("session_end", { sessionId: "s1", messageCount: 5 }, {});
      mockApi.fire("agent_end", { messages: [], success: true }, {});

      expect(mockBuffer.pushed).toHaveLength(3);
      expect(mockBuffer.buffer.push).toHaveBeenCalledTimes(3);
    });

    it("each event has a unique id", () => {
      mockApi.fire("llm_output", { provider: "anthropic", model: "claude-3" }, {});
      mockApi.fire("llm_output", { provider: "openai", model: "gpt-4o" }, {});

      const ids = mockBuffer.pushed.map((e) => e.id);
      expect(new Set(ids).size).toBe(2);
    });
  });
});
