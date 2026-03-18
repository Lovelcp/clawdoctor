# ClawDoc Phase 2 Implementation Plan (v2)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend ClawDoc with LLM-powered deep diagnosis (16 hybrid/LLM diseases + cross-department causal chains), a full prescription lifecycle (generate/preview/apply/rollback/follow-up), a Web Dashboard (Hono + SPA with 9 pages), and an OpenClaw Plugin for real-time event streaming.

**Architecture:** Four subsystems built on Phase 1's foundation (261 tests, 43 disease definitions, snapshot collector, rule engine, health scorer). LLM Analyzer plugs into the existing analysis pipeline. Prescription Engine operates on DiseaseInstance outputs. Dashboard is a Hono server serving a bundled SPA backed by the same SQLite store. Plugin registers OpenClaw hooks to stream events into persistent SQLite.

**Tech Stack:** Phase 1 stack + Hono + @hono/node-server (dashboard server), vanilla HTML/JS SPA with Chart.js (CDN dev / inlined prod), openclaw as peerDependency (plugin types).

**Spec:** `docs/2026-03-17-clawdoc-design.md`

---

## Key Architecture Decisions (resolved from v1 review)

### 1. LLM Provider Abstraction (not Anthropic-only)

The LLM client uses a `LLMProvider` interface — not hardcoded to Anthropic.

Phase 2 ships one implementation:
- `AnthropicProvider`: Anthropic Messages API (used when `ANTHROPIC_API_KEY` or `OPENCLAW_API_KEY` is set)

Future (Phase 3): `OpenClawProvider` that delegates to OpenClaw's model routing when running as plugin. Deferred because it requires OpenClaw gateway runtime, which complicates testing.

```typescript
interface LLMProvider {
  chat(system: string, user: string, opts?: { maxTokens?: number }): Promise<LLMResponse>;
}

interface LLMResponse {
  text: string;
  tokensUsed: { input: number; output: number };
  error?: string;
}
```

Config resolution: `config.llm.model` override → OpenClaw model config → fallback to `claude-sonnet-4-20250514`.

### 2. HealthScore Persistence (store full JSON, not flat)

Schema v2 adds `health_score_json TEXT` column to `health_scores` table. The full nested `HealthScore` (including `departments: Record<Department, DepartmentScore>`, `coverage.skippedDiseases`, per-department disease counts) is stored as JSON. Dashboard reads this directly — no reconstruction needed.

Also adds `queryLatestScore(agentId): HealthScore | null` to ScoreStore (ORDER BY timestamp DESC LIMIT 1).

### 3. Plugin Types (peerDependency, not stubs)

`package.json` adds `"openclaw": "*"` as a peerDependency. Plugin code imports real types from `openclaw/plugin-sdk`:

```typescript
import type { OpenClawPluginDefinition, OpenClawPluginApi } from "openclaw/plugin-sdk";
```

For development/testing without OpenClaw installed, a minimal type-only shim at `src/plugin/openclaw-types.ts` provides the interfaces. At runtime, the real OpenClaw types are used.

### 4. Dashboard Build Strategy

**Development:** SPA loads Preact/HTM/Chart.js from esm.sh CDN. Single `index.html`, no build step.
**Production (npm publish):** A `scripts/bundle-spa.ts` script downloads CDN resources and inlines them into `index.html`, producing a self-contained file at `dist/dashboard/index.html`. The Hono server serves this file.

### 5. Disease Definition Alignment

Phase 1 already has all 43 diseases with real `analysisPromptTemplate` and `inputDataKeys`. Phase 2 adds a `RawSampleProvider` that maps each `inputDataKey` to live filesystem data. A new task creates the explicit mapping table and tests it against all 16 LLM/hybrid diseases.

### 6. Existing Schema (clarification)

Phase 1's schema v1 already creates `prescriptions`, `followups`, `events`, `diagnoses`, `health_scores` tables. Phase 2 schema v2 only adds: `causal_chains` table + `health_score_json` column on `health_scores`.

---

## File Structure (Phase 2 additions)

