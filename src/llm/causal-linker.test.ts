// ═══════════════════════════════════════════════
//  Causal Chain Linker Tests (TDD)
// ═══════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { parseCausalChains } from "./causal-linker.js";
import type { DiseaseInstance } from "../types/domain.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDisease(
  id: string,
  definitionId: string,
  severity: DiseaseInstance["severity"] = "warning",
): DiseaseInstance {
  return {
    id,
    definitionId,
    severity,
    evidence: [],
    confidence: 0.85,
    firstDetectedAt: Date.now() - 3600_000,
    lastSeenAt: Date.now(),
    status: "active",
    context: {},
  };
}

// ─── Well-formed input ────────────────────────────────────────────────────────

describe("parseCausalChains - well-formed input", () => {
  it("parses a well-formed response into CausalChain objects", () => {
    const diseases = [
      makeDisease("inst-001", "MEM-001"),
      makeDisease("inst-002", "SK-002"),
      makeDisease("inst-003", "BEH-003"),
    ];

    const raw = [
      {
        name: "Memory Overflow Chain",
        rootCause: "inst-001",
        chain: ["inst-001", "inst-002", "inst-003"],
        impact: "Agent loses context across sessions",
      },
    ];

    const result = parseCausalChains(raw, diseases);

    expect(result).toHaveLength(1);
    const chain = result[0];

    expect(typeof chain.id).toBe("string");
    expect(chain.id.length).toBeGreaterThan(0);

    expect(chain.name).toEqual({ en: "Memory Overflow Chain" });
    expect(chain.impact).toEqual({ en: "Agent loses context across sessions" });

    expect(chain.rootCause.diseaseId).toBe("MEM-001");
    expect(chain.rootCause.instanceId).toBe("inst-001");

    expect(chain.chain).toHaveLength(3);
    expect(chain.chain[0].diseaseId).toBe("MEM-001");
    expect(chain.chain[0].instanceId).toBe("inst-001");
    expect(chain.chain[1].diseaseId).toBe("SK-002");
    expect(chain.chain[1].instanceId).toBe("inst-002");
    expect(chain.chain[2].diseaseId).toBe("BEH-003");
    expect(chain.chain[2].instanceId).toBe("inst-003");
  });

  it("leaves unifiedPrescription undefined", () => {
    const diseases = [makeDisease("inst-a", "SK-001"), makeDisease("inst-b", "SK-002")];
    const raw = [
      {
        name: "Test Chain",
        rootCause: "inst-a",
        chain: ["inst-a", "inst-b"],
        impact: "Some impact",
      },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result[0].unifiedPrescription).toBeUndefined();
  });

  it("assigns unique IDs to each chain", () => {
    const diseases = [
      makeDisease("inst-x", "SK-001"),
      makeDisease("inst-y", "SK-002"),
      makeDisease("inst-z", "SK-003"),
    ];
    const raw = [
      { name: "Chain A", rootCause: "inst-x", chain: ["inst-x", "inst-y"], impact: "Impact A" },
      { name: "Chain B", rootCause: "inst-y", chain: ["inst-y", "inst-z"], impact: "Impact B" },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result).toHaveLength(2);
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("parses multiple chains", () => {
    const diseases = [
      makeDisease("d1", "A-001"),
      makeDisease("d2", "A-002"),
      makeDisease("d3", "B-001"),
      makeDisease("d4", "B-002"),
    ];
    const raw = [
      { name: "Chain 1", rootCause: "d1", chain: ["d1", "d2"], impact: "Impact 1" },
      { name: "Chain 2", rootCause: "d3", chain: ["d3", "d4"], impact: "Impact 2" },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result).toHaveLength(2);
    expect(result[0].name.en).toBe("Chain 1");
    expect(result[1].name.en).toBe("Chain 2");
  });
});

// ─── Null / malformed input ───────────────────────────────────────────────────

describe("parseCausalChains - null / malformed input", () => {
  it("returns empty array for null input", () => {
    const diseases = [makeDisease("inst-a", "SK-001"), makeDisease("inst-b", "SK-002")];
    expect(parseCausalChains(null, diseases)).toEqual([]);
  });

  it("returns empty array for empty array input", () => {
    const diseases = [makeDisease("inst-a", "SK-001")];
    expect(parseCausalChains([], diseases)).toEqual([]);
  });

  it("filters out chain entries with missing name field", () => {
    const diseases = [makeDisease("inst-a", "SK-001"), makeDisease("inst-b", "SK-002")];
    const raw = [
      { rootCause: "inst-a", chain: ["inst-a", "inst-b"], impact: "Impact" },
    ] as Array<{ name: string; rootCause: string; chain: string[]; impact: string }>;

    const result = parseCausalChains(raw, diseases);
    expect(result).toHaveLength(0);
  });

  it("filters out chain entries with non-array chain field", () => {
    const diseases = [makeDisease("inst-a", "SK-001")];
    const raw = [
      { name: "Bad Chain", rootCause: "inst-a", chain: "inst-a" as unknown as string[], impact: "Impact" },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result).toHaveLength(0);
  });

  it("filters out null entries within the raw array", () => {
    const diseases = [makeDisease("inst-a", "SK-001"), makeDisease("inst-b", "SK-002")];
    const raw = [
      null,
      { name: "Valid Chain", rootCause: "inst-a", chain: ["inst-a", "inst-b"], impact: "Impact" },
    ] as Array<{ name: string; rootCause: string; chain: string[]; impact: string }>;

    const result = parseCausalChains(raw, diseases);
    // null entry filtered, valid entry kept
    expect(result).toHaveLength(1);
    expect(result[0].name.en).toBe("Valid Chain");
  });
});

// ─── Non-existent disease IDs ─────────────────────────────────────────────────

describe("parseCausalChains - chains with non-existent disease IDs", () => {
  it("filters out chains whose chain[] references a non-existent disease ID", () => {
    const diseases = [makeDisease("inst-real", "SK-001")];
    const raw = [
      {
        name: "Bad Chain",
        rootCause: "inst-real",
        chain: ["inst-real", "inst-phantom"],
        impact: "Impact",
      },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result).toHaveLength(0);
  });

  it("keeps chains where all IDs exist, drops chains where any ID is missing", () => {
    const diseases = [
      makeDisease("inst-a", "SK-001"),
      makeDisease("inst-b", "SK-002"),
    ];
    const raw = [
      { name: "Good Chain", rootCause: "inst-a", chain: ["inst-a", "inst-b"], impact: "Impact" },
      { name: "Bad Chain", rootCause: "inst-a", chain: ["inst-a", "inst-c"], impact: "Impact" },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result).toHaveLength(1);
    expect(result[0].name.en).toBe("Good Chain");
  });

  it("returns empty when diseases array is empty", () => {
    const raw = [
      { name: "Chain", rootCause: "inst-a", chain: ["inst-a", "inst-b"], impact: "Impact" },
    ];

    const result = parseCausalChains(raw, []);
    expect(result).toHaveLength(0);
  });
});

// ─── Single-element chains ────────────────────────────────────────────────────

describe("parseCausalChains - single-element chains", () => {
  it("filters out single-element chains", () => {
    const diseases = [makeDisease("inst-a", "SK-001")];
    const raw = [
      { name: "Single", rootCause: "inst-a", chain: ["inst-a"], impact: "Impact" },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result).toHaveLength(0);
  });

  it("keeps two-element chains (minimum valid length)", () => {
    const diseases = [makeDisease("inst-a", "SK-001"), makeDisease("inst-b", "SK-002")];
    const raw = [
      { name: "Two-step", rootCause: "inst-a", chain: ["inst-a", "inst-b"], impact: "Impact" },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result).toHaveLength(1);
  });

  it("filters empty chain arrays", () => {
    const diseases = [makeDisease("inst-a", "SK-001")];
    const raw = [
      { name: "Empty", rootCause: "inst-a", chain: [], impact: "Impact" },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result).toHaveLength(0);
  });
});

// ─── rootCause normalization ──────────────────────────────────────────────────

describe("parseCausalChains - rootCause normalization", () => {
  it("normalizes rootCause to first chain element when they differ", () => {
    const diseases = [
      makeDisease("inst-first", "MEM-001"),
      makeDisease("inst-second", "SK-002"),
      makeDisease("inst-mismatch", "BEH-003"),
    ];

    const raw = [
      {
        name: "Mismatched Root",
        // rootCause declared as inst-mismatch, but chain starts with inst-first
        rootCause: "inst-mismatch",
        chain: ["inst-first", "inst-second"],
        impact: "Impact",
      },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result).toHaveLength(1);

    // rootCause should be normalised to first chain element (inst-first / MEM-001)
    expect(result[0].rootCause.instanceId).toBe("inst-first");
    expect(result[0].rootCause.diseaseId).toBe("MEM-001");
  });

  it("keeps rootCause unchanged when it matches the first chain element", () => {
    const diseases = [makeDisease("inst-a", "SK-001"), makeDisease("inst-b", "SK-002")];
    const raw = [
      { name: "Aligned Root", rootCause: "inst-a", chain: ["inst-a", "inst-b"], impact: "Impact" },
    ];

    const result = parseCausalChains(raw, diseases);
    expect(result[0].rootCause.instanceId).toBe("inst-a");
    expect(result[0].rootCause.diseaseId).toBe("SK-001");
  });

  it("drops chain when rootCause mismatch references a non-existent disease but chain IDs all exist", () => {
    // The mismatch normalisation picks the first chain element, which does exist,
    // so the chain should still be kept (normalization rescues it).
    const diseases = [makeDisease("inst-a", "SK-001"), makeDisease("inst-b", "SK-002")];
    const raw = [
      {
        name: "Rescue Case",
        rootCause: "inst-phantom",  // phantom — but chain is valid
        chain: ["inst-a", "inst-b"],
        impact: "Impact",
      },
    ];

    const result = parseCausalChains(raw, diseases);
    // Chain IDs all exist → chain kept, rootCause normalised to inst-a
    expect(result).toHaveLength(1);
    expect(result[0].rootCause.instanceId).toBe("inst-a");
  });
});
