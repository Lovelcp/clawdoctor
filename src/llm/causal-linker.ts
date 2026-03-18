// ═══════════════════════════════════════════════
//  Causal Chain Linker
//  Converts raw LLM causal chain output to typed CausalChain domain objects.
//  Phase 2: §6 Causal Chain Analysis
// ═══════════════════════════════════════════════

import { ulid } from "ulid";
import type { CausalChain, DiagnosisRef, DiseaseInstance, I18nString } from "../types/domain.js";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse raw LLM causal chain output into typed CausalChain objects.
 *
 * Filters:
 *  - null / non-array input → returns []
 *  - chains where any chain[] element does not match a DiseaseInstance.id → dropped
 *  - single-element chains (chain.length < 2) → dropped
 *  - rootCause normalised to first chain element when mismatch detected
 *
 * `unifiedPrescription` is intentionally left undefined; it is backfilled by
 * the pipeline after prescription generation.
 */
export function parseCausalChains(
  rawChains: Array<{ name: string; rootCause: string; chain: string[]; impact: string }> | null,
  diseases: DiseaseInstance[],
): CausalChain[] {
  // Guard: null or non-array input
  if (!Array.isArray(rawChains)) {
    return [];
  }

  // Build a fast lookup from DiseaseInstance.id → DiseaseInstance
  const diseaseMap = new Map<string, DiseaseInstance>();
  for (const d of diseases) {
    diseaseMap.set(d.id, d);
  }

  const result: CausalChain[] = [];

  for (const raw of rawChains) {
    // Guard: malformed chain entry
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof raw.name !== "string" ||
      typeof raw.rootCause !== "string" ||
      !Array.isArray(raw.chain) ||
      typeof raw.impact !== "string"
    ) {
      continue;
    }

    // Guard: single-element chains are not causal chains
    if (raw.chain.length < 2) {
      continue;
    }

    // Guard: all chain IDs must reference actual DiseaseInstance objects
    const allExist = raw.chain.every((id) => typeof id === "string" && diseaseMap.has(id));
    if (!allExist) {
      continue;
    }

    // Build DiagnosisRef list from chain IDs
    const chainRefs: DiagnosisRef[] = raw.chain.map((id) => {
      const disease = diseaseMap.get(id)!;
      return makeDiagnosisRef(id, disease);
    });

    // Normalize rootCause: if the declared rootCause doesn't match the first
    // element of the chain, use the first chain element as the authoritative root.
    const firstChainId = raw.chain[0];
    const rootCauseId = raw.rootCause !== firstChainId ? firstChainId : raw.rootCause;
    const rootCauseDisease = diseaseMap.get(rootCauseId)!;
    const rootCauseRef: DiagnosisRef = makeDiagnosisRef(rootCauseId, rootCauseDisease);

    const name: I18nString = { en: raw.name };
    const impact: I18nString = { en: raw.impact };

    result.push({
      id: ulid(),
      name,
      rootCause: rootCauseRef,
      chain: chainRefs,
      impact,
      // unifiedPrescription left undefined — backfilled by pipeline
    });
  }

  return result;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function makeDiagnosisRef(diseaseId: string, disease: DiseaseInstance): DiagnosisRef {
  // Use definitionId as the stable disease identifier in the ref
  return {
    diseaseId: disease.definitionId,
    instanceId: disease.id,
    summary: { en: `Instance of ${disease.definitionId} (${disease.severity})` },
  };
}