```
src/
├── llm/
│   ├── provider.ts                # LLMProvider interface + AnthropicProvider impl
│   ├── provider.test.ts
│   ├── llm-analyzer.ts            # 3-round LLM analysis (scan → deep → causal)
│   ├── llm-analyzer.test.ts
│   ├── prompts.ts                 # System prompt + round-specific prompt templates
│   ├── token-budget.ts            # Token budget enforcement + truncation
│   ├── token-budget.test.ts
│   ├── causal-linker.ts           # Cross-department causal chain parsing
│   └── causal-linker.test.ts
├── raw-samples/
│   ├── raw-sample-provider.ts     # RawSampleProvider: live filesystem reads (NOT reuse of snapshot parsers)
│   ├── raw-sample-provider.test.ts
│   ├── input-key-mapper.ts        # Maps DiseaseDefinition.inputDataKeys → RawSampleProvider methods
│   └── input-key-mapper.test.ts
├── prescription/
│   ├── prescription-generator.ts  # LLM-based prescription generation
│   ├── prescription-generator.test.ts
│   ├── prescription-executor.ts   # preview / apply / rollback
│   ├── prescription-executor.test.ts
│   ├── backup.ts                  # Backup creation + 3-way conflict detection
│   ├── backup.test.ts
│   ├── followup.ts                # Follow-up verdict computation
│   └── followup.test.ts
├── plugin/
│   ├── plugin.ts                  # OpenClawPluginDefinition entry point
│   ├── stream-collector.ts        # Hook registrations → event buffering → SQLite flush
│   ├── stream-collector.test.ts
│   ├── event-buffer.ts            # In-memory buffer with size + interval flushing
│   ├── event-buffer.test.ts
│   ├── summarize.ts               # summarizeParams(), summarizeResult(), redactAndTruncate()
│   ├── summarize.test.ts
│   └── openclaw-types.ts          # Dev-only type shim (real types from openclaw/plugin-sdk at runtime)
├── dashboard/
│   ├── server.ts                  # Hono app: API routes + SPA serving + auth middleware
│   ├── server.test.ts             # All 14 API routes tested against in-memory DB
│   ├── spa.test.ts                # Automated SPA validation (structure, routes, endpoints)
│   └── public/
│       └── index.html             # SPA (vanilla JS + CDN deps, inlined for production)
├── store/
│   ├── prescription-store.ts      # Prescription + followup CRUD (uses existing tables from schema v1)
│   ├── prescription-store.test.ts
│   ├── causal-chain-store.ts      # CausalChain persistence (uses new table from schema v2)
│   └── causal-chain-store.test.ts
├── commands/
│   ├── rx-cmd.ts                  # clawdoc rx list/preview/apply/rollback/followup/history
│   └── dashboard-cmd.ts           # clawdoc dashboard [--port]
├── scripts/
│   └── bundle-spa.ts              # Download CDN deps → inline into index.html
└── (modify existing)
    ├── types/domain.ts            # Add CausalChain, Phase 2 lifecycle types, RawSample types
    ├── store/database.ts          # Schema v2: causal_chains table + health_score_json column
    ├── store/score-store.ts       # Add queryLatestScore(), insertHealthScoreWithJson()
    ├── analysis/rule-engine.ts    # Extend evaluateRules() for hybrid preFilter → "suspect"
    ├── analysis/analysis-pipeline.ts # Add LLM step, causal chains, prescriptions, degradation
    ├── commands/checkup.ts        # Add LLM analysis path when --no-llm is NOT set (flag already exists)
    ├── report/terminal-report.ts  # Add causal chain + prescription sections
    ├── bin.ts                     # Register rx and dashboard commands
    └── package.json               # Add hono, @hono/node-server deps; openclaw peerDep
```

---

## Dependency Graph & Parallelism

```
Pre-requisite (sequential):
  Task 0: Phase 2 types + schema v2 + score-store extension

Round 1 (4-way parallel — no shared files):
  Track A: Task 1 (LLM provider) | Task 2 (token budget + prompts)
  Track B: Task 3 (event summarizer) | Task 4 (event buffer)
  Track C: Task 5 (dashboard server + ALL API routes + SPA)
  Track D: Task 6 (RawSampleProvider + input key mapper)

Round 2 (2-way parallel):
  Track A: Task 7 (LLM analyzer 3-round) — needs Tasks 1, 2, 6
  Track B: Task 8 (stream collector + plugin) — needs Tasks 3, 4, 5

Round 3 (2-way parallel):
  Task 9: Causal linker + store — needs Task 7 (uses LLMAnalyzerResult output types)
  Task 10: Prescription engine — needs Tasks 1, 7

Round 4 (sequential):
  Task 11: Pipeline integration — needs Tasks 7, 9, 10
  Task 12: CLI commands (rx + dashboard) — needs Tasks 5, 10, 11
  Task 13: E2E + integration tests — needs Task 12
```

NOTE on Track C (Task 5): Dashboard server and API routes are ONE task — not split.
The server test creates the Hono app with all routes registered, then tests each endpoint.
This avoids the v1 problem where Task 5 tests depended on Task 6 routes.

---

## Task 0: Phase 2 Types + Schema v2 + Store Extensions

**Files:**
- Modify: `src/types/domain.ts`
- Modify: `src/store/database.ts`
- Modify: `src/store/score-store.ts`
- Create: `src/store/score-store.test.ts` (extend)
- Modify: `package.json`

- [ ] **Step 1: Add Phase 2 types to domain.ts**

```typescript
// ─── Phase 2 additions to src/types/domain.ts ───

export interface CausalChain {
  id: string;
  name: I18nString;
  rootCause: DiagnosisRef;
  chain: DiagnosisRef[];
  impact: I18nString;
  unifiedPrescription?: Prescription; // populated by Prescription Engine after causal analysis
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

// ─── RawSample types (for LLM analysis, not persisted) ───

export interface SessionSample {
  sessionKey: string;
  messageCount: number;
  toolCallSequence: Array<{
    toolName: string;
    success: boolean;
    errorSummary?: string;
  }>;
  tokenUsage?: { input: number; output: number };
}

export interface MemoryFileSample {
  path: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  modifiedAt: number;
}

export interface SkillDefinitionSample {
  pluginId: string;
  source: string;
  codeSnippets: string[];
}
```

