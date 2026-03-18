# ClawDoc Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend ClawDoc with LLM-powered deep diagnosis (16 hybrid/LLM diseases + cross-department causal chains), a full prescription lifecycle (generate/preview/apply/rollback/follow-up), a Web Dashboard (Hono + Preact SPA with 9 pages), and an OpenClaw Plugin for real-time event streaming.

**Architecture:** Four subsystems built on Phase 1's foundation (261 tests, 43 disease definitions, snapshot collector, rule engine, health scorer). LLM Analyzer plugs into the existing analysis pipeline between Rule Engine and Health Scorer. Prescription Engine operates on DiseaseInstance outputs. Dashboard is a standalone Hono server serving a bundled SPA that queries the same SQLite store. Plugin registers OpenClaw hooks to stream events into persistent SQLite.

**Tech Stack:** Phase 1 stack + Hono (dashboard server), Preact + HTM (SPA, no build step), Chart.js (charts), Anthropic SDK or fetch-based LLM calls (reuse OpenClaw model config).

**Spec:** `docs/2026-03-17-clawdoc-design.md` — sections §5.3 (Stream Collector), §6.1.1 (RawSampleProvider), §6.4 (LLM Analyzer), §6.5 (Cross-Department Linker), §7 (Prescription System), §9.3 (Web Dashboard).

**Phase 1 codebase (read these for integration):**
- `src/analysis/analysis-pipeline.ts` — runCheckup(), CheckupResult
- `src/analysis/rule-engine.ts` — evaluateRules(), RuleResult
- `src/analysis/metric-aggregator.ts` — aggregateMetrics(), MetricSet
- `src/analysis/health-scorer.ts` — scoring functions
- `src/store/` — database.ts, event-store.ts, diagnosis-store.ts, score-store.ts
- `src/types/` — domain.ts, events.ts, config.ts, scoring.ts
- `src/diseases/registry.ts` — DiseaseRegistry with all 43 diseases
- `src/config/loader.ts` — loadConfig()
- `src/commands/checkup.ts` — CLI checkup command
- `src/i18n/` — t(), UI_STRINGS

---

## Pre-Task 0: New Type Definitions

Before any implementation, add all Phase 2 types to `src/types/domain.ts`:

```typescript
// ─── Phase 2 types (add to domain.ts) ───

export interface CausalChain {
  id: string;
  name: I18nString;
  rootCause: DiagnosisRef;
  chain: DiagnosisRef[];
  impact: I18nString;
  unifiedPrescription?: Prescription;  // optional: populated by Prescription Engine after causal analysis
  // Pipeline order: Rule Engine → LLM Analyzer (creates chain without Rx) → Prescription Engine (fills Rx)
}

export interface PrescriptionPreview {
  prescriptionId: string;
  diagnosisName: I18nString;
  actions: Array<{
    description: I18nString;
    type: PrescriptionAction["type"];
    diff?: string;
    command?: string;
    risk: "low" | "medium" | "high";
  }>;
  estimatedImprovement: I18nString;
  rollbackAvailable: boolean;
}

export interface ExecutionResult {
  success: boolean;
  appliedActions: Array<{
    action: PrescriptionAction;
    status: "applied" | "failed" | "skipped";
    error?: string;
  }>;
  backup: PrescriptionBackup;
  preApplyMetrics: MetricSnapshot;
  immediateVerification: VerificationResult;
}

export interface PrescriptionBackup {
  id: string;
  prescriptionId: string;
  createdAt: number;
  entries: Array<{
    type: "file_content" | "config_snapshot";
    path: string;
    originalContent: string;
    preApplyHash: string;
    postApplyHash: string;
  }>;
}

export interface FollowUpResult {
  prescriptionId: string;
  diagnosisId: string;
  timeSinceApplied: number;
  comparison: {
    before: MetricSnapshot;
    after: MetricSnapshot;
    improvement: Record<string, { from: number; to: number; changePercent: number }>;
  };
  verdict: FollowUpVerdict;
}

export type FollowUpVerdict =
  | { status: "resolved"; message: I18nString }
  | { status: "improving"; message: I18nString }
  | { status: "unchanged"; message: I18nString }
  | { status: "worsened"; message: I18nString; suggestRollback: boolean };
```

Also add to `src/store/database.ts` migration v2: a `causal_chains` table for persisting causal chain results:

```sql
CREATE TABLE IF NOT EXISTS causal_chains (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  name_json   TEXT NOT NULL,
  root_cause_json TEXT NOT NULL,
  chain_json  TEXT NOT NULL,
  impact_json TEXT NOT NULL,
  prescription_id TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_causal_agent ON causal_chains(agent_id);
```

Update `CURRENT_SCHEMA_VERSION` to 2 and add the migration.

Commit:
```bash
git add src/types/domain.ts src/store/database.ts
git commit -m "feat: add Phase 2 types (CausalChain, PrescriptionBackup, ExecutionResult, FollowUpResult) and schema v2"
```

---

## File Structure (Phase 2 additions)

```
src/
├── llm/
│   ├── llm-client.ts              # LLM API client (Anthropic SDK / OpenClaw config reuse)
│   ├── llm-client.test.ts
│   ├── llm-analyzer.ts            # 3-round LLM analysis (scan → deep → causal)
│   ├── llm-analyzer.test.ts
│   ├── prompts.ts                 # System prompt + round-specific prompt templates
│   ├── token-budget.ts            # Token budget enforcement + truncation
│   ├── token-budget.test.ts
│   ├── causal-linker.ts           # Cross-department causal chain inference
│   └── causal-linker.test.ts
├── raw-samples/
│   ├── raw-sample-provider.ts     # RawSampleProvider: live filesystem reads
│   └── raw-sample-provider.test.ts
├── prescription/
│   ├── prescription-generator.ts  # LLM-based prescription generation
│   ├── prescription-generator.test.ts
│   ├── prescription-executor.ts   # preview / apply / rollback
│   ├── prescription-executor.test.ts
│   # NOTE: prescription-store lives at src/store/prescription-store.ts (follows existing convention)
│   ├── backup.ts                  # Backup creation + conflict detection
│   ├── backup.test.ts
│   ├── followup.ts                # Follow-up scheduling + verdict computation
│   └── followup.test.ts
├── plugin/
│   ├── plugin.ts                  # OpenClawPluginDefinition entry point
│   ├── stream-collector.ts        # Hook registrations → event buffering → SQLite flush
│   ├── stream-collector.test.ts
│   ├── event-buffer.ts            # In-memory buffer with periodic flush
│   ├── event-buffer.test.ts
│   ├── summarize.ts               # summarizeParams(), summarizeResult(), redactAndTruncate()
│   └── summarize.test.ts
├── dashboard/
│   ├── server.ts                  # Hono app: API routes + static SPA serving
│   ├── server.test.ts
│   ├── api/
│   │   ├── health.ts              # GET /api/health
│   │   ├── diseases.ts            # GET /api/diseases, GET /api/diseases/:id
│   │   ├── prescriptions.ts       # GET/POST /api/prescriptions/*
│   │   ├── metrics.ts             # GET /api/metrics/:dept
│   │   ├── trends.ts              # GET /api/trends
│   │   ├── events.ts              # GET /api/events
│   │   ├── causal-chains.ts       # GET /api/causal-chains
│   │   ├── config-api.ts          # GET/PUT /api/config
│   │   ├── skills.ts              # GET /api/skills
│   │   ├── memory.ts              # GET /api/memory
│   │   └── auth.ts                # Bearer token auth middleware
│   └── public/
│       └── index.html             # Single-file SPA (Preact + HTM + Chart.js inline)
├── commands/
│   ├── rx-cmd.ts                  # clawdoc rx list/preview/apply/rollback/followup/history
│   └── dashboard-cmd.ts           # clawdoc dashboard [--port]
├── store/
│   ├── prescription-store.ts      # Prescription + followup persistence helpers (follows existing store convention)
│   ├── prescription-store.test.ts
│   └── causal-chain-store.ts      # CausalChain persistence
└── (modify existing)
    ├── types/domain.ts                # Add CausalChain, PrescriptionBackup, ExecutionResult, FollowUpResult, FollowUpVerdict
    ├── store/database.ts              # Schema v2 migration (causal_chains table)
    ├── analysis/analysis-pipeline.ts  # Add LLM analyzer step when noLlm=false; add llmDegradationReason to CheckupResult
    ├── analysis/rule-engine.ts        # Extend evaluateRules to evaluate hybrid disease preFilters (return as "suspect")
    ├── commands/checkup.ts            # Remove noLlm hardcode, support --no-llm flag
    ├── bin.ts                         # Register rx and dashboard commands
    └── package.json                   # Add ./plugin exports entry
```

