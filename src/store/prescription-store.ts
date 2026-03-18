// ═══════════════════════════════════════════════
//  Prescription Store
//  Design spec §8.1 (prescriptions + followups tables)
// ═══════════════════════════════════════════════

import type Database from "better-sqlite3";
import type { Prescription, PrescriptionLevel } from "../types/domain.js";

// ─── Row shapes returned by SQLite ───

interface PrescriptionRow {
  id: string;
  diagnosis_id: string;
  type: string;             // maps to Prescription.level
  actions_json: string;     // JSON: { risk, estimatedImprovement, actions }
  status: string;
  backup_json: string | null;
  pre_apply_metrics_json: string | null;
  applied_at: number | null;
  rolled_back_at: number | null;
  created_at: number;
}

interface FollowupRow {
  id: string;
  prescription_id: string;
  checkpoint: string;
  scheduled_at: number;
  completed_at: number | null;
  result_json: string | null;
  created_at: number;
}

// ─── JSON payload stored in actions_json column ───

interface ActionsJsonPayload {
  risk: Prescription["risk"];
  estimatedImprovement: Prescription["estimatedImprovement"];
  actions: Prescription["actions"];
}

// ─── Row → domain object ───

function rowToPrescription(row: PrescriptionRow): Prescription & { status: string; appliedAt?: number; rolledBackAt?: number } {
  const payload = JSON.parse(row.actions_json) as ActionsJsonPayload;
  return {
    id: row.id,
    diagnosisId: row.diagnosis_id,
    level: row.type as PrescriptionLevel,
    risk: payload.risk,
    estimatedImprovement: payload.estimatedImprovement,
    actions: payload.actions,
    status: row.status,
    ...(row.applied_at !== null ? { appliedAt: row.applied_at } : {}),
    ...(row.rolled_back_at !== null ? { rolledBackAt: row.rolled_back_at } : {}),
  };
}

// ─── PrescriptionStore interface ───

export interface PrescriptionStore {
  insertPrescription(rx: Prescription): void;
  queryPrescriptions(filter: {
    status?: string;
    diagnosisId?: string;
    agentId?: string;
  }): Prescription[];
  getPrescriptionById(id: string): Prescription | null;
  updatePrescriptionStatus(
    id: string,
    status: string,
    appliedAt?: number,
    rolledBackAt?: number,
  ): void;
  deletePendingByAgent(agentId: string): number;
  insertFollowup(record: {
    id: string;
    prescriptionId: string;
    checkpoint: string;
    scheduledAt: number;
  }): void;
  getPendingFollowups(): Array<{
    id: string;
    prescriptionId: string;
    checkpoint: string;
    scheduledAt: number;
  }>;
  completeFollowup(id: string, resultJson: string): void;
}

// ─── Factory ───

