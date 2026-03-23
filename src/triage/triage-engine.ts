// ===============================================
//  Triage Engine
//  Phase 1: Alert-only mode — all results are "red"
//  Phase 2 will add severity-based triage levels
//  and automated intervention decisions.
// ===============================================

import type { DiseaseInstance } from "../types/domain.js";
import type { TriageResult } from "../types/monitor.js";

/**
 * Phase 1 triage: always returns level "red" (alert only).
 *
 * In Phase 1, no automated interventions exist, so every
 * detected disease is escalated to alert level for human review.
 *
 * Phase 2 will replace this with severity-based triage that
 * considers disease severity, recurrence, and auto-remediation
 * eligibility.
 */
export function triageAlertOnly(disease: DiseaseInstance): TriageResult {
  return {
    level: "red",
    diseaseId: disease.definitionId,
    agentId: disease.context.agentId as string | undefined,
    reason: { en: "Alert only (Phase 1)", zh: "仅告警（第一阶段）" },
  };
}
