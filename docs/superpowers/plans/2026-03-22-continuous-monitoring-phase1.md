# Continuous Monitoring Phase 1: Read-Only Monitor + Alerting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a foreground monitor process that continuously checks OpenClaw infrastructure health via Probes, matches findings to diseases, sends alert notifications (Telegram + Webhook), and records all activity to a Chart audit trail. No automated interventions in this phase — all triage results are alert-only.

**Architecture:** Probes run on non-overlapping timers (setTimeout-after-completion). Each probe emits Findings that are matched directly to DiseaseDefinitions by ID. Results flow through a Triage engine (alert-only mode), Page dispatcher (Telegram + Webhook with dedup/rate-limit), and Chart store (SQLite). Monitor state is persisted to a file for cross-process `status` reads.

**Tech Stack:** TypeScript (ESM), better-sqlite3 (WAL), commander.js (CLI), vitest (tests), node:child_process (execFile for probes)

**Spec:** `docs/superpowers/specs/2026-03-22-continuous-monitoring-design.md`

**Phase scope (from spec):**
- Probe interface + ProbeScheduler + gateway/session/cost probes
- ProbeDiseaseMatch (direct disease lookup, NOT rule engine)
- INFRA-001, BHV-010, CST-010 disease definitions + infra department
- Page Dispatcher + Telegram + Webhook channels + dedup + rate limiting
- Chart store + `clawdoc chart` CLI
- Monitor Engine (foreground, state file, heartbeat)
- `clawdoc monitor start/stop/status`
- Config extensions + validation
- Schema migration v3
- **NO interventions, NO consent** — triage is alert-only (all results → red)
- 80%+ test coverage

---

## File Structure

### New Files (create)

| File | Responsibility |
|------|---------------|
| `src/types/monitor.ts` | ProbeId, ProbeStatus, ProbeConfig, ProbeResult, Finding, ProbeError, TriageLevel, TriageResult, PagePriority, PageMessage, ChartEntry, ChartOutcome, MonitorStatus, MonitorStateFile |
| `src/diseases/infra.ts` | INFRA-001 through INFRA-006 disease definitions |
| `src/monitor/probe.ts` | Probe type, ProbeDeps, ShellExecutor, ShellResult |
| `src/monitor/probe-scheduler.ts` | Non-overlapping async probe scheduling |
| `src/monitor/probes/gateway-probe.ts` | Gateway process health check |
| `src/monitor/probes/session-probe.ts` | Stuck session detection (file mtime) |
| `src/monitor/probes/cost-probe.ts` | Cost anomaly detection (rolling average) |
| `src/monitor/probe-disease-match.ts` | Finding → DiseaseInstance direct lookup |
| `src/triage/triage-engine.ts` | Severity → TriageLevel (alert-only mode for Phase 1; own top-level module per spec, will grow in Phase 2) |
| `src/monitor/monitor-engine.ts` | Orchestrator: scheduler + dispatcher + heartbeat |
| `src/monitor/monitor-state.ts` | State file read/write (atomic JSON) |
| `src/page/page-dispatcher.ts` | Dedup, rate limit, dispatch to channels |
| `src/page/page-channel.ts` | PageChannel type + SendResult |
| `src/page/channels/telegram-page.ts` | Telegram Bot API alert sending |
| `src/page/channels/webhook-page.ts` | Webhook POST with HMAC signing |
| `src/chart/chart-store.ts` | ChartEntry SQLite CRUD + queries |
| `src/commands/monitor-cmd.ts` | `clawdoc monitor start/stop/status` |
| `src/commands/chart-cmd.ts` | `clawdoc chart` with filters |
| Tests (co-located `.test.ts` for each module above) |

### Modified Files

| File | Change |
|------|--------|
| `src/types/domain.ts` | Add `"infra"` to `Department` union |
| `src/types/config.ts` | Add `monitor`, `page`, `consent`, `weights.infra` fields + defaults |
| `src/types/events.ts` | Add `"probe_result"` to `EventType`, `ProbeResultData` to `EventDataMap` |
| `src/diseases/registry.ts` | Import + merge `infraDiseases` |
| `src/diseases/behavior.ts` | Add BHV-010 (BHV-011 deferred to Phase 2 — hybrid detection, no probe in Phase 1) |
| `src/diseases/cost.ts` | Add CST-010 |
| `src/store/database.ts` | Migration v3 (chart_entries, page_dedup, health_scores.infra + forward-looking: consent_requests, intervention_retries) |
| `src/types/config.ts` | Add `infra: 0.15` to DEFAULT_CONFIG.weights immediately (prevents type errors after Department union change) |
| `src/analysis/health-scorer.ts` | Handle 7 departments, null infra when no data |
| `src/dashboard/server.ts` | Add `"infra"` to `VALID_DEPARTMENTS` |
| `src/i18n/locales.ts` | Add ~30 new i18n keys for monitor/page/chart |
| `src/bin.ts` | Register monitor + chart commands |

---

## Tasks

### Task 1: Extend Department Type + Event Types

**Files:**
- Modify: `src/types/domain.ts`
- Modify: `src/types/events.ts`
- Create: `src/types/monitor.ts`
- Test: `src/types/monitor.test.ts`

- [ ] **Step 1: Add "infra" to Department union**

In `src/types/domain.ts`, change the Department type:

```typescript
export type Department =
  | "vitals"
  | "skill"
  | "memory"
  | "behavior"
  | "cost"
  | "security"
  | "infra";       // Infrastructure
```

- [ ] **Step 2: Add probe_result to EventType + EventDataMap**

In `src/types/events.ts`, add to the EventType union:

