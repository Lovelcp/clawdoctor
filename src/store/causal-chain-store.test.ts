// ═══════════════════════════════════════════════
//  Causal Chain Store Tests (TDD)
// ═══════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "./database.js";
import { createCausalChainStore } from "./causal-chain-store.js";
import type { CausalChain, DiagnosisRef } from "../types/domain.js";
import type Database from "better-sqlite3";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRef(diseaseId: string, instanceId: string): DiagnosisRef {
  return {
    diseaseId,
    instanceId,
    summary: { en: `Summary for ${diseaseId}` },
  };
}

function makeChain(overrides: Partial<CausalChain> = {}): CausalChain {
  return {
    id: `chain_${Math.random().toString(36).slice(2)}`,
    name: { en: "Test Causal Chain" },
    rootCause: makeRef("MEM-001", "inst-001"),
    chain: [makeRef("MEM-001", "inst-001"), makeRef("SK-002", "inst-002")],
    impact: { en: "Reduces agent reliability" },
    unifiedPrescription: undefined,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CausalChainStore", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  // ─── Insert and query ──────────────────────────────────────────────────────

  it("inserts a chain and queries it back", () => {
    const store = createCausalChainStore(db);
    const chain = makeChain({ id: "chain-001" });
    store.insertChain("agent-001", chain);

    const results = store.queryChains("agent-001");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("chain-001");
  });

  it("serialises and deserialises name as I18nString", () => {
    const store = createCausalChainStore(db);
    const chain = makeChain({ id: "chain-i18n", name: { en: "Memory Leak Chain", zh: "内存泄漏链" } });
    store.insertChain("agent-001", chain);

    const results = store.queryChains("agent-001");
    expect(results[0].name).toEqual({ en: "Memory Leak Chain", zh: "内存泄漏链" });
  });

  it("serialises and deserialises rootCause DiagnosisRef", () => {
    const store = createCausalChainStore(db);
    const rootCause = makeRef("MEM-003", "inst-999");
    const chain = makeChain({ id: "chain-rc", rootCause });
    store.insertChain("agent-001", chain);

    const results = store.queryChains("agent-001");
    expect(results[0].rootCause.diseaseId).toBe("MEM-003");
    expect(results[0].rootCause.instanceId).toBe("inst-999");
  });

  it("serialises and deserialises the chain DiagnosisRef array", () => {
    const store = createCausalChainStore(db);
    const chainRefs = [
      makeRef("MEM-001", "i1"),
      makeRef("SK-002", "i2"),
      makeRef("BEH-003", "i3"),
    ];
    const chain = makeChain({ id: "chain-arr", chain: chainRefs });
    store.insertChain("agent-001", chain);

    const results = store.queryChains("agent-001");
    expect(results[0].chain).toHaveLength(3);
    expect(results[0].chain[1].diseaseId).toBe("SK-002");
    expect(results[0].chain[2].instanceId).toBe("i3");
  });

  it("serialises and deserialises impact as I18nString", () => {
    const store = createCausalChainStore(db);
    const chain = makeChain({ id: "chain-imp", impact: { en: "High error rate", zh: "高错误率" } });
    store.insertChain("agent-001", chain);

    const results = store.queryChains("agent-001");
    expect(results[0].impact).toEqual({ en: "High error rate", zh: "高错误率" });
  });

  it("returns multiple chains ordered by created_at ascending", () => {
    const store = createCausalChainStore(db);
    store.insertChain("agent-001", makeChain({ id: "chain-A" }));
    store.insertChain("agent-001", makeChain({ id: "chain-B" }));
    store.insertChain("agent-001", makeChain({ id: "chain-C" }));

    const results = store.queryChains("agent-001");
    expect(results).toHaveLength(3);
    expect(results.map((c) => c.id)).toEqual(["chain-A", "chain-B", "chain-C"]);
  });

  it("isolates chains by agentId", () => {
    const store = createCausalChainStore(db);
    store.insertChain("agent-001", makeChain({ id: "c1" }));
    store.insertChain("agent-002", makeChain({ id: "c2" }));

    const agent1Results = store.queryChains("agent-001");
    expect(agent1Results).toHaveLength(1);
    expect(agent1Results[0].id).toBe("c1");

    const agent2Results = store.queryChains("agent-002");
    expect(agent2Results).toHaveLength(1);
    expect(agent2Results[0].id).toBe("c2");
  });

  // ─── Returns empty array ───────────────────────────────────────────────────

  it("returns empty array when no chains exist for agent", () => {
    const store = createCausalChainStore(db);
    const results = store.queryChains("no-such-agent");
    expect(results).toHaveLength(0);
  });

  it("returns empty array after deleteByAgent removes all chains", () => {
    const store = createCausalChainStore(db);
    store.insertChain("agent-001", makeChain({ id: "c1" }));
    store.insertChain("agent-001", makeChain({ id: "c2" }));
    store.deleteByAgent("agent-001");

    const results = store.queryChains("agent-001");
    expect(results).toHaveLength(0);
  });

  // ─── deleteByAgent ─────────────────────────────────────────────────────────

  it("deleteByAgent removes all chains for that agent", () => {
    const store = createCausalChainStore(db);
    store.insertChain("agent-001", makeChain({ id: "c1" }));
    store.insertChain("agent-001", makeChain({ id: "c2" }));
    store.insertChain("agent-002", makeChain({ id: "c3" }));

    const deleted = store.deleteByAgent("agent-001");
    expect(deleted).toBe(2);

    // agent-001 chains gone
    expect(store.queryChains("agent-001")).toHaveLength(0);
    // agent-002 chains untouched
    expect(store.queryChains("agent-002")).toHaveLength(1);
  });

  it("deleteByAgent returns 0 when no chains exist for agent", () => {
    const store = createCausalChainStore(db);
    const deleted = store.deleteByAgent("no-such-agent");
    expect(deleted).toBe(0);
  });

  // ─── updateChainPrescription ───────────────────────────────────────────────

  it("updateChainPrescription sets prescription_id on the row", () => {
    const store = createCausalChainStore(db);
    store.insertChain("agent-001", makeChain({ id: "chain-px" }));

    store.updateChainPrescription("chain-px", "rx-001");

    // Verify via raw DB query
    const row = db
      .prepare("SELECT prescription_id FROM causal_chains WHERE id = ?")
      .get("chain-px") as { prescription_id: string | null };
    expect(row.prescription_id).toBe("rx-001");
  });

  it("updateChainPrescription is idempotent when called twice", () => {
    const store = createCausalChainStore(db);
    store.insertChain("agent-001", makeChain({ id: "chain-idem" }));

    store.updateChainPrescription("chain-idem", "rx-001");
    store.updateChainPrescription("chain-idem", "rx-002");

    const row = db
      .prepare("SELECT prescription_id FROM causal_chains WHERE id = ?")
      .get("chain-idem") as { prescription_id: string | null };
    expect(row.prescription_id).toBe("rx-002");
  });

  it("inserts chain with null prescription_id by default", () => {
    const store = createCausalChainStore(db);
    store.insertChain("agent-001", makeChain({ id: "chain-nopx", unifiedPrescription: undefined }));

    const row = db
      .prepare("SELECT prescription_id FROM causal_chains WHERE id = ?")
      .get("chain-nopx") as { prescription_id: string | null };
    expect(row.prescription_id).toBeNull();
  });
});
