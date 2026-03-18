// ═══════════════════════════════════════════════
//  Event Store
//  Design spec §5.6 (source-priority merge), §8.1
// ═══════════════════════════════════════════════

import type Database from "better-sqlite3";
import type { ClawInsightEvent, EventType } from "../types/events.js";

// ─── Row shape returned by SQLite ───

interface EventRow {
  id: string;
  source: "snapshot" | "stream";
  timestamp: number;
  agent_id: string;
  session_key: string | null;
  session_id: string | null;
  type: string;
  data: string;
  created_at: number;
}

// ─── Query filter ───

export interface EventFilter {
  agentId: string;
  type?: EventType;
  since?: number;   // inclusive lower bound on timestamp
  until?: number;   // inclusive upper bound on timestamp
}

// ─── Source-priority filter ───

export interface SourcePriorityFilter {
  agentId: string;
}

// ─── Row → domain object ───

function rowToEvent(row: EventRow): ClawInsightEvent {
  return {
    id: row.id,
    source: row.source,
    timestamp: row.timestamp,
    agentId: row.agent_id,
    sessionKey: row.session_key ?? undefined,
    sessionId: row.session_id ?? undefined,
    type: row.type as EventType,
    data: JSON.parse(row.data) as ClawInsightEvent["data"],
  };
}

// ─── EventStore interface ───

export interface EventStore {
  insertEvent(event: ClawInsightEvent): void;
  queryEvents(filter: EventFilter): ClawInsightEvent[];
  /**
   * Source-priority merge (§5.6):
   * For sessions that have stream events, exclude snapshot events for those sessions.
   * Sessions with only snapshot data are returned as-is.
   */
  queryEventsWithSourcePriority(filter: SourcePriorityFilter): ClawInsightEvent[];
}

// ─── Factory ───

export function createEventStore(db: Database.Database): EventStore {
  const insertStmt = db.prepare<{
    id: string;
    source: string;
    timestamp: number;
    agent_id: string;
    session_key: string | null;
    session_id: string | null;
    type: string;
    data: string;
  }>(`
    INSERT INTO events (id, source, timestamp, agent_id, session_key, session_id, type, data)
    VALUES (@id, @source, @timestamp, @agent_id, @session_key, @session_id, @type, @data)
  `);

  function insertEvent(event: ClawInsightEvent): void {
    insertStmt.run({
      id: event.id,
      source: event.source,
      timestamp: event.timestamp,
      agent_id: event.agentId,
      session_key: event.sessionKey ?? null,
      session_id: event.sessionId ?? null,
      type: event.type,
      data: JSON.stringify(event.data),
    });
  }

  function queryEvents(filter: EventFilter): ClawInsightEvent[] {
    const conditions: string[] = ["agent_id = @agentId"];
    const params: Record<string, unknown> = { agentId: filter.agentId };

    if (filter.type !== undefined) {
      conditions.push("type = @type");
      params.type = filter.type;
    }
    if (filter.since !== undefined) {
      conditions.push("timestamp >= @since");
      params.since = filter.since;
    }
    if (filter.until !== undefined) {
      conditions.push("timestamp <= @until");
      params.until = filter.until;
    }

    const sql = `
      SELECT * FROM events
      WHERE ${conditions.join(" AND ")}
      ORDER BY timestamp ASC
    `;

    const rows = db.prepare(sql).all(params) as EventRow[];
    return rows.map(rowToEvent);
  }

  function queryEventsWithSourcePriority(filter: SourcePriorityFilter): ClawInsightEvent[] {
    // Find all session_keys for this agent that have at least one stream event.
    // For those sessions, return only stream events.
    // For all other sessions (snapshot-only or null sessionKey), return all events.
    //
    // Implementation per spec §5.6:
    //   SELECT * FROM events
    //   WHERE agent_id = ?
    //     AND (
    //       source = 'stream'
    //       OR session_key IS NULL
    //       OR session_key NOT IN (
    //         SELECT DISTINCT session_key FROM events
    //         WHERE agent_id = ? AND source = 'stream' AND session_key IS NOT NULL
    //       )
    //     )
    //   ORDER BY timestamp ASC
    const sql = `
      SELECT * FROM events
      WHERE agent_id = @agentId
        AND (
          source = 'stream'
          OR session_key IS NULL
          OR session_key NOT IN (
            SELECT DISTINCT session_key FROM events
            WHERE agent_id = @agentId
              AND source = 'stream'
              AND session_key IS NOT NULL
          )
        )
      ORDER BY timestamp ASC
    `;

    const rows = db.prepare(sql).all({ agentId: filter.agentId }) as EventRow[];
    return rows.map(rowToEvent);
  }

  return { insertEvent, queryEvents, queryEventsWithSourcePriority };
}