```typescript
export type EventType =
  | "llm_call" | "tool_call" | "session_lifecycle" | "agent_lifecycle"
  | "subagent_event" | "message_event" | "compaction_event"
  | "config_snapshot" | "memory_snapshot" | "plugin_snapshot"
  | "probe_result";    // NEW: continuous monitor probe results
```

Add the data type and mapping:

```typescript
export interface ProbeResultData {
  readonly probeId: string;
  readonly status: string;
  readonly findings: ReadonlyArray<{
    readonly code: string;
    readonly message: { en: string; [locale: string]: string };
    readonly severity: "critical" | "warning" | "info";
    readonly context: Readonly<Record<string, unknown>>;
  }>;
  readonly metrics: Readonly<Record<string, number>>;
}

// Add to EventDataMap:
//   probe_result: ProbeResultData;
```

- [ ] **Step 3: Create monitor types file**

Create `src/types/monitor.ts` with all monitor-specific types. See spec for full definitions. Key types: `ProbeId`, `ProbeStatus`, `ProbeConfig`, `ProbeResult`, `Finding`, `ProbeError`, `ProbeStats`, `TriageLevel`, `TriageResult`, `PagePriority`, `PageMessage`, `SendResult`, `ChartEntry`, `ChartOutcome`, `MonitorStateFile`, `MonitorStatus`.

```typescript
import type { Severity, I18nString, DiseaseInstance } from "./domain.js";

export type ProbeId = "gateway" | "cron" | "auth" | "session" | "budget" | "cost";

export type ProbeStatus = "ok" | "warning" | "critical" | "error";

export interface ProbeConfig {
  readonly id: ProbeId;
  readonly intervalMs: number;
  readonly enabled: boolean;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface Finding {
  readonly code: string;
  readonly message: I18nString;
  readonly severity: Severity;
  readonly context: Readonly<Record<string, unknown>>;
}

export interface ProbeResult {
  readonly probeId: ProbeId;
  readonly status: ProbeStatus;
  readonly findings: readonly Finding[];
  readonly metrics: Readonly<Record<string, number>>;
  readonly timestamp: number;
}

export interface ProbeError {
  readonly probeId: ProbeId;
  readonly error: string;
  readonly timestamp: number;
}

export interface ProbeStats {
  readonly lastRunAt: number | null;
  readonly lastStatus: ProbeStatus | null;
  readonly runCount: number;
  readonly consecutiveErrors: number;
  readonly totalErrors: number;
}

export type TriageLevel = "green" | "yellow" | "red";

export interface TriageResult {
  readonly level: TriageLevel;
  readonly diseaseId: string;
  readonly agentId?: string;
  readonly reason: I18nString;
}

export type PagePriority = "info" | "warning" | "critical" | "emergency";

export interface PageMessage {
  readonly priority: PagePriority;
  readonly title: I18nString;
  readonly body: I18nString;
  readonly diseaseId?: string;
  readonly probeId?: ProbeId;
  readonly agentId?: string;
  readonly timestamp: number;
}

export interface SendResult {
  readonly success: boolean;
  readonly error?: string;
}

export type ChartOutcome = "success" | "failed" | "skipped" | "expired" | "cancelled";

export interface ChartEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly probeId?: ProbeId;
  readonly diseaseId?: string;
  readonly agentId?: string;
  readonly triageLevel?: TriageLevel;
  readonly interventionId?: string;
  readonly action: string;
  readonly outcome: ChartOutcome;
  readonly consentChannel?: string;
  readonly consentResponse?: string;
  readonly snapshotId?: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface MonitorStateFile {
  readonly pid: number;
  readonly startedAt: number;
  readonly lastHeartbeat: number;
  readonly probeStats: Readonly<Record<string, ProbeStats>>;
  readonly pendingConsents: number;
  readonly todayInterventions: { readonly executed: number; readonly failed: number };
}

export interface MonitorStatus {
  readonly running: boolean;
  readonly pid: number;
  readonly startedAt: number | null;
  readonly probeStats: Readonly<Record<string, ProbeStats>>;
  readonly pendingConsents: number;
  readonly todayInterventions: { readonly executed: number; readonly failed: number };
}
```

- [ ] **Step 4: Write type validation test**

Create `src/types/monitor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { ProbeId, ProbeStatus, ProbeConfig, ProbeResult, Finding, ChartEntry, TriageLevel, PagePriority } from "./monitor.js";

describe("monitor types", () => {
  it("ProbeResult satisfies the type contract", () => {
    const result: ProbeResult = {
      probeId: "gateway",
      status: "ok",
      findings: [],
      metrics: { uptime: 100 },
      timestamp: Date.now(),
    };
    expect(result.probeId).toBe("gateway");
    expect(result.status).toBe("ok");
  });

  it("Finding uses existing Severity type", () => {
    const finding: Finding = {
      code: "INFRA-001",
      message: { en: "Gateway down", zh: "网关离线" },
      severity: "critical",
      context: { pid: null },
    };
    expect(finding.severity).toBe("critical");
  });

  it("ChartEntry fields are optional where spec requires", () => {
    const entry: ChartEntry = {
      id: "test",
      timestamp: Date.now(),
      action: "probe-error",
      outcome: "failed",
      details: {},
    };
    expect(entry.probeId).toBeUndefined();
    expect(entry.diseaseId).toBeUndefined();
    expect(entry.triageLevel).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm test src/types/monitor.test.ts`
Expected: PASS

- [ ] **Step 6: Add "infra" to DEFAULT_CONFIG.weights**

In `src/types/config.ts`, update `DEFAULT_CONFIG.weights` to include `infra: 0.15` and re-normalize existing weights:

```typescript
weights: {
  vitals: 0.06, skill: 0.22, memory: 0.12,
  behavior: 0.22, cost: 0.10, security: 0.13, infra: 0.15,
}
```

