import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSnapshot } from "./snapshot-collector.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = join(__dirname, "..", "..");
const fixturesRoot = join(repoRoot, "fixtures");

describe("collectSnapshot", () => {
  it("returns an array of ClawInsightEvents", async () => {
    const events = await collectSnapshot({
      agentId: "agent-test",
      // stateDir with sessions subdir
      stateDir: fixturesRoot,
      workspaceDir: join(fixturesRoot, "memory"),
    });

    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  it("includes memory_snapshot event", async () => {
    const events = await collectSnapshot({
      agentId: "agent-test",
      stateDir: fixturesRoot,
      workspaceDir: join(fixturesRoot, "memory"),
    });

    const memoryEvents = events.filter((e) => e.type === "memory_snapshot");
    expect(memoryEvents).toHaveLength(1);
  });

  it("includes plugin_snapshot event", async () => {
    const events = await collectSnapshot({
      agentId: "agent-test",
      stateDir: fixturesRoot,
      workspaceDir: join(fixturesRoot, "memory"),
    });

    const pluginEvents = events.filter((e) => e.type === "plugin_snapshot");
    expect(pluginEvents).toHaveLength(1);
  });

  it("includes session events from sessions/ subdir", async () => {
    const events = await collectSnapshot({
      agentId: "agent-test",
      stateDir: fixturesRoot,
      workspaceDir: join(fixturesRoot, "memory"),
    });

    // Both healthy-session and failing-tools-session should contribute events
    const toolCalls = events.filter((e) => e.type === "tool_call");
    const llmCalls = events.filter((e) => e.type === "llm_call");
    expect(toolCalls.length).toBeGreaterThanOrEqual(2); // one per session
    expect(llmCalls.length).toBeGreaterThanOrEqual(2);  // one per session
  });

  it("includes config_snapshot event when configPath is provided", async () => {
    const events = await collectSnapshot({
      agentId: "agent-test",
      stateDir: fixturesRoot,
      workspaceDir: join(fixturesRoot, "memory"),
      configPath: join(fixturesRoot, "config", "valid-openclaw.json"),
    });

    const configEvents = events.filter((e) => e.type === "config_snapshot");
    expect(configEvents).toHaveLength(1);
  });

  it("all returned events have agentId set", async () => {
    const events = await collectSnapshot({
      agentId: "my-specific-agent",
      stateDir: fixturesRoot,
      workspaceDir: join(fixturesRoot, "memory"),
    });

    for (const event of events) {
      expect(event.agentId).toBe("my-specific-agent");
    }
  });

  it("all returned events have source=snapshot", async () => {
    const events = await collectSnapshot({
      agentId: "agent-test",
      stateDir: fixturesRoot,
      workspaceDir: join(fixturesRoot, "memory"),
    });

    for (const event of events) {
      expect(event.source).toBe("snapshot");
    }
  });

  it("works gracefully when stateDir has no sessions subdir", async () => {
    const events = await collectSnapshot({
      agentId: "agent-test",
      stateDir: "/nonexistent/statedir",
      workspaceDir: join(fixturesRoot, "memory"),
    });

    // Should still return memory and plugin snapshot events
    expect(Array.isArray(events)).toBe(true);
    const types = new Set(events.map((e) => e.type));
    expect(types.has("memory_snapshot")).toBe(true);
    expect(types.has("plugin_snapshot")).toBe(true);
  });
});
