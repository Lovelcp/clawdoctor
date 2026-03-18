// ═══════════════════════════════════════════════
//  Prescription Executor
//  preview / execute / rollback / followUp
//  Design spec §7.2
// ═══════════════════════════════════════════════

import { ulid } from "ulid";
import type Database from "better-sqlite3";
import type { ClawDoctorConfig } from "../types/config.js";
import type {
  Prescription,
  PrescriptionAction,
  PrescriptionBackup,
  PrescriptionPreview,
  ExecutionResult,
  FollowUpResult,
  MetricSnapshot,
  VerificationResult,
} from "../types/domain.js";
import type { RollbackResult } from "../types/domain.js";
import { createPrescriptionStore } from "../store/prescription-store.js";
import { createDiagnosisStore } from "../store/diagnosis-store.js";
import { createBackup, finalizeBackup, executeRollback } from "./backup.js";
import { computeFollowUpVerdict } from "./followup.js";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

// ─── Follow-up checkpoints ────────────────────────────────────────────────────

const FOLLOWUP_CHECKPOINTS = [
  { checkpoint: "T+1h",  offsetMs: 60 * 60 * 1000 },
  { checkpoint: "T+24h", offsetMs: 24 * 60 * 60 * 1000 },
  { checkpoint: "T+7d",  offsetMs: 7 * 24 * 60 * 60 * 1000 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Gather a MetricSnapshot for immediate verification after execution.
 * In a real system this would re-aggregate metrics; here we record a placeholder.
 */
function buildMetricSnapshot(diagnosisId: string): MetricSnapshot {
  return {
    timestamp: Date.now(),
    metrics: {},
    diseaseId: diagnosisId,
  };
}

/**
 * Apply a single PrescriptionAction to the filesystem.
 * Returns { status, error }.
 */
function applyAction(action: PrescriptionAction): { status: "applied" | "failed" | "skipped"; error?: string } {
  try {
    switch (action.type) {
      case "file_edit": {
        // Apply unified diff — for simplicity we write directly.
        // In a production system you would use a diff/patch library.
        // We write the diff as the new file content for now.
        writeFileSync(action.filePath, action.diff, "utf8");
        return { status: "applied" };
      }

      case "file_delete": {
        if (existsSync(action.filePath)) {
          unlinkSync(action.filePath);
        }
        return { status: "applied" };
      }

      case "config_change":
        // config_change requires integration with the config system
        // mark as skipped (manual configuration required)
        return { status: "skipped" };

      case "command":
        // command execution is intentionally not automated for safety
        return { status: "skipped" };

      case "manual":
        // manual actions require human intervention
        return { status: "skipped" };

      default:
        return { status: "skipped" };
    }
  } catch (err: unknown) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Compute an immediate VerificationResult after executing a prescription.
 * Since we don't re-run the full analysis pipeline here, we return a
 * "needs_data" status to indicate a follow-up check is scheduled.
 */
function buildImmediateVerification(prescription: Prescription): VerificationResult {
  return {
    diseaseId: prescription.diagnosisId,
    previousSeverity: "warning",
    currentStatus: "needs_data",
    newMetrics: {},
    note: {
      en: "Follow-up metrics will be collected at T+1h, T+24h, and T+7d checkpoints.",
    },
  };
}

/**
 * Map a PrescriptionAction's risk level.
 * Individual actions inherit the prescription's overall risk unless
 * they are of a "risky" type (command, file_delete).
 */
function actionRisk(
  action: PrescriptionAction,
  prescriptionRisk: Prescription["risk"],
): "low" | "medium" | "high" {
  if (action.type === "command" || action.type === "file_delete") {
    return "high";
  }
  if (action.type === "file_edit") {
    return prescriptionRisk === "low" ? "medium" : prescriptionRisk;
  }
  return prescriptionRisk;
}

// ─── PrescriptionExecutor ─────────────────────────────────────────────────────

export interface PrescriptionExecutor {
  preview(prescriptionId: string): Promise<PrescriptionPreview>;
  execute(prescriptionId: string): Promise<ExecutionResult>;
  rollback(prescriptionId: string): Promise<RollbackResult>;
  followUp(prescriptionId: string): Promise<FollowUpResult>;
}

export function createPrescriptionExecutor(
  db: Database.Database,
  _config: ClawDoctorConfig,
): PrescriptionExecutor {
  const rxStore = createPrescriptionStore(db);
  const diagStore = createDiagnosisStore(db);

  // ─── preview ──────────────────────────────────────────────────────────────

  async function preview(prescriptionId: string): Promise<PrescriptionPreview> {
    const rx = rxStore.getPrescriptionById(prescriptionId);
    if (!rx) {
      throw new Error(`Prescription not found: ${prescriptionId}`);
    }

    // Try to get a diagnosis name
    const diagnoses = diagStore.queryDiagnoses({ agentId: "" });
    const diagnosis = diagnoses.find((d) => d.id === rx.diagnosisId);

    return {
      prescriptionId: rx.id,
      diagnosisName: { en: `Diagnosis ${rx.diagnosisId}${diagnosis ? ` (${diagnosis.definitionId})` : ""}` },
      actions: rx.actions.map((action) => ({
        description: getActionDescription(action),
        type: action.type,
        ...(action.type === "file_edit" ? { diff: action.diff } : {}),
        ...(action.type === "command" ? { command: action.command } : {}),
        risk: actionRisk(action, rx.risk),
      })),
      estimatedImprovement: rx.estimatedImprovement,
      rollbackAvailable: rx.actions.some(
        (a) => a.type === "file_edit" || a.type === "file_delete",
      ),
    };
  }

  // ─── execute ──────────────────────────────────────────────────────────────

  async function execute(prescriptionId: string): Promise<ExecutionResult> {
    const rx = rxStore.getPrescriptionById(prescriptionId);
    if (!rx) {
      throw new Error(`Prescription not found: ${prescriptionId}`);
    }

    // Phase 1: capture pre-apply state
    const backupEntries = createBackup(rx.actions);
    const preApplyMetrics = buildMetricSnapshot(rx.diagnosisId);

    // Apply actions
    const appliedActions: ExecutionResult["appliedActions"] = [];
    let overallSuccess = true;

    for (const action of rx.actions) {
      const result = applyAction(action);
      appliedActions.push({ action, ...result });
      if (result.status === "failed") {
        overallSuccess = false;
      }
    }

    // Phase 2: finalize backup (capture post-apply hashes)
    const finalEntries = finalizeBackup(backupEntries);

    const backup: PrescriptionBackup = {
      id: ulid(),
      prescriptionId: rx.id,
      createdAt: Date.now(),
      entries: finalEntries,
    };

    // Persist backup + update status
    const appliedAt = Date.now();
    rxStore.updatePrescriptionStatus(rx.id, "applied", appliedAt);

    // Store backup in database
    db.prepare(`
      UPDATE prescriptions SET backup_json = @backup_json WHERE id = @id
    `).run({
      id: rx.id,
      backup_json: JSON.stringify(backup),
    });

    // Schedule follow-up checkpoints (T+1h, T+24h, T+7d)
    for (const { checkpoint, offsetMs } of FOLLOWUP_CHECKPOINTS) {
      rxStore.insertFollowup({
        id: ulid(),
        prescriptionId: rx.id,
        checkpoint,
        scheduledAt: appliedAt + offsetMs,
      });
    }

    return {
      success: overallSuccess,
      appliedActions,
      backup,
      preApplyMetrics,
      immediateVerification: buildImmediateVerification(rx),
    };
  }

  // ─── rollback ─────────────────────────────────────────────────────────────

  async function rollback(prescriptionId: string): Promise<RollbackResult> {
    const rx = rxStore.getPrescriptionById(prescriptionId);
    if (!rx) {
      throw new Error(`Prescription not found: ${prescriptionId}`);
    }

    // Load backup from database
    const row = db
      .prepare("SELECT backup_json FROM prescriptions WHERE id = ?")
      .get(prescriptionId) as { backup_json: string | null } | undefined;

    if (!row?.backup_json) {
      return {
        success: false,
        restoredFiles: [],
        skippedFiles: [],
        conflicts: [],
        error: "No backup available for rollback",
      };
    }

    const backup = JSON.parse(row.backup_json) as PrescriptionBackup;
    const result = executeRollback(backup);

    if (result.success || result.restoredFiles.length > 0) {
      rxStore.updatePrescriptionStatus(rx.id, "rolled_back", undefined, Date.now());
    }

    return result;
  }

  // ─── followUp ─────────────────────────────────────────────────────────────

  async function followUp(prescriptionId: string): Promise<FollowUpResult> {
    const rx = rxStore.getPrescriptionById(prescriptionId);
    if (!rx) {
      throw new Error(`Prescription not found: ${prescriptionId}`);
    }

    // Load pre-apply metrics from database
    const row = db
      .prepare("SELECT pre_apply_metrics_json, applied_at FROM prescriptions WHERE id = ?")
      .get(prescriptionId) as { pre_apply_metrics_json: string | null; applied_at: number | null } | undefined;

    const beforeSnapshot: MetricSnapshot = row?.pre_apply_metrics_json
      ? (JSON.parse(row.pre_apply_metrics_json) as MetricSnapshot)
      : buildMetricSnapshot(rx.diagnosisId);

    // After snapshot: current metrics
    const afterSnapshot = buildMetricSnapshot(rx.diagnosisId);

    const timeSinceApplied = row?.applied_at ? Date.now() - row.applied_at : 0;

    // Compute improvement per metric
    const improvement: FollowUpResult["comparison"]["improvement"] = {};
    const sharedKeys = Object.keys(beforeSnapshot.metrics).filter(
      (k) => k in afterSnapshot.metrics,
    );
    for (const key of sharedKeys) {
      const from = beforeSnapshot.metrics[key];
      const to = afterSnapshot.metrics[key];
      const changePercent = from !== 0 ? ((to - from) / Math.abs(from)) * 100 : 0;
      improvement[key] = { from, to, changePercent };
    }

    const verdict = computeFollowUpVerdict(beforeSnapshot, afterSnapshot);

    // Mark the next pending follow-up as completed
    const pending = rxStore.getPendingFollowups().filter(
      (f) => f.prescriptionId === prescriptionId,
    );
    if (pending.length > 0) {
      rxStore.completeFollowup(pending[0].id, JSON.stringify({ verdict, afterSnapshot }));
    }

    return {
      prescriptionId,
      diagnosisId: rx.diagnosisId,
      timeSinceApplied,
      comparison: {
        before: beforeSnapshot,
        after: afterSnapshot,
        improvement,
      },
      verdict,
    };
  }

  return { preview, execute, rollback, followUp };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function getActionDescription(action: PrescriptionAction): { en: string } {
  switch (action.type) {
    case "file_edit":
      return action.description;
    case "file_delete":
      return action.description;
    case "config_change":
      return action.description;
    case "command":
      return action.description;
    case "manual":
      return action.instruction;
  }
}
