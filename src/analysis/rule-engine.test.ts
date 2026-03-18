import { describe, it, expect } from "vitest";
import { evaluateRules } from "./rule-engine.js";
import { getDiseaseRegistry } from "../diseases/registry.js";
import { DEFAULT_CONFIG } from "../types/config.js";
import type { MetricSet } from "./metric-aggregator.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal MetricSet with sensible healthy defaults. Individual tests
 * can override only the fields they care about.
 */
function makeMetrics(overrides: DeepPartial<MetricSet> = {}): MetricSet {
  const base: MetricSet = {
    timeRange: { from: 0, to: Date.now() },
    agentId: "test-agent",

    skill: {
      toolCallCount: 100,
      toolSuccessRate: 0.95,
      toolErrorRate: 0.05,
      avgToolDurationMs: 500,
      topErrorTools: [],
      repeatCallPatterns: [],
      unusedPlugins: [],
      tokenPerToolCall: {},
      contextTokenRatio: {},
    },

    memory: {
      fileCount: 10,
      totalSizeBytes: 1024 * 100,
      avgAgeDays: 5,
      staleFiles: [],
    },

    behavior: {
      sessionCount: 20,
      avgMessagesPerSession: 10,
      agentSuccessRate: 0.90,
      avgStepsPerSession: 5,
      subagentSpawnCount: 0,
      subagentFailureRate: 0,
      verboseRatio: 1.0,
    },

    cost: {
      totalInputTokens: 10_000,
      totalOutputTokens: 5_000,
      totalCacheReadTokens: 8_000,
      totalCacheWriteTokens: 1_000,
      cacheHitRate: 0.8,
      tokensByModel: {},
      tokensByTool: {},
      tokensBySession: [],
      dailyTrend: [
        { date: "2026-03-10", tokens: 40_000 },
        { date: "2026-03-11", tokens: 45_000 },
        { date: "2026-03-12", tokens: 42_000 },
        { date: "2026-03-13", tokens: 48_000 },
        { date: "2026-03-14", tokens: 46_000 },
        { date: "2026-03-15", tokens: 44_000 },
        { date: "2026-03-16", tokens: 43_000 },
        { date: "2026-03-17", tokens: 43_000 },
      ],
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
      diskUsageBytes: 100 * 1024 * 1024, // 100 MB
    },
  };

  return deepMerge(base, overrides) as MetricSet;
}

// Minimal deep partial + merge helpers for test convenience
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

