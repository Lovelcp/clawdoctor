// ═══════════════════════════════════════════════
//  Stream Collector
//  Registers OpenClaw plugin hooks and converts
//  them into ClawDocEvents pushed to the EventBuffer.
//  Design spec: Phase 2, Task 8
// ═══════════════════════════════════════════════

import { ulid } from "ulid";
import type { EventBuffer } from "./event-buffer.js";
import type { OpenClawPluginApi } from "./openclaw-types.js";
import { summarizeParams, summarizeResult, redactAndTruncate } from "./summarize.js";
import type {
  ClawDocEvent,
  LLMCallData,
  ToolCallData,
  SessionLifecycleData,
  AgentLifecycleData,
  SubagentEventData,
  CompactionEventData,
} from "../types/events.js";

// ─── registerStreamCollector ──────────────────────────────────────────────────

/**
 * Registers 6 OpenClaw plugin hooks that produce ClawDocEvents and push
 * them to the given EventBuffer.
 *
 * Hooks registered:
 *   llm_output        → llm_call event
 *   after_tool_call   → tool_call event (params/result summarized, error redacted)
 *   session_end       → session_lifecycle event
 *   agent_end         → agent_lifecycle event
 *   subagent_ended    → subagent_event
 *   after_compaction  → compaction_event
 */
export function registerStreamCollector(api: OpenClawPluginApi, buffer: EventBuffer): void {
  // ── llm_output → llm_call ──────────────────────────────────────────────────
  api.on("llm_output", (event: any, ctx: any) => {
    const data: LLMCallData = {
      provider: event.provider ?? "unknown",
      model: event.model ?? "unknown",
      inputTokens: event.usage?.input,
      outputTokens: event.usage?.output,
      cacheReadTokens: event.usage?.cacheRead,
      cacheWriteTokens: event.usage?.cacheWrite,
      totalTokens: event.usage?.total,
      success: true,
    };

    const ev: ClawDocEvent = {
      id: ulid(),
      source: "stream",
      timestamp: Date.now(),
      agentId: ctx?.agentId ?? "default",
      sessionKey: ctx?.sessionKey,
      sessionId: ctx?.sessionId ?? event.sessionId,
      type: "llm_call",
      data,
    };

    buffer.push(ev);
  });

  // ── after_tool_call → tool_call ───────────────────────────────────────────
  api.on("after_tool_call", (event: any, ctx: any) => {
    const paramsSummary = event.params ? summarizeParams(event.params as Record<string, unknown>) : {};
    const resultSummary = summarizeResult(event.result);
    const error = redactAndTruncate(event.error, 200);

    const data: ToolCallData = {
      toolName: event.toolName ?? ctx?.toolName ?? "unknown",
      paramsSummary,
      resultSummary,
      error,
      durationMs: event.durationMs,
      success: error === undefined && event.error === undefined,
    };

    const ev: ClawDocEvent = {
      id: ulid(),
      source: "stream",
      timestamp: Date.now(),
      agentId: ctx?.agentId ?? "default",
      sessionKey: ctx?.sessionKey,
      sessionId: ctx?.sessionId,
      type: "tool_call",
      data,
    };

    buffer.push(ev);
  });

  // ── session_end → session_lifecycle ───────────────────────────────────────
  api.on("session_end", (event: any, ctx: any) => {
    const data: SessionLifecycleData = {
      event: "end",
      messageCount: event.messageCount,
      durationMs: event.durationMs,
    };

    const ev: ClawDocEvent = {
      id: ulid(),
      source: "stream",
      timestamp: Date.now(),
      agentId: ctx?.agentId ?? "default",
      sessionKey: ctx?.sessionKey ?? event.sessionKey,
      sessionId: ctx?.sessionId ?? event.sessionId,
      type: "session_lifecycle",
      data,
    };

    buffer.push(ev);
  });

  // ── agent_end → agent_lifecycle ───────────────────────────────────────────
  api.on("agent_end", (event: any, ctx: any) => {
    const error = redactAndTruncate(event.error, 200);

    const data: AgentLifecycleData = {
      event: "end",
      success: event.success,
      error,
      durationMs: event.durationMs,
      trigger: ctx?.trigger,
    };

    const ev: ClawDocEvent = {
      id: ulid(),
      source: "stream",
      timestamp: Date.now(),
      agentId: ctx?.agentId ?? "default",
      sessionKey: ctx?.sessionKey,
      sessionId: ctx?.sessionId,
      type: "agent_lifecycle",
      data,
    };

    buffer.push(ev);
  });

  // ── subagent_ended → subagent_event ───────────────────────────────────────
  api.on("subagent_ended", (event: any, ctx: any) => {
    const error = redactAndTruncate(event.error, 200);

    const data: SubagentEventData = {
      event: "ended",
      childSessionKey: event.targetSessionKey ?? ctx?.childSessionKey ?? "",
      agentId: ctx?.agentId ?? "default",
      outcome: event.outcome,
      error,
      durationMs: undefined,
    };

    const ev: ClawDocEvent = {
      id: ulid(),
      source: "stream",
      timestamp: Date.now(),
      agentId: ctx?.agentId ?? "default",
      sessionKey: ctx?.requesterSessionKey,
      sessionId: ctx?.sessionId,
      type: "subagent_event",
      data,
    };

    buffer.push(ev);
  });

  // ── after_compaction → compaction_event ───────────────────────────────────
  api.on("after_compaction", (event: any, ctx: any) => {
    const data: CompactionEventData = {
      // after_compaction has messageCount (after) and compactedCount (how many compacted)
      // reconstruct messageCountBefore from messageCount + compactedCount
      messageCountBefore: (event.messageCount ?? 0) + (event.compactedCount ?? 0),
      messageCountAfter: event.messageCount ?? 0,
      tokenCountBefore: undefined,
      tokenCountAfter: event.tokenCount,
    };

    const ev: ClawDocEvent = {
      id: ulid(),
      source: "stream",
      timestamp: Date.now(),
      agentId: ctx?.agentId ?? "default",
      sessionKey: ctx?.sessionKey,
      sessionId: ctx?.sessionId,
      type: "compaction_event",
      data,
    };

    buffer.push(ev);
  });
}