This MUST happen in Task 1 — otherwise `Record<Department, number>` will fail type-check for all downstream code.

- [ ] **Step 7: Run type check**

Run: `pnpm check`
Expected: PASS (no type errors)

- [ ] **Step 8: Commit**

```bash
git add src/types/domain.ts src/types/events.ts src/types/monitor.ts src/types/monitor.test.ts src/types/config.ts
git commit -m "feat: add infra department, probe_result event type, and monitor types"
```

---

### Task 2: Schema Migration v3

**Files:**
- Modify: `src/store/database.ts`
- Test: `src/store/database.test.ts` (extend existing)

- [ ] **Step 1: Write migration test**

Add test to `src/store/database.test.ts` (or create if not exists):

```typescript
import { describe, it, expect } from "vitest";
import { openDatabase } from "./database.js";

describe("migration v3", () => {
  it("creates chart_entries table", () => {
    const db = openDatabase(":memory:");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chart_entries'").all();
    expect(tables).toHaveLength(1);
  });

  it("creates page_dedup table", () => {
    const db = openDatabase(":memory:");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='page_dedup'").all();
    expect(tables).toHaveLength(1);
  });

  it("creates intervention_retries table", () => {
    const db = openDatabase(":memory:");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='intervention_retries'").all();
    expect(tables).toHaveLength(1);
  });

  it("adds infra column to health_scores", () => {
    const db = openDatabase(":memory:");
    const columns = db.prepare("PRAGMA table_info(health_scores)").all() as Array<{ name: string }>;
    const names = columns.map(c => c.name);
    expect(names).toContain("infra");
  });

  it("creates consent_requests table", () => {
    const db = openDatabase(":memory:");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='consent_requests'").all();
    expect(tables).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test — should FAIL**

Run: `pnpm test src/store/database.test.ts`
Expected: FAIL (tables don't exist yet)

- [ ] **Step 3: Implement migration v3**

In `src/store/database.ts`, bump `CURRENT_SCHEMA_VERSION` to 3 and add `migration3`:

```typescript
function migration3(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`ALTER TABLE health_scores ADD COLUMN infra REAL;`);

    db.exec(`
      CREATE TABLE chart_entries (
        id              TEXT PRIMARY KEY,
        timestamp       INTEGER NOT NULL,
        probe_id        TEXT,
        disease_id      TEXT,
        agent_id        TEXT,
        triage_level    TEXT,
        intervention_id TEXT,
        action          TEXT NOT NULL,
        outcome         TEXT NOT NULL,
        consent_channel TEXT,
        consent_response TEXT,
        snapshot_id     TEXT,
        details         TEXT
      );
      CREATE INDEX idx_chart_ts ON chart_entries(timestamp);
      CREATE INDEX idx_chart_probe ON chart_entries(probe_id);
      CREATE INDEX idx_chart_outcome ON chart_entries(outcome);
    `);

    db.exec(`
      CREATE TABLE consent_requests (
        id              TEXT PRIMARY KEY,
        timestamp       INTEGER NOT NULL,
        triage_level    TEXT NOT NULL,
        intervention_id TEXT NOT NULL,
        disease_id      TEXT NOT NULL,
        agent_id        TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        channels        TEXT NOT NULL,
        responded_at    INTEGER,
        responded_via   TEXT,
        responded_by    TEXT,
        expires_at      INTEGER NOT NULL,
        context         TEXT
      );
      CREATE INDEX idx_consent_status ON consent_requests(status);
      CREATE INDEX idx_consent_expires ON consent_requests(expires_at);
    `);

    db.exec(`
      CREATE TABLE page_dedup (
        key             TEXT PRIMARY KEY,
        priority        TEXT NOT NULL,
        last_sent_at    INTEGER NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE intervention_retries (
        disease_id      TEXT NOT NULL,
        agent_id        TEXT NOT NULL DEFAULT 'default',
        intervention_id TEXT NOT NULL,
        retry_count     INTEGER NOT NULL DEFAULT 0,
        last_attempted  INTEGER NOT NULL,
        suppressed      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (disease_id, agent_id, intervention_id)
      );
    `);
  })();
}
```

Add to MIGRATIONS: `3: migration3`. Update `CURRENT_SCHEMA_VERSION = 3`.

> **Forward-looking tables:** `consent_requests` and `intervention_retries` are created in v3 even though they're used in Phase 2/3. This avoids requiring another migration when those phases ship. The tables are empty until Phase 2/3 code writes to them.

- [ ] **Step 4: Run test — should PASS**

Run: `pnpm test src/store/database.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/database.ts src/store/database.test.ts
git commit -m "feat: schema migration v3 — chart, consent, dedup, retries tables + infra column"
```

---

### Task 3: Disease Definitions (INFRA + BHV-010 + CST-010)

**Files:**
- Create: `src/diseases/infra.ts`
- Modify: `src/diseases/behavior.ts`
- Modify: `src/diseases/cost.ts`
- Modify: `src/diseases/registry.ts`
- Test: `src/diseases/infra.test.ts`

- [ ] **Step 1: Write test for infra diseases**

```typescript
import { describe, it, expect } from "vitest";
import { infraDiseases } from "./infra.js";

