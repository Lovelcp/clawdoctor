// ═══════════════════════════════════════════════
//  Diagnosis Store
//  Design spec §8.1 (diagnoses table)
// ═══════════════════════════════════════════════

import type Database from "better-sqlite3";
import type { DiseaseInstance, Evidence, Severity } from "../types/domain.js";

// ─── Row shape returned by SQLite ───

interface DiagnosisRow {
  id: string;
  disease_id: string;
  agent_id: string;
  severity: string;
  confidence: number;
  evidence_json: string;
  context_json: string | null;
  status: string;
  first_detected: number;
  last_seen: number;
  resolved_at: number | null;
  created_at: number;
}

// ─── Query filter ───

export interface DiagnosisFilter {
  agentId: string;
  status?: DiseaseInstance["status"];
  diseaseId?: string;
}

// ─── Row → domain object ───

function rowToDiagnosis(row: DiagnosisRow): DiseaseInstance {
  return {
    id: row.id,
    definitionId: row.disease_id,
    severity: row.severity as Severity,
    confidence: row.confidence,
    evidence: JSON.parse(row.evidence_json) as Evidence[],
    context: row.context_json ? (JSON.parse(row.context_json) as Record<string, unknown>) : {},
    status: row.status as DiseaseInstance["status"],
    firstDetectedAt: row.first_detected,
    lastSeenAt: row.last_seen,
  };
}

// ─── DiagnosisStore interface ───

export interface DiagnosisStore {
  insertDiagnosis(agentId: string, diagnosis: DiseaseInstance): void;
  queryDiagnoses(filter: DiagnosisFilter): DiseaseInstance[];
  updateDiagnosisStatus(id: string, status: DiseaseInstance["status"], resolvedAt?: number): void;
}

// ─── Factory ───

export function createDiagnosisStore(db: Database.Database): DiagnosisStore {
  const insertStmt = db.prepare<{
    id: string;
    disease_id: string;
    agent_id: string;
    severity: string;
    confidence: number;
    evidence_json: string;
    context_json: string | null;
    status: string;
    first_detected: number;
    last_seen: number;
  }>(`
    INSERT INTO diagnoses
      (id, disease_id, agent_id, severity, confidence, evidence_json, context_json,
       status, first_detected, last_seen)
    VALUES
      (@id, @disease_id, @agent_id, @severity, @confidence, @evidence_json, @context_json,
       @status, @first_detected, @last_seen)
  `);

  function insertDiagnosis(agentId: string, diagnosis: DiseaseInstance): void {
    insertStmt.run({
      id: diagnosis.id,
      disease_id: diagnosis.definitionId,
      agent_id: agentId,
      severity: diagnosis.severity,
      confidence: diagnosis.confidence,
      evidence_json: JSON.stringify(diagnosis.evidence),
      context_json: diagnosis.context ? JSON.stringify(diagnosis.context) : null,
      status: diagnosis.status,
      first_detected: diagnosis.firstDetectedAt,
      last_seen: diagnosis.lastSeenAt,
    });
  }

  function queryDiagnoses(filter: DiagnosisFilter): DiseaseInstance[] {
    const conditions: string[] = ["agent_id = @agentId"];
    const params: Record<string, unknown> = { agentId: filter.agentId };

    if (filter.status !== undefined) {
      conditions.push("status = @status");
      params.status = filter.status;
    }
    if (filter.diseaseId !== undefined) {
      conditions.push("disease_id = @diseaseId");
      params.diseaseId = filter.diseaseId;
    }

    const sql = `
      SELECT * FROM diagnoses
      WHERE ${conditions.join(" AND ")}
      ORDER BY first_detected ASC
    `;

    const rows = db.prepare(sql).all(params) as DiagnosisRow[];
    return rows.map(rowToDiagnosis);
  }

  function updateDiagnosisStatus(
    id: string,
    status: DiseaseInstance["status"],
    resolvedAt?: number,
  ): void {
    db.prepare<{ id: string; status: string; resolved_at: number | null }>(`
      UPDATE diagnoses
      SET status = @status, resolved_at = @resolved_at
      WHERE id = @id
    `).run({
      id,
      status,
      resolved_at: resolvedAt ?? null,
    });
  }

  return { insertDiagnosis, queryDiagnoses, updateDiagnosisStatus };
}
