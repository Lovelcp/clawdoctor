# ClawDoc Phase 2 Implementation Plan (v2)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend ClawDoc with LLM-powered deep diagnosis (16 hybrid/LLM diseases + cross-department causal chains), a full prescription lifecycle (generate/preview/apply/rollback/follow-up), a Web Dashboard (Hono + SPA with 9 pages), and an OpenClaw Plugin for real-time event streaming.

**Architecture:** Four subsystems built on Phase 1's foundation (261 tests, 43 disease definitions, snapshot collector, rule engine, health scorer). LLM Analyzer plugs into the existing analysis pipeline. Prescription Engine operates on DiseaseInstance outputs. Dashboard is a Hono server serving a bundled SPA backed by the same SQLite store. Plugin registers OpenClaw hooks to stream events into persistent SQLite.

**Tech Stack:** Phase 1 stack + Hono + @hono/node-server (dashboard server), vanilla HTML/JS SPA with Chart.js (CDN dev / inlined prod), openclaw as peerDependency (plugin types).

**Spec:** `docs/2026-03-17-clawdoc-design.md`

---

## Key Architecture Decisions

### 1. DB Persistence Semantics (single, unambiguous behavior)

**Decision:** `clawdoc checkup` ALWAYS writes to `~/.clawdoc/clawdoc.db` (persistent).

There is no in-memory default for CLI mode. The Phase 1 `:memory:` behavior is replaced. Rationale:
- `rx list` needs to read diagnoses/prescriptions from the same DB that `checkup` wrote to
- Dashboard needs to read health scores, events, causal chains
- Plugin follow-up scheduler needs to query pending follow-ups

```
clawdoc checkup     → writes to ~/.clawdoc/clawdoc.db
clawdoc rx list     → reads from ~/.clawdoc/clawdoc.db
clawdoc dashboard   → reads from ~/.clawdoc/clawdoc.db
plugin mode         → writes to ~/.clawdoc/clawdoc.db (same file)
```

`CheckupOptions` gets a `dbPath?: string` (default: `~/.clawdoc/clawdoc.db`). For tests, pass `:memory:` explicitly. The `db?: Database.Database` from the previous plan is REMOVED — it created lifecycle ambiguity. Instead, the pipeline always opens/closes its own DB at the given path.

### 2. Dedup/Replacement Strategy for Repeated Checkups

**Decision:** "Latest checkup wins" — each checkup replaces previous results for the same agent.

Before inserting new results, the pipeline:
1. **Diagnoses:** Mark all previous `active` diagnoses → `resolved` (if not re-detected). Re-detected diseases UPDATE `last_seen` instead of INSERT.
2. **Prescriptions:** Delete all `pending` prescriptions (stale). Applied/rolled-back prescriptions are preserved (they have history).
3. **Causal chains:** Delete all previous chains for this agent (replaced by new analysis).
4. **Health scores:** Append new score (time series — no deletion). Dashboard reads latest.
5. **Events:** Append only (no dedup needed — events are immutable log entries).

This requires `diagnosisStore` to support upsert-by-diseaseId and `prescriptionStore`/`causalChainStore` to support bulk delete for an agent.

### 3. Dashboard Security (all endpoints authenticated, localhost only)

**Decision:**
- Server binds to `127.0.0.1` ONLY (never `0.0.0.0`)
- ALL API endpoints require bearer token (read AND write) — config, memory, skills, events all contain sensitive workspace data
- Only exception: `GET /` serves the SPA HTML shell without auth (the shell itself contains no data)
- Token is injected into the SPA via `window.__CLAWDOC_TOKEN__` in a `<script>` tag that the server injects before serving index.html
- SPA reads `window.__CLAWDOC_TOKEN__` and attaches `Authorization: Bearer <token>` to every `/api/*` fetch