---

## Dependency Graph & Parallelism

```
Round 1 (3-way parallel — independent file sets, no shared modifications):
  Track A → Tasks 1-4: LLM Analyzer (client, prompts, analyzer, causal linker)
  Track B → Tasks 5-8: Dashboard (server, API routes, SPA, API tests)
  Track C → Tasks 9-10: Plugin utilities (summarize, event buffer)
  NOTE: Task 11 (Plugin entry) deferred to Round 2 — it needs Dashboard route from Task 5/6

Round 2 (2-way parallel — after Round 1):
  Agent A → Task 11: Plugin entry (needs Tasks 5, 10)
  Agent B → Task 12: Prescription Engine (needs Tasks 1-3)

Round 3 (serial — integration):
  Task 13: Pipeline Integration (wire LLM + hybrid preFilter into analysis pipeline, update checkup CLI)
  Task 14: CLI Commands (rx commands, dashboard command)
  Task 15: E2E + Final Integration Tests
```

---

## Track A: LLM Analyzer

### Task 1: LLM Client + RawSampleProvider

**Files:**
- Create: `src/llm/llm-client.ts`
- Create: `src/llm/llm-client.test.ts`
- Create: `src/raw-samples/raw-sample-provider.ts`
- Create: `src/raw-samples/raw-sample-provider.test.ts`

- [ ] **Step 1: Write failing test for LLM client**

```typescript
// src/llm/llm-client.test.ts
import { describe, it, expect, vi } from "vitest";
import { createLLMClient } from "./llm-client.js";

describe("LLMClient", () => {
  it("sends structured prompt and parses JSON response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: "text", text: JSON.stringify([
          { diseaseId: "SK-002", status: "confirmed", severity: "warning", confidence: 0.85, evidence: [], rootCause: "test" }
        ])}],
        usage: { input_tokens: 500, output_tokens: 200 },
      }),
    });

    const client = createLLMClient({ apiKey: "test-key", model: "claude-sonnet-4-20250514", fetch: mockFetch });
    const result = await client.analyze("system prompt", "user prompt");

    expect(result.diagnoses).toHaveLength(1);
    expect(result.diagnoses[0].diseaseId).toBe("SK-002");
    expect(result.tokensUsed).toEqual({ input: 500, output: 200 });
  });

  it("returns empty diagnoses on malformed JSON response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: "text", text: "not valid json {{{" }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });

    const client = createLLMClient({ apiKey: "test-key", model: "claude-sonnet-4-20250514", fetch: mockFetch });
    const result = await client.analyze("system", "user");

    expect(result.diagnoses).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it("handles network failure gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = createLLMClient({ apiKey: "test-key", model: "claude-sonnet-4-20250514", fetch: mockFetch });
    const result = await client.analyze("system", "user");

    expect(result.diagnoses).toHaveLength(0);
    expect(result.error).toContain("ECONNREFUSED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/llm/llm-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement LLM client**

```typescript
// src/llm/llm-client.ts
export interface LLMClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;              // default: https://api.anthropic.com
  fetch?: typeof globalThis.fetch; // injectable for testing
}

export interface LLMDiagnosis {
  diseaseId: string;
  status: "confirmed" | "ruled_out" | "inconclusive";
  severity?: Severity;
  confidence: number;
  evidence: Array<{ description: string; dataReference?: string }>;  // plain strings from LLM
  rootCause?: string;
}

// When merging into DiseaseInstance, convert evidence descriptions:
// LLMDiagnosis.evidence[i].description (string) → Evidence.description ({ en: string })
// This mapping is done in analysis-pipeline.ts Task 13 integration step.

export interface LLMResult {
  diagnoses: LLMDiagnosis[];
  tokensUsed: { input: number; output: number };
  error?: string;
}

export function createLLMClient(opts: LLMClientOptions) {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? "https://api.anthropic.com";

  return {
    async analyze(systemPrompt: string, userPrompt: string): Promise<LLMResult> {
      try {
        const response = await fetchFn(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": opts.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
          }),
        });

        if (!response.ok) {
          return { diagnoses: [], tokensUsed: { input: 0, output: 0 }, error: `HTTP ${response.status}` };
        }

        const data = await response.json();
        const text = data.content?.[0]?.text ?? "";
        const tokensUsed = {
          input: data.usage?.input_tokens ?? 0,
          output: data.usage?.output_tokens ?? 0,
        };

        try {
          const diagnoses = JSON.parse(text) as LLMDiagnosis[];
          return { diagnoses: Array.isArray(diagnoses) ? diagnoses : [], tokensUsed };
        } catch {
          return { diagnoses: [], tokensUsed, error: "Failed to parse LLM JSON response" };
        }
      } catch (err: any) {
        return { diagnoses: [], tokensUsed: { input: 0, output: 0 }, error: err.message };
      }
    },
  };
}