- [ ] **Step 2: Add schema v2 migration to database.ts**

```typescript
// In MIGRATIONS object, add (wrapped in transaction for atomicity):
2: (db) => {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE health_scores ADD COLUMN health_score_json TEXT;
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS causal_chains (
      id              TEXT PRIMARY KEY,
      agent_id        TEXT NOT NULL,
      name_json       TEXT NOT NULL,
      root_cause_json TEXT NOT NULL,
      chain_json      TEXT NOT NULL,
      impact_json     TEXT NOT NULL,
      prescription_id TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_causal_agent ON causal_chains(agent_id);
    `);
  })(); // end transaction
},
```

Update `CURRENT_SCHEMA_VERSION` to 2.

- [ ] **Step 3: Extend score-store.ts**

Add two new methods:

```typescript
// In ScoreStore interface, add:
insertHealthScoreWithJson(record: HealthScoreRecord, healthScoreJson: string): void;
queryLatestScore(agentId: string): { record: HealthScoreRecord; json: string } | null;
```

`queryLatestScore` uses `ORDER BY timestamp DESC LIMIT 1`.

- [ ] **Step 4: Install new dependencies**

```bash
pnpm add hono @hono/node-server
pnpm add -D openclaw  # devDependency for type imports during development
```

Add to package.json:
```json
"peerDependencies": {
  "openclaw": "*"
},
"peerDependenciesMeta": {
  "openclaw": { "optional": true }
}
```

- [ ] **Step 5: Run pnpm check, verify all types compile**
- [ ] **Step 6: Run full test suite (261 existing tests must still pass)**
- [ ] **Step 7: Commit**

```bash
git add src/types/domain.ts src/store/database.ts src/store/score-store.ts package.json pnpm-lock.yaml
git commit -m "feat: add Phase 2 types, schema v2 migration, score-store extensions"
```

---

## Task 1: LLM Provider (provider-agnostic)

**Files:**
- Create: `src/llm/provider.ts`
- Create: `src/llm/provider.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { createAnthropicProvider, resolveLLMProvider } from "./provider.js";
import type { ClawDocConfig } from "../types/config.js";
import { DEFAULT_CONFIG } from "../types/config.js";

describe("AnthropicProvider", () => {
  it("sends structured prompt and returns parsed text + usage", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: "text", text: '[{"diseaseId":"SK-002","status":"confirmed"}]' }],
        usage: { input_tokens: 500, output_tokens: 200 },
      }),
    });

    const provider = createAnthropicProvider({ apiKey: "test", model: "claude-sonnet-4-20250514", fetch: mockFetch });
    const result = await provider.chat("system", "user");

    expect(result.text).toContain("SK-002");
    expect(result.tokensUsed).toEqual({ input: 500, output: 200 });
    expect(result.error).toBeUndefined();
  });

  it("returns error on HTTP failure without throwing", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: "Too Many Requests" });
    const provider = createAnthropicProvider({ apiKey: "test", model: "test", fetch: mockFetch });
    const result = await provider.chat("s", "u");

    expect(result.text).toBe("");
    expect(result.error).toContain("429");
  });

  it("returns error on network failure without throwing", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const provider = createAnthropicProvider({ apiKey: "test", model: "test", fetch: mockFetch });
    const result = await provider.chat("s", "u");

    expect(result.error).toContain("ECONNREFUSED");
  });
});

