// ═══════════════════════════════════════════════
//  Store Layer Tests (TDD)
//  Tests for database, event-store, diagnosis-store, score-store
// ═══════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "./database.js";
import { createEventStore } from "./event-store.js";
import { createDiagnosisStore } from "./diagnosis-store.js";
import { createScoreStore } from "./score-store.js";
import type { ClawDocEvent } from "../types/events.js";
import type { DiseaseInstance } from "../types/domain.js";
import type Database from "better-sqlite3";

// ─── Helpers ───

function makeEvent(overrides: Partial<ClawDocEvent> = {}): ClawDocEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    source: "snapshot",
    timestamp: Date.now(),
    agentId: "agent-001",
    sessionKey: "telegram:12345",
    sessionId: "session-uuid-abc",
    type: "tool_call",
    data: {
      toolName: "Bash",
      paramsSummary: { command: "string" },
      success: true,
    },
    ...overrides,
  };
}

function makeDiagnosis(overrides: Partial<DiseaseInstance> = {}): DiseaseInstance {
  return {
    id: `diag_${Math.random().toString(36).slice(2)}`,
    definitionId: "SK-001",
    severity: "warning",
    evidence: [
      {
        type: "metric",
        description: { en: "success rate below threshold" },
        value: 0.4,
        threshold: 0.7,
        confidence: 0.9,
      },
    ],
    confidence: 0.85,
    firstDetectedAt: Date.now() - 3600_000,
    lastSeenAt: Date.now(),
    status: "active",
    context: { toolName: "Bash" },
    ...overrides,
  };
}

// ─── Tests ───

describe("openDatabase", () => {
  it("opens an in-memory database without errors", () => {
    const db = openDatabase(":memory:");
    expect(db).toBeDefined();
    db.close();
  });

  it("sets WAL journal mode", () => {
    const db = openDatabase(":memory:");
    const result = db.pragma("journal_mode", { simple: true });
    // In-memory databases use 'memory' journal mode by default
    expect(["wal", "memory"]).toContain(result);
    db.close();
  });

  it("creates all required tables", () => {
    const db = openDatabase(":memory:");
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toContain("events");
    expect(tables).toContain("diagnoses");
    expect(tables).toContain("prescriptions");
    expect(tables).toContain("followups");
    expect(tables).toContain("health_scores");
    db.close();
  });

  it("sets user_version to 2 after migration", () => {
    const db = openDatabase(":memory:");
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(2);
    db.close();
  });

  it("is idempotent: opening same db twice does not error", () => {
    const db1 = openDatabase(":memory:");
    db1.close();
    // A second in-memory DB is fresh, but we can at least verify no error
    const db2 = openDatabase(":memory:");
    expect(db2).toBeDefined();
    db2.close();
  });
});

