import { describe, it, expect, vi } from "vitest";
import { INPUT_KEY_MAP, resolveInputData } from "./input-key-mapper.js";
import { getDiseaseRegistry } from "../diseases/registry.js";
import type { RawSampleProvider } from "./raw-sample-provider.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";

// ─── Critical coverage test ───────────────────────────────────────────────────

describe("INPUT_KEY_MAP", () => {
  it("all LLM/hybrid diseases have mapped inputDataKeys", () => {
    const registry = getDiseaseRegistry();
    const llmDiseases = registry.getAll().filter(
      (d) => d.detection.type === "llm" || d.detection.type === "hybrid",
    );

    for (const disease of llmDiseases) {
      const det = disease.detection;
      const keys =
        det.type === "llm"
          ? det.inputDataKeys
          : det.type === "hybrid"
          ? det.deepAnalysis.inputDataKeys
          : [];

      for (const key of keys) {
        expect(
          INPUT_KEY_MAP[key],
          `${disease.id}: unmapped inputDataKey "${key}"`,
        ).toBeDefined();
      }
    }
  });

  it("has at least 16 LLM/hybrid diseases to cover", () => {
    const registry = getDiseaseRegistry();
    const llmDiseases = registry.getAll().filter(
      (d) => d.detection.type === "llm" || d.detection.type === "hybrid",
    );
    expect(llmDiseases.length).toBeGreaterThanOrEqual(16);
  });
});

// ─── resolveInputData ─────────────────────────────────────────────────────────

function makeMockProvider(): RawSampleProvider {
  return {
    getRecentSessionSamples: vi.fn().mockResolvedValue([
      {
        sessionKey: "sess-001",
        messageCount: 3,
        toolCallSequence: [{ toolName: "web_search", success: true }],
        tokenUsage: { input: 100, output: 50 },
      },
    ]),
    getMemoryFileContents: vi.fn().mockResolvedValue([
      {
        path: "/some/MEMORY.md",
        content: "## Memory\nAgent goals.",
        frontmatter: { name: "main" },
        modifiedAt: Date.now() - 86400000,
      },
    ]),
    getSkillDefinitions: vi.fn().mockResolvedValue([]),
  };
}

function makeMockMetrics(): MetricSet {
  return {
    timeRange: { from: 0, to: Date.now() },
    agentId: "test-agent",
    skill: {
      toolCallCount: 10,
      toolSuccessRate: 0.8,
      toolErrorRate: 0.2,
      avgToolDurationMs: 120,
      topErrorTools: [
        { tool: "file_read", errorCount: 3, errorMessages: ["ENOENT: file not found"] },
      ],
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
      pluginSources: { "my-plugin": "official" },
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

describe("resolveInputData", () => {
  it("returns empty object for rule-only diseases", async () => {
    const registry = getDiseaseRegistry();
    const ruleDisease = registry.getAll().find((d) => d.detection.type === "rule");
    expect(ruleDisease).toBeDefined();

    const result = await resolveInputData(
      ruleDisease!,
      makeMockProvider(),
      makeMockMetrics(),
      "test-agent",
    );
    expect(result).toEqual({});
  });

  it("resolves all keys for an LLM disease (SK-003)", async () => {
    const registry = getDiseaseRegistry();
    const disease = registry.getById("SK-003");
    expect(disease).toBeDefined();

    const provider = makeMockProvider();
    const metrics = makeMockMetrics();

    const result = await resolveInputData(disease!, provider, metrics, "test-agent");

    expect(result).toHaveProperty("sessionToolCallLog");
    expect(result).toHaveProperty("toolDescriptions");
    expect(result).toHaveProperty("taskGoal");
  });

  it("resolves deepAnalysis keys for a hybrid disease (SK-005)", async () => {
    const registry = getDiseaseRegistry();
    const disease = registry.getById("SK-005");
    expect(disease).toBeDefined();

    const result = await resolveInputData(
      disease!,
      makeMockProvider(),
      makeMockMetrics(),
      "test-agent",
    );

    expect(result).toHaveProperty("consecutiveFailureLog");
    expect(result).toHaveProperty("toolChainDefinition");
  });

  it("resolves memoryFiles key to MemoryFileSample array (MEM-001)", async () => {
    const registry = getDiseaseRegistry();
    const disease = registry.getById("MEM-001");
    expect(disease).toBeDefined();

    const provider = makeMockProvider();
    const result = await resolveInputData(disease!, provider, makeMockMetrics(), "test-agent");

    expect(result).toHaveProperty("memoryFiles");
    expect(Array.isArray(result["memoryFiles"])).toBe(true);
    expect(provider.getMemoryFileContents).toHaveBeenCalled();
  });

  it("resolves sessionToolCallLog key to SessionSample array", async () => {
    const registry = getDiseaseRegistry();
    const disease = registry.getById("SK-003");
    expect(disease).toBeDefined();

    const provider = makeMockProvider();
    const result = await resolveInputData(disease!, provider, makeMockMetrics(), "test-agent");

    expect(Array.isArray(result["sessionToolCallLog"])).toBe(true);
    expect(provider.getRecentSessionSamples).toHaveBeenCalledWith("test-agent", 5);
  });

  it("resolves toolName to most error-prone tool name", async () => {
    const registry = getDiseaseRegistry();
    const disease = registry.getById("SK-002");
    expect(disease).toBeDefined();

    const result = await resolveInputData(
      disease!,
      makeMockProvider(),
      makeMockMetrics(),
      "test-agent",
    );

    expect(result["toolName"]).toBe("file_read");
  });

  it("resolves errorLog as formatted string of tool errors", async () => {
    const registry = getDiseaseRegistry();
    const disease = registry.getById("SK-002");
    expect(disease).toBeDefined();

    const result = await resolveInputData(
      disease!,
      makeMockProvider(),
      makeMockMetrics(),
      "test-agent",
    );

    expect(typeof result["errorLog"]).toBe("string");
    expect(result["errorLog"] as string).toContain("file_read");
  });

  it("resolves all keys for every LLM/hybrid disease without throwing", async () => {
    const registry = getDiseaseRegistry();
    const llmDiseases = registry.getAll().filter(
      (d) => d.detection.type === "llm" || d.detection.type === "hybrid",
    );

    for (const disease of llmDiseases) {
      const result = await resolveInputData(
        disease,
        makeMockProvider(),
        makeMockMetrics(),
        "test-agent",
      );
      expect(result).toBeDefined();
    }
  });
});
