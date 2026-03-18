// ═══════════════════════════════════════════════
//  LLM Prompt Templates
//  Design spec §6.4 — diagnosis system prompt + round-specific prompts
// ═══════════════════════════════════════════════

import type { MetricSet } from "../analysis/metric-aggregator.js";
import type { RuleResult } from "../analysis/rule-engine.js";
import type { DiseaseInstance } from "../types/domain.js";
import type {
  SessionSample,
  MemoryFileSample,
  SkillDefinitionSample,
} from "../types/domain.js";

// ─── System Prompt ────────────────────────────────────────────────────────────

/**
 * The ClawDoc diagnosis system prompt (spec §6.4).
 * Instructs the LLM to act as a health diagnostics engine.
 */
export const DIAGNOSIS_SYSTEM_PROMPT = `You are ClawDoc, an AI agent health diagnostics engine.
You analyze OpenClaw agent runtime data to detect health issues.
OUTPUT FORMAT: JSON array of diagnosis objects. Each MUST include: diseaseId, status, severity, confidence, evidence, rootCause.
RULES: Only confirm with evidence. Prefer "inconclusive" over false positives. Reference specific data points.`;

// ─── Round 1: Suspect Triage ──────────────────────────────────────────────────

/**
 * Builds the Round 1 prompt: given rule-engine suspects and aggregated metrics,
 * ask the LLM to validate and deepen analysis of suspected diseases.
 */
export function buildRound1Prompt(
  suspects: RuleResult[],
  metrics: MetricSet,
): string {
  return JSON.stringify({
    task: "round1_suspect_triage",
    description:
      "Validate and deepen analysis of suspected diseases flagged by the rule engine. " +
      "For each suspect, confirm or reject based on the provided metrics. " +
      "Return a JSON array of diagnosis objects with: diseaseId, status, severity, confidence, evidence, rootCause.",
    suspects,
    metrics,
  });
}

// ─── Round 2: Deep Sample Analysis ───────────────────────────────────────────

export type RawSample =
  | SessionSample
  | MemoryFileSample
  | SkillDefinitionSample;

/**
 * Builds the Round 2 prompt: given confirmed diagnoses from Round 1 and raw
 * session/memory/skill samples, perform deep analysis to surface additional
 * evidence or refine severity.
 */
export function buildRound2Prompt(
  confirmed: DiseaseInstance[],
  samples: RawSample[],
): string {
  return JSON.stringify({
    task: "round2_deep_sample_analysis",
    description:
      "Using confirmed diagnoses and raw runtime samples, perform deep analysis. " +
      "Refine severity and confidence, surface additional evidence, and identify any " +
      "missed diseases. Return a JSON array of diagnosis objects with: " +
      "diseaseId, status, severity, confidence, evidence, rootCause.",
    confirmed,
    samples,
  });
}

// ─── Causal Chain Prompt ──────────────────────────────────────────────────────

/**
 * Builds the causal chain prompt: given all diagnoses, ask the LLM to identify
 * causal relationships and produce a linked causal chain narrative.
 */
export function buildCausalChainPrompt(
  allDiagnoses: DiseaseInstance[],
): string {
  return JSON.stringify({
    task: "causal_chain_analysis",
    description:
      "Analyze the full set of confirmed diagnoses and identify causal relationships " +
      "between them. Determine which diseases are root causes vs downstream effects. " +
      "Return a JSON array of causal chain objects with: id, rootCause (diseaseId + summary), " +
      "chain (ordered list of diseaseId + summary), impact, and optionally a unified prescription summary.",
    allDiagnoses,
  });
}
