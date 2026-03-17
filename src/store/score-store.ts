// ═══════════════════════════════════════════════
//  Score Store
//  Design spec §8.1 (health_scores table)
// ═══════════════════════════════════════════════

import type Database from "better-sqlite3";
import type { DataMode } from "../types/scoring.js";

// ─── Insert payload ───

export interface HealthScoreRecord {
  id: string;
  agentId: string;
  timestamp: number;
  dataMode: DataMode;
  coverage: number;         // 0-1
  overall: number | null;   // null if no departments evaluable
  vitals: number | null;
  skill: number | null;
  memory: number | null;
  behavior: number | null;
  cost: number | null;
  security: number | null;
}

// ─── Row shape returned by SQLite ───

interface HealthScoreRow {
  id: string;
  agent_id: string;
  timestamp: number;
  data_mode: string;
  coverage: number;
  overall: number | null;
  vitals: number | null;
  skill: number | null;
  memory: number | null;
  behavior: number | null;
  cost: number | null;
  security: number | null;
  created_at: number;
}

// ─── Query filter ───

export interface ScoreHistoryFilter {
  agentId: string;
  since?: number;
  until?: number;
  limit?: number;
}

// ─── Row → domain record ───

function rowToRecord(row: HealthScoreRow): HealthScoreRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    timestamp: row.timestamp,
    dataMode: row.data_mode as DataMode,
    coverage: row.coverage,
    overall: row.overall,
    vitals: row.vitals,
    skill: row.skill,
    memory: row.memory,
    behavior: row.behavior,
    cost: row.cost,
    security: row.security,
  };
}

// ─── ScoreStore interface ───

export interface ScoreStore {
  insertHealthScore(record: HealthScoreRecord): void;
  queryScoreHistory(filter: ScoreHistoryFilter): HealthScoreRecord[];
}

// ─── Factory ───

export function createScoreStore(db: Database.Database): ScoreStore {
  const insertStmt = db.prepare<{
    id: string;
    agent_id: string;
    timestamp: number;
    data_mode: string;
    coverage: number;
    overall: number | null;
    vitals: number | null;
    skill: number | null;
    memory: number | null;
    behavior: number | null;
    cost: number | null;
    security: number | null;
  }>(`
    INSERT INTO health_scores
      (id, agent_id, timestamp, data_mode, coverage,
       overall, vitals, skill, memory, behavior, cost, security)
    VALUES
      (@id, @agent_id, @timestamp, @data_mode, @coverage,
       @overall, @vitals, @skill, @memory, @behavior, @cost, @security)
  `);

  function insertHealthScore(record: HealthScoreRecord): void {
    insertStmt.run({
      id: record.id,
      agent_id: record.agentId,
      timestamp: record.timestamp,
      data_mode: record.dataMode,
      coverage: record.coverage,
      overall: record.overall,
      vitals: record.vitals,
      skill: record.skill,
      memory: record.memory,
      behavior: record.behavior,
      cost: record.cost,
      security: record.security,
    });
  }

  function queryScoreHistory(filter: ScoreHistoryFilter): HealthScoreRecord[] {
    const conditions: string[] = ["agent_id = @agentId"];
    const params: Record<string, unknown> = { agentId: filter.agentId };

    if (filter.since !== undefined) {
      conditions.push("timestamp >= @since");
      params.since = filter.since;
    }
    if (filter.until !== undefined) {
      conditions.push("timestamp <= @until");
      params.until = filter.until;
    }

    let sql = `
      SELECT * FROM health_scores
      WHERE ${conditions.join(" AND ")}
      ORDER BY timestamp ASC
    `;

    if (filter.limit !== undefined) {
      sql += ` LIMIT @limit`;
      params.limit = filter.limit;
    }

    const rows = db.prepare(sql).all(params) as HealthScoreRow[];
    return rows.map(rowToRecord);
  }

  return { insertHealthScore, queryScoreHistory };
}