describe("resolveLLMProvider", () => {
  it("returns null when llm.enabled is false", () => {
    const config = { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, enabled: false } };
    expect(resolveLLMProvider(config)).toBeNull();
  });

  it("returns null when no API key available", () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENCLAW_API_KEY;
    expect(resolveLLMProvider(DEFAULT_CONFIG)).toBeNull();
    if (original) process.env.ANTHROPIC_API_KEY = original;
  });

  it("returns AnthropicProvider when API key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const provider = resolveLLMProvider(DEFAULT_CONFIG);
    expect(provider).not.toBeNull();
    delete process.env.ANTHROPIC_API_KEY;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement provider.ts**

```typescript
// src/llm/provider.ts
export interface LLMProvider {
  chat(system: string, user: string, opts?: { maxTokens?: number }): Promise<LLMResponse>;
}

export interface LLMResponse {
  text: string;
  tokensUsed: { input: number; output: number };
  error?: string;
}

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): LLMProvider { /* ... */ }

export function resolveLLMProvider(config: ClawDocConfig): LLMProvider | null {
  if (!config.llm.enabled) return null;
  const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENCLAW_API_KEY;
  if (!apiKey) return null;
  return createAnthropicProvider({
    apiKey,
    model: config.llm.model ?? "claude-sonnet-4-20250514",
  });
}
```

- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit**

```bash
git add src/llm/provider.ts src/llm/provider.test.ts
git commit -m "feat: add provider-agnostic LLM client with Anthropic implementation"
```

---

## Task 2: Prompt Templates + Token Budget

**Files:**
- Create: `src/llm/prompts.ts`
- Create: `src/llm/token-budget.ts`
- Create: `src/llm/token-budget.test.ts`

- [ ] **Step 1: Write failing token budget test**

Tests must use the real nested MetricSet structure:

```typescript
import { describe, it, expect } from "vitest";
import { truncateForBudget } from "./token-budget.js";

describe("TokenBudget", () => {
  it("passes through data under budget", () => {
    const input = { metrics: { cost: { tokensBySession: [{ sessionKey: "s", tokens: 100 }] } }, samples: [] };
    const result = truncateForBudget(input, 50000);
    expect(result.metrics.cost.tokensBySession).toHaveLength(1);
  });

  it("drops raw samples first when over budget", () => {
    const bigSamples = Array(100).fill({ sessionKey: "s", toolCallSequence: Array(50).fill({ toolName: "t", success: true }) });
    const result = truncateForBudget({ metrics: { cost: { tokensBySession: [] } }, samples: bigSamples }, 2000);
    expect(result.samples.length).toBeLessThan(50);
    expect(result.metrics).toBeDefined();
  });

  it("truncates MetricSet details when samples gone and still over budget", () => {
    const bigMetrics = {
      cost: { tokensBySession: Array(500).fill({ sessionKey: "s", tokens: 100 }), dailyTrend: [] },
      skill: { topErrorTools: Array(200).fill({ tool: "t", errorCount: 1, errorMessages: ["err"] }) },
    };
    const result = truncateForBudget({ metrics: bigMetrics, samples: [] }, 3000);
    expect(result.metrics.cost.tokensBySession.length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Implement prompts.ts with spec §6.4 system prompt and round templates**
- [ ] **Step 3: Implement token-budget.ts per spec §6.4 truncation strategy**
- [ ] **Step 4: Run tests, verify pass, commit**

```bash
git add src/llm/prompts.ts src/llm/token-budget.ts src/llm/token-budget.test.ts
git commit -m "feat: add LLM prompt templates and token budget enforcement"
```

---

## Task 3: Event Summarizer Utilities

**Files:**
- Create: `src/plugin/summarize.ts`
- Create: `src/plugin/summarize.test.ts`

Privacy-safe event summarization per spec §8.3: `summarizeParams()` (key → type descriptor, never values), `summarizeResult()` (type + length), `redactAndTruncate()` (truncate + API key pattern redaction).

- [ ] **Step 1: Write failing tests** (same as v1 plan — 3 describe blocks, 8+ tests)
- [ ] **Step 2: Implement, verify, commit**

```bash
git add src/plugin/summarize.ts src/plugin/summarize.test.ts
git commit -m "feat: add event summarizer utilities for privacy-safe storage"
```

---

## Task 4: Event Buffer

**Files:**
- Create: `src/plugin/event-buffer.ts`
- Create: `src/plugin/event-buffer.test.ts`

In-memory buffer with size-based + interval-based flushing. Must implement `stop()` for clean shutdown.

- [ ] **Step 1: Write failing tests** (size-based flush, stop flush, interval-based flush with vi.useFakeTimers)
- [ ] **Step 2: Implement, verify, commit**

```bash
git add src/plugin/event-buffer.ts src/plugin/event-buffer.test.ts
git commit -m "feat: add event buffer with size-based and interval-based flushing"
```

---

## Task 5: Dashboard Server + API Routes + SPA (single deliverable)

**Files:**
- Create: `src/dashboard/server.ts`
- Create: `src/dashboard/server.test.ts`
- Create: `src/dashboard/spa.test.ts`
- Create: `src/dashboard/public/index.html`
- Modify: `src/store/score-store.ts` (if queryLatestScore not yet added in Task 0)

This is intentionally ONE task — server + routes + SPA together. The v1 plan's split (Tasks 5/6/7/8) created untestable intermediate states.

- [ ] **Step 1: Implement server.ts with ALL 14 API routes inline**

```typescript
// src/dashboard/server.ts
import { Hono } from "hono";

export interface DashboardOptions {
  db: Database.Database;
  config: ClawDocConfig;
  authToken?: string;
}

export function createDashboardApp(opts: DashboardOptions): Hono {
  const app = new Hono();

  // Auth middleware for write endpoints
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "GET") return next();
    if (!opts.authToken) return next();
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${opts.authToken}`) return c.json({ error: "Unauthorized" }, 401);
    return next();
  });

  // ─── Read endpoints ───
  // GET /api/health — returns full HealthScore JSON from health_score_json column
  // GET /api/diseases — filterable by dept, severity, status
  // GET /api/diseases/:id — single disease with evidence
  // GET /api/prescriptions — list
  // GET /api/prescriptions/:id/followup — followup result
  // GET /api/metrics/:dept — calls aggregateMetrics() against persistent DB, returns filtered department
  //   Implementation: import aggregateMetrics from analysis/metric-aggregator.ts
  //   The existing aggregateMetrics() works on any SQLite DB (not just in-memory).
  //   Route handler: aggregateMetrics(db, agentId, { from: since, to: now }) → return metrics[dept]
  //   Query params: ?agentId=default&since=7d
  // GET /api/trends — HealthScore[] time series
  // GET /api/events — paginated (?page=1&limit=50&type=tool_call)
  // GET /api/causal-chains — CausalChain[]
  // GET /api/config — ClawDocConfig
  // GET /api/skills — PluginSnapshotData
  // GET /api/memory — MemorySnapshotData

  // ─── Write endpoints (auth required) ───
  // PUT /api/config — update config
  // POST /api/prescriptions/:id/apply — ExecutionResult
  // POST /api/prescriptions/:id/rollback — RollbackResult

  // ─── SPA fallback ───
  app.get("*", (c) => c.html(SPA_HTML));

  return app;
}
```

GET /api/health reads the `health_score_json` column directly — no reconstruction from flat scores.

- [ ] **Step 2: Write server.test.ts testing ALL 14 endpoints**

Test against in-memory DB seeded with fixture data. Key test cases:
- GET /api/health returns full nested HealthScore with departments
- GET /api/diseases filters by department and severity
- GET /api/events paginates correctly
- PUT /api/config rejected without auth token
- PUT /api/config accepted with valid auth token
- POST /api/prescriptions/:id/apply returns ExecutionResult
- POST /api/prescriptions/:id/rollback returns RollbackResult
- GET /api/causal-chains returns CausalChain[] (empty when none)

- [ ] **Step 3: Create SPA index.html**

Single HTML file with:
- Hash-based router (#/overview, #/skills, #/memory, #/behavior, #/cost, #/security, #/rx, #/timeline, #/settings)
- CDN loads: Preact, HTM, Chart.js (from esm.sh)
- Fetch wrapper for /api/* calls
- 9 pages matching spec §9.3
- Medical-monitor aesthetic (coral brand color from terminal report)

- [ ] **Step 4: Write spa.test.ts (automated SPA validation)**

```typescript
describe("Dashboard SPA", () => {
  it("is valid HTML with DOCTYPE");
  it("contains all 9 page route definitions");
  it("references all 14 API endpoints");
  it("includes Chart.js");
  it("is self-contained except for CDN URLs");
});
```

- [ ] **Step 5: Verify server + SPA manually**
- [ ] **Step 6: Commit**

```bash
git add src/dashboard/ package.json pnpm-lock.yaml
git commit -m "feat: add dashboard with Hono server, 14 API routes, and 9-page SPA"
```

---

## Task 6: RawSampleProvider + Input Key Mapper

**Files:**
- Create: `src/raw-samples/raw-sample-provider.ts`
- Create: `src/raw-samples/raw-sample-provider.test.ts`
- Create: `src/raw-samples/input-key-mapper.ts`
- Create: `src/raw-samples/input-key-mapper.test.ts`

IMPORTANT: RawSampleProvider does NOT reuse the existing session-parser or memory-scanner. Those produce privacy-redacted event summaries. RawSampleProvider reads raw filesystem data for LLM analysis (truncated + redacted per spec §6.1.1, §8.3).

- [ ] **Step 1: Implement raw-sample-provider.ts**

Three methods:
- `getRecentSessionSamples(agentId, limit)`: Parse JSONL files, extract tool call sequences with error summaries (first 200 chars, redacted). NOT the same as session-parser.ts which produces ClawDocEvent with paramsSummary.
- `getMemoryFileContents(limit, maxTokensPerFile)`: Read actual file content (fs.readFileSync), truncate to maxTokensPerFile chars. NOT the memory-scanner which returns metadata only.
- `getSkillDefinitions(pluginIds)`: Read plugin source code for security analysis.

- [ ] **Step 2: Implement input-key-mapper.ts**

Maps each disease definition's `inputDataKeys` to RawSampleProvider method calls:

```typescript
export function resolveInputData(
  disease: DiseaseDefinition,
  provider: RawSampleProvider,
  metrics: MetricSet,
  agentId: string,
): Promise<Record<string, unknown>>
```

For each key in `disease.detection.inputDataKeys`, maps to the appropriate data source:
- `"toolName"` → from disease context
- `"errorLog"` / `"successLog"` → from metrics.skill.topErrorTools
- `"sessionToolCallLog"` → from provider.getRecentSessionSamples()
- `"memoryFiles"` → from provider.getMemoryFileContents()
- etc.

- [ ] **Step 3: Write test that validates all 16 LLM/hybrid diseases have resolvable inputDataKeys**

```typescript
it("all LLM/hybrid diseases have mapped inputDataKeys", () => {
  const registry = getDiseaseRegistry();
  const llmDiseases = registry.getAll().filter(d =>
    d.detection.type === "llm" || d.detection.type === "hybrid"
  );
  for (const disease of llmDiseases) {
    const keys = disease.detection.type === "llm"
      ? disease.detection.inputDataKeys
      : disease.detection.deepAnalysis.inputDataKeys;
    for (const key of keys) {
      expect(INPUT_KEY_MAP[key], `${disease.id}: unmapped inputDataKey "${key}"`).toBeDefined();
    }
  }
});
```

- [ ] **Step 4: Verify, commit**

```bash
git add src/raw-samples/
git commit -m "feat: add RawSampleProvider and input key mapper for LLM analysis"
```

---

## Task 7: LLM Analyzer (3-round analysis)

**Files:**
- Create: `src/llm/llm-analyzer.ts`
- Create: `src/llm/llm-analyzer.test.ts`

Depends on: Task 1 (provider), Task 2 (prompts + budget), Task 6 (raw samples)

- [ ] **Step 1: Write failing tests**

Key test cases:
1. Full 3-round flow: suspects → confirmed → deep analysis → causal chain
2. LLM-only disease path (empty suspects, non-empty llmOnlyDiseases)
3. Graceful degradation on LLM failure (returns empty + error message)
4. Skips remaining rounds when token budget exceeded
5. Returns correct tokensUsed total across all rounds

All tests use mock LLMProvider (vi.fn()).

- [ ] **Step 2: Implement llm-analyzer.ts**

```typescript
export interface LLMAnalyzerInput {
  provider: LLMProvider;
  suspects: RuleResult[];                    // from hybrid preFilter
  llmOnlyDiseases: DiseaseDefinition[];      // detection.type === "llm"
  metrics: MetricSet;
  samples: { recentSessions: SessionSample[]; memoryFiles: MemoryFileSample[]; skillDefinitions: SkillDefinitionSample[] };
  config: { maxTokensPerCheckup: number; maxTokensPerDiagnosis: number };
}

export interface LLMAnalyzerResult {
  confirmed: LLMDiagnosis[];
  causalChains: Array<{ name: string; rootCause: string; chain: string[]; impact: string }>;           // raw from LLM, parsed by causal-linker
  totalTokensUsed: number;
  error?: string;                            // degradation reason if LLM failed
}

export async function analyzeLLM(input: LLMAnalyzerInput): Promise<LLMAnalyzerResult>
```

3 rounds per spec §6.4. Token budget tracked cumulatively. If any round fails, capture error and stop (don't throw).

- [ ] **Step 3: Verify, commit**

```bash
git add src/llm/llm-analyzer.ts src/llm/llm-analyzer.test.ts
git commit -m "feat: add 3-round LLM analyzer with budget enforcement and degradation"
```

---

## Task 8: Stream Collector + OpenClaw Plugin

**Files:**
- Create: `src/plugin/stream-collector.ts`
- Create: `src/plugin/stream-collector.test.ts`
- Create: `src/plugin/plugin.ts`
- Create: `src/plugin/openclaw-types.ts`

Depends on: Task 3 (summarize), Task 4 (event buffer), Task 5 (dashboard server)

- [ ] **Step 1: Create openclaw-types.ts (dev shim)**

Minimal type interfaces matching `openclaw/plugin-sdk` exports. Used for development when openclaw is not installed. At runtime in plugin mode, the real types are used.

- [ ] **Step 2: Implement stream-collector.ts**

Registers 6 hooks (spec §5.3): `llm_output`, `after_tool_call`, `session_end`, `agent_end`, `subagent_ended`, `after_compaction`. Uses summarizeParams/summarizeResult from Task 3. Pushes to EventBuffer from Task 4.

- [ ] **Step 3: Implement plugin.ts entry point**

```typescript
export const clawdocPlugin: OpenClawPluginDefinition = {
  id: "clawdoc",
  name: "ClawDoc",
  description: "Agent health diagnostics",
  register(api) {
    // 1. Open persistent SQLite at ~/.clawdoc/clawdoc.db
    // 2. Create event buffer with flush to event store
    // 3. Register stream collector hooks
    // 4. Register periodic snapshot service (30min, with stop() cleanup)
    // 5. Register follow-up scheduler service (10min, spec §7.5)
    // 6. Register CLI subcommands (openclaw clawdoc checkup)
    // 7. Register dashboard HTTP route (/clawdoc/*)
  },
};
```

- [ ] **Step 4: Write tests with mock plugin API, verify, commit**

```bash
git add src/plugin/
git commit -m "feat: add OpenClaw plugin with stream collector, follow-up scheduler, and dashboard route"
```

---

## Task 9: Causal Chain Linker + Store

**Files:**
- Create: `src/llm/causal-linker.ts`
- Create: `src/llm/causal-linker.test.ts`
- Create: `src/store/causal-chain-store.ts`
- Create: `src/store/causal-chain-store.test.ts`

- [ ] **Step 1: Write causal linker tests**

Key test cases:
- Parses well-formed LLM response into CausalChain objects
- Returns empty for null/malformed LLM response
- Filters out chains referencing non-existent disease IDs
- Filters out single-element chains (no causal relationship)
- Normalizes rootCause to first chain element when mismatched

- [ ] **Step 2: Implement causal-linker.ts and causal-chain-store.ts**

The store provides: `insertChain()`, `queryChains(agentId)`, `deleteChains(agentId)`.

Convert LLM evidence descriptions (string) → Evidence.description ({ en: string }) with `type: "llm_analysis"` and `confidence` from LLMDiagnosis.

- [ ] **Step 3: Verify, commit**

```bash
git add src/llm/causal-linker.ts src/llm/causal-linker.test.ts src/store/causal-chain-store.ts src/store/causal-chain-store.test.ts
git commit -m "feat: add causal chain linker and persistence store"
```

---

## Task 10: Prescription Engine

**Files:**
- Create: `src/prescription/prescription-generator.ts` + test
- Create: `src/prescription/prescription-executor.ts` + test
- Create: `src/store/prescription-store.ts` + test
- Create: `src/prescription/backup.ts` + test
- Create: `src/prescription/followup.ts` + test

Depends on: Task 1 (LLM provider), Task 7 (analyzer — for integration context)

- [ ] **Step 1: Implement prescription-store.ts** (in `src/store/` following convention)

Uses the existing prescriptions + followups tables from schema v1:

```typescript
export interface PrescriptionStore {
  insertPrescription(rx: Prescription): void;
  queryPrescriptions(filter: { status?: string; diagnosisId?: string }): Prescription[];
  updatePrescriptionStatus(id: string, status: string, appliedAt?: number, rolledBackAt?: number): void;
  insertFollowup(record: FollowupRecord): void;
  getPendingFollowups(): FollowupRecord[];
  completeFollowup(id: string, result: FollowUpResult): void;
}
```

- [ ] **Step 2: Implement backup.ts with 3-way conflict detection**

Per spec §7.4:
- `createBackup(actions)`: read current files, compute SHA-256 preApplyHash
- `applyBackup(backup)`: 3-way comparison (preApplyHash, postApplyHash, currentHash)
  - currentHash === postApplyHash → safe rollback
  - currentHash === preApplyHash → already reverted, skip
  - neither → conflict, return conflict info

Test in temp directory:
- file_edit: create file → backup → edit → verify changed → rollback → verify restored
- file_delete: create file → backup → delete → verify gone → rollback → verify restored
- conflict: create file → backup → apply → externally modify → rollback → detect conflict
- already-reverted: create file → backup → apply → manually revert → rollback → skip (idempotent)

- [ ] **Step 3: Implement prescription-generator.ts**

Uses LLM provider to generate concrete prescriptions from disease + template:

```typescript
export async function generatePrescription(
  disease: DiseaseInstance,
  definition: DiseaseDefinition,
  provider: LLMProvider,
  context: { metrics: MetricSet },
): Promise<Prescription>
```

- [ ] **Step 4: Implement prescription-executor.ts (preview/apply/rollback)**

Upon successful apply, the executor MUST create 3 follow-up schedule rows in the `followups` table:
```typescript
const FOLLOWUP_CHECKPOINTS = [
  { checkpoint: "1h", delayMs: 60 * 60 * 1000 },
  { checkpoint: "24h", delayMs: 24 * 60 * 60 * 1000 },
  { checkpoint: "7d", delayMs: 7 * 24 * 60 * 60 * 1000 },
];
// After successful apply:
for (const cp of FOLLOWUP_CHECKPOINTS) {
  prescriptionStore.insertFollowup({
    id: ulid(),
    prescriptionId: rx.id,
    checkpoint: cp.checkpoint,
    scheduledAt: Date.now() + cp.delayMs,
    completedAt: null,
    resultJson: null,
  });
}
```
The plugin follow-up scheduler (Task 8, line ~795) queries `getPendingFollowups()` and processes due items.
- [ ] **Step 5: Implement followup.ts (verdict computation)**
- [ ] **Step 6: Write tests for all modules, verify, commit**

```bash
git add src/prescription/ src/store/prescription-store.ts src/store/prescription-store.test.ts
git commit -m "feat: add prescription engine with generate, execute, backup, rollback, followup"
```

---

## Task 11: Pipeline Integration

**Files:**
- Modify: `src/analysis/rule-engine.ts`
- Modify: `src/analysis/analysis-pipeline.ts`
- Modify: `src/commands/checkup.ts`
- Modify: `src/report/terminal-report.ts`
- Modify: `src/store/score-store.ts`

- [ ] **Step 1: Extend rule engine for hybrid preFilters**

Modify `evaluateRules()` to also handle `detection.type === "hybrid"`:
- Evaluate `detection.preFilter` (the RuleDetection part)
- If triggers: return RuleResult with `status: "suspect"` (not "confirmed")
- If not: skip
- LLM-only diseases (`detection.type === "llm"`) remain skipped by rule engine

- [ ] **Step 2: Add hybrid preFilter tests**

```typescript
describe("evaluateRules — hybrid diseases", () => {
  it("evaluates hybrid preFilter and returns status 'suspect'");
  it("skips hybrid disease when preFilter does not trigger");
  it("still skips LLM-only diseases");
  it("existing rule-only diseases still return 'confirmed'");
});
```

- [ ] **Step 3: Extend analysis pipeline with LLM step**

Update `CheckupResult`:
```typescript
export interface CheckupResult {
  healthScore: HealthScore;
  diseases: DiseaseInstance[];
  ruleResults: RuleResult[];
  causalChains?: CausalChain[];
  prescriptions?: Prescription[];
  llmAvailable: boolean;
  llmDegradationReason?: string; // "no_api_key" | "network_error" | "budget_exceeded" | "malformed_response"
}
```

When `noLlm` is false and LLM provider is available:
1. Run hybrid preFilter via extended evaluateRules() → suspects
2. Collect LLM-only diseases from registry
3. Fetch raw samples via RawSampleProvider
4. Call analyzeLLM()
5. Merge LLM results with rule results (convert evidence: string → { en: string }, set type: "llm_analysis")
6. Persist causal chains to causal_chain_store
7. Generate prescriptions for confirmed diseases
8. Persist HealthScore as JSON via insertHealthScoreWithJson()

When LLM fails: set `llmDegradationReason`, keep rule-only results.

- [ ] **Step 4: Update terminal report for causal chains + prescriptions**
- [ ] **Step 5: Run full test suite, fix any broken tests**
- [ ] **Step 6: Commit**

```bash
git add src/analysis/ src/commands/checkup.ts src/report/ src/store/score-store.ts
git commit -m "feat: integrate LLM analyzer, causal chains, and prescriptions into pipeline"
```

---

## Task 12: CLI Commands (rx + dashboard)

**Files:**
- Create: `src/commands/rx-cmd.ts`
- Create: `src/commands/dashboard-cmd.ts`
- Modify: `src/bin.ts`

- [ ] **Step 1: Implement rx-cmd.ts** (all prescription CLI commands from spec §9.1)
- [ ] **Step 2: Implement dashboard-cmd.ts**

```typescript
// Detects persistent DB at ~/.clawdoc/clawdoc.db or falls back to :memory:
// Generates auth token, prints to terminal
// Starts Hono server
```

- [ ] **Step 3: Wire into bin.ts**
- [ ] **Step 4: Smoke test**
- [ ] **Step 5: Commit**

```bash
git add src/commands/rx-cmd.ts src/commands/dashboard-cmd.ts src/bin.ts
git commit -m "feat: add rx and dashboard CLI commands"
```

---

## Task 13: E2E + Integration Tests

**Files:**
- Modify: `src/e2e.test.ts`

- [ ] **Step 1: Add Phase 2 E2E tests**

High-risk paths that MUST be covered:
1. `clawdoc checkup --json` includes `llmAvailable` and `llmDegradationReason` fields
2. `clawdoc rx list --json` returns array (empty when no prescriptions)
3. `clawdoc dashboard --help` shows --port option
4. LLM degradation path: when no API key, checkup still produces rule-only results with degradation reason
5. Plugin event buffer: mock hook calls → verify events reach SQLite (unit-level, not full OpenClaw)
6. Prescription apply/rollback in temp directory: create fixture → apply → verify changes → rollback → verify restored

- [ ] **Step 2: Run full test suite**
- [ ] **Step 3: Commit**

```bash
git add src/e2e.test.ts
git commit -m "feat: add Phase 2 E2E and integration tests"
```

---

## Summary

| Task | Track | Description | Dependencies | Parallel With |
|------|-------|-------------|-------------|--------------|
| 0 | — | Phase 2 types + schema v2 + store extensions | — | — |
| 1 | A | LLM Provider (provider-agnostic) | 0 | 2, 3, 4, 5, 6 |
| 2 | A | Prompts + Token Budget | 0 | 1, 3, 4, 5, 6 |
| 3 | B | Event Summarizer | 0 | 1, 2, 4, 5, 6 |
| 4 | B | Event Buffer | 0 | 1, 2, 3, 5, 6 |
| 5 | C | Dashboard (server + routes + SPA) | 0 | 1, 2, 3, 4, 6 |
| 6 | D | RawSampleProvider + Input Key Mapper | 0 | 1, 2, 3, 4, 5 |
| 7 | A | LLM Analyzer 3-round | 1, 2, 6 | 8, 9 |
| 8 | B | Stream Collector + Plugin | 3, 4, 5 | 7, 9 |
| 9 | A | Causal Chain Linker + Store | 7 | 10 |
| 10 | — | Prescription Engine | 1, 7 | — |
| 11 | — | Pipeline Integration | 7, 9, 10 | — |
| 12 | — | CLI Commands (rx + dashboard) | 5, 10, 11 | — |
| 13 | — | E2E + Integration Tests | 12 | — |

**Optimal agent team allocation:**

```
Round 0: Task 0 (types + schema) — sequential
Round 1: Task 1 | Task 2 | Task 3 | Task 4 | Task 5 | Task 6 — 6-way parallel
Round 2: Task 7 | Task 8 — 2-way parallel
Round 3: Task 9 | Task 10 — 2-way parallel
Round 4: Task 11 — sequential (pipeline integration)
Round 5: Task 12 — sequential (CLI commands)
Round 6: Task 13 — sequential (E2E)
```