```typescript
// server.ts — token injection
app.get("/", (c) => {
  const html = SPA_HTML.replace(
    "</head>",
    `<script>window.__CLAWDOC_TOKEN__="${opts.authToken}";</script></head>`
  );
  return c.html(html);
});

// Auth middleware — ALL /api/* routes
app.use("/api/*", async (c, next) => {
  if (!opts.authToken) return next(); // no token = dev mode
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${opts.authToken}`) return c.json({ error: "Unauthorized" }, 401);
  return next();
});
```

### 4. LLM Provider + Config Resolution (explicit and justified)

**Decision:** Phase 2 ships `AnthropicProvider` only. Config resolution is:

```
1. config.llm.model → overrides model name (e.g. "claude-opus-4-20250514")
2. config.llm.baseUrl → overrides API endpoint (for proxies, custom deployments)
3. ANTHROPIC_API_KEY env var → API key for Anthropic
4. Fallback model: "claude-sonnet-4-20250514"
```

`OPENCLAW_API_KEY` is NOT used — it was ambiguous (could be Anthropic key or another provider's key). Users who run OpenClaw with Anthropic should set `ANTHROPIC_API_KEY` directly. OpenClaw provider integration is deferred to Phase 3 where it can use the gateway's model routing API.

`resolveLLMProvider()` returns `null` (with reason) when:
- `config.llm.enabled === false` → reason: `"llm_disabled"`
- No `ANTHROPIC_API_KEY` → reason: `"no_api_key"`

These reasons flow into `CheckupResult.llmDegradationReason`.

### 5. Per-Disease LLM Context (inputDataKeys → RawSampleProvider → prompt)

**Decision:** The LLM Analyzer does NOT send a single global prompt. It iterates diseases and builds per-disease prompts using `resolveInputData()`.

```
For each disease to analyze:
  1. Get disease.detection.analysisPromptTemplate
  2. Call resolveInputData(disease, provider, metrics, agentId) → data dict
  3. Format: template + data dict → user prompt
  4. Call llmProvider.chat(systemPrompt, userPrompt)
  5. Parse response → LLMDiagnosis
```

Diseases are batched by department to reduce LLM calls (one call per department, not per disease). The Round 1 prompt includes all diseases for a department with their resolved data.

### 6. Backup Model (split pre/post apply phases)

**Decision:** `PrescriptionBackup` is built in TWO phases, not one.

```typescript
// Phase A: Before apply — record original state
interface BackupEntry {
  path: string;
  originalContent: string | null;  // null = file did not exist (new file created by apply)
  preApplyHash: string | null;     // null = file did not exist
}