export function createPrescriptionStore(db: Database.Database): PrescriptionStore {
  // ─── Prescription statements ──────────────────────────────────────────────

  const insertStmt = db.prepare<{
    id: string;
    diagnosis_id: string;
    type: string;
    actions_json: string;
    status: string;
  }>(`
    INSERT INTO prescriptions (id, diagnosis_id, type, actions_json, status)
    VALUES (@id, @diagnosis_id, @type, @actions_json, @status)
  `);

  const updateStatusStmt = db.prepare<{
    id: string;
    status: string;
    applied_at: number | null;
    rolled_back_at: number | null;
  }>(`
    UPDATE prescriptions
    SET status = @status,
        applied_at = CASE WHEN @applied_at IS NOT NULL THEN @applied_at ELSE applied_at END,
        rolled_back_at = CASE WHEN @rolled_back_at IS NOT NULL THEN @rolled_back_at ELSE rolled_back_at END
    WHERE id = @id
  `);

  const getByIdStmt = db.prepare<{ id: string }>(`
    SELECT * FROM prescriptions WHERE id = @id
  `);

  // ─── Followup statements ──────────────────────────────────────────────────

  const insertFollowupStmt = db.prepare<{
    id: string;
    prescription_id: string;
    checkpoint: string;
    scheduled_at: number;
  }>(`
    INSERT INTO followups (id, prescription_id, checkpoint, scheduled_at)
    VALUES (@id, @prescription_id, @checkpoint, @scheduled_at)
  `);

  const pendingFollowupsStmt = db.prepare(`
    SELECT id, prescription_id, checkpoint, scheduled_at
    FROM followups
    WHERE completed_at IS NULL
    ORDER BY scheduled_at ASC
  `);

  const completeFollowupStmt = db.prepare<{
    id: string;
    completed_at: number;
    result_json: string;
  }>(`
    UPDATE followups
    SET completed_at = @completed_at, result_json = @result_json
    WHERE id = @id
  `);

  // ─── Implementation ───────────────────────────────────────────────────────

  function insertPrescription(rx: Prescription): void {
    const actionsJson: ActionsJsonPayload = {
      risk: rx.risk,
      estimatedImprovement: rx.estimatedImprovement,
      actions: rx.actions,
    };

    insertStmt.run({
      id: rx.id,
      diagnosis_id: rx.diagnosisId,
      type: rx.level,
      actions_json: JSON.stringify(actionsJson),
      status: "pending",
    });
  }

  function queryPrescriptions(filter: {
    status?: string;
    diagnosisId?: string;
    agentId?: string;
  }): Prescription[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.status !== undefined) {
      conditions.push("p.status = @status");
      params.status = filter.status;
    }
    if (filter.diagnosisId !== undefined) {
      conditions.push("p.diagnosis_id = @diagnosisId");
      params.diagnosisId = filter.diagnosisId;
    }
    if (filter.agentId !== undefined) {
      conditions.push("d.agent_id = @agentId");
      params.agentId = filter.agentId;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = filter.agentId !== undefined
      ? `
        SELECT p.* FROM prescriptions p
        JOIN diagnoses d ON d.id = p.diagnosis_id
        ${whereClause}
        ORDER BY p.created_at ASC
      `
      : `
        SELECT p.* FROM prescriptions p
        ${whereClause}
        ORDER BY p.created_at ASC
      `;

    const rows = db.prepare(sql).all(params) as PrescriptionRow[];
    return rows.map(rowToPrescription);
  }

  function getPrescriptionById(id: string): Prescription | null {
    const row = getByIdStmt.get({ id }) as PrescriptionRow | undefined;
    if (!row) return null;
    return rowToPrescription(row);
  }

  function updatePrescriptionStatus(
    id: string,
    status: string,
    appliedAt?: number,
    rolledBackAt?: number,
  ): void {
    updateStatusStmt.run({
      id,
      status,
      applied_at: appliedAt ?? null,
      rolled_back_at: rolledBackAt ?? null,
    });
  }

  function deletePendingByAgent(agentId: string): number {
    const result = db.prepare<{ agentId: string }>(`
      DELETE FROM prescriptions
      WHERE status = 'pending'
        AND diagnosis_id IN (
          SELECT id FROM diagnoses WHERE agent_id = @agentId
        )
    `).run({ agentId });
    return result.changes;
  }

  function insertFollowup(record: {
    id: string;
    prescriptionId: string;
    checkpoint: string;
    scheduledAt: number;
  }): void {
    insertFollowupStmt.run({
      id: record.id,
      prescription_id: record.prescriptionId,
      checkpoint: record.checkpoint,
      scheduled_at: record.scheduledAt,
    });
  }

  function getPendingFollowups(): Array<{
    id: string;
    prescriptionId: string;
    checkpoint: string;
    scheduledAt: number;
  }> {
    const rows = pendingFollowupsStmt.all() as Array<{
      id: string;
      prescription_id: string;
      checkpoint: string;
      scheduled_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      prescriptionId: r.prescription_id,
      checkpoint: r.checkpoint,
      scheduledAt: r.scheduled_at,
    }));
  }

  function completeFollowup(id: string, resultJson: string): void {
    completeFollowupStmt.run({
      id,
      completed_at: Date.now(),
      result_json: resultJson,
    });
  }

  return {
    insertPrescription,
    queryPrescriptions,
    getPrescriptionById,
    updatePrescriptionStatus,
    deletePendingByAgent,
    insertFollowup,
    getPendingFollowups,
    completeFollowup,
  };
}
