// ===============================================
//  Chart Store — audit trail for monitor actions
//  Design spec: continuous monitoring §Chart
// ===============================================

import type Database from "better-sqlite3";
import type { ChartEntry, ChartOutcome, ProbeId, TriageLevel } from "../types/monitor.js";

// --- Query filter ---

export interface ChartFilter {
  readonly probeId?: string;
  readonly outcome?: ChartOutcome;
  readonly since?: number;
  readonly limit: number;
}

// --- Row shape returned by SQLite ---

interface ChartRow {
  readonly id: string;
  readonly timestamp: number;
  readonly probe_id: string | null;
  readonly disease_id: string | null;
  readonly agent_id: string | null;
  readonly triage_level: string | null;
  readonly intervention_id: string | null;
  readonly action: string;
  readonly outcome: string;
  readonly consent_channel: string | null;
  readonly consent_response: string | null;
  readonly snapshot_id: string | null;
  readonly details: string | null;
}

// --- Row -> domain object ---

function rowToChartEntry(row: ChartRow): ChartEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    probeId: (row.probe_id as ProbeId) ?? undefined,
    diseaseId: row.disease_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    triageLevel: (row.triage_level as TriageLevel) ?? undefined,
    interventionId: row.intervention_id ?? undefined,
    action: row.action,
    outcome: row.outcome as ChartOutcome,
    consentChannel: row.consent_channel ?? undefined,
    consentResponse: row.consent_response ?? undefined,
    snapshotId: row.snapshot_id ?? undefined,
    details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : {},
  };
}

// --- Store interface ---

export interface ChartStore {
  insert(entry: ChartEntry): void;
  query(filter: ChartFilter): ChartEntry[];
}

// --- Factory ---

export function createChartStore(db: Database.Database): ChartStore {
  const insertStmt = db.prepare<{
    id: string;
    timestamp: number;
    probe_id: string | null;
    disease_id: string | null;
    agent_id: string | null;
    triage_level: string | null;
    intervention_id: string | null;
    action: string;
    outcome: string;
    consent_channel: string | null;
    consent_response: string | null;
    snapshot_id: string | null;
    details: string | null;
  }>(`
    INSERT INTO chart_entries (
      id, timestamp, probe_id, disease_id, agent_id, triage_level,
      intervention_id, action, outcome, consent_channel, consent_response,
      snapshot_id, details
    ) VALUES (
      @id, @timestamp, @probe_id, @disease_id, @agent_id, @triage_level,
      @intervention_id, @action, @outcome, @consent_channel, @consent_response,
      @snapshot_id, @details
    )
  `);

  function insert(entry: ChartEntry): void {
    insertStmt.run({
      id: entry.id,
      timestamp: entry.timestamp,
      probe_id: entry.probeId ?? null,
      disease_id: entry.diseaseId ?? null,
      agent_id: entry.agentId ?? null,
      triage_level: entry.triageLevel ?? null,
      intervention_id: entry.interventionId ?? null,
      action: entry.action,
      outcome: entry.outcome,
      consent_channel: entry.consentChannel ?? null,
      consent_response: entry.consentResponse ?? null,
      snapshot_id: entry.snapshotId ?? null,
      details: JSON.stringify(entry.details),
    });
  }

  function query(filter: ChartFilter): ChartEntry[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.probeId !== undefined) {
      conditions.push("probe_id = @probeId");
      params.probeId = filter.probeId;
    }
    if (filter.outcome !== undefined) {
      conditions.push("outcome = @outcome");
      params.outcome = filter.outcome;
    }
    if (filter.since !== undefined) {
      conditions.push("timestamp >= @since");
      params.since = filter.since;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT * FROM chart_entries
      ${where}
      ORDER BY timestamp DESC
      LIMIT @limit
    `;
    params.limit = filter.limit;

    const rows = db.prepare(sql).all(params) as ChartRow[];
    return rows.map(rowToChartEntry);
  }

  return { insert, query };
}