describe("EventStore", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  it("inserts an event and queries it back", () => {
    const store = createEventStore(db);
    const event = makeEvent({ agentId: "agent-001" });
    store.insertEvent(event);

    const results = store.queryEvents({ agentId: "agent-001" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(event.id);
  });

  it("serializes and deserializes data as JSON", () => {
    const store = createEventStore(db);
    const event = makeEvent({
      type: "tool_call",
      data: { toolName: "WebSearch", paramsSummary: { query: "string" }, success: false, error: "timeout" },
    });
    store.insertEvent(event);

    const results = store.queryEvents({ agentId: "agent-001" });
    expect(results[0].data).toMatchObject({ toolName: "WebSearch", success: false, error: "timeout" });
  });

  it("filters events by type", () => {
    const store = createEventStore(db);
    store.insertEvent(makeEvent({ id: "e1", type: "tool_call" }));
    store.insertEvent(makeEvent({ id: "e2", type: "llm_call", data: { provider: "anthropic", model: "claude-3-5-sonnet", success: true } }));

    const toolResults = store.queryEvents({ agentId: "agent-001", type: "tool_call" });
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].id).toBe("e1");
  });

  it("filters events by since/until timestamps", () => {
    const store = createEventStore(db);
    const now = Date.now();
    store.insertEvent(makeEvent({ id: "e-old", timestamp: now - 10_000 }));
    store.insertEvent(makeEvent({ id: "e-new", timestamp: now }));

    const recent = store.queryEvents({ agentId: "agent-001", since: now - 5_000 });
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("e-new");
  });

  it("returns events ordered by timestamp ascending", () => {
    const store = createEventStore(db);
    const now = Date.now();
    store.insertEvent(makeEvent({ id: "e2", timestamp: now }));
    store.insertEvent(makeEvent({ id: "e1", timestamp: now - 1000 }));

    const results = store.queryEvents({ agentId: "agent-001" });
    expect(results[0].id).toBe("e1");
    expect(results[1].id).toBe("e2");
  });

  it("returns empty array when no events match", () => {
    const store = createEventStore(db);
    const results = store.queryEvents({ agentId: "no-such-agent" });
    expect(results).toHaveLength(0);
  });

  describe("queryEventsWithSourcePriority (§5.6)", () => {
    it("returns snapshot events when no stream events exist for the session", () => {
      const store = createEventStore(db);
      store.insertEvent(makeEvent({ id: "snap-1", source: "snapshot", sessionKey: "session-A" }));
      store.insertEvent(makeEvent({ id: "snap-2", source: "snapshot", sessionKey: "session-A" }));

      const results = store.queryEventsWithSourcePriority({ agentId: "agent-001" });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.source === "snapshot")).toBe(true);
    });

    it("returns only stream events when stream events exist for a session (excludes snapshots)", () => {
      const store = createEventStore(db);
      // Session A has both snapshot and stream events
      store.insertEvent(makeEvent({ id: "snap-a1", source: "snapshot", sessionKey: "session-A" }));
      store.insertEvent(makeEvent({ id: "snap-a2", source: "snapshot", sessionKey: "session-A" }));
      store.insertEvent(makeEvent({ id: "strm-a1", source: "stream", sessionKey: "session-A" }));

      const results = store.queryEventsWithSourcePriority({ agentId: "agent-001" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("strm-a1");
      expect(results[0].source).toBe("stream");
    });

    it("handles mixed sessions correctly: stream wins for session-A, snapshot kept for session-B", () => {
      const store = createEventStore(db);
      // Session A: has stream
      store.insertEvent(makeEvent({ id: "snap-a1", source: "snapshot", sessionKey: "session-A" }));
      store.insertEvent(makeEvent({ id: "strm-a1", source: "stream", sessionKey: "session-A" }));
      store.insertEvent(makeEvent({ id: "strm-a2", source: "stream", sessionKey: "session-A" }));
      // Session B: snapshot only
      store.insertEvent(makeEvent({ id: "snap-b1", source: "snapshot", sessionKey: "session-B" }));
      store.insertEvent(makeEvent({ id: "snap-b2", source: "snapshot", sessionKey: "session-B" }));

      const results = store.queryEventsWithSourcePriority({ agentId: "agent-001" });
      const ids = results.map((e) => e.id).sort();
      // snap-a1 must be excluded; snap-b1/b2 and strm-a1/a2 must be included
      expect(ids).toEqual(["snap-b1", "snap-b2", "strm-a1", "strm-a2"].sort());
    });

    it("handles events with null session_key: each is treated independently", () => {
      const store = createEventStore(db);
      store.insertEvent(makeEvent({ id: "snap-null", source: "snapshot", sessionKey: undefined }));
      // Even without a sessionKey, snapshot events are included when no stream exists
      const results = store.queryEventsWithSourcePriority({ agentId: "agent-001" });
      expect(results.map((e) => e.id)).toContain("snap-null");
    });

    it("filters to the specified agentId only", () => {
      const store = createEventStore(db);
      store.insertEvent(makeEvent({ id: "a1", agentId: "agent-001", sessionKey: "s1" }));
      store.insertEvent(makeEvent({ id: "b1", agentId: "agent-002", sessionKey: "s1" }));

      const results = store.queryEventsWithSourcePriority({ agentId: "agent-001" });
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe("agent-001");
    });
  });
});

