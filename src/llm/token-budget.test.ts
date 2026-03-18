// ═══════════════════════════════════════════════
//  Token Budget Tests
//  TDD coverage for truncateForBudget
// ═══════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { truncateForBudget } from "./token-budget.js";
import type { TruncatableInput } from "./token-budget.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal MetricSet-shaped object for testing. */
function makeMetrics(
  tokensBySessionCount = 5,
  topErrorToolsCount = 2,
  errorMessagesPerTool = 3,
) {
  return {
    cost: {
      tokensBySession: Array.from({ length: tokensBySessionCount }, (_, i) => ({
        sessionKey: `session-${i}`,
        tokens: 1000 * (i + 1),
      })),
    },
    skill: {
      topErrorTools: Array.from({ length: topErrorToolsCount }, (_, i) => ({
        tool: `tool-${i}`,
        errorCount: i + 1,
        errorMessages: Array.from(
          { length: errorMessagesPerTool },
          (__, j) => `Error message ${j} for tool-${i} with some detail`,
        ),
      })),
    },
  };
}

/** Estimate tokens the same way the implementation does. */
function estimateTokens(data: unknown): number {
  return JSON.stringify(data).length / 4;
}

/** Build a small input that is comfortably under a given budget. */
function makeSmallInput(): TruncatableInput {
  return {
    suspects: [{ diseaseId: "SK-001", status: "suspect" }],
    samples: [{ sessionKey: "s1", messageCount: 5, toolCallSequence: [] }],
    metrics: makeMetrics(2, 1, 1) as unknown as TruncatableInput["metrics"],
  };
}

// ─── Pass-through (under budget) ─────────────────────────────────────────────

describe("truncateForBudget - passes through data under budget", () => {
  it("returns input unchanged when already under budget", () => {
    const input = makeSmallInput();
    const tokens = estimateTokens(input);
    // Use a budget comfortably above the actual size.
    const result = truncateForBudget(input, tokens + 500);
    expect(result).toEqual(input);
  });

  it("returns the same object reference when under budget (no allocation)", () => {
    const input = makeSmallInput();
    const tokens = estimateTokens(input);
    const result = truncateForBudget(input, tokens + 500);
    // Should be the exact same reference (pass-through).
    expect(result).toBe(input);
  });

  it("does not mutate the original input", () => {
    const input = makeSmallInput();
    const originalJson = JSON.stringify(input);
    const tokens = estimateTokens(input);
    truncateForBudget(input, Math.floor(tokens / 2)); // force truncation
    expect(JSON.stringify(input)).toBe(originalJson);
  });
});

// ─── Drop raw samples first ───────────────────────────────────────────────────

describe("truncateForBudget - drops raw samples first when over budget", () => {
  it("reduces samples array before touching metrics", () => {
    // Build a large samples array to push over budget.
    const bigSamples = Array.from({ length: 200 }, (_, i) => ({
      sessionKey: `session-${i}`,
      messageCount: 10,
      toolCallSequence: Array.from({ length: 5 }, (__, j) => ({
        toolName: `tool-${j}`,
        success: true,
      })),
    }));

    const input: TruncatableInput = {
      suspects: [{ diseaseId: "SK-001" }],
      samples: bigSamples,
      metrics: makeMetrics(2, 1, 1) as unknown as TruncatableInput["metrics"],
    };

    const fullTokens = estimateTokens(input);
    // Budget at 50% of full size to force truncation.
    const budget = Math.floor(fullTokens * 0.5);

    const result = truncateForBudget(input, budget);

    // Samples should be shorter.
    expect(result.samples!.length).toBeLessThan(bigSamples.length);

    // Suspects must still be present and intact.
    expect(result.suspects).toEqual(input.suspects);

    // Result must be within budget.
    expect(estimateTokens(result)).toBeLessThanOrEqual(budget);
  });

  it("drops all samples if necessary to reach budget", () => {
    const bigSamples = Array.from({ length: 50 }, (_, i) => ({
      sessionKey: `session-${i}`,
      messageCount: 20,
      toolCallSequence: Array.from({ length: 20 }, (__, j) => ({
        toolName: `tool-${j}`,
        success: false,
        errorSummary: `Error detail for step ${j} in session ${i} — very long message`,
      })),
    }));

    const input: TruncatableInput = {
      suspects: [{ diseaseId: "SK-001" }],
      samples: bigSamples,
    };

    // Tiny budget to force all samples to be dropped.
    const result = truncateForBudget(input, 10);

    expect(result.samples).toEqual([]);
    // Suspects still present.
    expect(result.suspects).toEqual(input.suspects);
  });
});

// ─── Truncate MetricSet details ───────────────────────────────────────────────

describe("truncateForBudget - truncates MetricSet details (nested structure)", () => {
  it("truncates cost.tokensBySession to max 10 entries", () => {
    // Build a large tokensBySession to push over budget.
    const largeMetrics = {
      cost: {
        tokensBySession: Array.from({ length: 100 }, (_, i) => ({
          sessionKey: `session-${i}`,
          tokens: 50000 + i,
        })),
      },
      skill: {
        topErrorTools: [],
      },
    };

    const input: TruncatableInput = {
      suspects: [{ diseaseId: "SK-001" }],
      metrics: largeMetrics as unknown as TruncatableInput["metrics"],
    };

    const fullTokens = estimateTokens(input);
    // Budget just below cost of having all 100 sessions.
    const budget = Math.floor(fullTokens * 0.5);

    const result = truncateForBudget(input, budget);

    expect(result.metrics!.cost.tokensBySession.length).toBeLessThanOrEqual(10);
    // Suspects untouched.
    expect(result.suspects).toEqual(input.suspects);
  });

  it("drops skill.topErrorTools errorMessages (sets to empty array)", () => {
    const largeMetrics = {
      cost: {
        tokensBySession: Array.from({ length: 5 }, (_, i) => ({
          sessionKey: `session-${i}`,
          tokens: 100,
        })),
      },
      skill: {
        topErrorTools: Array.from({ length: 20 }, (_, i) => ({
          tool: `tool-${i}`,
          errorCount: i + 1,
          errorMessages: Array.from(
            { length: 50 },
            (__, j) =>
              `Very long error message ${j} for tool ${i}: something went wrong in the runtime at step X`,
          ),
        })),
      },
    };

    const input: TruncatableInput = {
      suspects: [{ diseaseId: "SK-001" }],
      metrics: largeMetrics as unknown as TruncatableInput["metrics"],
    };

    const fullTokens = estimateTokens(input);
    const budget = Math.floor(fullTokens * 0.3);

    const result = truncateForBudget(input, budget);

    // All errorMessages arrays should be empty after truncation.
    for (const entry of result.metrics!.skill.topErrorTools) {
      expect(entry.errorMessages).toEqual([]);
    }
    // Suspects untouched.
    expect(result.suspects).toEqual(input.suspects);
  });

  it("never drops the suspect list", () => {
    const suspects = [
      { diseaseId: "SK-001", status: "suspect" },
      { diseaseId: "MEM-002", status: "suspect" },
      { diseaseId: "COST-003", status: "suspect" },
    ];

    const input: TruncatableInput = {
      suspects,
      samples: Array.from({ length: 500 }, (_, i) => ({
        sessionKey: `session-${i}`,
        messageCount: 30,
        toolCallSequence: [],
      })),
      metrics: makeMetrics(100, 30, 100) as unknown as TruncatableInput["metrics"],
    };

    // Tiny budget to force maximum truncation.
    const result = truncateForBudget(input, 10);

    expect(result.suspects).toEqual(suspects);
  });
});