// Phase B: After apply — record new state
interface FinalizedBackupEntry extends BackupEntry {
  postApplyHash: string;           // hash of file AFTER apply
}
```

The executor flow:
1. `createBackup(actions) → BackupEntry[]` — reads current files, computes preApplyHash
2. Apply all actions (file_edit, file_delete, file_create)
3. `finalizeBackup(entries) → FinalizedBackupEntry[]` — reads files again, computes postApplyHash
4. Persist the finalized backup

For file_delete: `originalContent` = file content before delete, `postApplyHash` = null (file gone).
For new file created by apply: `originalContent` = null, `preApplyHash` = null, `postApplyHash` = hash of new file.

Rollback:
- `postApplyHash` matches current → safe to restore `originalContent`
- `preApplyHash` matches current → already reverted, skip
- Neither → conflict, show three-way diff
- `originalContent === null` → rollback means delete the file (it was new)

### 7. CausalChain Persistence (with prescription backfill)

**Decision:** `causal-chain-store` has an `updateChainPrescription(chainId, prescriptionId)` method.

Pipeline order:
1. LLM Analyzer produces raw causal chains (without prescriptions)
2. `causalChainStore.insertChain(chain)` — `prescription_id` = NULL
3. Prescription Generator runs for each confirmed disease
4. For each chain whose `rootCause.diseaseId` has a generated prescription:
   `causalChainStore.updateChainPrescription(chain.id, prescription.id)`

### 8. Dashboard Standalone Data Flow (precise scope)

**Decision:** Dashboard startup runs a full snapshot + analysis cycle. This populates:

| API Endpoint | Data Source | Populated by standalone checkup? |
|-------------|------------|--------------------------------|
| GET /api/health | health_scores.health_score_json | Yes |
| GET /api/diseases | diagnoses table | Yes |
| GET /api/prescriptions | prescriptions table | Yes (pending Rx from LLM) |
| GET /api/metrics/:dept | aggregateMetrics(db) from events | Yes (snapshot events) |
| GET /api/trends | health_scores time series | Partial (only one data point) |
| GET /api/events | events table | Yes (snapshot events, no stream events) |
| GET /api/causal-chains | causal_chains table | Yes (if LLM enabled) |
| GET /api/config | config file (live read) | Yes |
| GET /api/skills | latest plugin_snapshot event | Yes |
| GET /api/memory | latest memory_snapshot event | Yes |

Gaps in standalone mode (explicitly documented in dashboard UI):
- `GET /api/trends`: only 1 data point (need multiple checkup runs for trends)
- `GET /api/events`: only snapshot events (no stream events without plugin)
- Skills/Memory: from latest snapshot, not real-time

### 9. HealthScore Persistence (store full JSON, not flat)

Schema v2 adds `health_score_json TEXT` column to `health_scores` table.

### 10. Plugin Types (peerDependency, not stubs)

`package.json` adds `"openclaw": "*"` as optional peerDependency. Dev-only type shim for development without OpenClaw installed.

### 11. Dashboard Build Strategy

**Development:** SPA loads Preact/HTM/Chart.js from esm.sh CDN. Single `index.html`, no build step.
**Production:** `scripts/bundle-spa.ts` inlines CDN resources into self-contained HTML.

### 12. Disease Definition Alignment

Phase 1 has all 43 diseases with real `analysisPromptTemplate` and `inputDataKeys`. Phase 2 adds `RawSampleProvider` + `input-key-mapper` to resolve `inputDataKeys` to live data.

### 13. Existing Schema (clarification)

Phase 1 schema v1 already has `prescriptions`, `followups`, `events`, `diagnoses`, `health_scores` tables. Phase 2 schema v2 adds: `causal_chains` table + `health_score_json` column.

### 14. API Route Count

The dashboard has **15** API routes (not 14):
- 12 GET: health, diseases, diseases/:id, prescriptions, prescriptions/:id/followup, metrics/:dept, trends, events, causal-chains, config, skills, memory
- 3 write: PUT config, POST prescriptions/:id/apply, POST prescriptions/:id/rollback

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
│   ├── server.test.ts             # All 15 API routes tested against in-memory DB
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
    originalContent: string | null;   // null = file did not exist before apply
    preApplyHash: string | null;      // null = file did not exist before apply
    postApplyHash: string;            // hash AFTER apply (computed in finalization phase)
  }>;
}
// NOTE: Backup is built in two phases (see Architecture Decision 6):
// Phase A (before apply): createBackup() records originalContent + preApplyHash
// Phase B (after apply): finalizeBackup() computes postApplyHash

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

Extend the existing score-store:

1. **Extend `HealthScoreRow`** to include `health_score_json: string | null` (new column from schema v2)
2. **Extend `HealthScoreRecord`** to include `healthScoreJson?: string`
3. **Update `rowToRecord()`** to map the new column
4. **Add two new methods to ScoreStore interface:**

```typescript
insertHealthScoreWithJson(record: HealthScoreRecord, healthScoreJson: string): void;
queryLatestScore(agentId: string): HealthScoreRecord | null;
// → SELECT ... ORDER BY timestamp DESC LIMIT 1
// Returns null if no scores exist
```

5. **Existing `insertHealthScore()` is preserved** for backward compatibility (Phase 1 callers). It inserts with `health_score_json = NULL`. Phase 2's pipeline will call `insertHealthScoreWithJson()` instead.

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

- [ ] **Step 1: Implement server.ts with ALL 15 API routes inline**

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

**Standalone dashboard data flow:** Dashboard reads from `~/.clawdoc/clawdoc.db` (same file that `clawdoc checkup` writes to). If no recent data exists, it runs a fresh checkup first:

```typescript
// In dashboard-cmd.ts:
const dbPath = join(homedir(), ".clawdoc", "clawdoc.db");

