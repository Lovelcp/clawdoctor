// ═══════════════════════════════════════════════
//  Prescription Store Tests (TDD)
// ═══════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "./database.js";
import { createPrescriptionStore } from "./prescription-store.js";
import { createDiagnosisStore } from "./diagnosis-store.js";
import type { Prescription, DiseaseInstance } from "../types/domain.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDiagnosis(overrides: Partial<DiseaseInstance> = {}): DiseaseInstance {
  return {
    id: `diag_${Math.random().toString(36).slice(2)}`,
    definitionId: "SK-001",
    severity: "warning",
    evidence: [],
    confidence: 0.85,
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
    actions: [
      {
        type: "manual",
        instruction: { en: "Follow these steps" },
      },
    ],
    estimatedImprovement: { en: "+20% success rate" },
    risk: "low",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PrescriptionStore", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
    // Insert a seed diagnosis so foreign key is satisfied
    const diagStore = createDiagnosisStore(db);
    diagStore.insertDiagnosis("agent-001", makeDiagnosis({ id: "diag-seed" }));
    diagStore.insertDiagnosis("agent-001", makeDiagnosis({ id: "diag-seed-2" }));
    diagStore.insertDiagnosis("agent-002", makeDiagnosis({ id: "diag-agent2" }));
  });

  // ─── insertPrescription ──────────────────────────────────────────────────

  it("inserts a prescription and retrieves it by id", () => {
    const store = createPrescriptionStore(db);
    const rx = makePrescription("diag-seed", { id: "rx-001" });
    store.insertPrescription(rx);

    const found = store.getPrescriptionById("rx-001");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("rx-001");
    expect(found!.diagnosisId).toBe("diag-seed");
    expect(found!.level).toBe("guided");
    expect(found!.risk).toBe("low");
    expect(found!.estimatedImprovement).toEqual({ en: "+20% success rate" });
  });

  it("stores actions serialized as JSON", () => {
    const store = createPrescriptionStore(db);
    const rx = makePrescription("diag-seed", {
      id: "rx-002",
      actions: [
        { type: "manual", instruction: { en: "Do something" } },
        { type: "command", command: "echo hello", description: { en: "Echo" } },
      ],
    });
    store.insertPrescription(rx);

    const found = store.getPrescriptionById("rx-002");
    expect(found!.actions).toHaveLength(2);
    expect(found!.actions[0].type).toBe("manual");
    expect(found!.actions[1].type).toBe("command");
  });

  it("inserts with status pending by default", () => {
    const store = createPrescriptionStore(db);
    const rx = makePrescription("diag-seed", { id: "rx-003" });
    store.insertPrescription(rx);

    const row = db
      .prepare("SELECT status FROM prescriptions WHERE id = ?")
      .get("rx-003") as { status: string };
    expect(row.status).toBe("pending");
  });

  // ─── queryPrescriptions ──────────────────────────────────────────────────

  it("queries all prescriptions without filter", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-q1" }));
    store.insertPrescription(makePrescription("diag-seed-2", { id: "rx-q2" }));

    const all = store.queryPrescriptions({});
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by status", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-s1" }));
    store.insertPrescription(makePrescription("diag-seed-2", { id: "rx-s2" }));
    store.updatePrescriptionStatus("rx-s2", "applied", Date.now());

    const pending = store.queryPrescriptions({ status: "pending" });
    expect(pending.map((r) => r.id)).toContain("rx-s1");
    expect(pending.map((r) => r.id)).not.toContain("rx-s2");

    const applied = store.queryPrescriptions({ status: "applied" });
    expect(applied.map((r) => r.id)).toContain("rx-s2");
  });

  it("filters by diagnosisId", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-d1" }));
    store.insertPrescription(makePrescription("diag-seed-2", { id: "rx-d2" }));

    const results = store.queryPrescriptions({ diagnosisId: "diag-seed" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("rx-d1");
  });

  it("filters by agentId via join with diagnoses", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-a1" }));
    store.insertPrescription(makePrescription("diag-agent2", { id: "rx-a2" }));

    const results = store.queryPrescriptions({ agentId: "agent-001" });
    expect(results.map((r) => r.id)).toContain("rx-a1");
    expect(results.map((r) => r.id)).not.toContain("rx-a2");
  });

  // ─── getPrescriptionById ─────────────────────────────────────────────────

  it("returns null for unknown prescription id", () => {
    const store = createPrescriptionStore(db);
    const found = store.getPrescriptionById("no-such-id");
    expect(found).toBeNull();
  });

  // ─── updatePrescriptionStatus ────────────────────────────────────────────

  it("updates status to applied and sets appliedAt", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-u1" }));
    const now = Date.now();
    store.updatePrescriptionStatus("rx-u1", "applied", now);

    const row = db
      .prepare("SELECT status, applied_at FROM prescriptions WHERE id = ?")
      .get("rx-u1") as { status: string; applied_at: number };
    expect(row.status).toBe("applied");
    expect(row.applied_at).toBe(now);
  });

  it("updates status to rolled_back and sets rolledBackAt", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-u2" }));
    const now = Date.now();
    store.updatePrescriptionStatus("rx-u2", "rolled_back", undefined, now);

    const row = db
      .prepare("SELECT status, rolled_back_at FROM prescriptions WHERE id = ?")
      .get("rx-u2") as { status: string; rolled_back_at: number };
    expect(row.status).toBe("rolled_back");
    expect(row.rolled_back_at).toBe(now);
  });

  it("updates status without touching existing applied_at", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-u3" }));
    const appliedAt = Date.now() - 1000;
    store.updatePrescriptionStatus("rx-u3", "applied", appliedAt);
    // Now update status to rolled_back without passing appliedAt
    store.updatePrescriptionStatus("rx-u3", "rolled_back", undefined, Date.now());

    const row = db
      .prepare("SELECT applied_at FROM prescriptions WHERE id = ?")
      .get("rx-u3") as { applied_at: number };
    expect(row.applied_at).toBe(appliedAt);
  });

  // ─── deletePendingByAgent ────────────────────────────────────────────────

  it("deletes all pending prescriptions for an agent and returns count", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-del1" }));
    store.insertPrescription(makePrescription("diag-seed-2", { id: "rx-del2" }));
    store.insertPrescription(makePrescription("diag-agent2", { id: "rx-del3" }));

    const deleted = store.deletePendingByAgent("agent-001");
    expect(deleted).toBe(2);

    const remaining = store.queryPrescriptions({});
    expect(remaining.map((r) => r.id)).not.toContain("rx-del1");
    expect(remaining.map((r) => r.id)).not.toContain("rx-del2");
    expect(remaining.map((r) => r.id)).toContain("rx-del3");
  });

  it("does not delete applied prescriptions", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-skip1" }));
    store.updatePrescriptionStatus("rx-skip1", "applied", Date.now());

    const deleted = store.deletePendingByAgent("agent-001");
    expect(deleted).toBe(0);

    const found = store.getPrescriptionById("rx-skip1");
    expect(found).not.toBeNull();
  });

  // ─── Followup CRUD ───────────────────────────────────────────────────────

  it("inserts a followup and returns it as pending", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-fu1" }));

    store.insertFollowup({
      id: "fu-001",
      prescriptionId: "rx-fu1",
      checkpoint: "T+1h",
      scheduledAt: Date.now() + 3600_000,
    });

    const pending = store.getPendingFollowups();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("fu-001");
    expect(pending[0].prescriptionId).toBe("rx-fu1");
    expect(pending[0].checkpoint).toBe("T+1h");
  });

  it("returns multiple pending followups ordered by scheduledAt", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-fu2" }));

    const now = Date.now();
    store.insertFollowup({ id: "fu-c", prescriptionId: "rx-fu2", checkpoint: "T+7d", scheduledAt: now + 7 * 86400_000 });
    store.insertFollowup({ id: "fu-a", prescriptionId: "rx-fu2", checkpoint: "T+1h", scheduledAt: now + 3600_000 });
    store.insertFollowup({ id: "fu-b", prescriptionId: "rx-fu2", checkpoint: "T+24h", scheduledAt: now + 86400_000 });

    const pending = store.getPendingFollowups();
    expect(pending.map((f) => f.id)).toEqual(["fu-a", "fu-b", "fu-c"]);
  });

  it("completeFollowup marks followup as completed", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-fu3" }));
    store.insertFollowup({ id: "fu-comp", prescriptionId: "rx-fu3", checkpoint: "T+1h", scheduledAt: Date.now() + 1 });

    store.completeFollowup("fu-comp", JSON.stringify({ verdict: "resolved" }));

    const pending = store.getPendingFollowups();
    expect(pending.map((f) => f.id)).not.toContain("fu-comp");

    const row = db
      .prepare("SELECT completed_at, result_json FROM followups WHERE id = ?")
      .get("fu-comp") as { completed_at: number; result_json: string };
    expect(row.completed_at).toBeGreaterThan(0);
    expect(JSON.parse(row.result_json)).toEqual({ verdict: "resolved" });
  });

  it("getPendingFollowups excludes completed followups", () => {
    const store = createPrescriptionStore(db);
    store.insertPrescription(makePrescription("diag-seed", { id: "rx-fu4" }));

    store.insertFollowup({ id: "fu-p1", prescriptionId: "rx-fu4", checkpoint: "T+1h", scheduledAt: Date.now() + 1 });
    store.insertFollowup({ id: "fu-p2", prescriptionId: "rx-fu4", checkpoint: "T+24h", scheduledAt: Date.now() + 2 });

    store.completeFollowup("fu-p1", "{}");

    const pending = store.getPendingFollowups();
    expect(pending.map((f) => f.id)).not.toContain("fu-p1");
    expect(pending.map((f) => f.id)).toContain("fu-p2");
  });

  // ─── level → type column mapping ────────────────────────────────────────

  it("preserves 'manual' level via type column", () => {
    const store = createPrescriptionStore(db);
    const rx = makePrescription("diag-seed", { id: "rx-level", level: "manual" });
    store.insertPrescription(rx);

    const found = store.getPrescriptionById("rx-level");
    expect(found!.level).toBe("manual");

    const row = db
      .prepare("SELECT type FROM prescriptions WHERE id = ?")
      .get("rx-level") as { type: string };
    expect(row.type).toBe("manual");
  });
});
