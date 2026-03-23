// ═══════════════════════════════════════════════
//  Prescription Generator Tests (TDD)
// ═══════════════════════════════════════════════

import { describe, it, expect, vi } from "vitest";
import { generatePrescription } from "./prescription-generator.js";
import type { LLMProvider, LLMResponse } from "../llm/provider.js";
import type { DiseaseInstance, DiseaseDefinition } from "../types/domain.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProvider(responseText: string, error?: string): LLMProvider {
  return {
    chat: vi.fn().mockResolvedValue({
      text: responseText,
      tokensUsed: { input: 100, output: 200 },
      error,
    } satisfies LLMResponse),
  };
}

function makeDiseaseInstance(overrides: Partial<DiseaseInstance> = {}): DiseaseInstance {
  return {
    id: "diag-001",
    definitionId: "SK-001",
    severity: "warning",
    evidence: [
      {
        type: "metric",
        description: { en: "Tool success rate is below threshold" },
        value: 0.45,
        threshold: 0.75,
        confidence: 0.9,
      },
    ],
    confidence: 0.85,
    firstDetectedAt: Date.now() - 86400_000,
    lastSeenAt: Date.now(),
    status: "active",
    context: { toolName: "WebSearch" },
    ...overrides,
  };
}

function makeDiseaseDefinition(overrides: Partial<DiseaseDefinition> = {}): DiseaseDefinition {
  return {
    id: "SK-001",
    department: "skill",
    category: "reliability",
    name: { en: "Tool Success Rate Deficit" },
    description: { en: "The tool success rate is consistently below acceptable thresholds." },
    rootCauses: [{ en: "Incorrect tool parameters" }, { en: "Transient API failures" }],
    detection: {
      type: "rule",
      metric: "skill.successRate",
      direction: "lower_is_worse",
      defaultThresholds: { warning: 0.75, critical: 0.5 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "manual"],
      promptTemplate: "Generate a prescription for tool success rate improvement",
      estimatedImprovementTemplate: { en: "+{value}% success rate improvement" },
      risk: "low",
    },
    relatedDiseases: [],
    defaultSeverity: "warning",
    tags: ["tool", "reliability"],
    ...overrides,
  };
}