// Open a read connection to check freshness
const checkDb = openDatabase(dbPath);
const scoreStore = createScoreStore(checkDb);
const latest = scoreStore.queryLatestScore("default");
checkDb.close();

// If stale or no data, run a fresh checkup (writes to same DB file)
if (!latest || Date.now() - latest.timestamp > 3600_000) {
  console.log("Running fresh checkup to populate dashboard data...");
  await runCheckup({ agentId: "default", stateDir, workspaceDir, noLlm: !config.llm.enabled });
}

// Open a read connection for the dashboard server
const db = openDatabase(dbPath);
await startDashboard({ db, config, port, authToken });
```

Note: `runCheckup` opens its own connection, writes, and closes. Dashboard opens a separate read connection. This avoids the lifecycle ambiguity.

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

- [ ] **Step 5: Create scripts/bundle-spa.ts (production build)**

A simple script that downloads CDN resources and inlines them into index.html:
```typescript
// scripts/bundle-spa.ts
// 1. Read src/dashboard/public/index.html
// 2. For each <script src="https://esm.sh/..."> tag:
//    - Fetch the URL, read content
//    - Replace <script src="..."> with <script>{inlined content}</script>
// 3. Write to dist/dashboard/index.html
```

- [ ] **Step 6: Verify server + SPA manually**
- [ ] **Step 6: Commit**

```bash
git add src/dashboard/ package.json pnpm-lock.yaml
git commit -m "feat: add dashboard with Hono server, 15 API routes, and 9-page SPA"
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
  rawSampleProvider: RawSampleProvider;       // for per-disease context resolution via resolveInputData()
  agentId: string;
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

**Per-disease context resolution (Architecture Decision 5):**
Round 1 does NOT send one global prompt. It groups diseases by department, then for each group:
1. Calls `resolveInputData(disease, input.rawSampleProvider, input.metrics, agentId)` per disease
2. Formats disease-specific data into the prompt using `disease.detection.analysisPromptTemplate`
3. Sends ONE LLM call per department batch (not per disease — batching for efficiency)

This means `LLMAnalyzerInput` needs a `rawSampleProvider: RawSampleProvider` field (not just flat samples). The analyzer calls `resolveInputData()` from the input-key-mapper (Task 6) internally.

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

The store provides:
- `insertChain(chain)` — insert with `prescription_id = NULL`
- `queryChains(agentId)` — query all chains for agent
- `deleteByAgent(agentId)` — delete all chains for agent (used by dedup strategy)
- `updateChainPrescription(chainId, prescriptionId)` — backfill prescription after generation (Architecture Decision 7)

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

Uses the existing prescriptions + followups tables from schema v1.

**Column mapping (Prescription → prescriptions table):**
- `rx.id` → `id`
- `rx.diagnosisId` → `diagnosis_id`
- `rx.level` → `type` column (the SQL column is named "type" for PrescriptionLevel)
- `rx.actions` → `actions_json` (JSON serialized)
- `rx.risk` + `rx.estimatedImprovement` → stored inside `actions_json` as metadata wrapper
- `status` → "pending" on insert

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

- [ ] **Step 3: Refactor runCheckup DB to always-persistent**

Replace the Phase 1 `:memory:` default with `~/.clawdoc/clawdoc.db`:

