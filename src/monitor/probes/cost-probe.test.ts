import { describe, it, expect, beforeEach } from "vitest";
import { costProbe } from "./cost-probe.js";
import { openDatabase } from "../../store/database.js";
import type Database from "better-sqlite3";
import type { ProbeConfig } from "../../types/monitor.js";
import type { ProbeDeps } from "../probe.js";

function makeDeps(db: Database.Database): ProbeDeps {
  return {
    stateDir: "/tmp/test-state",
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    store: {} as ProbeDeps["store"],
    db,
  };
}

function makeConfig(params: Record<string, unknown> = {}): ProbeConfig {
  return {
    id: "cost",
    intervalMs: 60000,
    enabled: true,
    params: { agentId: "test-agent", ...params },
  };
}

function insertLLMEvent(
  db: Database.Database,
  sessionKey: string,
  inputTokens: number,
  outputTokens: number,
  timestamp: number,
  agentId = "test-agent",
): void {
  db.prepare(`
    INSERT INTO events (id, source, timestamp, agent_id, session_key, type, data)
    VALUES (@id, 'snapshot', @timestamp, @agentId, @sessionKey, 'llm_call', @data)
  `).run({
    id: `evt-${sessionKey}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp,
    agentId,
    sessionKey,
    data: JSON.stringify({
      provider: "anthropic",
      model: "claude-3",
      inputTokens,
      outputTokens,
      success: true,
    }),
  });
}

describe("costProbe", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  it("returns ok when fewer than minSessionsForBaseline sessions exist", async () => {
    // Insert only 5 sessions (below default 20)
    for (let i = 0; i < 5; i++) {
      insertLLMEvent(db, `session-${i}`, 100, 50, Date.now() - i * 60000);
    }

    const result = await costProbe(makeConfig(), makeDeps(db));

    expect(result.probeId).toBe("cost");
    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(0);
    expect(result.metrics.sessionCount).toBe(5);
  });

  it("returns ok when no events exist", async () => {
    const result = await costProbe(makeConfig(), makeDeps(db));

    expect(result.probeId).toBe("cost");
    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(0);
  });

  it("returns ok when latest session cost is within normal range", async () => {
    const baseTime = Date.now();
    // Insert 21 sessions with ~150 total tokens each
    for (let i = 0; i < 21; i++) {
      insertLLMEvent(db, `session-${i}`, 100, 50, baseTime - (21 - i) * 60000);
    }

    const result = await costProbe(makeConfig(), makeDeps(db));

    expect(result.probeId).toBe("cost");
    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(0);
  });

  it("returns critical with CST-010 when latest session cost > 3x rolling average", async () => {
    const baseTime = Date.now();

    // Insert 20 sessions with ~150 total tokens each (baseline)
    for (let i = 0; i < 20; i++) {
      insertLLMEvent(db, `session-baseline-${i}`, 100, 50, baseTime - (21 - i) * 60000);
    }

    // Insert 1 session with a spike: 500 tokens (more than 3x the avg of 150)
    insertLLMEvent(db, "session-spike", 300, 200, baseTime);

    const result = await costProbe(makeConfig(), makeDeps(db));

    expect(result.probeId).toBe("cost");
    expect(result.status).toBe("critical");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe("CST-010");
    expect(result.findings[0].severity).toBe("critical");
    expect(result.findings[0].message.en).toBeTruthy();
    expect(result.findings[0].context).toHaveProperty("spikeMultiplier");
  });

  it("respects custom spikeMultiplier parameter", async () => {
    const baseTime = Date.now();

    // 20 sessions with ~150 tokens each
    for (let i = 0; i < 20; i++) {
      insertLLMEvent(db, `session-${i}`, 100, 50, baseTime - (21 - i) * 60000);
    }

    // Latest session: 400 tokens (2.67x average of 150)
    insertLLMEvent(db, "session-latest", 250, 150, baseTime);

    // Default spike multiplier (3x) — should be ok
    const resultDefault = await costProbe(makeConfig(), makeDeps(db));
    expect(resultDefault.status).toBe("ok");

    // Custom spike multiplier (2x) — should be critical
    const resultCustom = await costProbe(
      makeConfig({ spikeMultiplier: 2 }),
      makeDeps(db),
    );
    expect(resultCustom.status).toBe("critical");
    expect(resultCustom.findings[0].code).toBe("CST-010");
  });

  it("respects custom minSessionsForBaseline parameter", async () => {
    const baseTime = Date.now();

    // Insert 5 normal sessions + 1 spike
    for (let i = 0; i < 5; i++) {
      insertLLMEvent(db, `session-${i}`, 100, 50, baseTime - (6 - i) * 60000);
    }
    insertLLMEvent(db, "session-spike", 300, 200, baseTime);

    // Default minSessions (20) — not enough data, should be ok
    const resultDefault = await costProbe(makeConfig(), makeDeps(db));
    expect(resultDefault.status).toBe("ok");
    expect(resultDefault.findings).toHaveLength(0);

    // Custom minSessions (5) — now we have enough for baseline
    const resultCustom = await costProbe(
      makeConfig({ minSessionsForBaseline: 5 }),
      makeDeps(db),
    );
    expect(resultCustom.status).toBe("critical");
    expect(resultCustom.findings[0].code).toBe("CST-010");
  });

  it("aggregates multiple llm_call events within the same session", async () => {
    const baseTime = Date.now();

    // 20 sessions with ~150 tokens each
    for (let i = 0; i < 20; i++) {
      insertLLMEvent(db, `session-${i}`, 100, 50, baseTime - (21 - i) * 60000);
    }

    // Latest session with multiple LLM calls summing to a spike
    insertLLMEvent(db, "session-multi", 100, 50, baseTime - 1000);
    insertLLMEvent(db, "session-multi", 100, 50, baseTime - 500);
    insertLLMEvent(db, "session-multi", 100, 50, baseTime);
    // Total: 450, avg baseline: 150, ratio: 3.0 = triggers at 3x

    const result = await costProbe(makeConfig(), makeDeps(db));

    expect(result.probeId).toBe("cost");
    expect(result.status).toBe("critical");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe("CST-010");
  });
});
