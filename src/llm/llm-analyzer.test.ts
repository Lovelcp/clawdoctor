// ═══════════════════════════════════════════════
//  LLM Analyzer Tests
//  TDD coverage for analyzeLLM (3-round analysis)
// ═══════════════════════════════════════════════

import { describe, it, expect, vi } from "vitest";
import { analyzeLLM } from "./llm-analyzer.js";
import type { LLMAnalyzerInput, LLMDiagnosis } from "./llm-analyzer.js";
import type { LLMProvider, LLMResponse } from "./provider.js";
import type { RawSampleProvider } from "../raw-samples/raw-sample-provider.js";
import type { RuleResult } from "../analysis/rule-engine.js";
import type { DiseaseDefinition } from "../types/domain.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTokens(input = 100, output = 50): LLMResponse["tokensUsed"] {
  return { input, output };
}

function makeOkResponse(payload: unknown, input = 100, output = 50): LLMResponse {
  return {
    text: JSON.stringify(payload),
    tokensUsed: makeTokens(input, output),
  };
}

function makeErrorResponse(message: string): LLMResponse {
  return {
    text: "",
    tokensUsed: { input: 0, output: 0 },
    error: message,
  };
}

/**
 * Create a mock LLMProvider whose chat() method returns responses from a queue.
 * Each call consumes the next item from the queue.
 */
function makeMockProvider(responses: LLMResponse[]): LLMProvider {
  let idx = 0;
  return {
    chat: vi.fn().mockImplementation(async () => {
      const res = responses[idx] ?? makeOkResponse([]);
      idx++;
      return res;
    }),
  };
}

/**
 * Create a mock RawSampleProvider.
 */