describe("infra diseases", () => {
  it("defines 6 diseases", () => {
    expect(infraDiseases).toHaveLength(6);
  });

  it("all diseases have department 'infra'", () => {
    for (const d of infraDiseases) {
      expect(d.department).toBe("infra");
    }
  });

  it("all IDs start with INFRA-", () => {
    for (const d of infraDiseases) {
      expect(d.id).toMatch(/^INFRA-\d{3}$/);
    }
  });

  it("has i18n name and description for en and zh", () => {
    for (const d of infraDiseases) {
      expect(d.name.en).toBeTruthy();
      expect(d.name.zh).toBeTruthy();
      expect(d.description.en).toBeTruthy();
      expect(d.description.zh).toBeTruthy();
    }
  });

  it("INFRA-001 is critical severity", () => {
    const gw = infraDiseases.find(d => d.id === "INFRA-001");
    expect(gw).toBeDefined();
    expect(gw!.defaultSeverity).toBe("critical");
  });

  it("INFRA-005 is critical severity", () => {
    const budget = infraDiseases.find(d => d.id === "INFRA-005");
    expect(budget).toBeDefined();
    expect(budget!.defaultSeverity).toBe("critical");
  });
});
```

- [ ] **Step 2: Run test — should FAIL**

Run: `pnpm test src/diseases/infra.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Create `src/diseases/infra.ts`**

Define 6 INFRA diseases following the existing pattern from vitals.ts. Each disease needs: id, department, category, name (en/zh), description (en/zh), rootCauses, detection (type: "rule"), prescriptionTemplate, relatedDiseases, defaultSeverity, tags. See spec for disease names and severities.

- [ ] **Step 4: Run test — should PASS**

Run: `pnpm test src/diseases/infra.test.ts`
Expected: PASS

- [ ] **Step 5: Add BHV-010 to behavior.ts**

Append BHV-010 (Session Coma, warning, rule detection) to the `behaviorDiseases` array in `src/diseases/behavior.ts`. Follow existing pattern.

> **Note:** BHV-011 (Silent Completion Syndrome) is deferred to Phase 2 — it uses hybrid detection and no probe emits it in Phase 1.

- [ ] **Step 6: Add CST-010 to cost.ts**

Append CST-010 (Cost Spike Fever, critical) to `costDiseases` array in `src/diseases/cost.ts`.

> **Note:** INFRA-002 through INFRA-006 are forward declarations. They become active when cron, auth, and budget probes are added in Phase 2. Having them in the registry now means `clawdoc checkup` can display the infra department, and community plugins can reference these IDs.

- [ ] **Step 7: Update registry**

In `src/diseases/registry.ts`:
- Import `infraDiseases` from `./infra.js`
- Add `...infraDiseases` to `ALL_DISEASES` array

- [ ] **Step 8: Run all disease tests + type check**

Run: `pnpm test src/diseases/ && pnpm check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/diseases/infra.ts src/diseases/infra.test.ts src/diseases/behavior.ts src/diseases/cost.ts src/diseases/registry.ts
git commit -m "feat: add infra department diseases (INFRA-001~006) + BHV-010, BHV-011, CST-010"
```

---

### Task 4: Chart Store

**Files:**
- Create: `src/chart/chart-store.ts`
- Test: `src/chart/chart-store.test.ts`

- [ ] **Step 1: Write chart store tests**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../store/database.js";
import { createChartStore } from "./chart-store.js";
import type Database from "better-sqlite3";
import type { ChartEntry } from "../types/monitor.js";

