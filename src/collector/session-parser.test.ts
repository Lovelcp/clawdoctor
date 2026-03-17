import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSessionFile } from "./session-parser.js";
import type { ToolCallData, LLMCallData } from "../types/events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fixtures live at <repo-root>/fixtures/sessions/
// Since tsconfig rootDir is src, we need to go up two levels
const fixturesDir = join(__dirname, "..", "..", "fixtures", "sessions");

describe("parseSessionFile", () => {
  describe("healthy-session.jsonl", () => {
    const filePath = join(fixturesDir, "healthy-session.jsonl");

    it("derives sessionKey from filename, not JSONL header id", () => {
      const events = parseSessionFile(filePath, "agent-001");
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.sessionKey).toBe("healthy-session");
        // sessionId should be the header id
        expect(event.sessionId).toBe("sess-001");
      }
    });

    it("extracts a tool_call event for web_search", () => {
      const events = parseSessionFile(filePath, "agent-001");
      const toolCalls = events.filter((e) => e.type === "tool_call");
      expect(toolCalls).toHaveLength(1);

      const tc = toolCalls[0];
      expect(tc.agentId).toBe("agent-001");
      expect(tc.source).toBe("snapshot");

      const data = tc.data as ToolCallData;
      expect(data.toolName).toBe("web_search");
      expect(data.success).toBe(true);
    });

    it("stores paramsSummary (key → type) not raw params", () => {
      const events = parseSessionFile(filePath, "agent-001");
      const toolCall = events.find((e) => e.type === "tool_call");
      expect(toolCall).toBeDefined();

      const data = toolCall!.data as ToolCallData;
      // Raw params were: { query: "TypeScript best practices", limit: 10 }
      // paramsSummary should map key → type, NOT raw values
      expect(data.paramsSummary).toEqual({ query: "string", limit: "number" });
      // Verify raw values are not present
      expect(JSON.stringify(data.paramsSummary)).not.toContain("TypeScript best practices");
      expect(JSON.stringify(data.paramsSummary)).not.toContain("10");
    });

    it("stores resultSummary (type + length) not raw result", () => {
      const events = parseSessionFile(filePath, "agent-001");
      const toolCall = events.find((e) => e.type === "tool_call");
      expect(toolCall).toBeDefined();

      const data = toolCall!.data as ToolCallData;
      expect(data.resultSummary).toBeDefined();
      expect(data.resultSummary!.type).toBe("string");
      // Length should be > 0 (the content is "Results: 1. Use strict mode...")
      expect(data.resultSummary!.length).toBeGreaterThan(0);
      // Raw content must NOT be present
      expect(JSON.stringify(data.resultSummary)).not.toContain("strict mode");
    });

    it("extracts an llm_call event with token usage", () => {
      const events = parseSessionFile(filePath, "agent-001");
      const llmCalls = events.filter((e) => e.type === "llm_call");
      expect(llmCalls).toHaveLength(1);

      const data = llmCalls[0].data as LLMCallData;
      expect(data.inputTokens).toBe(1200);
      expect(data.outputTokens).toBe(450);
      expect(data.totalTokens).toBe(1650);
      expect(data.success).toBe(true);
    });

    it("assigns ULIDs as event ids", () => {
      const events = parseSessionFile(filePath, "agent-001");
      for (const event of events) {
        // ULID is 26 chars, alphanumeric uppercase
        expect(event.id).toMatch(/^[0-9A-Z]{26}$/);
      }
    });
  });

  describe("failing-tools-session.jsonl", () => {
    const filePath = join(fixturesDir, "failing-tools-session.jsonl");

    it("derives sessionKey from filename", () => {
      const events = parseSessionFile(filePath, "agent-002");
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.sessionKey).toBe("failing-tools-session");
      }
    });

    it("marks failed tool call as success=false", () => {
      const events = parseSessionFile(filePath, "agent-002");
      const toolCalls = events.filter((e) => e.type === "tool_call");
      expect(toolCalls).toHaveLength(1);

      const data = toolCalls[0].data as ToolCallData;
      expect(data.toolName).toBe("file_read");
      expect(data.success).toBe(false);
    });

    it("stores truncated error message (max 200 chars)", () => {
      const events = parseSessionFile(filePath, "agent-002");
      const toolCall = events.find((e) => e.type === "tool_call");
      const data = toolCall!.data as ToolCallData;

      expect(data.error).toBeDefined();
      expect(data.error!.length).toBeLessThanOrEqual(200);
      expect(data.error).toContain("ENOENT");
    });

    it("stores paramsSummary for failed tool call", () => {
      const events = parseSessionFile(filePath, "agent-002");
      const toolCall = events.find((e) => e.type === "tool_call");
      const data = toolCall!.data as ToolCallData;

      // Raw params were: { path: "/nonexistent/file.txt" }
      expect(data.paramsSummary).toEqual({ path: "string" });
      expect(JSON.stringify(data.paramsSummary)).not.toContain("/nonexistent/file.txt");
    });

    it("extracts llm_call event with usage", () => {
      const events = parseSessionFile(filePath, "agent-002");
      const llmCalls = events.filter((e) => e.type === "llm_call");
      expect(llmCalls).toHaveLength(1);

      const data = llmCalls[0].data as LLMCallData;
      expect(data.inputTokens).toBe(800);
      expect(data.outputTokens).toBe(200);
    });
  });

  describe("edge cases", () => {
    it("returns empty array for non-existent file", () => {
      const events = parseSessionFile("/nonexistent/path/session.jsonl", "agent-001");
      expect(events).toEqual([]);
    });

    it("all events have source=snapshot", () => {
      const filePath = join(fixturesDir, "healthy-session.jsonl");
      const events = parseSessionFile(filePath, "agent-001");
      for (const event of events) {
        expect(event.source).toBe("snapshot");
      }
    });

    it("all events have correct agentId", () => {
      const filePath = join(fixturesDir, "healthy-session.jsonl");
      const events = parseSessionFile(filePath, "my-test-agent");
      for (const event of events) {
        expect(event.agentId).toBe("my-test-agent");
      }
    });
  });
});