// Resolve LLM config: OpenClaw config → ClawDoc config override → env var fallback
export function resolveLLMConfig(config: ClawDocConfig): LLMClientOptions | null {
  if (!config.llm.enabled) return null;

  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENCLAW_API_KEY ?? "";
  if (!apiKey) return null;

  return {
    apiKey,
    model: config.llm.model ?? "claude-sonnet-4-20250514",
  };
}
```

- [ ] **Step 4: Write and implement RawSampleProvider**

```typescript
// src/raw-samples/raw-sample-provider.ts
// Reads live filesystem data for LLM analysis (never persisted)
// See spec §6.1.1
export interface RawSampleProvider {
  getRecentSessionSamples(agentId: string, limit: number): Promise<SessionSample[]>;
  getMemoryFileContents(limit: number, maxTokensPerFile: number): Promise<MemoryFileSample[]>;
  getSkillDefinitions(pluginIds: string[]): Promise<SkillDefinitionSample[]>;
}
```

IMPORTANT: RawSampleProvider CANNOT reuse the existing session-parser or memory-scanner directly. Those return privacy-redacted event summaries (paramsSummary with types only, no values). RawSampleProvider needs separate parsing logic:
- `getRecentSessionSamples()`: re-parse JSONL files but extract structural data (tool call sequences with error summaries) without the privacy redaction. Apply redactPatterns to error messages only.
- `getMemoryFileContents()`: read actual file content (not just metadata) truncated to maxTokensPerFile. This is a new fs.readFileSync operation, not a reuse of the scanner.
- `getSkillDefinitions()`: read plugin source code files for security analysis. New operation.

- [ ] **Step 5: Run all tests, verify pass**

Run: `pnpm test src/llm/ src/raw-samples/`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/llm/llm-client.ts src/llm/llm-client.test.ts src/raw-samples/
git commit -m "feat: add LLM client with Anthropic API + RawSampleProvider for live data"
```

---

### Task 2: Prompt Templates + Token Budget

**Files:**
- Create: `src/llm/prompts.ts`
- Create: `src/llm/token-budget.ts`
- Create: `src/llm/token-budget.test.ts`

- [ ] **Step 1: Write failing test for token budget**

```typescript
// src/llm/token-budget.test.ts
import { describe, it, expect } from "vitest";
import { truncateForBudget } from "./token-budget.js";

describe("TokenBudget", () => {
  it("passes through data under budget", () => {
    const input = { metrics: { small: "data" }, samples: [] };
    const result = truncateForBudget(input, 10000);
    expect(result.metrics).toEqual({ small: "data" });
  });

  it("drops raw samples first when over budget", () => {
    const bigSamples = Array(100).fill({ sessionKey: "s", toolCallSequence: Array(50).fill({ toolName: "t", success: true }) });
    const input = { metrics: { small: "data" }, samples: bigSamples };
    const result = truncateForBudget(input, 2000);
    expect(result.samples.length).toBeLessThan(100);
    expect(result.metrics).toBeDefined(); // metrics preserved
  });

  it("truncates MetricSet details when samples gone and still over budget", () => {
    const bigMetrics = {
      cost: { tokensBySession: Array(500).fill({ sessionKey: "s", tokens: 100 }), dailyTrend: [] },
      skill: { topErrorTools: Array(200).fill({ tool: "t", errorCount: 1, errorMessages: ["error ".repeat(20)] }) },
    };
    const result = truncateForBudget({ metrics: bigMetrics, samples: [] }, 3000);
    expect(result.metrics.cost.tokensBySession.length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Implement prompts.ts**

Transcribe the system prompt and round-specific templates from spec §6.4:

```typescript
// src/llm/prompts.ts
export const DIAGNOSIS_SYSTEM_PROMPT = `You are ClawDoc, an AI agent health diagnostics engine.
You analyze OpenClaw agent runtime data to detect health issues.

OUTPUT FORMAT: JSON array of diagnosis objects.
Each diagnosis MUST include:
- diseaseId: the disease code being confirmed or ruled out
- status: "confirmed" | "ruled_out" | "inconclusive"
- severity: "critical" | "warning" | "info" (only if confirmed)
- confidence: 0.0-1.0
- evidence: array of { description, dataReference }
- rootCause: brief root cause analysis (only if confirmed)

RULES:
- Only confirm a disease when evidence clearly supports it
- Prefer "inconclusive" over false positives
- Reference specific data points in evidence
- Consider cross-symptom relationships`;

export function buildRound1Prompt(suspects: RuleResult[], metrics: MetricSet): string { ... }
export function buildRound2Prompt(confirmed: LLMDiagnosis[], samples: SessionSample[]): string { ... }
export function buildCausalChainPrompt(allDiagnoses: LLMDiagnosis[]): string { ... }
```

- [ ] **Step 3: Implement token-budget.ts**

Per spec §6.4 token budget enforcement: drop raw samples first → MetricSet details → never drop suspect list.

- [ ] **Step 4: Run tests, verify pass, commit**

```bash
git add src/llm/prompts.ts src/llm/token-budget.ts src/llm/token-budget.test.ts
git commit -m "feat: add LLM prompt templates and token budget enforcement"
```

---

### Task 3: LLM Analyzer (3-round analysis)

**Files:**
- Create: `src/llm/llm-analyzer.ts`
- Create: `src/llm/llm-analyzer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/llm/llm-analyzer.test.ts
import { describe, it, expect, vi } from "vitest";
import { analyzeLLM } from "./llm-analyzer.js";