describe("DiagnosisStore", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  it("inserts a diagnosis and queries it back", () => {
    const store = createDiagnosisStore(db);
    const diag = makeDiagnosis({ id: "diag-001" });
    store.insertDiagnosis("agent-001", diag);

    const results = store.queryDiagnoses({ agentId: "agent-001" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("diag-001");
  });

  it("persists evidence as JSON and deserializes correctly", () => {
    const store = createDiagnosisStore(db);
    const diag = makeDiagnosis({ id: "diag-002" });
    store.insertDiagnosis("agent-001", diag);

    const results = store.queryDiagnoses({ agentId: "agent-001" });
    expect(results[0].evidence).toHaveLength(1);
    expect(results[0].evidence[0].type).toBe("metric");
  });

  it("filters by status", () => {
    const store = createDiagnosisStore(db);
    store.insertDiagnosis("agent-001", makeDiagnosis({ id: "d-active", status: "active" }));
    store.insertDiagnosis("agent-001", makeDiagnosis({ id: "d-resolved", status: "resolved" }));

    const active = store.queryDiagnoses({ agentId: "agent-001", status: "active" });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("d-active");
  });

  it("updates diagnosis status", () => {
    const store = createDiagnosisStore(db);
    const diag = makeDiagnosis({ id: "d-update", status: "active" });
    store.insertDiagnosis("agent-001", diag);

    store.updateDiagnosisStatus("d-update", "resolved", Date.now());

    const results = store.queryDiagnoses({ agentId: "agent-001", status: "resolved" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("d-update");
  });

  it("sets resolved_at when updating status to resolved", () => {
    const store = createDiagnosisStore(db);
    store.insertDiagnosis("agent-001", makeDiagnosis({ id: "d-res" }));
    const resolvedAt = Date.now();
    store.updateDiagnosisStatus("d-res", "resolved", resolvedAt);

    // Verify via raw query
    const row = db.prepare("SELECT resolved_at FROM diagnoses WHERE id = ?").get("d-res") as { resolved_at: number };
    expect(row.resolved_at).toBe(resolvedAt);
  });

  it("returns empty array when no diagnoses match", () => {
    const store = createDiagnosisStore(db);
    const results = store.queryDiagnoses({ agentId: "no-such-agent" });
    expect(results).toHaveLength(0);
  });
});

describe("ScoreStore", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  it("inserts a health score and queries it back", () => {
    const store = createScoreStore(db);
    store.insertHealthScore({
      id: "score-001",
      agentId: "agent-001",
      timestamp: Date.now(),
      dataMode: "snapshot",
      coverage: 0.8,
      overall: 72.5,
      vitals: 90,
      skill: 65,
      memory: 80,
      behavior: 70,
      cost: 60,
      security: 85,
    });

    const history = store.queryScoreHistory({ agentId: "agent-001" });
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("score-001");
    expect(history[0].overall).toBe(72.5);
  });

  it("handles null department scores", () => {
    const store = createScoreStore(db);
    store.insertHealthScore({
      id: "score-002",
      agentId: "agent-001",
      timestamp: Date.now(),
      dataMode: "stream",
      coverage: 0.3,
      overall: null,
      vitals: null,
      skill: null,
      memory: null,
      behavior: null,
      cost: null,
      security: null,
    });

    const history = store.queryScoreHistory({ agentId: "agent-001" });
    expect(history).toHaveLength(1);
    expect(history[0].overall).toBeNull();
    expect(history[0].vitals).toBeNull();
    expect(history[0].cost).toBeNull();
  });

  it("returns multiple scores ordered by timestamp ascending", () => {
    const store = createScoreStore(db);
    const now = Date.now();
    store.insertHealthScore({ id: "s2", agentId: "agent-001", timestamp: now, dataMode: "snapshot", coverage: 0.9, overall: 80, vitals: null, skill: null, memory: null, behavior: null, cost: null, security: null });
    store.insertHealthScore({ id: "s1", agentId: "agent-001", timestamp: now - 1000, dataMode: "snapshot", coverage: 0.8, overall: 75, vitals: null, skill: null, memory: null, behavior: null, cost: null, security: null });

    const history = store.queryScoreHistory({ agentId: "agent-001" });
    expect(history[0].id).toBe("s1");
    expect(history[1].id).toBe("s2");
  });

  it("supports since/until filters on queryScoreHistory", () => {
    const store = createScoreStore(db);
    const now = Date.now();
    store.insertHealthScore({ id: "s-old", agentId: "agent-001", timestamp: now - 10_000, dataMode: "snapshot", coverage: 0.5, overall: 60, vitals: null, skill: null, memory: null, behavior: null, cost: null, security: null });
    store.insertHealthScore({ id: "s-new", agentId: "agent-001", timestamp: now, dataMode: "snapshot", coverage: 0.9, overall: 85, vitals: null, skill: null, memory: null, behavior: null, cost: null, security: null });

    const recent = store.queryScoreHistory({ agentId: "agent-001", since: now - 5_000 });
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("s-new");
  });

  it("filters to the correct agentId", () => {
    const store = createScoreStore(db);
    store.insertHealthScore({ id: "s-a", agentId: "agent-001", timestamp: Date.now(), dataMode: "snapshot", coverage: 0.8, overall: 75, vitals: null, skill: null, memory: null, behavior: null, cost: null, security: null });
    store.insertHealthScore({ id: "s-b", agentId: "agent-002", timestamp: Date.now(), dataMode: "snapshot", coverage: 0.9, overall: 90, vitals: null, skill: null, memory: null, behavior: null, cost: null, security: null });

    const results = store.queryScoreHistory({ agentId: "agent-001" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("s-a");
  });
});
