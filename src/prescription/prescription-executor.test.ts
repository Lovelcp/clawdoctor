// ═══════════════════════════════════════════════
//  Prescription Executor Tests (TDD)
// ═══════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDatabase } from "../store/database.js";
import { createDiagnosisStore } from "../store/diagnosis-store.js";
import { createPrescriptionStore } from "../store/prescription-store.js";
import { createPrescriptionExecutor } from "./prescription-executor.js";
import { DEFAULT_CONFIG } from "../types/config.js";
import type { Prescription, DiseaseInstance } from "../types/domain.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDiagnosis(overrides: Partial<DiseaseInstance> = {}): DiseaseInstance {
  return {
    id: `diag_${Math.random().toString(36).slice(2)}`,
    definitionId: "SK-001",
    severity: "warning",
    evidence: [],
    confidence: 0.8,
    firstDetectedAt: Date.now() - 3600_000,
    lastSeenAt: Date.now(),
    status: "active",
    context: {},
    ...overrides,
  };
}

function makePrescription(diagnosisId: string, overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: `rx_${Math.random().toString(36).slice(2)}`,
    diagnosisId,
    level: "guided",
    actions: [{ type: "manual", instruction: { en: "Do something manually" } }],
    estimatedImprovement: { en: "+20% success rate" },
    risk: "low",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PrescriptionExecutor", () => {
  let db: Database.Database;
  let tmpDir: string;
  let diagId: string;

  beforeEach(() => {
    db = openDatabase(":memory:");
    tmpDir = mkdtempSync(join(tmpdir(), "clawdoctor-executor-test-"));

    // Seed a diagnosis
    const diagStore = createDiagnosisStore(db);
    const diag = makeDiagnosis({ id: "diag-exec-001" });
    diagId = diag.id;
    diagStore.insertDiagnosis("agent-001", diag);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── preview ──────────────────────────────────────────────────────────────

  describe("preview", () => {
    it("returns a PrescriptionPreview for a known prescription", async () => {
      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, { id: "rx-prev-001" });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      const preview = await executor.preview("rx-prev-001");

      expect(preview.prescriptionId).toBe("rx-prev-001");
      expect(preview.estimatedImprovement).toEqual({ en: "+20% success rate" });
      expect(preview.actions).toHaveLength(1);
      expect(preview.actions[0].type).toBe("manual");
    });

    it("throws when prescription not found", async () => {
      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await expect(executor.preview("no-such-rx")).rejects.toThrow("not found");
    });

    it("rollbackAvailable is true when file_edit action exists", async () => {
      const filePath = join(tmpDir, "test.txt");
      writeFileSync(filePath, "original", "utf8");

      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, {
        id: "rx-prev-002",
        actions: [{ type: "file_edit", filePath, diff: "new content", description: { en: "Edit file" } }],
      });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      const preview = await executor.preview("rx-prev-002");

      expect(preview.rollbackAvailable).toBe(true);
    });

    it("rollbackAvailable is false when only manual actions", async () => {
      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, { id: "rx-prev-003" });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      const preview = await executor.preview("rx-prev-003");

      expect(preview.rollbackAvailable).toBe(false);
    });
  });

  // ─── execute ──────────────────────────────────────────────────────────────

  describe("execute", () => {
    it("returns ExecutionResult with success true for manual-only prescription", async () => {
      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, { id: "rx-exec-001" });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      const result = await executor.execute("rx-exec-001");

      expect(result.success).toBe(true);
      expect(result.appliedActions).toHaveLength(1);
      expect(result.appliedActions[0].status).toBe("skipped"); // manual = skipped
      expect(result.backup).toBeDefined();
      expect(result.preApplyMetrics).toBeDefined();
      expect(result.immediateVerification).toBeDefined();
    });

    it("applies file_edit action and reports applied status", async () => {
      const filePath = join(tmpDir, "edit-me.txt");
      writeFileSync(filePath, "original content", "utf8");

      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, {
        id: "rx-exec-002",
        actions: [
          {
            type: "file_edit",
            filePath,
            diff: "new content from prescription",
            description: { en: "Update file" },
          },
        ],
      });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      const result = await executor.execute("rx-exec-002");

      expect(result.success).toBe(true);
      expect(result.appliedActions[0].status).toBe("applied");

      const content = readFileSync(filePath, "utf8");
      expect(content).toBe("new content from prescription");
    });

    it("applies file_delete action", async () => {
      const filePath = join(tmpDir, "delete-me.txt");
      writeFileSync(filePath, "to be deleted", "utf8");

      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, {
        id: "rx-exec-003",
        actions: [
          {
            type: "file_delete",
            filePath,
            description: { en: "Remove file" },
          },
        ],
      });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      const result = await executor.execute("rx-exec-003");

      expect(result.appliedActions[0].status).toBe("applied");
      expect(existsSync(filePath)).toBe(false);
    });

    it("updates prescription status to applied", async () => {
      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, { id: "rx-exec-004" });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await executor.execute("rx-exec-004");

      const row = db
        .prepare("SELECT status, applied_at FROM prescriptions WHERE id = ?")
        .get("rx-exec-004") as { status: string; applied_at: number };
      expect(row.status).toBe("applied");
      expect(row.applied_at).toBeGreaterThan(0);
    });

    it("creates 3 follow-up rows after successful execution", async () => {
      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, { id: "rx-exec-005" });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await executor.execute("rx-exec-005");

      const followups = rxStore.getPendingFollowups().filter(
        (f) => f.prescriptionId === "rx-exec-005",
      );
      expect(followups).toHaveLength(3);

      const checkpoints = followups.map((f) => f.checkpoint).sort();
      expect(checkpoints).toEqual(["T+1h", "T+24h", "T+7d"].sort());
    });

    it("follow-up scheduled times are T+1h, T+24h, T+7d from appliedAt", async () => {
      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, { id: "rx-exec-006" });
      rxStore.insertPrescription(rx);

      const before = Date.now();
      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await executor.execute("rx-exec-006");
      const after = Date.now();

      const followups = rxStore.getPendingFollowups().filter(
        (f) => f.prescriptionId === "rx-exec-006",
      );

      const fu1h = followups.find((f) => f.checkpoint === "T+1h")!;
      const fu24h = followups.find((f) => f.checkpoint === "T+24h")!;
      const fu7d = followups.find((f) => f.checkpoint === "T+7d")!;

      expect(fu1h.scheduledAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
      expect(fu1h.scheduledAt).toBeLessThanOrEqual(after + 60 * 60 * 1000);

      expect(fu24h.scheduledAt).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
      expect(fu7d.scheduledAt).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
    });

    it("stores backup_json in the prescriptions table", async () => {
      const filePath = join(tmpDir, "backup-test.txt");
      writeFileSync(filePath, "original", "utf8");

      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, {
        id: "rx-exec-007",
        actions: [{ type: "file_edit", filePath, diff: "new", description: { en: "Edit" } }],
      });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await executor.execute("rx-exec-007");

      const row = db
        .prepare("SELECT backup_json FROM prescriptions WHERE id = ?")
        .get("rx-exec-007") as { backup_json: string | null };
      expect(row.backup_json).not.toBeNull();
      const backup = JSON.parse(row.backup_json!);
      expect(backup.prescriptionId).toBe("rx-exec-007");
      expect(backup.entries).toHaveLength(1);
    });

    it("throws when prescription not found", async () => {
      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await expect(executor.execute("no-such-rx")).rejects.toThrow("not found");
    });
  });

  // ─── rollback ─────────────────────────────────────────────────────────────

  describe("rollback", () => {
    it("restores a file after execution", async () => {
      const filePath = join(tmpDir, "rollback-test.txt");
      writeFileSync(filePath, "original content", "utf8");

      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, {
        id: "rx-rb-001",
        actions: [{ type: "file_edit", filePath, diff: "new content", description: { en: "Edit" } }],
      });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await executor.execute("rx-rb-001");

      // Verify file was changed
      expect(readFileSync(filePath, "utf8")).toBe("new content");

      // Rollback
      const result = await executor.rollback("rx-rb-001");

      expect(result.success).toBe(true);
      expect(result.restoredFiles).toContain(filePath);
      expect(readFileSync(filePath, "utf8")).toBe("original content");
    });

    it("updates prescription status to rolled_back", async () => {
      const filePath = join(tmpDir, "rb-status.txt");
      writeFileSync(filePath, "original", "utf8");

      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, {
        id: "rx-rb-002",
        actions: [{ type: "file_edit", filePath, diff: "edited", description: { en: "Edit" } }],
      });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await executor.execute("rx-rb-002");
      await executor.rollback("rx-rb-002");

      const row = db
        .prepare("SELECT status, rolled_back_at FROM prescriptions WHERE id = ?")
        .get("rx-rb-002") as { status: string; rolled_back_at: number };
      expect(row.status).toBe("rolled_back");
      expect(row.rolled_back_at).toBeGreaterThan(0);
    });

    it("returns error result when no backup exists", async () => {
      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, { id: "rx-rb-003" });
      rxStore.insertPrescription(rx);
      // Never execute — no backup

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      const result = await executor.rollback("rx-rb-003");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("throws when prescription not found", async () => {
      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await expect(executor.rollback("no-such-rx")).rejects.toThrow("not found");
    });
  });

  // ─── followUp ─────────────────────────────────────────────────────────────

  describe("followUp", () => {
    it("returns a FollowUpResult with prescriptionId and diagnosisId", async () => {
      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, { id: "rx-fu-001" });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await executor.execute("rx-fu-001");
      const result = await executor.followUp("rx-fu-001");

      expect(result.prescriptionId).toBe("rx-fu-001");
      expect(result.diagnosisId).toBe(diagId);
      expect(result.verdict).toBeDefined();
      expect(result.comparison).toBeDefined();
    });

    it("marks the first pending follow-up as completed", async () => {
      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, { id: "rx-fu-002" });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await executor.execute("rx-fu-002");

      // Initially 3 pending followups
      const before = rxStore.getPendingFollowups().filter(
        (f) => f.prescriptionId === "rx-fu-002",
      );
      expect(before).toHaveLength(3);

      await executor.followUp("rx-fu-002");

      // After followUp, one should be completed
      const after = rxStore.getPendingFollowups().filter(
        (f) => f.prescriptionId === "rx-fu-002",
      );
      expect(after).toHaveLength(2);
    });

    it("timeSinceApplied reflects time elapsed since execution", async () => {
      const rxStore = createPrescriptionStore(db);
      const rx = makePrescription(diagId, { id: "rx-fu-003" });
      rxStore.insertPrescription(rx);

      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await executor.execute("rx-fu-003");
      const result = await executor.followUp("rx-fu-003");

      // timeSinceApplied should be non-negative and small (same test run)
      expect(result.timeSinceApplied).toBeGreaterThanOrEqual(0);
      expect(result.timeSinceApplied).toBeLessThan(10_000); // < 10 seconds
    });

    it("throws when prescription not found", async () => {
      const executor = createPrescriptionExecutor(db, DEFAULT_CONFIG);
      await expect(executor.followUp("no-such-rx")).rejects.toThrow("not found");
    });
  });
});
