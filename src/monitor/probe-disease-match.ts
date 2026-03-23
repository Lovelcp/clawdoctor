// ===============================================
//  Probe Disease Match
//  Maps a probe Finding to a DiseaseInstance
//  via direct registry lookup by finding code.
// ===============================================

import { ulid } from "ulid";
import type { DiseaseInstance, Evidence } from "../types/domain.js";
import type { Finding } from "../types/monitor.js";
import type { DiseaseRegistry } from "../diseases/registry.js";

/**
 * Attempt to match a probe Finding to a DiseaseDefinition.
 *
 * Lookup is by `finding.code` → `registry.getById(code)`.
 * If found, creates a new DiseaseInstance with:
 *   - ULID id
 *   - finding's severity (not the definition's defaultSeverity)
 *   - evidence derived from finding context
 *   - confidence 1.0 (rule-based, deterministic)
 *   - status "active"
 *
 * Returns null if no matching definition exists.
 */
export function matchFindingToDisease(
  finding: Finding,
  registry: DiseaseRegistry,
): DiseaseInstance | null {
  const definition = registry.getById(finding.code);
  if (!definition) {
    return null;
  }

  const now = Date.now();

  const evidence: Evidence[] = [
    {
      type: "metric",
      description: finding.message,
      confidence: 1.0,
    },
  ];

  return {
    id: ulid(),
    definitionId: definition.id,
    severity: finding.severity,
    evidence,
    confidence: 1.0,
    firstDetectedAt: now,
    lastSeenAt: now,
    status: "active",
    context: { ...finding.context },
  };
}