```typescript
export interface CheckupOptions {
  agentId: string;
  stateDir: string;
  workspaceDir: string;
  departments?: Department[];
  since?: number;
  noLlm: boolean;
  configPath?: string;
  dbPath?: string;  // default: ~/.clawdoc/clawdoc.db. Use ":memory:" for tests only.
}

// In runCheckup():
const dbDir = join(opts.stateDir ?? join(homedir(), ".clawdoc"));
mkdirSync(dbDir, { recursive: true });
const dbPath = opts.dbPath ?? join(dbDir, "clawdoc.db");
const db = openDatabase(dbPath);
try {
  // ... pipeline writes to persistent DB ...
} finally {
  db.close(); // always close — other commands open their own connection
}
```

**Dedup strategy (latest checkup wins):**
Before inserting new results:
```typescript
// 1. Resolve previous active diagnoses
const previousDiagnoses = diagnosisStore.queryDiagnoses({ agentId, status: "active" });

// 2. Delete stale pending prescriptions (not yet applied)
prescriptionStore.deletePendingByAgent(agentId);

// 3. Delete previous causal chains (replaced by new analysis)
causalChainStore.deleteByAgent(agentId);

// 4. After new analysis:
// - Re-detected diseases: UPDATE last_seen
// - New diseases: INSERT
// - Disappeared diseases: UPDATE status → "resolved"
diagnosisStore.reconcile(agentId, previousDiagnoses, newDiseases);
```

Add these methods to the stores:
- `prescriptionStore.deletePendingByAgent(agentId)`
- `causalChainStore.deleteByAgent(agentId)`
- `diagnosisStore.reconcile(agentId, previous, current)` — handles upsert + resolve logic

- [ ] **Step 4: Extend analysis pipeline with LLM step**

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

**Always (both LLM and no-LLM modes):**
0. **Dedup first:** `diagnosisStore.reconcile()` to resolve stale diseases, `prescriptionStore.deletePendingByAgent()`, `causalChainStore.deleteByAgent()`

**When `noLlm` is false and LLM provider is available:**
1. Run hybrid preFilter via extended evaluateRules() → suspects with `status: "suspect"`
2. Collect LLM-only diseases from registry (`detection.type === "llm"`)
3. Fetch raw samples via RawSampleProvider
4. Call `analyzeLLM()` — iterates diseases, calls `resolveInputData()` per disease for per-disease prompts, batches by department
5. Merge LLM results with rule results:
   - Convert `LLMDiagnosis.evidence[].description` (string) → `Evidence.description` (`{ en: string }`)
   - Set `Evidence.type` = `"llm_analysis"`, `Evidence.confidence` from LLMDiagnosis
6. **Persist** all diseases via `diagnosisStore.reconcile(agentId, previous, current)` — insert new, update re-detected, resolve disappeared
7. **Persist** causal chains via `causalChainStore.insertChain()` — `prescription_id = NULL` initially
8. Generate prescriptions for confirmed diseases via `generatePrescription()`
9. **Persist** prescriptions via `prescriptionStore.insertPrescription()` — status = `"pending"`
10. **Backfill** causal chain prescriptions: `causalChainStore.updateChainPrescription(chainId, rxId)`
11. NOTE: Follow-ups are NOT scheduled here — only on `rx apply` (Task 10 Step 4)
12. Persist HealthScore as JSON via `insertHealthScoreWithJson()`

**When LLM fails:** set `llmDegradationReason`, keep rule-only results, still run steps 0, 6, 12.

- [ ] **Step 5: Update terminal report for causal chains + prescriptions**
- [ ] **Step 6: Run full test suite, fix any broken tests**
- [ ] **Step 7: Commit**

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
7. **Schema migration v1→v2:** Create a v1 database with test data, run openDatabase() (triggers migration), verify causal_chains table exists and health_score_json column is present
8. **Dedup/replacement:** Run checkup twice on same fixtures, verify no duplicate diagnoses/prescriptions/causal chains — second run replaces first
9. **Cross-command data flow:** Run `checkup --json`, then `rx list --json` — verify prescriptions from checkup are visible in rx list (both read from same ~/.clawdoc/clawdoc.db)

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
| 7 | A | LLM Analyzer 3-round | 1, 2, 6 | 8 |
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
