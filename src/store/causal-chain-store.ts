// ═══════════════════════════════════════════════
//  Causal Chain Store
//  Design spec §8.2 (causal_chains table, Phase 2)
// ═══════════════════════════════════════════════

import type Database from "better-sqlite3";
import type { CausalChain, DiagnosisRef, I18nString, Prescription } from "../types/domain.js";

// ─── Row shape returned by SQLite ───

interface CausalChainRow {
  id: string;
  agent_id: string;
  name_json: string;
  root_cause_json: string;
  chain_json: string;
  impact_json: string;
  prescription_id: string | null;
  created_at: number;
}

// ─── Row → domain object ───

function rowToChain(row: CausalChainRow): CausalChain {
  return {
    id: row.id,
    name: JSON.parse(row.name_json) as I18nString,
    rootCause: JSON.parse(row.root_cause_json) as DiagnosisRef,
    chain: JSON.parse(row.chain_json) as DiagnosisRef[],
    impact: JSON.parse(row.impact_json) as I18nString,
    // unifiedPrescription is not stored inline; prescription_id is the FK
    // The column exists for linking to the prescriptions table; the full
    // Prescription object is not reconstructed here (out of scope for this store).
    unifiedPrescription: undefined as Prescription | undefined,
  };
}

// ─── CausalChainStore interface ───

export interface CausalChainStore {
  insertChain(agentId: string, chain: CausalChain): void;
  queryChains(agentId: string): CausalChain[];
  deleteByAgent(agentId: string): number;
  updateChainPrescription(chainId: string, prescriptionId: string): void;
}

// ─── Factory ───

export function createCausalChainStore(db: Database.Database): CausalChainStore {
  const insertStmt = db.prepare<{
    id: string;
    agent_id: string;
    name_json: string;
    root_cause_json: string;
    chain_json: string;
    impact_json: string;
    prescription_id: string | null;
  }>(`
    INSERT INTO causal_chains
      (id, agent_id, name_json, root_cause_json, chain_json, impact_json, prescription_id)
    VALUES
      (@id, @agent_id, @name_json, @root_cause_json, @chain_json, @impact_json, @prescription_id)
  `);

  function insertChain(agentId: string, chain: CausalChain): void {
    insertStmt.run({
      id: chain.id,
      agent_id: agentId,
      name_json: JSON.stringify(chain.name),
      root_cause_json: JSON.stringify(chain.rootCause),
      chain_json: JSON.stringify(chain.chain),
      impact_json: JSON.stringify(chain.impact),
      prescription_id: chain.unifiedPrescription?.id ?? null,
    });
  }

  function queryChains(agentId: string): CausalChain[] {
    const rows = db
      .prepare(`
        SELECT * FROM causal_chains
        WHERE agent_id = ?
        ORDER BY created_at ASC
      `)
      .all(agentId) as CausalChainRow[];
    return rows.map(rowToChain);
  }

  function deleteByAgent(agentId: string): number {
    const info = db
      .prepare(`DELETE FROM causal_chains WHERE agent_id = ?`)
      .run(agentId);
    return info.changes;
  }

  function updateChainPrescription(chainId: string, prescriptionId: string): void {
    db.prepare<{ id: string; prescription_id: string }>(`
      UPDATE causal_chains
      SET prescription_id = @prescription_id
      WHERE id = @id
    `).run({ id: chainId, prescription_id: prescriptionId });
  }

  return { insertChain, queryChains, deleteByAgent, updateChainPrescription };
}
