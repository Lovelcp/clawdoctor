// ═══════════════════════════════════════════════
//  Prescription Generator
//  Uses LLM to generate a concrete Prescription from a disease + template
//  Design spec §7.2
// ═══════════════════════════════════════════════

import { ulid } from "ulid";
import type { LLMProvider } from "../llm/provider.js";
import type {
  DiseaseInstance,
  DiseaseDefinition,
  Prescription,
  PrescriptionAction,
  I18nString,
} from "../types/domain.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeneratorContext {
  metrics: MetricSet;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are ClawInsight's prescription engine. Given a diagnosed disease and its definition,
generate a concrete, actionable prescription in JSON format.

Your response MUST be a valid JSON object (no markdown code fences) with this exact structure:
{
  "actions": [
    {
      "type": "file_edit" | "file_delete" | "config_change" | "command" | "manual",
      // For file_edit:
      "filePath": "...",
      "diff": "...",
      "description": { "en": "..." },
      // For file_delete:
      "filePath": "...",
      "description": { "en": "..." },
      // For config_change:
      "key": "...",
      "oldValue": ...,
      "newValue": ...,
      "description": { "en": "..." },
      // For command:
      "command": "...",
      "description": { "en": "..." },
      // For manual:
      "instruction": { "en": "..." }
    }
  ],
  "estimatedImprovement": { "en": "..." },
  "risk": "low" | "medium" | "high"
}

Generate ONLY actions of the types listed in the prescription template's actionTypes.
Be specific and concrete. Do not add any text outside the JSON object.`;

function buildPrompt(
  disease: DiseaseInstance,
  definition: DiseaseDefinition,
  context: GeneratorContext,
): string {
  const template = definition.prescriptionTemplate;

  return `Disease: ${definition.name.en} (${definition.id})
Description: ${definition.description.en}
Severity: ${disease.severity}
Confidence: ${(disease.confidence * 100).toFixed(0)}%

Root Causes:
${definition.rootCauses.map((rc) => `- ${rc.en}`).join("\n")}

Evidence:
${disease.evidence.map((e) => `- ${e.description.en}${e.value !== undefined ? ` (value: ${e.value}${e.threshold !== undefined ? `, threshold: ${e.threshold}` : ""})` : ""}`).join("\n")}

Disease Context:
${JSON.stringify(disease.context, null, 2)}

Prescription Template:
- Level: ${template.level}
- Allowed Action Types: ${template.actionTypes.join(", ")}
- Estimated Improvement Template: ${template.estimatedImprovementTemplate.en}
- Risk Level: ${template.risk}

Key Metrics:
${JSON.stringify(
  {
    "skill.successRate": context.metrics.skill.toolSuccessRate,
    "skill.toolCallCount": context.metrics.skill.toolCallCount,
    "cost.totalInputTokens": context.metrics.cost.totalInputTokens,
    "cost.totalOutputTokens": context.metrics.cost.totalOutputTokens,
    "memory.fileCount": context.metrics.memory.fileCount,
  },
  null,
  2,
)}

Generate a concrete prescription following the template. Use only the allowed action types.
Fill in the estimatedImprovement with a specific value based on the metrics.`;
}

// ─── Response parser ──────────────────────────────────────────────────────────

interface LLMPrescriptionResponse {
  actions: PrescriptionAction[];
  estimatedImprovement: I18nString;
  risk: "low" | "medium" | "high";
}

function parsePrescriptionResponse(text: string): LLMPrescriptionResponse | null {
  // Strip markdown code fences if present
  const stripped = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  try {
    const parsed = JSON.parse(stripped) as LLMPrescriptionResponse;
    if (!Array.isArray(parsed.actions)) return null;
    if (typeof parsed.estimatedImprovement !== "object") return null;
    if (!["low", "medium", "high"].includes(parsed.risk)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Fallback prescription ────────────────────────────────────────────────────

function buildFallbackPrescription(
  disease: DiseaseInstance,
  definition: DiseaseDefinition,
): LLMPrescriptionResponse {
  return {
    actions: [
      {
        type: "manual",
        instruction: {
          en: `Review ${definition.name.en} (${definition.id}): ${definition.description.en}. ${definition.rootCauses.map((rc) => rc.en).join(" ")}`,
        },
      },
    ],
    estimatedImprovement: definition.prescriptionTemplate.estimatedImprovementTemplate,
    risk: definition.prescriptionTemplate.risk,
  };
}

// ─── generatePrescription ─────────────────────────────────────────────────────

/**
 * Uses the LLM to generate a concrete Prescription from a disease + template.
 *
 * On LLM failure or parse failure, returns a minimal manual-action fallback
 * rather than throwing.
 */
export async function generatePrescription(
  disease: DiseaseInstance,
  definition: DiseaseDefinition,
  provider: LLMProvider,
  context: GeneratorContext,
): Promise<Prescription> {
  const prompt = buildPrompt(disease, definition, context);

  const response = await provider.chat(SYSTEM_PROMPT, prompt, {
    maxTokens: 2048,
  });

  let parsed: LLMPrescriptionResponse | null = null;

  if (!response.error && response.text) {
    parsed = parsePrescriptionResponse(response.text);
  }

  if (!parsed) {
    parsed = buildFallbackPrescription(disease, definition);
  }

  return {
    id: ulid(),
    diagnosisId: disease.id,
    level: definition.prescriptionTemplate.level,
    actions: parsed.actions,
    estimatedImprovement: parsed.estimatedImprovement,
    risk: parsed.risk,
  };
}
