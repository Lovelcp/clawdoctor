// ═══════════════════════════════════════════════
//  Session Parser
//  Source: design spec §5.2
// ═══════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { ulid } from "ulid";
import type { ClawDocEvent, ToolCallData, LLMCallData } from "../types/events.js";

// ─── JSONL message types ───

interface SessionHeader {
  type: "session";
  id: string;
  [key: string]: unknown;
}

interface ToolUseBlock {
  type: "toolUse" | "toolCall" | "functionCall";
  id: string;
  name: string;
  input?: Record<string, unknown>;
  // functionCall variant
  function?: { name: string; arguments?: string | Record<string, unknown> };
  parameters?: Record<string, unknown>;
}

interface AgentMessage {
  role: "user" | "assistant" | "toolResult" | "system";
  content?: string | unknown[];
  toolUseId?: string;
  isError?: boolean;
  errorMessage?: string;
  timestamp?: number;
  usage?: {
    input?: number;
    output?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

// ─── Privacy helpers ───

/**
 * Build paramsSummary: record of key → typeof value descriptor.
 * Does NOT store raw param values.
 */
function summarizeParams(input: Record<string, unknown>): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      summary[key] = "array";
    } else if (value === null) {
      summary[key] = "null";
    } else {
      summary[key] = typeof value;
    }
  }
  return summary;
}

/**
 * Build resultSummary: type + length. Does NOT store raw result.
 */
function summarizeResult(content: unknown): { type: string; length?: number } {
  if (typeof content === "string") {
    return { type: "string", length: content.length };
  }
  if (Array.isArray(content)) {
    return { type: "array", length: content.length };
  }
  if (content === null) {
    return { type: "null" };
  }
  if (typeof content === "object") {
    return { type: "object" };
  }
  return { type: typeof content };
}

/**
 * Truncate error message to 200 chars.
 */
function truncateError(error: string): string {
  return error.slice(0, 200);
}

// ─── Tool block extraction ───

function extractToolBlocks(content: unknown[]): ToolUseBlock[] {
  const blocks: ToolUseBlock[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const block = item as Record<string, unknown>;
    const type = block["type"] as string | undefined;

    if (type === "toolUse" || type === "toolCall") {
      blocks.push({
        type: type as "toolUse" | "toolCall",
        id: block["id"] as string,
        name: block["name"] as string,
        input: (block["input"] ?? {}) as Record<string, unknown>,
      });
    } else if (type === "functionCall") {
      // functionCall variant: function.name + function.arguments
      const fn = block["function"] as { name?: string; arguments?: string | Record<string, unknown> } | undefined;
      let input: Record<string, unknown> = {};
      if (fn?.arguments) {
        if (typeof fn.arguments === "string") {
          try {
            input = JSON.parse(fn.arguments) as Record<string, unknown>;
          } catch {
            input = {};
          }
        } else {
          input = fn.arguments as Record<string, unknown>;
        }
      }
      blocks.push({
        type: "functionCall",
        id: block["id"] as string,
        name: fn?.name ?? (block["name"] as string ?? "unknown"),
        input,
      });
    }
  }
  return blocks;
}

// ─── Main parser ───

/**
 * Parse a session JSONL file and return ClawDocEvents.
 * sessionKey is derived from the filename (not JSONL header id) per §5.5.
 */
export function parseSessionFile(filePath: string, agentId: string): ClawDocEvent[] {
  const events: ClawDocEvent[] = [];

  // Derive sessionKey from filename (e.g. "healthy-session.jsonl" → "healthy-session")
  const sessionKey = basename(filePath, extname(filePath));

  let rawContent: string;
  try {
    rawContent = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = rawContent.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Parse each line as JSON
  const parsed: unknown[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  if (parsed.length === 0) return [];

  // First line should be session header
  const header = parsed[0] as Record<string, unknown>;
  const sessionId = header["type"] === "session" ? (header["id"] as string | undefined) : undefined;

  // Build a map of toolUseId → toolResult message for fast lookup
  const toolResultMap = new Map<string, AgentMessage>();
  for (const item of parsed) {
    const msg = item as AgentMessage;
    if (msg.role === "toolResult" && msg.toolUseId) {
      toolResultMap.set(msg.toolUseId, msg);
    }
  }

  // Walk messages
  const now = Date.now();
  for (const item of parsed) {
    const msg = item as AgentMessage;

    if (msg.role === "assistant") {
      const content = msg.content;

      // Extract tool call blocks from array content
      if (Array.isArray(content)) {
        const toolBlocks = extractToolBlocks(content);
        for (const block of toolBlocks) {
          const toolResult = toolResultMap.get(block.id);
          const isError = toolResult?.isError ?? false;
          const errorMsg = toolResult?.errorMessage;

          const toolCallData: ToolCallData = {
            toolName: block.name,
            paramsSummary: summarizeParams(block.input ?? {}),
            success: !isError,
          };

          if (toolResult) {
            toolCallData.resultSummary = summarizeResult(toolResult.content);
          }

          if (isError && errorMsg) {
            toolCallData.error = truncateError(errorMsg);
          }

          const timestamp = toolResult?.timestamp ?? now;

          events.push({
            id: ulid(timestamp),
            source: "snapshot",
            timestamp,
            agentId,
            sessionKey,
            sessionId,
            type: "tool_call",
            data: toolCallData,
          });
        }
      }

      // Extract LLM usage
      if (msg.usage) {
        const usage = msg.usage;
        const inputTokens = usage.input ?? usage.inputTokens;
        const outputTokens = usage.output ?? usage.outputTokens;

        const llmCallData: LLMCallData = {
          provider: "unknown",
          model: "unknown",
          inputTokens,
          outputTokens,
          totalTokens:
            inputTokens !== undefined && outputTokens !== undefined
              ? inputTokens + outputTokens
              : undefined,
          success: true,
        };

        events.push({
          id: ulid(now),
          source: "snapshot",
          timestamp: now,
          agentId,
          sessionKey,
          sessionId,
          type: "llm_call",
          data: llmCallData,
        });
      }
    }
  }

  return events;
}