function deepMerge(target: unknown, source: unknown): unknown {
  if (source === null || source === undefined) return target;
  if (typeof source !== "object" || Array.isArray(source)) return source;
  const result = { ...(target as Record<string, unknown>) };
  for (const key of Object.keys(source as Record<string, unknown>)) {
    const sv = (source as Record<string, unknown>)[key];
    const tv = result[key];
    if (sv !== null && typeof sv === "object" && !Array.isArray(sv) &&
        tv !== null && typeof tv === "object" && !Array.isArray(tv)) {
      result[key] = deepMerge(tv, sv);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

const registry = getDiseaseRegistry();

// ─── CST-001: Metabolic Overload ──────────────────────────────────────────────

describe("CST-001 Metabolic Overload", () => {
  it("triggers at critical severity when latest daily tokens > 500K", () => {
    const metrics = makeMetrics({
      cost: {
        dailyTrend: [
          { date: "2026-03-10", tokens: 40_000 },
          { date: "2026-03-11", tokens: 600_000 },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-001");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("critical");
    expect(hit!.confidence).toBeGreaterThan(0);
  });

  it("triggers at warning severity when latest daily tokens between 100K and 500K", () => {
    const metrics = makeMetrics({
      cost: {
        dailyTrend: [{ date: "2026-03-17", tokens: 200_000 }],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-001");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
  });

  it("does NOT trigger when daily tokens is 50K (below warning threshold)", () => {
    const metrics = makeMetrics({
      cost: {
        dailyTrend: [{ date: "2026-03-17", tokens: 50_000 }],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-001");
    expect(hit).toBeUndefined();
  });

  it("does NOT trigger when dailyTrend is empty", () => {
    const metrics = makeMetrics({
      cost: { dailyTrend: [] },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-001");
    expect(hit).toBeUndefined();
  });
});

// ─── CST-003: Cache Miss Epidemic ─────────────────────────────────────────────

describe("CST-003 Cache Miss Epidemic", () => {
  it("returns nothing (skip) when cacheHitRate is null (snapshot mode)", () => {
    const metrics = makeMetrics({
      cost: { cacheHitRate: null },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-003");
    expect(hit).toBeUndefined();
  });

  it("triggers at critical when cacheHitRate is very low (0.05)", () => {
    const metrics = makeMetrics({
      cost: { cacheHitRate: 0.05 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-003");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("critical");
  });

  it("triggers at warning when cacheHitRate is 0.20 (between critical=0.10 and warning=0.30)", () => {
    const metrics = makeMetrics({
      cost: { cacheHitRate: 0.20 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-003");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
  });
});

// ─── CST-005: Cost Spike ───────────────────────────────────────────────────────

describe("CST-005 Cost Spike", () => {
  it("triggers at critical when latest day is 6x above 7-day avg (spikeMultiplier critical=5.0)", () => {
    // 7-day avg = 50K, latest = 300K → ratio 6x
    const metrics = makeMetrics({
      cost: {
        dailyTrend: [
          { date: "2026-03-11", tokens: 50_000 },
          { date: "2026-03-12", tokens: 50_000 },
          { date: "2026-03-13", tokens: 50_000 },
          { date: "2026-03-14", tokens: 50_000 },
          { date: "2026-03-15", tokens: 50_000 },
          { date: "2026-03-16", tokens: 50_000 },
          { date: "2026-03-17", tokens: 50_000 },
          { date: "2026-03-18", tokens: 300_000 },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-005");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("critical");
  });

  it("triggers at warning when latest day is 3x above 7-day avg (warning=2.0)", () => {
    const metrics = makeMetrics({
      cost: {
        dailyTrend: [
          { date: "2026-03-11", tokens: 50_000 },
          { date: "2026-03-12", tokens: 50_000 },
          { date: "2026-03-13", tokens: 50_000 },
          { date: "2026-03-14", tokens: 50_000 },
          { date: "2026-03-15", tokens: 50_000 },
          { date: "2026-03-16", tokens: 50_000 },
          { date: "2026-03-17", tokens: 50_000 },
          { date: "2026-03-18", tokens: 150_000 },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-005");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
  });

  it("does NOT trigger when there are fewer than 2 data points", () => {
    const metrics = makeMetrics({
      cost: { dailyTrend: [{ date: "2026-03-17", tokens: 999_000 }] },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-005");
    expect(hit).toBeUndefined();
  });

  it("does NOT trigger when usage is stable", () => {
    const metrics = makeMetrics({
      cost: {
        dailyTrend: [
          { date: "2026-03-11", tokens: 50_000 },
          { date: "2026-03-12", tokens: 50_000 },
          { date: "2026-03-13", tokens: 50_000 },
          { date: "2026-03-14", tokens: 50_000 },
          { date: "2026-03-15", tokens: 50_000 },
          { date: "2026-03-16", tokens: 50_000 },
          { date: "2026-03-17", tokens: 50_000 },
          { date: "2026-03-18", tokens: 55_000 },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "CST-005");
    expect(hit).toBeUndefined();
  });
});

// ─── SK-006: Repetition Compulsion ────────────────────────────────────────────

describe("SK-006 Repetition Compulsion", () => {
  it("triggers when repeatCallPatterns has entries exceeding warning threshold (3)", () => {
    const metrics = makeMetrics({
      skill: {
        repeatCallPatterns: [
          { tool: "readFile", params: '{"path":"/foo"}', count: 4 },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-006");
    expect(hit).toBeDefined();
  });

  it("triggers at critical when count exceeds critical threshold (5)", () => {
    const metrics = makeMetrics({
      skill: {
        repeatCallPatterns: [
          { tool: "readFile", params: '{"path":"/foo"}', count: 6 },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-006");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("critical");
  });

  it("does NOT trigger when repeatCallPatterns is empty", () => {
    const metrics = makeMetrics({
      skill: { repeatCallPatterns: [] },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-006");
    expect(hit).toBeUndefined();
  });

  it("does NOT trigger when repeat count is below warning threshold (2)", () => {
    const metrics = makeMetrics({
      skill: {
        repeatCallPatterns: [
          { tool: "readFile", params: '{"path":"/foo"}', count: 2 },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-006");
    expect(hit).toBeUndefined();
  });
});

// ─── SK-007: Zombie Skill ─────────────────────────────────────────────────────

describe("SK-007 Zombie Skill", () => {
  it("triggers when unusedPlugins is non-empty", () => {
    const metrics = makeMetrics({
      skill: { unusedPlugins: ["slack-plugin", "jira-plugin"] },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-007");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
  });

  it("does NOT trigger when unusedPlugins is empty", () => {
    const metrics = makeMetrics({
      skill: { unusedPlugins: [] },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-007");
    expect(hit).toBeUndefined();
  });
});

// ─── SEC-001: Immune Deficiency (sandbox disabled) ───────────────────────────

describe("SEC-001 Immune Deficiency", () => {
  it("triggers when sandbox is disabled", () => {
    const metrics = makeMetrics({
      security: { sandboxEnabled: false },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SEC-001");
    expect(hit).toBeDefined();
  });

  it("does NOT trigger when sandbox is enabled", () => {
    const metrics = makeMetrics({
      security: { sandboxEnabled: true },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SEC-001");
    expect(hit).toBeUndefined();
  });
});

// ─── SEC-002: Credential Leak ─────────────────────────────────────────────────

describe("SEC-002 Credential Leak", () => {
  it("triggers when credentialPatternHits is non-empty", () => {
    const metrics = makeMetrics({
      security: {
        credentialPatternHits: [
          { file: "session.jsonl", line: 42, pattern: "API_KEY" },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SEC-002");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("critical");
  });

  it("does NOT trigger when credentialPatternHits is empty", () => {
    const metrics = makeMetrics({
      security: { credentialPatternHits: [] },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SEC-002");
    expect(hit).toBeUndefined();
  });
});

// ─── VIT-001: Gateway Offline ─────────────────────────────────────────────────

describe("VIT-001 Gateway Offline", () => {
  it("triggers at critical when gateway is unreachable", () => {
    const metrics = makeMetrics({
      vitals: { gatewayReachable: false },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "VIT-001");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("critical");
  });

  it("does NOT trigger when gateway is reachable", () => {
    const metrics = makeMetrics({
      vitals: { gatewayReachable: true },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "VIT-001");
    expect(hit).toBeUndefined();
  });
});

// ─── MEM-003: Memory Bloat ────────────────────────────────────────────────────

describe("MEM-003 Memory Bloat", () => {
  it("triggers at critical when fileCount exceeds critical threshold (200)", () => {
    const metrics = makeMetrics({
      memory: { fileCount: 250 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "MEM-003");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("critical");
  });

  it("triggers at warning when fileCount is between 50 and 200", () => {
    const metrics = makeMetrics({
      memory: { fileCount: 80 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "MEM-003");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
  });

  it("does NOT trigger when fileCount is below warning threshold", () => {
    const metrics = makeMetrics({
      memory: { fileCount: 30 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "MEM-003");
    expect(hit).toBeUndefined();
  });
});

// ─── BHV-005: Premature Abort ─────────────────────────────────────────────────

describe("BHV-005 Premature Abort", () => {
  it("triggers at critical when agentSuccessRate is very low (0.40)", () => {
    // BHV-005 uses metric "behavior.taskCompletionRate" → metrics.behavior.agentSuccessRate
    // lower_is_worse: critical < 0.50, warning < 0.70
    const metrics = makeMetrics({
      behavior: { agentSuccessRate: 0.40 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "BHV-005");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("critical");
  });

  it("triggers at warning when agentSuccessRate is 0.60 (below warning=0.70)", () => {
    const metrics = makeMetrics({
      behavior: { agentSuccessRate: 0.60 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "BHV-005");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warning");
  });

  it("does NOT trigger when agentSuccessRate is healthy (0.85)", () => {
    const metrics = makeMetrics({
      behavior: { agentSuccessRate: 0.85 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "BHV-005");
    expect(hit).toBeUndefined();
  });
});

// ─── LLM-only diseases are excluded from rule engine ─────────────────────────

describe("LLM-only diseases are excluded from rule engine", () => {
  it("SK-003 (LLM detection) should not appear in results", () => {
    // SK-003 has detection.type === "llm", should be skipped entirely
    const metrics = makeMetrics();
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-003");
    expect(hit).toBeUndefined();
  });

  it("MEM-001 (LLM detection) should not appear in results", () => {
    const metrics = makeMetrics();
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "MEM-001");
    expect(hit).toBeUndefined();
  });

  it("BHV-001 (LLM detection) should not appear in results", () => {
    const metrics = makeMetrics();
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "BHV-001");
    expect(hit).toBeUndefined();
  });

  it("evaluateRules returns only rule-based and hybrid disease results", () => {
    const metrics = makeMetrics();
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    // All returned results must reference diseases with detection.type === "rule" or "hybrid"
    for (const result of results) {
      const def = registry.getById(result.diseaseId);
      expect(def).toBeDefined();
      expect(["rule", "hybrid"]).toContain(def!.detection.type);
    }
  });
});

// ─── Hybrid preFilter evaluation ─────────────────────────────────────────────

describe("Hybrid disease preFilter evaluation", () => {
  it("SK-002 (hybrid) returns status 'suspect' when preFilter triggers", () => {
    // SK-002 preFilter: metric "skill.errorBurstCount", direction "higher_is_worse"
    // defaultThresholds: { warning: 3, critical: 10 }
    // We need topErrorTools[0].errorCount > 3 to trigger
    const metrics = makeMetrics({
      skill: {
        topErrorTools: [
          { tool: "readFile", errorCount: 5, errorMessages: ["not found"] },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-002");
    expect(hit).toBeDefined();
    expect(hit!.status).toBe("suspect");
    expect(hit!.severity).toBe("warning");
  });

  it("SK-002 (hybrid) is skipped when preFilter does not trigger", () => {
    // errorBurstCount = 1, which is below warning threshold of 3
    const metrics = makeMetrics({
      skill: {
        topErrorTools: [
          { tool: "readFile", errorCount: 1, errorMessages: ["not found"] },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-002");
    expect(hit).toBeUndefined();
  });

  it("SK-002 (hybrid) not in results when no error tools", () => {
    const metrics = makeMetrics({
      skill: { topErrorTools: [] },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-002");
    expect(hit).toBeUndefined();
  });

  it("hybrid disease at critical threshold returns suspect with critical severity", () => {
    // SK-002 preFilter critical threshold is 10
    const metrics = makeMetrics({
      skill: {
        topErrorTools: [
          { tool: "apiCall", errorCount: 12, errorMessages: ["timeout"] },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-002");
    expect(hit).toBeDefined();
    expect(hit!.status).toBe("suspect");
    expect(hit!.severity).toBe("critical");
  });

  it("LLM-only diseases (SK-003) are still skipped", () => {
    const metrics = makeMetrics({
      skill: {
        topErrorTools: [
          { tool: "readFile", errorCount: 5, errorMessages: ["not found"] },
        ],
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-003");
    expect(hit).toBeUndefined();
  });

  it("existing rule diseases still return 'confirmed' status", () => {
    const metrics = makeMetrics({
      vitals: { gatewayReachable: false },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "VIT-001");
    expect(hit).toBeDefined();
    expect(hit!.status).toBe("confirmed");
  });
});

// ─── RuleResult structure ─────────────────────────────────────────────────────

describe("RuleResult structure", () => {
  it("each result has required fields with valid values", () => {
    const metrics = makeMetrics({
      vitals: { gatewayReachable: false },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "VIT-001");
    expect(hit).toBeDefined();
    expect(typeof hit!.diseaseId).toBe("string");
    expect(["confirmed", "suspect"]).toContain(hit!.status);
    expect(["critical", "warning", "info"]).toContain(hit!.severity);
    expect(Array.isArray(hit!.evidence)).toBe(true);
    expect(hit!.evidence.length).toBeGreaterThan(0);
    expect(typeof hit!.confidence).toBe("number");
    expect(hit!.confidence).toBeGreaterThan(0);
    expect(hit!.confidence).toBeLessThanOrEqual(1);
  });

  it("evidence items have required fields", () => {
    const metrics = makeMetrics({
      memory: { fileCount: 300 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "MEM-003");
    expect(hit).toBeDefined();
    const ev = hit!.evidence[0];
    expect(ev.type).toBe("metric");
    expect(typeof ev.description.en).toBe("string");
    expect(typeof ev.confidence).toBe("number");
  });
});

// ─── VIT-005: Storage Pressure ────────────────────────────────────────────────

describe("VIT-005 Storage Pressure", () => {
  it("triggers at critical when diskUsage exceeds 1000 MB", () => {
    const metrics = makeMetrics({
      vitals: { diskUsageBytes: 1100 * 1024 * 1024 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "VIT-005");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("critical");
  });

  it("does NOT trigger when diskUsage is below 500 MB", () => {
    const metrics = makeMetrics({
      vitals: { diskUsageBytes: 100 * 1024 * 1024 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "VIT-005");
    expect(hit).toBeUndefined();
  });
});

// ─── MEM-005: Stale Memory ────────────────────────────────────────────────────

describe("MEM-005 Stale Memory", () => {
  it("triggers when avgAgeDays exceeds warning threshold (30)", () => {
    const metrics = makeMetrics({
      memory: { avgAgeDays: 45 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "MEM-005");
    expect(hit).toBeDefined();
  });

  it("does NOT trigger when avgAgeDays is recent (5 days)", () => {
    const metrics = makeMetrics({
      memory: { avgAgeDays: 5 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "MEM-005");
    expect(hit).toBeUndefined();
  });
});

// ─── BHV-007: Verbose Waste ───────────────────────────────────────────────────

describe("BHV-007 Verbose Waste", () => {
  it("triggers when verboseRatio exceeds warning threshold (3.0)", () => {
    const metrics = makeMetrics({
      behavior: { verboseRatio: 4.0 },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "BHV-007");
    expect(hit).toBeDefined();
  });

  it("does NOT trigger when verboseRatio is null (no data)", () => {
    const metrics = makeMetrics({
      behavior: { verboseRatio: null },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "BHV-007");
    expect(hit).toBeUndefined();
  });
});

// ─── SEC-007: Open DM Policy ──────────────────────────────────────────────────

describe("SEC-007 Open DM Policy", () => {
  it("triggers when channelAllowLists has a channel with value false", () => {
    const metrics = makeMetrics({
      security: {
        channelAllowLists: { "#general": false, "#private": true },
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SEC-007");
    expect(hit).toBeDefined();
  });

  it("does NOT trigger when all channels have allowLists (true)", () => {
    const metrics = makeMetrics({
      security: {
        channelAllowLists: { "#general": true, "#private": true },
      },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SEC-007");
    expect(hit).toBeUndefined();
  });

  it("does NOT trigger when channelAllowLists is empty", () => {
    const metrics = makeMetrics({
      security: { channelAllowLists: {} },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SEC-007");
    expect(hit).toBeUndefined();
  });
});

// ─── SK-001: Token Obesity ────────────────────────────────────────────────────

describe("SK-001 Token Obesity", () => {
  it("triggers when any tool has tokens-per-call exceeding warning threshold (50K)", () => {
    const metrics = makeMetrics({
      skill: { tokenPerToolCall: { search: 80_000 } },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-001");
    expect(hit).toBeDefined();
  });

  it("does NOT trigger when tokenPerToolCall is empty", () => {
    const metrics = makeMetrics({
      skill: { tokenPerToolCall: {} },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-001");
    expect(hit).toBeUndefined();
  });
});

// ─── SK-009: Context Overflow ─────────────────────────────────────────────────

describe("SK-009 Context Overflow", () => {
  it("triggers when any contextTokenRatio entry exceeds warning threshold (0.30)", () => {
    const metrics = makeMetrics({
      skill: { contextTokenRatio: { "analyze-tool": 0.45 } },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-009");
    expect(hit).toBeDefined();
  });

  it("does NOT trigger when contextTokenRatio is empty", () => {
    const metrics = makeMetrics({
      skill: { contextTokenRatio: {} },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const hit = results.find((r) => r.diseaseId === "SK-009");
    expect(hit).toBeUndefined();
  });
});

// ─── Confidence: critical vs warning ─────────────────────────────────────────

describe("Confidence levels", () => {
  it("critical severity has higher confidence than warning for same disease", () => {
    const criticalMetrics = makeMetrics({ memory: { fileCount: 300 } }); // > 200 critical
    const warningMetrics = makeMetrics({ memory: { fileCount: 80 } });   // > 50 warning

    const criticalResults = evaluateRules(criticalMetrics, DEFAULT_CONFIG, registry);
    const warningResults = evaluateRules(warningMetrics, DEFAULT_CONFIG, registry);

    const critical = criticalResults.find((r) => r.diseaseId === "MEM-003");
    const warning = warningResults.find((r) => r.diseaseId === "MEM-003");

    expect(critical).toBeDefined();
    expect(warning).toBeDefined();
    expect(critical!.confidence).toBeGreaterThan(warning!.confidence);
  });
});