describe("ChartStore", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  it("inserts and retrieves a chart entry", () => {
    const store = createChartStore(db);
    const entry: ChartEntry = {
      id: "01ABC",
      timestamp: Date.now(),
      probeId: "gateway",
      diseaseId: "INFRA-001",
      agentId: "main",
      triageLevel: "red",
      action: "alert-sent",
      outcome: "success",
      details: { message: "Gateway down" },
    };
    store.insert(entry);
    const results = store.query({ limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("01ABC");
    expect(results[0].probeId).toBe("gateway");
  });

  it("filters by probe", () => {
    const store = createChartStore(db);
    store.insert({ id: "1", timestamp: 1000, probeId: "gateway", action: "a", outcome: "success", details: {} });
    store.insert({ id: "2", timestamp: 2000, probeId: "cron", action: "b", outcome: "failed", details: {} });
    const results = store.query({ probeId: "gateway", limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].probeId).toBe("gateway");
  });

  it("filters by outcome", () => {
    const store = createChartStore(db);
    store.insert({ id: "1", timestamp: 1000, action: "a", outcome: "success", details: {} });
    store.insert({ id: "2", timestamp: 2000, action: "b", outcome: "failed", details: {} });
    const results = store.query({ outcome: "failed", limit: 10 });
    expect(results).toHaveLength(1);
  });

  it("filters by since timestamp", () => {
    const store = createChartStore(db);
    store.insert({ id: "1", timestamp: 1000, action: "old", outcome: "success", details: {} });
    store.insert({ id: "2", timestamp: 5000, action: "new", outcome: "success", details: {} });
    const results = store.query({ since: 3000, limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("new");
  });

  it("returns results ordered by timestamp desc", () => {
    const store = createChartStore(db);
    store.insert({ id: "1", timestamp: 1000, action: "first", outcome: "success", details: {} });
    store.insert({ id: "2", timestamp: 3000, action: "third", outcome: "success", details: {} });
    store.insert({ id: "3", timestamp: 2000, action: "second", outcome: "success", details: {} });
    const results = store.query({ limit: 10 });
    expect(results[0].action).toBe("third");
    expect(results[1].action).toBe("second");
    expect(results[2].action).toBe("first");
  });

  it("respects limit", () => {
    const store = createChartStore(db);
    for (let i = 0; i < 5; i++) {
      store.insert({ id: `${i}`, timestamp: i * 1000, action: `a${i}`, outcome: "success", details: {} });
    }
    const results = store.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test — should FAIL**

Run: `pnpm test src/chart/chart-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement chart store**

Create `src/chart/chart-store.ts` following the event-store pattern:

```typescript
import type Database from "better-sqlite3";
import type { ChartEntry, ChartOutcome } from "../types/monitor.js";

export interface ChartFilter {
  readonly probeId?: string;
  readonly outcome?: ChartOutcome;
  readonly since?: number;
  readonly limit: number;
}

export interface ChartStore {
  insert(entry: ChartEntry): void;
  query(filter: ChartFilter): ChartEntry[];
}

export function createChartStore(db: Database.Database): ChartStore {
  // Parameterized insert + dynamic WHERE query building
  // JSON.stringify for details field
  // Parse details back with JSON.parse on read
  // ORDER BY timestamp DESC, LIMIT
}
```

- [ ] **Step 4: Run test — should PASS**

Run: `pnpm test src/chart/chart-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chart/chart-store.ts src/chart/chart-store.test.ts
git commit -m "feat: chart store — SQLite CRUD for intervention audit trail"
```

---

### Task 5: Probe Interface + Scheduler

**Files:**
- Create: `src/monitor/probe.ts`
- Create: `src/monitor/probe-scheduler.ts`
- Test: `src/monitor/probe-scheduler.test.ts`

- [ ] **Step 1: Create probe interface**

Create `src/monitor/probe.ts`:

```typescript
import type { ProbeConfig, ProbeResult } from "../types/monitor.js";
import type { EventStore } from "../store/event-store.js";

export interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type ShellExecutor = (
  bin: string,
  args: readonly string[],
  opts?: { readonly timeoutMs?: number; readonly cwd?: string }
) => Promise<ShellResult>;

export interface ProbeDeps {
  readonly stateDir: string;
  readonly exec: ShellExecutor;
  readonly store: EventStore;
}

export type Probe = (config: ProbeConfig, deps: ProbeDeps) => Promise<ProbeResult>;
```

- [ ] **Step 2: Write scheduler tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProbeScheduler } from "./probe-scheduler.js";
import type { ProbeConfig, ProbeResult, ProbeStats } from "../types/monitor.js";
import type { Probe } from "./probe.js";

describe("ProbeScheduler", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("runs a probe at the configured interval", async () => {
    const fn = vi.fn<Probe>().mockResolvedValue({
      probeId: "gateway",
      status: "ok",
      findings: [],
      metrics: {},
      timestamp: Date.now(),
    });

    const config: ProbeConfig = { id: "gateway", intervalMs: 1000, enabled: true, params: {} };
    const onResult = vi.fn();
    const scheduler = createProbeScheduler(onResult);
    scheduler.start([{ config, fn }]);

    // First run is immediate
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Second run after interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });

  it("does not overlap — next run waits for completion", async () => {
    let resolveProbe: () => void;
    const fn = vi.fn<Probe>().mockImplementation(() =>
      new Promise<ProbeResult>(resolve => {
        resolveProbe = () => resolve({
          probeId: "gateway", status: "ok", findings: [], metrics: {}, timestamp: Date.now(),
        });
      })
    );

    const config: ProbeConfig = { id: "gateway", intervalMs: 100, enabled: true, params: {} };
    const onResult = vi.fn();
    const scheduler = createProbeScheduler(onResult);
    scheduler.start([{ config, fn }]);

    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past interval — probe still running, should NOT call again
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(1);

    // Complete the probe
    resolveProbe!();
    await vi.advanceTimersByTimeAsync(0);

    // Now it should schedule next run
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });

  it("tracks consecutive errors and resets on success", async () => {
    let callCount = 0;
    const fn = vi.fn<Probe>().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) throw new Error("fail");
      return { probeId: "gateway", status: "ok", findings: [], metrics: {}, timestamp: Date.now() };
    });

    const config: ProbeConfig = { id: "gateway", intervalMs: 100, enabled: true, params: {} };
    const onResult = vi.fn();
    const scheduler = createProbeScheduler(onResult);
    scheduler.start([{ config, fn }]);

    // Run 1: error
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.stats()["gateway"].consecutiveErrors).toBe(1);

    // Run 2: error
    await vi.advanceTimersByTimeAsync(100);
    expect(scheduler.stats()["gateway"].consecutiveErrors).toBe(2);

    // Run 3: success
    await vi.advanceTimersByTimeAsync(100);
    expect(scheduler.stats()["gateway"].consecutiveErrors).toBe(0);

    await scheduler.stop();
  });

  it("calls onResult with probe results", async () => {
    const result: ProbeResult = {
      probeId: "gateway", status: "warning",
      findings: [{ code: "INFRA-001", message: { en: "down" }, severity: "critical", context: {} }],
      metrics: {}, timestamp: Date.now(),
    };
    const fn = vi.fn<Probe>().mockResolvedValue(result);
    const config: ProbeConfig = { id: "gateway", intervalMs: 1000, enabled: true, params: {} };
    const onResult = vi.fn();
    const scheduler = createProbeScheduler(onResult);
    scheduler.start([{ config, fn }]);

    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith(result);

    await scheduler.stop();
  });
});
```

- [ ] **Step 3: Run test — should FAIL**

Run: `pnpm test src/monitor/probe-scheduler.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement probe scheduler**

Create `src/monitor/probe-scheduler.ts`:

```typescript
import type { ProbeConfig, ProbeResult, ProbeStats, ProbeId } from "../types/monitor.js";
import type { Probe } from "./probe.js";

interface ProbeEntry {
  readonly config: ProbeConfig;
  readonly fn: Probe;
}

export interface ProbeScheduler {
  start(probes: readonly ProbeEntry[]): void;
  stop(): Promise<void>;
  stats(): Readonly<Record<string, ProbeStats>>;
}

export function createProbeScheduler(
  onResult: (result: ProbeResult) => void
): ProbeScheduler {
  // Implementation uses setTimeout-after-completion pattern
  // Tracks ProbeStats per probe, resets consecutiveErrors on success
  // stop() clears all timers and waits for in-flight probes
}
```

- [ ] **Step 5: Run test — should PASS**

Run: `pnpm test src/monitor/probe-scheduler.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/monitor/probe.ts src/monitor/probe-scheduler.ts src/monitor/probe-scheduler.test.ts
git commit -m "feat: probe interface + non-overlapping async scheduler"
```

---

### Task 6: Gateway Probe

**Files:**
- Create: `src/monitor/probes/gateway-probe.ts`
- Test: `src/monitor/probes/gateway-probe.test.ts`

- [ ] **Step 1: Write test**

Test with mock ShellExecutor. Test cases: gateway running (ok), gateway not found (critical finding INFRA-001), shell command fails (probe error).

- [ ] **Step 2: Run test — should FAIL**

- [ ] **Step 3: Implement**

Check gateway via: `openclaw gateway status`, fallback to `pgrep -f openclaw-gateway`. Return Finding with code `"INFRA-001"` if not running.

- [ ] **Step 4: Run test — should PASS**

- [ ] **Step 5: Commit**

```bash
git add src/monitor/probes/gateway-probe.ts src/monitor/probes/gateway-probe.test.ts
git commit -m "feat: gateway probe — checks gateway process health"
```

---

### Task 7: Session Probe

**Files:**
- Create: `src/monitor/probes/session-probe.ts`
- Test: `src/monitor/probes/session-probe.test.ts`

- [ ] **Step 1: Write test**

Test with mock filesystem (inject stateDir pointing to a temp dir). Test cases: no sessions (ok), session with recent mtime (ok), session with old mtime > threshold (warning finding BHV-010).

- [ ] **Step 2: Run test — should FAIL**

- [ ] **Step 3: Implement**

Read session directories from `stateDir/sessions/`, check mtime of latest JSONL file per session. If mtime older than `params.inactiveThresholdMs` (default 7200000 = 2h), emit Finding BHV-010.

- [ ] **Step 4: Run test — should PASS**

- [ ] **Step 5: Commit**

```bash
git add src/monitor/probes/session-probe.ts src/monitor/probes/session-probe.test.ts
git commit -m "feat: session probe — detects stuck sessions via file mtime"
```

---

### Task 8: Cost Probe

**Files:**
- Create: `src/monitor/probes/cost-probe.ts`
- Test: `src/monitor/probes/cost-probe.test.ts`

- [ ] **Step 1: Write test**

Test using in-memory SQLite with pre-inserted events. Test cases: <20 sessions (ok, no baseline), normal cost (ok), 3x spike (critical finding CST-010).

- [ ] **Step 2: Run test — should FAIL**

- [ ] **Step 3: Implement**

Query session costs using raw SQL on the database handle (NOT via EventStore.queryEvents, which is designed for event-level queries). The cost probe needs an aggregate query:

```sql
SELECT session_key, SUM(json_extract(data, '$.inputTokens') + json_extract(data, '$.outputTokens')) as total_tokens
FROM events
WHERE type = 'llm_call' AND agent_id = ?
GROUP BY session_key
ORDER BY MAX(timestamp) DESC
LIMIT ?
```

This means `ProbeDeps` needs a `db: Database.Database` handle in addition to `store: EventStore`. Add `readonly db: Database.Database` to `ProbeDeps` in `src/monitor/probe.ts`.

Compute rolling average from the last `minSessionsForBaseline` (default 20) sessions. If the most recent session's cost > `spikeMultiplier` (default 3) × average, emit Finding CST-010. If fewer than `minSessionsForBaseline` sessions exist, return status "ok" (no baseline = no detection).

- [ ] **Step 4: Run test — should PASS**

- [ ] **Step 5: Commit**

```bash
git add src/monitor/probes/cost-probe.ts src/monitor/probes/cost-probe.test.ts
git commit -m "feat: cost probe — detects cost spikes via rolling average"
```

---

### Task 9: Probe Disease Match + Triage Engine

**Files:**
- Create: `src/monitor/probe-disease-match.ts`
- Create: `src/triage/triage-engine.ts`
- Test: `src/monitor/probe-disease-match.test.ts`
- Test: `src/triage/triage-engine.test.ts`

- [ ] **Step 1: Write probe-disease-match test**

Test that a Finding with code "INFRA-001" is matched to the corresponding DiseaseDefinition and produces a DiseaseInstance. Test that an unknown code returns null.

- [ ] **Step 2: Run test — should FAIL**

- [ ] **Step 3: Implement probe-disease-match**

Simple lookup: `registry.getById(finding.code)`. If found, create a DiseaseInstance with ULID id, the finding's severity, evidence from finding context, confidence 1.0, status "active".

- [ ] **Step 4: Run test — should PASS**

- [ ] **Step 5: Write triage engine test**

In Phase 1, all triage results are `"red"` (alert-only). Test that any disease instance → TriageResult with level "red".

- [ ] **Step 6: Run test — should FAIL**

- [ ] **Step 7: Implement triage engine (Phase 1: alert-only)**

```typescript
export function triageAlertOnly(disease: DiseaseInstance): TriageResult {
  return {
    level: "red",
    diseaseId: disease.definitionId,
    agentId: disease.context.agentId as string | undefined,
    reason: { en: "Alert only (Phase 1)", zh: "仅告警（第一阶段）" },
  };
}
```

- [ ] **Step 8: Run test — should PASS**

- [ ] **Step 9: Commit**

```bash
git add src/monitor/probe-disease-match.ts src/monitor/probe-disease-match.test.ts src/monitor/triage-engine.ts src/monitor/triage-engine.test.ts
git commit -m "feat: probe disease matcher + triage engine (alert-only mode)"
```

---

### Task 10: Page Channel Interface + Implementations

**Files:**
- Create: `src/page/page-channel.ts`
- Create: `src/page/channels/telegram-page.ts`
- Create: `src/page/channels/webhook-page.ts`
- Test: `src/page/channels/telegram-page.test.ts`
- Test: `src/page/channels/webhook-page.test.ts`

- [ ] **Step 1: Create page channel interface**

```typescript
import type { PageMessage, SendResult } from "../types/monitor.js";

export type PageChannel = {
  readonly type: "telegram" | "webhook";
  readonly send: (msg: PageMessage) => Promise<SendResult>;
};
```

- [ ] **Step 2: Write Telegram page test**

Mock `fetch` (global). Test message formatting (HTML parse mode), test send success, test send failure (non-200).

- [ ] **Step 3: Run test — should FAIL**

- [ ] **Step 4: Implement Telegram page**

Uses Telegram Bot API `sendMessage` with HTML parse mode. Format: severity emoji + disease name + agent + timestamp + details.

- [ ] **Step 5: Run test — should PASS**

- [ ] **Step 6: Write Webhook page test**

Mock `fetch`. Test JSON payload format, test HMAC signature header (`X-ClawDoc-Signature`), test send failure.

- [ ] **Step 7: Run test — should FAIL**

- [ ] **Step 8: Implement Webhook page**

POST JSON payload with HMAC-SHA256 signature. Uses `node:crypto` for HMAC.

- [ ] **Step 9: Run test — should PASS**

- [ ] **Step 10: Commit**

```bash
git add src/page/page-channel.ts src/page/channels/telegram-page.ts src/page/channels/telegram-page.test.ts src/page/channels/webhook-page.ts src/page/channels/webhook-page.test.ts
git commit -m "feat: page channels — Telegram + Webhook with HMAC signing"
```

---

### Task 11: Page Dispatcher (Dedup + Rate Limit)

**Files:**
- Create: `src/page/page-dispatcher.ts`
- Test: `src/page/page-dispatcher.test.ts`

- [ ] **Step 1: Write dispatcher tests**

Test: dedup suppresses duplicate alerts within window. Test: dedup allows after window expires. Test: rate limit caps per-probe frequency. Test: global max per hour. Test: emergency priority bypasses dedup. Test: channel failure logs error and continues. Test: dedup key format is `probeId:diseaseId:agentId`.

- [ ] **Step 2: Run test — should FAIL**

- [ ] **Step 3: Implement dispatcher**

Uses SQLite `page_dedup` table for persistent dedup state. Rate limit uses in-memory counters (reset hourly). Dispatches to all configured channels. Retries once on failure (5s delay). Circuit breaker: if a channel fails 5 consecutive times, disable it for 1h and send a warning page to the remaining healthy channels.

- [ ] **Step 4: Run test — should PASS**

- [ ] **Step 5: Commit**

```bash
git add src/page/page-dispatcher.ts src/page/page-dispatcher.test.ts
git commit -m "feat: page dispatcher — dedup, rate limiting, multi-channel dispatch"
```

---

### Task 12: Monitor State File

**Files:**
- Create: `src/monitor/monitor-state.ts`
- Test: `src/monitor/monitor-state.test.ts`

- [ ] **Step 1: Write tests**

Test: write state file atomically (tmp + rename). Test: read state file. Test: detect stale PID. Test: delete state file.

- [ ] **Step 2: Run test — should FAIL**

- [ ] **Step 3: Implement**

Atomic write: write to `monitor.state.tmp`, then `rename` to `monitor.state`. Read: parse JSON. Stale detection: check if PID is alive via `process.kill(pid, 0)` (signal 0 = check existence).

- [ ] **Step 4: Run test — should PASS**

- [ ] **Step 5: Commit**

```bash
git add src/monitor/monitor-state.ts src/monitor/monitor-state.test.ts
git commit -m "feat: monitor state file — atomic read/write + stale PID detection"
```

---

### Task 13: Config Extensions + Validation

**Files:**
- Modify: `src/types/config.ts`
- Modify: `src/config/loader.ts`
- Create: `src/monitor/config-validator.ts`
- Test: `src/monitor/config-validator.test.ts`

> **Why here (before Monitor Engine):** The monitor engine reads probe intervals, page settings, and consent config from `ClawDoctorConfig`. These fields must exist before the engine can be implemented.

- [ ] **Step 1: Extend config types**

Add `monitor`, `page`, and `consent` sections to `ClawDoctorConfig` and `DEFAULT_CONFIG`. The `weights.infra` field was already added in Task 1. See spec for full shape.

- [ ] **Step 2: Update config loader**

Add deep merge handling for new sections in `src/config/loader.ts`.

- [ ] **Step 3: Write config validator tests**

Test: missing bot token when telegram enabled → error. Test: weights not summing to 1.0 → error. Test: valid config → no errors. Test: CLI consent without TTY → warning.

- [ ] **Step 4: Run test — should FAIL**

- [ ] **Step 5: Implement config validator**

```typescript
export interface ConfigValidationResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export function validateMonitorConfig(config: ClawDoctorConfig): ConfigValidationResult {
  // Check all validation rules from spec
}
```

- [ ] **Step 6: Run test — should PASS**

- [ ] **Step 7: Commit**

```bash
git add src/types/config.ts src/config/loader.ts src/monitor/config-validator.ts src/monitor/config-validator.test.ts
git commit -m "feat: config extensions for monitor/page/consent + validation"
```

---

### Task 14: Monitor Engine

**Files:**
- Create: `src/monitor/monitor-engine.ts`
- Test: `src/monitor/monitor-engine.test.ts`

- [ ] **Step 1: Write integration test**

Test with in-memory SQLite + mock ShellExecutor + mock PageChannels. Verify: engine starts, runs probes, matches diseases, sends pages, writes chart entries, writes state file, stops gracefully.

- [ ] **Step 2: Run test — should FAIL**

- [ ] **Step 3: Implement monitor engine**

Orchestrates: ProbeScheduler → onResult callback → write event to store → ProbeDiseaseMatch → triageAlertOnly → PageDispatcher → ChartStore. Heartbeat updates state file every 30s. SIGTERM handler for graceful shutdown.

> **Phase 1 simplification — ActionDispatcher deferred:** The spec describes a decoupled ActionDispatcher queue between ProbeScheduler and result processing. In Phase 1, all triage results are alert-only (no interventions, no consent waits), so there are no slow operations that could block probes. The `onResult` callback processes synchronously. **In Phase 2**, when interventions and consent waits are added, this callback MUST be refactored into an async ActionDispatcher queue to prevent slow actions from blocking probe scheduling.

> **State file vs SQLite:** The spec mentions a `monitor_state` SQLite table. This plan uses a JSON state file (`~/.clawdoctor/monitor.state`) instead, because: (1) state file is simpler for cross-process reads (no SQLite connection needed for `clawdoc monitor status`), (2) atomic write via tmp+rename is sufficient for a single-writer scenario, (3) state is ephemeral (deleted on shutdown). This is a deliberate simplification that may be revisited if multi-process coordination becomes more complex.

- [ ] **Step 4: Run test — should PASS**

- [ ] **Step 5: Commit**

```bash
git add src/monitor/monitor-engine.ts src/monitor/monitor-engine.test.ts
git commit -m "feat: monitor engine — orchestrates probes, triage, page, chart"
```

---

### Task 15: CLI Commands (monitor + chart)

**Files:**
- Create: `src/commands/monitor-cmd.ts`
- Create: `src/commands/chart-cmd.ts`
- Modify: `src/bin.ts`

- [ ] **Step 1: Implement monitor command**

Register `clawdoc monitor` with subcommands:
- `start [--dry-run]`: validate config → start monitor engine
- `stop`: read state file → send SIGTERM to PID
- `status`: read state file → render status table

- [ ] **Step 2: Implement chart command**

Register `clawdoc chart` with options:
- `-n <limit>` (default 20)
- `--probe <probeId>`
- `--outcome <outcome>`
- `--since <date>`

Query ChartStore and render table.

- [ ] **Step 3: Register in bin.ts**

```typescript
import { registerMonitorCommand } from "./commands/monitor-cmd.js";
import { registerChartCommand } from "./commands/chart-cmd.js";
// Add to program registration
registerMonitorCommand(program);
registerChartCommand(program);
```

- [ ] **Step 4: Run type check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/monitor-cmd.ts src/commands/chart-cmd.ts src/bin.ts
git commit -m "feat: CLI commands — clawdoc monitor start/stop/status + clawdoc chart"
```

---

### Task 16: i18n + Dashboard + Health Scorer Updates

**Files:**
- Modify: `src/i18n/locales.ts`
- Modify: `src/dashboard/server.ts`
- Modify: `src/analysis/health-scorer.ts`

- [ ] **Step 1: Add i18n strings**

Add ~30 keys to `UI_STRINGS` in `src/i18n/locales.ts`:
- `infra` department name
- Monitor status messages
- Chart output labels
- Page alert messages
- Config validation messages

- [ ] **Step 2: Update VALID_DEPARTMENTS + dashboard i18n**

In `src/dashboard/server.ts`, add `"infra"` to the valid departments set.

In `src/dashboard/public/index.html`, add `infra` department name to `LOCALE_DICT`:
```javascript
"dept.infra": { en: "Infrastructure", zh: "基础设施" },
```

- [ ] **Step 3: Update health scorer**

In `src/analysis/health-scorer.ts`, handle 7 departments. When infra score is `null` (monitor never ran), exclude from overall calculation and re-normalize remaining weights.

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 5: Run type check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales.ts src/dashboard/server.ts src/analysis/health-scorer.ts
git commit -m "feat: i18n strings, dashboard infra department, health scorer 7-department support"
```

---

### Task 17: E2E Smoke Test

**Files:**
- Create: `src/monitor/monitor-e2e.test.ts`

- [ ] **Step 1: Write E2E test**

Integration test that:
1. Creates file-based SQLite (not `:memory:`)
2. Creates a mock stateDir with a fake session file (old mtime)
3. Starts monitor engine with mock ShellExecutor (gateway returns ok)
4. Waits for 1 probe cycle
5. Verifies: event written to SQLite, chart entry created, page dispatcher called
6. Stops monitor gracefully
7. Verifies state file is cleaned up

- [ ] **Step 2: Run test — should PASS**

Run: `pnpm test src/monitor/monitor-e2e.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/monitor/monitor-e2e.test.ts
git commit -m "test: monitor E2E smoke test — full pipeline verification"
```

---

### Task 18: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 2: Run type check**

Run: `pnpm check`
Expected: PASS (zero errors)

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev monitor start --dry-run`
Expected: Monitor starts, logs probe results, sends dry-run alerts, writes chart entries. Ctrl+C stops gracefully.

- [ ] **Step 5: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: Phase 1 cleanup and verification"
```

---

## Phase 2-4 Plans

After Phase 1 is complete and verified, create separate plans for:
- **Phase 2**: `2026-XX-XX-continuous-monitoring-phase2.md` — Triage + Interventions
- **Phase 3**: `2026-XX-XX-continuous-monitoring-phase3.md` — Consent System
- **Phase 4**: `2026-XX-XX-continuous-monitoring-phase4.md` — Integration & Polish