function makeMockRawProvider(): RawSampleProvider {
  return {
    getRecentSessionSamples: vi.fn().mockResolvedValue([
      {
        sessionKey: "sess-001",
        messageCount: 5,
        toolCallSequence: [{ toolName: "web_search", success: true }],
        tokenUsage: { input: 200, output: 80 },
      },
    ]),
    getMemoryFileContents: vi.fn().mockResolvedValue([]),
    getSkillDefinitions: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Minimal MetricSet for testing.
 */
function makeMockMetrics(): MetricSet {
  return {
    timeRange: { from: 0, to: Date.now() },
    agentId: "test-agent",
    skill: {
      toolCallCount: 10,
      toolSuccessRate: 0.8,
      toolErrorRate: 0.2,
      avgToolDurationMs: 120,
      topErrorTools: [{ tool: "file_read", errorCount: 3, errorMessages: ["ENOENT"] }],
      repeatCallPatterns: [],
      unusedPlugins: [],
      tokenPerToolCall: {},
      contextTokenRatio: {},
    },
    memory: {
      fileCount: 3,
      totalSizeBytes: 1024,
      avgAgeDays: 10,
      staleFiles: [],
    },
    behavior: {
      sessionCount: 5,
      avgMessagesPerSession: 8,
      agentSuccessRate: 0.9,
      avgStepsPerSession: 6,
      subagentSpawnCount: 0,
      subagentFailureRate: 0,
      verboseRatio: null,
    },
    cost: {
      totalInputTokens: 5000,
      totalOutputTokens: 2000,
      totalCacheReadTokens: 500,
      totalCacheWriteTokens: 200,
      cacheHitRate: 0.1,
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
      diskUsageBytes: 1024,
    },
  };
}

/**
 * Minimal RuleResult suspect.
 */
function makeSuspect(diseaseId: string): RuleResult {
  return {
    diseaseId,
    status: "suspect",
    severity: "warning",
    evidence: [],
    confidence: 0.6,
  };
}

/**
 * Minimal LLM-only DiseaseDefinition.
 */
function makeLLMDisease(id: string, department: DiseaseDefinition["department"] = "skill"): DiseaseDefinition {
  return {
    id,
    department,
    category: "reliability",
    name: { en: `Disease ${id}` },
    description: { en: `Description for ${id}` },
    rootCauses: [{ en: "Some root cause" }],
    detection: {
      type: "llm",
      analysisPromptTemplate: `Analyze ${id}`,
      inputDataKeys: ["sessionToolCallLog"],
      outputSchema: {},
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit"],
      promptTemplate: `Fix ${id}`,
      estimatedImprovementTemplate: { en: "+10% improvement" },
      risk: "low",
    },
    relatedDiseases: [],
    defaultSeverity: "warning",
    tags: [],
  };
}

/**
 * Default config with generous budgets.
 */
const DEFAULT_CONFIG = {
  maxTokensPerCheckup: 100_000,
  maxTokensPerDiagnosis: 10_000,
};

// ─── Round 1 confirmed diagnosis payload ─────────────────────────────────────

const CONFIRMED_DIAGNOSIS: LLMDiagnosis = {
  diseaseId: "SK-002",
  status: "confirmed",
  severity: "warning",
  confidence: 0.85,
  evidence: [{ description: "Tool fails frequently", dataReference: "skill.topErrorTools" }],
  rootCause: "Missing error handling",
};

const RULED_OUT_DIAGNOSIS: LLMDiagnosis = {
  diseaseId: "SK-007",
  status: "ruled_out",
  severity: "info",
  confidence: 0.9,
  evidence: [{ description: "All plugins are used" }],
};

// ─── Test 1: Full 3-round flow ────────────────────────────────────────────────

describe("analyzeLLM - full 3-round flow with suspects", () => {
  it("runs all 3 rounds and returns confirmed + causal chains", async () => {
    const round1Response = makeOkResponse([CONFIRMED_DIAGNOSIS, RULED_OUT_DIAGNOSIS]);

    const round2Confirmed: LLMDiagnosis = {
      ...CONFIRMED_DIAGNOSIS,
      confidence: 0.95,
      rootCause: "Refined root cause from deep analysis",
    };
    const round2Response = makeOkResponse([round2Confirmed]);

    const round3CausalChain = {
      name: "Tool Failure Chain",
      rootCause: "SK-002",
      chain: ["SK-002"],
      impact: "High tool error rate reduces agent reliability",
    };
    const round3Response = makeOkResponse([round3CausalChain]);

    const provider = makeMockProvider([round1Response, round2Response, round3Response]);
    const rawProvider = makeMockRawProvider();

    const input: LLMAnalyzerInput = {
      provider,
      suspects: [makeSuspect("SK-002"), makeSuspect("SK-007")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: rawProvider,
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    };

    const result = await analyzeLLM(input);

    // Should have confirmed SK-002
    expect(result.confirmed.length).toBeGreaterThanOrEqual(1);
    const sk002 = result.confirmed.find((c) => c.diseaseId === "SK-002");
    expect(sk002).toBeDefined();
    expect(sk002!.status).toBe("confirmed");

    // Ruled-out diseases should NOT be in confirmed
    const sk007 = result.confirmed.find((c) => c.diseaseId === "SK-007");
    expect(sk007).toBeUndefined();

    // Causal chains from Round 3
    expect(result.causalChains.length).toBeGreaterThanOrEqual(1);
    expect(result.causalChains[0].name).toBe("Tool Failure Chain");
    expect(result.causalChains[0].rootCause).toBe("SK-002");

    // provider.chat should have been called 3 times (R1 suspects + R2 + R3)
    expect(provider.chat).toHaveBeenCalledTimes(3);

    // No error
    expect(result.error).toBeUndefined();
  });

  it("Round 2 refines confidence and rootCause for confirmed diseases", async () => {
    const r1 = makeOkResponse([CONFIRMED_DIAGNOSIS]);
    const r2Refined: LLMDiagnosis = {
      diseaseId: "SK-002",
      status: "confirmed",
      severity: "critical",
      confidence: 0.98,
      evidence: [{ description: "Deep analysis confirms systemic failure" }],
      rootCause: "Core issue: incomplete error handling in file_read",
    };
    const r2 = makeOkResponse([r2Refined]);
    const r3 = makeOkResponse([]);

    const provider = makeMockProvider([r1, r2, r3]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    const sk002 = result.confirmed.find((c) => c.diseaseId === "SK-002");
    expect(sk002).toBeDefined();
    // Round 2 should have updated confidence and rootCause
    expect(sk002!.confidence).toBe(0.98);
    expect(sk002!.rootCause).toBe("Core issue: incomplete error handling in file_read");
  });
});

// ─── Test 2: LLM-only disease path ───────────────────────────────────────────

describe("analyzeLLM - LLM-only disease path (empty suspects)", () => {
  it("processes llmOnlyDiseases when suspects is empty", async () => {
    const confirmedLlmDisease: LLMDiagnosis = {
      diseaseId: "SK-003",
      status: "confirmed",
      severity: "warning",
      confidence: 0.80,
      evidence: [{ description: "Session logs show suspicious pattern" }],
    };
    const r1 = makeOkResponse([confirmedLlmDisease]);
    const r2 = makeOkResponse([confirmedLlmDisease]); // Round 2
    const r3 = makeOkResponse([]); // Round 3 no chains

    const provider = makeMockProvider([r1, r2, r3]);

    const result = await analyzeLLM({
      provider,
      suspects: [],
      llmOnlyDiseases: [makeLLMDisease("SK-003", "skill")],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    expect(result.confirmed.length).toBeGreaterThanOrEqual(1);
    const sk003 = result.confirmed.find((c) => c.diseaseId === "SK-003");
    expect(sk003).toBeDefined();
    expect(sk003!.status).toBe("confirmed");

    // provider.chat called: R1 (llm batch) + R2 (deep) + R3 (causal)
    expect(provider.chat).toHaveBeenCalledTimes(3);
  });

  it("groups LLM-only diseases by department and sends one call per department", async () => {
    const skillDisease1 = makeLLMDisease("SK-003", "skill");
    const skillDisease2 = makeLLMDisease("SK-004", "skill");
    const memDisease = makeLLMDisease("MEM-001", "memory");

    const confirmedSkill: LLMDiagnosis = {
      diseaseId: "SK-003",
      status: "confirmed",
      severity: "warning",
      confidence: 0.75,
      evidence: [],
    };
    // R1 call for skill dept, R1 call for memory dept, R2, R3
    const r1Skill = makeOkResponse([confirmedSkill]);
    const r1Mem = makeOkResponse([]);
    const r2 = makeOkResponse([confirmedSkill]);
    const r3 = makeOkResponse([]);

    const provider = makeMockProvider([r1Skill, r1Mem, r2, r3]);

    const result = await analyzeLLM({
      provider,
      suspects: [],
      llmOnlyDiseases: [skillDisease1, skillDisease2, memDisease],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    // Should have called provider at least twice for Round 1 (2 departments)
    const callCount = (provider.chat as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(2);

    expect(result.confirmed.find((c) => c.diseaseId === "SK-003")).toBeDefined();
  });

  it("returns empty confirmed when all llmOnlyDiseases are ruled_out", async () => {
    const r1 = makeOkResponse([
      { diseaseId: "SK-003", status: "ruled_out", confidence: 0.9, evidence: [] },
    ]);
    const provider = makeMockProvider([r1]);

    const result = await analyzeLLM({
      provider,
      suspects: [],
      llmOnlyDiseases: [makeLLMDisease("SK-003", "skill")],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    expect(result.confirmed).toHaveLength(0);
    // No Round 2 or 3 since nothing confirmed
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });
});

// ─── Test 3: Graceful degradation on LLM failure ─────────────────────────────

describe("analyzeLLM - graceful degradation on LLM failure", () => {
  it("returns error and empty results when Round 1 fails", async () => {
    const provider = makeMockProvider([makeErrorResponse("API unavailable")]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    expect(result.error).toBe("API unavailable");
    expect(result.confirmed).toHaveLength(0);
    expect(result.causalChains).toHaveLength(0);
    // Should not throw
  });

  it("returns partial results when Round 2 fails but Round 1 succeeded", async () => {
    const r1 = makeOkResponse([CONFIRMED_DIAGNOSIS]);
    const r2Error = makeErrorResponse("Rate limit exceeded");

    const provider = makeMockProvider([r1, r2Error]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    // Round 1 confirmed diseases should still be present
    expect(result.confirmed.length).toBeGreaterThanOrEqual(1);
    expect(result.confirmed.find((c) => c.diseaseId === "SK-002")).toBeDefined();

    // Error should be recorded
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Rate limit");
  });

  it("returns partial results when Round 3 fails but Rounds 1 and 2 succeeded", async () => {
    const r1 = makeOkResponse([CONFIRMED_DIAGNOSIS]);
    const r2 = makeOkResponse([CONFIRMED_DIAGNOSIS]);
    const r3Error = makeErrorResponse("Model overloaded");

    const provider = makeMockProvider([r1, r2, r3Error]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    // Confirmed diseases present from Rounds 1+2
    expect(result.confirmed.length).toBeGreaterThanOrEqual(1);

    // Causal chains empty (Round 3 failed)
    expect(result.causalChains).toHaveLength(0);

    // Error recorded for Round 3 failure
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Model overloaded");
  });

  it("does not throw when provider.chat throws an exception", async () => {
    const provider: LLMProvider = {
      chat: vi.fn().mockRejectedValue(new Error("Network error")),
    };

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    expect(result.error).toContain("Network error");
    expect(result.confirmed).toHaveLength(0);
  });
});

// ─── Test 4: Budget enforcement ───────────────────────────────────────────────

describe("analyzeLLM - skips remaining rounds when budget exceeded", () => {
  it("skips Round 2 when token budget exceeded after Round 1", async () => {
    // Round 1 uses tokens that exceed the per-checkup budget
    const r1 = makeOkResponse([CONFIRMED_DIAGNOSIS], 4900, 4900); // 9800 tokens

    const provider = makeMockProvider([r1]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: {
        maxTokensPerCheckup: 5000,  // budget: only 5000 total
        maxTokensPerDiagnosis: 10_000,
      },
    });

    // Only Round 1 should have been called (budget exceeded after R1)
    expect(provider.chat).toHaveBeenCalledTimes(1);

    // Confirmed from Round 1 still present
    expect(result.confirmed.find((c) => c.diseaseId === "SK-002")).toBeDefined();

    // No causal chains (Round 3 skipped)
    expect(result.causalChains).toHaveLength(0);
  });

  it("skips Round 3 when token budget exceeded after Round 2", async () => {
    // R1: 3000 tokens, R2: 3000 tokens = 6000 total > budget of 5500
    const r1 = makeOkResponse([CONFIRMED_DIAGNOSIS], 1500, 1500); // 3000
    const r2 = makeOkResponse([CONFIRMED_DIAGNOSIS], 1500, 1500); // 3000

    const provider = makeMockProvider([r1, r2]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: {
        maxTokensPerCheckup: 5500,  // allows R1 + R2 but not R3
        maxTokensPerDiagnosis: 10_000,
      },
    });

    // Rounds 1 and 2 called, Round 3 skipped
    expect(provider.chat).toHaveBeenCalledTimes(2);

    // No causal chains
    expect(result.causalChains).toHaveLength(0);
  });

  it("skips all rounds when budget is 0 (budget already exceeded)", async () => {
    const provider = makeMockProvider([]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: {
        maxTokensPerCheckup: 0,  // zero budget
        maxTokensPerDiagnosis: 10_000,
      },
    });

    expect(provider.chat).not.toHaveBeenCalled();
    expect(result.confirmed).toHaveLength(0);
    expect(result.causalChains).toHaveLength(0);
  });
});

// ─── Test 5: Cumulative tokensUsed ───────────────────────────────────────────

describe("analyzeLLM - returns correct cumulative tokensUsed", () => {
  it("sums tokens across all rounds", async () => {
    // R1: input=100, output=50 → 150
    // R2: input=200, output=100 → 300
    // R3: input=50, output=25 → 75
    // Total: 525
    const r1 = makeOkResponse([CONFIRMED_DIAGNOSIS], 100, 50);
    const r2 = makeOkResponse([CONFIRMED_DIAGNOSIS], 200, 100);
    const r3 = makeOkResponse([{ name: "chain", rootCause: "SK-002", chain: ["SK-002"], impact: "high" }], 50, 25);

    const provider = makeMockProvider([r1, r2, r3]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    expect(result.totalTokensUsed).toBe(525);
  });

  it("returns 0 tokens when no calls were made", async () => {
    // No suspects, no llmOnlyDiseases
    const provider = makeMockProvider([]);

    const result = await analyzeLLM({
      provider,
      suspects: [],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    expect(result.totalTokensUsed).toBe(0);
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it("counts tokens even when LLM returns an error response", async () => {
    // Error responses have 0 tokens from the LLM
    const r1Error = makeErrorResponse("API error");

    const provider = makeMockProvider([r1Error]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    // Error responses have tokensUsed: { input: 0, output: 0 }
    expect(result.totalTokensUsed).toBe(0);
    expect(result.error).toBeDefined();
  });

  it("accumulates tokens across suspect batch + LLM-only department batches", async () => {
    // Suspects batch: 100 + 50 = 150
    // LLM-only skill dept: 80 + 40 = 120
    // R2: 200 + 100 = 300
    // R3: 50 + 25 = 75
    // Total: 645
    const rSuspects = makeOkResponse([CONFIRMED_DIAGNOSIS], 100, 50);
    const rLlmOnly = makeOkResponse([], 80, 40);
    const r2 = makeOkResponse([CONFIRMED_DIAGNOSIS], 200, 100);
    const r3 = makeOkResponse([], 50, 25);

    const provider = makeMockProvider([rSuspects, rLlmOnly, r2, r3]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [makeLLMDisease("SK-003", "skill")],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    expect(result.totalTokensUsed).toBe(645);
  });
});

// ─── Test 6: Edge cases ───────────────────────────────────────────────────────

describe("analyzeLLM - edge cases", () => {
  it("handles malformed JSON from LLM without throwing", async () => {
    const r1: LLMResponse = {
      text: "this is not json at all !!!",
      tokensUsed: { input: 50, output: 20 },
    };
    const provider = makeMockProvider([r1]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    // No confirmed (parse failed gracefully), no throw
    expect(result.confirmed).toHaveLength(0);
    expect(result.error).toBeUndefined(); // parse failure is silent
  });

  it("handles LLM response wrapped in markdown code fences", async () => {
    const r1: LLMResponse = {
      text: "```json\n" + JSON.stringify([CONFIRMED_DIAGNOSIS]) + "\n```",
      tokensUsed: { input: 100, output: 50 },
    };
    const r2: LLMResponse = { text: JSON.stringify([CONFIRMED_DIAGNOSIS]), tokensUsed: { input: 50, output: 30 } };
    const r3: LLMResponse = { text: JSON.stringify([]), tokensUsed: { input: 20, output: 10 } };

    const provider = makeMockProvider([r1, r2, r3]);

    const result = await analyzeLLM({
      provider,
      suspects: [makeSuspect("SK-002")],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    expect(result.confirmed.find((c) => c.diseaseId === "SK-002")).toBeDefined();
  });

  it("returns empty results when both suspects and llmOnlyDiseases are empty", async () => {
    const provider = makeMockProvider([]);

    const result = await analyzeLLM({
      provider,
      suspects: [],
      llmOnlyDiseases: [],
      metrics: makeMockMetrics(),
      rawSampleProvider: makeMockRawProvider(),
      agentId: "test-agent",
      config: DEFAULT_CONFIG,
    });

    expect(result.confirmed).toHaveLength(0);
    expect(result.causalChains).toHaveLength(0);
    expect(result.totalTokensUsed).toBe(0);
    expect(result.error).toBeUndefined();
    expect(provider.chat).not.toHaveBeenCalled();
  });
});