function makeMinimalMetrics(): MetricSet {
  return {
    timeRange: { from: Date.now() - 86400_000, to: Date.now() },
    agentId: "agent-001",
    skill: {
      toolCallCount: 100,
      toolSuccessRate: 0.45,
      toolErrorRate: 0.55,
      avgToolDurationMs: 2500,
      topErrorTools: [{ tool: "WebSearch", errorCount: 30, errorMessages: ["timeout"] }],
      repeatCallPatterns: [],
      unusedPlugins: [],
      tokenPerToolCall: {},
      contextTokenRatio: {},
    },
    memory: { fileCount: 10, totalSizeBytes: 51200, avgAgeDays: 15, staleFiles: [] },
    behavior: {
      sessionCount: 20,
      avgMessagesPerSession: 8,
      agentSuccessRate: 0.75,
      avgStepsPerSession: 6,
      subagentSpawnCount: 2,
      subagentFailureRate: 0,
      verboseRatio: null,
    },
    cost: {
      totalInputTokens: 500_000,
      totalOutputTokens: 100_000,
      totalCacheReadTokens: 50_000,
      totalCacheWriteTokens: 10_000,
      cacheHitRate: 0.09,
      tokensByModel: {},
      tokensByTool: {},
      tokensBySession: [],
      dailyTrend: [],
    },
    security: {
      sandboxEnabled: true,
      pluginSources: {},
      channelAllowLists: {},
      credentialPatternHits: [],
    },
    vitals: {
      gatewayReachable: true,
      configValid: true,
      configWarnings: [],
      pluginLoadErrors: [],
      openclawVersion: "1.0.0",
      diskUsageBytes: 1024 * 1024,
    },
    infra: null,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("generatePrescription", () => {
  it("returns a Prescription with correct diagnosisId and level", async () => {
    const response = JSON.stringify({
      actions: [{ type: "manual", instruction: { en: "Review tool error logs" } }],
      estimatedImprovement: { en: "+30% success rate" },
      risk: "low",
    });

    const provider = makeProvider(response);
    const disease = makeDiseaseInstance();
    const definition = makeDiseaseDefinition();
    const metrics = makeMinimalMetrics();

    const rx = await generatePrescription(disease, definition, provider, { metrics });

    expect(rx.id).toBeDefined();
    expect(rx.id.length).toBeGreaterThan(0);
    expect(rx.diagnosisId).toBe("diag-001");
    expect(rx.level).toBe("guided");
    expect(rx.risk).toBe("low");
    expect(rx.estimatedImprovement).toEqual({ en: "+30% success rate" });
    expect(rx.actions).toHaveLength(1);
    expect(rx.actions[0].type).toBe("manual");
  });

  it("parses multiple action types from LLM response", async () => {
    const response = JSON.stringify({
      actions: [
        {
          type: "file_edit",
          filePath: "/agent/config.json",
          diff: "@@ -1 +1 @@\n-old\n+new",
          description: { en: "Update config" },
        },
        {
          type: "manual",
          instruction: { en: "Restart the agent" },
        },
      ],
      estimatedImprovement: { en: "+25% improvement" },
      risk: "medium",
    });

    const provider = makeProvider(response);
    const rx = await generatePrescription(
      makeDiseaseInstance(),
      makeDiseaseDefinition(),
      provider,
      { metrics: makeMinimalMetrics() },
    );

    expect(rx.actions).toHaveLength(2);
    expect(rx.actions[0].type).toBe("file_edit");
    expect(rx.actions[1].type).toBe("manual");
    expect(rx.risk).toBe("medium");
  });

  it("strips markdown code fences from LLM response", async () => {
    const json = JSON.stringify({
      actions: [{ type: "manual", instruction: { en: "Do this" } }],
      estimatedImprovement: { en: "+10%" },
      risk: "low",
    });
    const response = "```json\n" + json + "\n```";

    const provider = makeProvider(response);
    const rx = await generatePrescription(
      makeDiseaseInstance(),
      makeDiseaseDefinition(),
      provider,
      { metrics: makeMinimalMetrics() },
    );

    expect(rx.actions).toHaveLength(1);
    expect(rx.actions[0].type).toBe("manual");
  });

  it("falls back to manual action when LLM returns an error", async () => {
    const provider = makeProvider("", "API error: quota exceeded");
    const rx = await generatePrescription(
      makeDiseaseInstance(),
      makeDiseaseDefinition(),
      provider,
      { metrics: makeMinimalMetrics() },
    );

    expect(rx.actions).toHaveLength(1);
    expect(rx.actions[0].type).toBe("manual");
    expect(rx.risk).toBe("low"); // fallback uses template risk
  });

  it("falls back to manual action when LLM response is invalid JSON", async () => {
    const provider = makeProvider("This is not valid JSON at all");
    const rx = await generatePrescription(
      makeDiseaseInstance(),
      makeDiseaseDefinition(),
      provider,
      { metrics: makeMinimalMetrics() },
    );

    expect(rx.actions).toHaveLength(1);
    expect(rx.actions[0].type).toBe("manual");
  });

  it("falls back when LLM returns JSON missing required fields", async () => {
    const provider = makeProvider(JSON.stringify({ partial: true }));
    const rx = await generatePrescription(
      makeDiseaseInstance(),
      makeDiseaseDefinition(),
      provider,
      { metrics: makeMinimalMetrics() },
    );

    expect(rx.actions[0].type).toBe("manual");
  });

  it("generates unique ids for each prescription", async () => {
    const response = JSON.stringify({
      actions: [{ type: "manual", instruction: { en: "Do something" } }],
      estimatedImprovement: { en: "+5%" },
      risk: "low",
    });

    const provider: LLMProvider = {
      chat: vi.fn().mockResolvedValue({
        text: response,
        tokensUsed: { input: 10, output: 20 },
      }),
    };

    const disease = makeDiseaseInstance();
    const definition = makeDiseaseDefinition();
    const metrics = makeMinimalMetrics();

    const rx1 = await generatePrescription(disease, definition, provider, { metrics });
    const rx2 = await generatePrescription(disease, definition, provider, { metrics });

    expect(rx1.id).not.toBe(rx2.id);
  });

  it("calls the LLM provider exactly once", async () => {
    const response = JSON.stringify({
      actions: [{ type: "manual", instruction: { en: "Act" } }],
      estimatedImprovement: { en: "+1%" },
      risk: "low",
    });
    const provider = makeProvider(response);
    await generatePrescription(
      makeDiseaseInstance(),
      makeDiseaseDefinition(),
      provider,
      { metrics: makeMinimalMetrics() },
    );

    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it("uses the disease's diagnosisId in the returned prescription", async () => {
    const response = JSON.stringify({
      actions: [{ type: "manual", instruction: { en: "Fix it" } }],
      estimatedImprovement: { en: "+15%" },
      risk: "high",
    });
    const provider = makeProvider(response);
    const disease = makeDiseaseInstance({ id: "diag-special-999" });

    const rx = await generatePrescription(
      disease,
      makeDiseaseDefinition(),
      provider,
      { metrics: makeMinimalMetrics() },
    );

    expect(rx.diagnosisId).toBe("diag-special-999");
  });

  it("uses the template level from the disease definition", async () => {
    const response = JSON.stringify({
      actions: [{ type: "manual", instruction: { en: "Manual step" } }],
      estimatedImprovement: { en: "+10%" },
      risk: "high",
    });
    const provider = makeProvider(response);
    const definition = makeDiseaseDefinition({
      prescriptionTemplate: {
        level: "manual",
        actionTypes: ["manual"],
        promptTemplate: "template",
        estimatedImprovementTemplate: { en: "+{value}%" },
        risk: "high",
      },
    });

    const rx = await generatePrescription(
      makeDiseaseInstance(),
      definition,
      provider,
      { metrics: makeMinimalMetrics() },
    );

    expect(rx.level).toBe("manual");
  });
});