describe("LLMAnalyzer", () => {
  it("runs 3 rounds: scan → deep → causal", async () => {
    const mockClient = {
      analyze: vi.fn()
        .mockResolvedValueOnce({
          // Round 1: confirm SK-002
          diagnoses: [{ diseaseId: "SK-002", status: "confirmed", severity: "warning", confidence: 0.9, evidence: [], rootCause: "test" }],
          tokensUsed: { input: 500, output: 200 },
        })
        .mockResolvedValueOnce({
          // Round 2: deep analysis
          diagnoses: [{ diseaseId: "SK-002", status: "confirmed", severity: "warning", confidence: 0.95, evidence: [{ description: "deep" }], rootCause: "detailed cause" }],
          tokensUsed: { input: 1000, output: 400 },
        })
        .mockResolvedValueOnce({
          // Round 3: causal chain
          diagnoses: [],
          tokensUsed: { input: 500, output: 200 },
        }),
    };

    const result = await analyzeLLM({
      client: mockClient,
      suspects: [{ diseaseId: "SK-002", status: "suspect", severity: "warning", evidence: [], confidence: 0.7 }],
      llmOnlyDiseases: [],
      metrics: {} as any,
      samples: { recentSessions: [], memoryFiles: [], skillDefinitions: [] },
      config: { maxTokensPerCheckup: 50000, maxTokensPerDiagnosis: 10000 },
    });

    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].diseaseId).toBe("SK-002");
    expect(mockClient.analyze).toHaveBeenCalledTimes(3);
    expect(result.totalTokensUsed).toBeGreaterThan(0);
  });

  it("degrades gracefully when LLM fails", async () => {
    const mockClient = {
      analyze: vi.fn().mockResolvedValue({
        diagnoses: [], tokensUsed: { input: 0, output: 0 }, error: "API error",
      }),
    };

    const result = await analyzeLLM({
      client: mockClient,
      suspects: [{ diseaseId: "SK-002", status: "suspect", severity: "warning", evidence: [], confidence: 0.7 }],
      llmOnlyDiseases: [],
      metrics: {} as any,
      samples: { recentSessions: [], memoryFiles: [], skillDefinitions: [] },
      config: { maxTokensPerCheckup: 50000, maxTokensPerDiagnosis: 10000 },
    });

    expect(result.confirmed).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it("evaluates LLM-only diseases even with empty suspects", async () => {
    const mockClient = {
      analyze: vi.fn()
        .mockResolvedValueOnce({
          diagnoses: [{ diseaseId: "MEM-001", status: "confirmed", severity: "warning", confidence: 0.8, evidence: [], rootCause: "test" }],
          tokensUsed: { input: 500, output: 200 },
        })
        .mockResolvedValueOnce({ diagnoses: [], tokensUsed: { input: 500, output: 200 } })
        .mockResolvedValueOnce({ diagnoses: [], tokensUsed: { input: 500, output: 200 } }),
    };

    const result = await analyzeLLM({
      client: mockClient,
      suspects: [],  // no suspects from rule engine
      llmOnlyDiseases: [{ id: "MEM-001", detection: { type: "llm" } }],
      metrics: {} as any,
      samples: { recentSessions: [], memoryFiles: [], skillDefinitions: [] },
      config: { maxTokensPerCheckup: 50000, maxTokensPerDiagnosis: 10000 },
    });

    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].diseaseId).toBe("MEM-001");
  });

  it("skips remaining rounds when token budget exceeded", async () => {
    const mockClient = {
      analyze: vi.fn().mockResolvedValue({
        diagnoses: [], tokensUsed: { input: 5000, output: 5000 },
      }),
    };

    const result = await analyzeLLM({
      client: mockClient,
      suspects: [],
      llmOnlyDiseases: [],
      metrics: {} as any,
      samples: { recentSessions: [], memoryFiles: [], skillDefinitions: [] },
      config: { maxTokensPerCheckup: 8000, maxTokensPerDiagnosis: 10000 },
    });

    // Should stop after round 1 since 10000 > 8000 budget
    expect(mockClient.analyze).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Implement llm-analyzer.ts**

3-round pipeline per spec §6.4:
1. Round 1: Quick scan — confirm/rule out suspects + evaluate LLM-only diseases
2. Round 2: Deep analysis — root cause for confirmed diseases (uses RawSampleProvider data)
3. Round 3: Cross-department causal chain inference

- [ ] **Step 3: Run tests, verify pass, commit**

```bash
git add src/llm/llm-analyzer.ts src/llm/llm-analyzer.test.ts
git commit -m "feat: add 3-round LLM analyzer with budget enforcement and degradation"
```

---

### Task 4: Causal Chain Linker + Store

**Files:**
- Create: `src/llm/causal-linker.ts`
- Create: `src/llm/causal-linker.test.ts`
- Create: `src/store/causal-chain-store.ts`
- Create: `src/store/causal-chain-store.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/llm/causal-linker.test.ts
import { describe, it, expect } from "vitest";
import { parseCausalChains } from "./causal-linker.js";

describe("CausalLinker", () => {
  it("parses LLM response into CausalChain objects", () => {
    const llmResponse = [{
      name: "Memory-driven tool selection drift",
      rootCause: "MEM-004",
      chain: ["MEM-004", "SK-002", "CST-001"],
      impact: "Conflicting memory causes tool failures and wasted tokens",
    }];

    const diseases = [
      { id: "d1", definitionId: "MEM-004", severity: "warning" as const },
      { id: "d2", definitionId: "SK-002", severity: "warning" as const },
      { id: "d3", definitionId: "CST-001", severity: "warning" as const },
    ];

    const chains = parseCausalChains(llmResponse, diseases);
    expect(chains).toHaveLength(1);
    expect(chains[0].rootCause.diseaseId).toBe("MEM-004");
    expect(chains[0].chain).toHaveLength(3);
  });

  it("returns empty array for invalid LLM response", () => {
    const chains = parseCausalChains(null, []);
    expect(chains).toEqual([]);
  });

  it("filters out chains referencing non-existent disease IDs", () => {
    const llmResponse = [{ name: "test", rootCause: "FAKE-001", chain: ["FAKE-001", "FAKE-002"], impact: "test" }];
    const chains = parseCausalChains(llmResponse, []);
    expect(chains).toEqual([]); // no matching diseases → chain dropped
  });

  it("filters out single-element chains (no causal relationship)", () => {
    const llmResponse = [{ name: "test", rootCause: "SK-002", chain: ["SK-002"], impact: "test" }];
    const diseases = [{ id: "d1", definitionId: "SK-002", severity: "warning" as const }];
    const chains = parseCausalChains(llmResponse, diseases);
    expect(chains).toEqual([]); // single element = no chain
  });

  it("handles rootCause not matching first chain element", () => {
    const llmResponse = [{ name: "test", rootCause: "CST-001", chain: ["MEM-004", "SK-002", "CST-001"], impact: "test" }];
    const diseases = [
      { id: "d1", definitionId: "MEM-004", severity: "warning" as const },
      { id: "d2", definitionId: "SK-002", severity: "warning" as const },
      { id: "d3", definitionId: "CST-001", severity: "warning" as const },
    ];
    const chains = parseCausalChains(llmResponse, diseases);
    // rootCause should be normalized to the first element in chain
    expect(chains[0].rootCause.diseaseId).toBe("MEM-004");
  });
});
```

- [ ] **Step 2: Implement and test**

`CausalChain` type is already defined in `src/types/domain.ts` (if not, add it). Implement the parser that converts LLM Round 3 output into typed `CausalChain[]`.

- [ ] **Step 3: Commit**

```bash
git add src/llm/causal-linker.ts src/llm/causal-linker.test.ts
git commit -m "feat: add causal chain linker for cross-department diagnosis"
```

---

## Track B: Web Dashboard

### Task 5: Dashboard Server + Auth

**Files:**
- Create: `src/dashboard/server.ts`
- Create: `src/dashboard/server.test.ts`
- Create: `src/dashboard/api/auth.ts`
- Modify: `package.json` (add hono dependency)

- [ ] **Step 1: Install Hono**

```bash
pnpm add hono
```

- [ ] **Step 2: Write failing test**

```typescript
// src/dashboard/server.test.ts
import { describe, it, expect } from "vitest";
import { createDashboardApp } from "./server.js";
import { openDatabase } from "../store/database.js";

describe("Dashboard Server", () => {
  it("serves /api/health endpoint", async () => {
    const db = openDatabase(":memory:");
    const app = createDashboardApp({ db, config: DEFAULT_CONFIG });

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dataMode).toBeDefined();
  });

  it("serves SPA at / for non-API routes", async () => {
    const db = openDatabase(":memory:");
    const app = createDashboardApp({ db, config: DEFAULT_CONFIG });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("rejects write endpoints without auth token", async () => {
    const db = openDatabase(":memory:");
    const app = createDashboardApp({ db, config: DEFAULT_CONFIG, authToken: "secret123" });

    const res = await app.request("/api/config", { method: "PUT", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("allows write endpoints with valid auth token", async () => {
    const db = openDatabase(":memory:");
    const app = createDashboardApp({ db, config: DEFAULT_CONFIG, authToken: "secret123" });

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { Authorization: "Bearer secret123", "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "zh" }),
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Implement server.ts**

```typescript
// src/dashboard/server.ts
import { Hono } from "hono";
import { serve } from "@hono/node-server";

export interface DashboardOptions {
  db: Database;
  config: ClawDocConfig;
  authToken?: string;  // generated on first launch for standalone mode
}

export function createDashboardApp(opts: DashboardOptions): Hono {
  const app = new Hono();

  // Auth middleware for write endpoints
  if (opts.authToken) {
    app.use("/api/*", async (c, next) => {
      if (c.req.method === "GET") return next();
      const auth = c.req.header("Authorization");
      if (auth !== `Bearer ${opts.authToken}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      return next();
    });
  }

  // API routes (registered in Task 6)
  // SPA fallback
  app.get("*", (c) => c.html(SPA_HTML));

  return app;
}

export async function startDashboard(opts: DashboardOptions & { port?: number }) {
  const app = createDashboardApp(opts);
  const port = opts.port ?? 9800;
  serve({ fetch: app.fetch, port });
  return { port, app };
}
```

- [ ] **Step 4: Install @hono/node-server, run tests, commit**

```bash
pnpm add @hono/node-server
git add src/dashboard/ package.json pnpm-lock.yaml
git commit -m "feat: add dashboard Hono server with auth middleware"
```

---

### Task 6: Dashboard API Routes

**Files:**
- Create: `src/dashboard/api/health.ts`
- Create: `src/dashboard/api/diseases.ts`
- Create: `src/dashboard/api/prescriptions.ts`
- Create: `src/dashboard/api/metrics.ts`
- Create: `src/dashboard/api/trends.ts`
- Create: `src/dashboard/api/events.ts`
- Create: `src/dashboard/api/causal-chains.ts`
- Create: `src/dashboard/api/config-api.ts`
- Create: `src/dashboard/api/skills.ts`
- Create: `src/dashboard/api/memory.ts`

Each API route is a Hono route handler that queries the SQLite store. All routes from spec §9.3:

```
GET  /api/health          → HealthScore (latest)
GET  /api/diseases         → DiseaseInstance[] (filterable by dept, severity, status)
GET  /api/diseases/:id     → single DiseaseInstance with evidence
GET  /api/prescriptions    → Prescription[]
POST /api/prescriptions/:id/apply    → ExecutionResult
POST /api/prescriptions/:id/rollback → RollbackResult
GET  /api/prescriptions/:id/followup → FollowUpResult
GET  /api/metrics/:dept    → MetricSet for department
GET  /api/trends           → HealthScore[] time series
GET  /api/events           → ClawDocEvent[] (paginated: ?page=1&limit=50&type=tool_call)
GET  /api/causal-chains    → CausalChain[]
GET  /api/config           → ClawDocConfig
PUT  /api/config           → update config
GET  /api/skills           → PluginSnapshotData
GET  /api/memory           → MemorySnapshotData
```

- [ ] **Step 1: Implement all API route files**

Each file exports a function that registers routes on a Hono app:

```typescript
// src/dashboard/api/health.ts
// NOTE: The API must return the full nested HealthScore shape (with departments as
// Record<Department, DepartmentScore>), not the flat HealthScoreRecord from score-store.
// This requires either:
// (a) Re-running a lightweight checkup to compute the full HealthScore (expensive), or
// (b) Storing the full HealthScore JSON alongside the flat scores in a new column, or
// (c) Reconstructing the nested shape from the flat scores + latest diagnoses.
//
// Approach (c) is chosen: query flat scores + active diagnoses, build HealthScore in memory.
export function registerHealthRoutes(app: Hono, db: Database): void {
  app.get("/api/health", (c) => {
    const scoreStore = createScoreStore(db);
    const diagnosisStore = createDiagnosisStore(db);
    // NOTE: existing queryScoreHistory sorts ASC. Use since/until to get latest,
    // or add a getLatestScore() helper to score-store.ts that uses ORDER BY timestamp DESC LIMIT 1.
    const latestScores = scoreStore.queryLatestScore("default");
    if (latestScores.length === 0) return c.json({ error: "No health data" }, 404);

    const activeDiseases = diagnosisStore.queryDiagnoses({ agentId: "default", status: "active" });
    const healthScore = reconstructHealthScore(latestScores[0], activeDiseases);
    return c.json(healthScore);
  });
}

// reconstructHealthScore: takes flat HealthScoreRecord + DiseaseInstance[] →
// builds nested HealthScore with departments: Record<Department, DepartmentScore>
function reconstructHealthScore(record: HealthScoreRecord, diseases: DiseaseInstance[]): HealthScore { ... }
```
```

- [ ] **Step 2: Write API integration tests**

Test each endpoint against an in-memory DB seeded with fixture data.

- [ ] **Step 3: Wire all routes into server.ts**

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/api/
git commit -m "feat: add all 14 dashboard API routes"
```

---

### Task 7: Dashboard SPA (Single-File Preact + Chart.js)

**Files:**
- Create: `src/dashboard/public/index.html`

This is a single HTML file containing the entire SPA: Preact (via CDN or inline), HTM for JSX-like syntax without build step, Chart.js for charts, and CSS.

The SPA has 9 pages (spec §9.3): Overview, Skills, Memory, Behavior, Cost, Security, Rx, Timeline, Settings.

- [ ] **Step 1: Create the SPA HTML file**

The file should be a self-contained HTML document with:
- Inline Preact + HTM (from esm.sh CDN for dev, bundled for prod)
- Client-side router (hash-based: `#/overview`, `#/skills`, etc.)
- Fetch wrapper for API calls (`/api/*`)
- Chart.js for visualizations
- CSS with the medical-monitor aesthetic (matching the terminal report: coral lobster brand color, severity color coding, clean layout)

Key pages:
- **Overview**: Health score card (big number + grade), department grid with scores, active diseases table, trend chart
- **Skills/Memory/Behavior/Cost/Security**: Department-specific detail pages
- **Rx**: Prescription list with apply/rollback buttons, diff viewer
- **Timeline**: Event list with type filters
- **Settings**: Config editor form

- [ ] **Step 2: Implement basic SPA with Overview + department pages**

Focus on:
1. Navigation sidebar
2. Overview page with health score display
3. Department pages showing disease lists
4. Responsive layout

- [ ] **Step 3: Add Chart.js visualizations**

- Score trend line chart on Overview
- Token cost area chart on Cost page
- Tool success rate bar chart on Skills page

- [ ] **Step 4: Add Rx management page**

- List prescriptions with status badges
- Preview button (shows diff in modal)
- Apply/Rollback buttons (POST to API)

- [ ] **Step 5: Add Settings page**

- Threshold editor (table with warning/critical inputs)
- Language toggle
- LLM toggle

- [ ] **Step 6: Write automated SPA tests**

Create `src/dashboard/spa.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SPA_PATH = path.join(import.meta.dirname, "public/index.html");

describe("Dashboard SPA", () => {
  const html = fs.readFileSync(SPA_PATH, "utf-8");

  it("is valid HTML with DOCTYPE", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("contains all 9 page route definitions", () => {
    for (const page of ["overview", "skills", "memory", "behavior", "cost", "security", "rx", "timeline", "settings"]) {
      expect(html).toContain(page);
    }
  });

  it("includes API endpoint calls for all 14 routes", () => {
    for (const endpoint of ["/api/health", "/api/diseases", "/api/prescriptions", "/api/metrics", "/api/trends", "/api/events", "/api/config", "/api/skills", "/api/memory", "/api/causal-chains"]) {
      expect(html).toContain(endpoint);
    }
  });

  it("includes Chart.js for visualizations", () => {
    expect(html.toLowerCase()).toContain("chart");
  });

  it("includes the lobster brand color", () => {
    // Coral/orange brand color from terminal report design
    expect(html).toMatch(/#[a-fA-F0-9]{6}|rgb|hsl/);
  });

  it("is self-contained (no external resource URLs except CDN)", () => {
    // All resources should be either inline or from CDN (esm.sh/unpkg)
    const externalUrls = html.match(/https?:\/\/[^\s"']+/g) ?? [];
    for (const url of externalUrls) {
      expect(url).toMatch(/esm\.sh|unpkg\.com|cdn\.jsdelivr/);
    }
  });
});
```

- [ ] **Step 7: Run SPA tests**

Run: `pnpm test src/dashboard/spa.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Manual verification**

Start the dashboard server and verify pages load:
```bash
pnpm dev dashboard --port 9800
# Open http://localhost:9800 in browser
```

- [ ] **Step 9: Commit**

```bash
git add src/dashboard/public/ src/dashboard/spa.test.ts
git commit -m "feat: add dashboard SPA with 9 pages, charts, and Rx management"
```

---

### Task 8: Dashboard API Tests

**Files:**
- Create: `src/dashboard/server.test.ts` (extend from Task 5)

- [ ] **Step 1: Write comprehensive API tests**

Test all API endpoints against seeded in-memory DB. Verify:
- GET /api/health returns latest score
- GET /api/diseases filters by department
- GET /api/events paginates correctly
- PUT /api/config updates config
- Auth middleware blocks unauthorized writes

- [ ] **Step 2: Commit**

```bash
git add src/dashboard/server.test.ts
git commit -m "test: add comprehensive dashboard API integration tests"
```

---

## Track C: OpenClaw Plugin

### Task 9: Event Summarizer Utilities

**Files:**
- Create: `src/plugin/summarize.ts`
- Create: `src/plugin/summarize.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/plugin/summarize.test.ts
import { describe, it, expect } from "vitest";
import { summarizeParams, summarizeResult, redactAndTruncate } from "./summarize.js";

describe("summarizeParams", () => {
  it("converts values to type descriptors", () => {
    const result = summarizeParams({ query: "hello world", limit: 10, verbose: true });
    expect(result).toEqual({ query: "string", limit: "number", verbose: "boolean" });
  });

  it("handles nested objects", () => {
    const result = summarizeParams({ config: { key: "value" } });
    expect(result.config).toBe("object");
  });

  it("handles arrays", () => {
    const result = summarizeParams({ items: [1, 2, 3] });
    expect(result.items).toBe("array[3]");
  });
});

describe("summarizeResult", () => {
  it("summarizes string result", () => {
    const result = summarizeResult("hello world");
    expect(result).toEqual({ type: "string", length: 11 });
  });

  it("summarizes object result", () => {
    const result = summarizeResult({ key: "value" });
    expect(result.type).toBe("object");
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles null/undefined", () => {
    expect(summarizeResult(null)).toEqual({ type: "null" });
    expect(summarizeResult(undefined)).toEqual({ type: "undefined" });
  });
});

describe("redactAndTruncate", () => {
  it("truncates to maxLength", () => {
    const long = "a".repeat(500);
    expect(redactAndTruncate(long, 200).length).toBe(200);
  });

  it("redacts API key patterns", () => {
    const result = redactAndTruncate("sk-ant-api03-abcdefghijklmnop", 200);
    expect(result).not.toContain("abcdefghijklmnop");
    expect(result).toContain("***");
  });

  it("handles undefined input", () => {
    expect(redactAndTruncate(undefined, 200)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement and test, commit**

```bash
git add src/plugin/summarize.ts src/plugin/summarize.test.ts
git commit -m "feat: add event summarizer utilities for privacy-safe event storage"
```

---

### Task 10: Event Buffer

**Files:**
- Create: `src/plugin/event-buffer.ts`
- Create: `src/plugin/event-buffer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/plugin/event-buffer.test.ts
import { describe, it, expect, vi } from "vitest";
import { createEventBuffer } from "./event-buffer.js";

describe("EventBuffer", () => {
  it("buffers events and flushes when limit reached", () => {
    const flushFn = vi.fn();
    const buffer = createEventBuffer({ maxSize: 3, flushIntervalMs: 60000, onFlush: flushFn });

    buffer.push({ id: "1" } as any);
    buffer.push({ id: "2" } as any);
    expect(flushFn).not.toHaveBeenCalled();

    buffer.push({ id: "3" } as any);
    expect(flushFn).toHaveBeenCalledTimes(1);
    expect(flushFn).toHaveBeenCalledWith([{ id: "1" }, { id: "2" }, { id: "3" }]);
  });

  it("flushes remaining events on stop", () => {
    const flushFn = vi.fn();
    const buffer = createEventBuffer({ maxSize: 100, flushIntervalMs: 60000, onFlush: flushFn });

    buffer.push({ id: "1" } as any);
    buffer.push({ id: "2" } as any);
    buffer.stop();

    expect(flushFn).toHaveBeenCalledTimes(1);
    expect(flushFn).toHaveBeenCalledWith([{ id: "1" }, { id: "2" }]);
  });

  it("auto-flushes after interval even when size limit not reached", () => {
    vi.useFakeTimers();
    const flushFn = vi.fn();
    const buffer = createEventBuffer({ maxSize: 100, flushIntervalMs: 5000, onFlush: flushFn });

    buffer.push({ id: "1" } as any);
    expect(flushFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(flushFn).toHaveBeenCalledTimes(1);
    expect(flushFn).toHaveBeenCalledWith([{ id: "1" }]);

    vi.useRealTimers();
    buffer.stop();
  });
});
```

- [ ] **Step 2: Implement, test, commit**

```bash
git add src/plugin/event-buffer.ts src/plugin/event-buffer.test.ts
git commit -m "feat: add event buffer with size-based and interval-based flushing"
```

---

### Task 11: Stream Collector + Plugin Entry

**Files:**
- Create: `src/plugin/stream-collector.ts`
- Create: `src/plugin/stream-collector.test.ts`
- Create: `src/plugin/plugin.ts`

- [ ] **Step 1: Implement stream-collector.ts**

Registers all OpenClaw plugin hooks per spec §5.3:
- `llm_output` → llm_call events
- `after_tool_call` → tool_call events (using summarizeParams/summarizeResult)
- `session_end` → session_lifecycle events
- `agent_end` → agent_lifecycle events
- `subagent_ended` → subagent_event events
- `after_compaction` → compaction_event events

All events go through the EventBuffer → batch INSERT into persistent SQLite.

- [ ] **Step 2: Implement plugin.ts entry point**

```typescript
// src/plugin/plugin.ts
import type { OpenClawPluginDefinition } from "./openclaw-types.js";

export const clawdocPlugin: OpenClawPluginDefinition = {
  id: "clawdoc",
  name: "ClawDoc",
  description: "Agent health diagnostics",
  register(api) {
    // 1. Open persistent SQLite at ~/.clawdoc/clawdoc.db
    // 2. Create event buffer with flush to event store
    // 3. Register stream collector hooks
    // 4. Register periodic snapshot service (30min interval, with stop() cleanup)
    // 5. Register CLI subcommands (openclaw clawdoc checkup)
    // 6. Register dashboard HTTP route (/clawdoc/*)
  },
};
```

Note: For the OpenClaw plugin types, create a minimal `src/plugin/openclaw-types.ts` with just the interfaces needed (OpenClawPluginDefinition, OpenClawPluginApi) — don't import from OpenClaw directly since ClawDoc is a standalone package.

- [ ] **Step 3: Write tests with mock plugin API**

- [ ] **Step 4: Commit**

```bash
git add src/plugin/
git commit -m "feat: add OpenClaw plugin with stream collector and event buffering"
```

---

## Track D: Prescription Engine (depends on LLM Analyzer)

### Task 12: Prescription Engine

**Files:**
- Create: `src/prescription/prescription-generator.ts`
- Create: `src/prescription/prescription-generator.test.ts`
- Create: `src/prescription/prescription-executor.ts`
- Create: `src/prescription/prescription-executor.test.ts`
- Create: `src/store/prescription-store.ts` (follows existing store convention)
- Create: `src/store/prescription-store.test.ts`
- Create: `src/prescription/backup.ts`
- Create: `src/prescription/backup.test.ts`
- Create: `src/prescription/followup.ts`
- Create: `src/prescription/followup.test.ts`

This is a large task. Break into sub-steps:

- [ ] **Step 1: Implement prescription-store.ts**

Wraps the existing prescriptions + followups tables:

```typescript
export interface PrescriptionStore {
  insertPrescription(rx: Prescription): void;
  queryPrescriptions(filter: { status?: string; diagnosisId?: string }): Prescription[];
  updatePrescriptionStatus(id: string, status: string, appliedAt?: number): void;
  insertFollowup(followup: FollowupRecord): void;
  getPendingFollowups(): FollowupRecord[];
  completeFollowup(id: string, result: FollowUpResult): void;
}
```

- [ ] **Step 2: Implement backup.ts**

```typescript
export function createBackup(actions: PrescriptionAction[]): PrescriptionBackup
// Read current file contents, compute SHA-256 hash for each

export function applyBackup(backup: PrescriptionBackup): RollbackResult
// For each entry: compare currentHash vs postApplyHash
// Safe: restore. Conflict: report. Already reverted: skip.
```

Test in a temp directory: create files, backup, modify, rollback, verify restored.

- [ ] **Step 3: Implement prescription-generator.ts**

Uses LLM client to generate concrete prescriptions from DiseaseInstance + PrescriptionTemplate:

```typescript
export async function generatePrescription(
  disease: DiseaseInstance,
  template: PrescriptionTemplate,
  llmClient: LLMClient,
  context: { metrics: MetricSet; samples: RawSamples },
): Promise<Prescription>
```

- [ ] **Step 4: Implement prescription-executor.ts**

The core execution engine per spec §7.3:

```typescript
export function createPrescriptionExecutor(db: Database, config: ClawDocConfig) {
  return {
    async preview(prescriptionId: string): Promise<PrescriptionPreview>,
    async execute(prescriptionId: string): Promise<ExecutionResult>,
    async rollback(prescriptionId: string): Promise<RollbackResult>,
    async followUp(prescriptionId: string): Promise<FollowUpResult>,
  };
}
```

Execute flow: backup current files → apply actions (file_edit via diff, file_delete, config_change) → compute postApplyHash → verify immediately → schedule follow-ups.

- [ ] **Step 5: Implement followup.ts**

```typescript
export function computeFollowUpVerdict(before: MetricSnapshot, after: MetricSnapshot): FollowUpVerdict
// Compare metrics, compute changePercent, determine verdict
```

- [ ] **Step 6: Write tests for all modules**

- prescription-store: CRUD operations
- backup: create + rollback with conflict detection
- generator: mock LLM produces valid prescription
- executor: full lifecycle in temp directory (apply → verify → rollback)
- followup: verdict computation

- [ ] **Step 7: Commit**

```bash
git add src/prescription/
git commit -m "feat: add prescription engine with generate, execute, backup, rollback, followup"
```

---

## Integration Tasks

### Task 13: Pipeline Integration

**Files:**
- Modify: `src/analysis/rule-engine.ts` (extend evaluateRules for hybrid preFilters)
- Modify: `src/analysis/analysis-pipeline.ts` (add LLM analyzer step, causal chains, prescriptions)
- Modify: `src/commands/checkup.ts` (remove noLlm hardcode, support --no-llm flag)
- Modify: `src/report/terminal-report.ts` (add causal chain + prescription sections)

- [ ] **Step 1: Extend analysis pipeline with LLM step**

When `noLlm` is false and LLM config is available:
1. **Modify `evaluateRules()` in `src/analysis/rule-engine.ts`** to also evaluate hybrid diseases:
   - For `detection.type === "hybrid"`: evaluate `detection.preFilter` (the RuleDetection part)
   - If preFilter triggers: return a RuleResult with `status: "suspect"` (not "confirmed")
   - If preFilter does not trigger: skip (the LLM step won't be needed)
   - This change is backward-compatible: Phase 1 `--no-llm` mode will see suspects but not process them
2. Collect LLM-only diseases (detection.type === "llm") — these go directly to LLM without pre-filtering
3. Run `analyzeLLM()` with suspects + LLM-only diseases + metrics + raw samples
4. Merge LLM results with rule results, converting LLMDiagnosis.evidence.description (string) → Evidence.description ({ en: string })
5. If causal chains found, persist to causal_chains table and add to CheckupResult
6. Set `llmDegradationReason` if LLM was unavailable or failed

Update `CheckupResult` to include:
```typescript
export interface CheckupResult {
  healthScore: HealthScore;
  diseases: DiseaseInstance[];
  ruleResults: RuleResult[];
  causalChains?: CausalChain[];     // NEW
  prescriptions?: Prescription[];    // NEW
  llmAvailable: boolean;             // NEW
  llmDegradationReason?: string;     // NEW: "no_api_key" | "network_error" | "budget_exceeded" | "malformed_response"
}
```

- [ ] **Step 2: Update checkup command**

Remove the `noLlm: true` hardcode. Support the `--no-llm` flag properly. When LLM is available, show LLM analysis results in terminal report.

- [ ] **Step 3: Update terminal report for causal chains + prescriptions**

Add sections to the terminal report for:
- Causal chains (if any)
- Pending prescriptions (with `clawdoc rx preview` hints)

- [ ] **Step 4: Run full test suite, fix any broken tests**

- [ ] **Step 5: Commit**

```bash
git add src/analysis/analysis-pipeline.ts src/commands/checkup.ts src/report/
git commit -m "feat: integrate LLM analyzer and prescriptions into checkup pipeline"
```

---

### Task 14: CLI Commands (rx + dashboard)

**Files:**
- Create: `src/commands/rx-cmd.ts`
- Create: `src/commands/dashboard-cmd.ts`
- Modify: `src/bin.ts`

- [ ] **Step 1: Implement rx-cmd.ts**

All prescription CLI commands from spec §9.1:

```typescript
export function registerRxCommand(program: Command): void {
  const rx = program.command("rx").description("Prescription management");

  rx.command("list")
    .option("--status <status>", "Filter by status")
    .action(...);

  rx.command("preview <id>").action(...);
  rx.command("apply <id>").action(...);
  rx.command("apply").option("--all").option("--dry-run").action(...);
  rx.command("rollback <id>").action(...);
  rx.command("followup [id]").action(...);
  rx.command("history").action(...);
}
```

- [ ] **Step 2: Implement dashboard-cmd.ts**

```typescript
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../store/database.js";
import { loadConfig } from "../config/loader.js";

export function registerDashboardCommand(program: Command): void {
  program
    .command("dashboard")
    .description("Start web dashboard")
    .option("--port <port>", "Port number", "9800")
    .action(async (opts) => {
      const { startDashboard } = await import("../dashboard/server.js");

      // Detect persistent DB (plugin mode) or fall back to empty in-memory DB
      const persistentDbPath = join(process.env.HOME ?? "~", ".clawdoc", "clawdoc.db");
      const dbPath = existsSync(persistentDbPath) ? persistentDbPath : ":memory:";
      const db = openDatabase(dbPath);

      const configPath = join(process.env.HOME ?? "~", ".clawdoc", "config.json");
      const config = loadConfig(configPath);

      const token = randomBytes(16).toString("hex");
      console.log(`Dashboard: http://localhost:${opts.port}`);
      console.log(`Auth token: ${token}`);
      if (dbPath === ":memory:") {
        console.log("⚠ No persistent data found. Run 'clawdoc checkup' first or install the plugin.");
      }
      await startDashboard({ db, config, port: parseInt(opts.port), authToken: token });
    });
}
```

- [ ] **Step 3: Wire into bin.ts**

- [ ] **Step 4: Smoke test**

```bash
pnpm dev rx list
pnpm dev dashboard --port 9800
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/rx-cmd.ts src/commands/dashboard-cmd.ts src/bin.ts
git commit -m "feat: add rx and dashboard CLI commands"
```

---

### Task 15: E2E + Final Integration

**Files:**
- Modify: `src/e2e.test.ts`

- [ ] **Step 1: Add Phase 2 E2E tests**

```typescript
describe("E2E Phase 2", () => {
  it("clawdoc checkup --json includes llmAvailable field", () => {
    // Even without API key, the field should be present (false)
    const result = JSON.parse(runPlain("checkup --json --agent default", fixtureEnv));
    expect(result.llmAvailable).toBe(false);
  });

  it("clawdoc rx list returns empty array when no prescriptions", () => {
    const output = runPlain("rx list --json", fixtureEnv);
    expect(JSON.parse(output)).toEqual([]);
  });

  it("clawdoc dashboard --help shows port option", () => {
    const output = run("dashboard --help");
    expect(output).toContain("--port");
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 3: Final commit**

```bash
git add src/e2e.test.ts
git commit -m "feat: add Phase 2 E2E tests for LLM, prescriptions, and dashboard"
```

---

## Summary

| Task | Track | Description | Dependencies | Parallelizable With |
|------|-------|-------------|-------------|-------------------|
| 1 | A | LLM Client + RawSampleProvider | — | 5, 9 |
| 2 | A | Prompts + Token Budget | 1 | 5, 6, 9, 10 |
| 3 | A | LLM Analyzer (3-round) | 2 | 5, 6, 7, 10, 11 |
| 4 | A | Causal Chain Linker | 3 | 7, 11 |
| 5 | B | Dashboard Server + Auth | — | 1, 9 |
| 6 | B | Dashboard API Routes | 5 | 2, 3, 10, 11 |
| 7 | B | Dashboard SPA | 6 | 3, 4, 11 |
| 8 | B | Dashboard API Tests | 6 | 3, 4, 11 |
| 9 | C | Event Summarizer | — | 1, 5 |
| 10 | C | Event Buffer | 9 | 2, 3, 6 |
| 11 | C | Stream Collector + Plugin | 5, 10 | 4 |
| 12 | D | Prescription Engine | 1, 2, 3 | 11 |
| 13 | — | Pipeline Integration | 3, 4, 12 | — |
| 14 | — | CLI Commands (rx + dashboard) | 5, 12 | — |
| 15 | — | E2E + Final Integration | 13, 14 | — |

**Optimal agent team allocation (3 parallel tracks + serial integration):**

```
Round 0: Pre-Task 0 (add Phase 2 types + schema v2) — sequential
Round 1: Agent A → Task 1 (LLM client)  |  Agent B → Task 5 (dashboard server)  |  Agent C → Task 9 (summarizer)
Round 2: Agent A → Task 2 (prompts)     |  Agent B → Task 6 (API routes)       |  Agent C → Task 10 (buffer)
Round 3: Agent A → Task 3 (analyzer)    |  Agent B → Task 7 (SPA)
Round 4: Agent A → Task 4 (causal)      |  Agent B → Task 8 (API tests)        |  Agent C → Task 11 (plugin, needs 5+10)
Round 5: Agent A → Task 12 (prescriptions)
Round 6: Agent A → Task 13 (pipeline integration — modify rule-engine + pipeline)
Round 7: Agent A → Task 14 (CLI commands)
Round 8: Agent A → Task 15 (E2E)
```
