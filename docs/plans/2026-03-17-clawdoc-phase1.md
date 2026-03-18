# ClawDoctor Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver `npx clawdoctor checkup` — a zero-config CLI that runs rule-based health diagnostics across 6 departments on any OpenClaw agent workspace and outputs a terminal health report with scores, grades, and disease findings.

**Architecture:** Standalone TypeScript ESM package. Snapshot Collector reads OpenClaw files on disk → events written to temp SQLite → Metric Aggregation (SQL) → Rule Engine evaluates 27 diseases → Health Scorer computes per-department + overall scores with data coverage tracking → Ink-based terminal report renderer outputs the result.

**Tech Stack:** TypeScript ESM, pnpm, better-sqlite3 (WAL mode), Commander.js + Ink, Vitest, ULID

**Spec:** `docs/2026-03-17-clawdoctor-design.md` — the authoritative source for all types, disease definitions, scoring algorithms, and behavior.

---

## File Structure

```
clawdoctortor/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── bin.ts                          # CLI entry point (Commander.js)
│   ├── types/
│   │   ├── domain.ts                   # Department, Severity, I18nString, DiseaseDefinition, DiseaseInstance, Evidence, DiagnosisRef, PrescriptionTemplate, MetricSnapshot, VerificationResult, RollbackResult
│   │   ├── events.ts                   # ClawDoctorEvent, EventType, EventDataMap, TypedClawDoctorEvent, all *Data interfaces
│   │   ├── config.ts                   # ClawDoctorConfig, default thresholds, default weights
│   │   └── scoring.ts                  # HealthScore, DataCoverage, DepartmentScore, DataMode, Grade
│   ├── config/
│   │   ├── loader.ts                   # loadConfig(): read ~/.clawdoctor/config.json, merge defaults
│   │   └── loader.test.ts
│   ├── i18n/
│   │   ├── i18n.ts                     # t(i18nString, locale): string — resolve with en fallback
│   │   ├── locales.ts                  # UI framework strings (report titles, labels)
│   │   └── i18n.test.ts
│   ├── store/
│   │   ├── database.ts                 # openDatabase(), migrate(), WAL setup, parameterized queries
│   │   ├── event-store.ts              # insertEvent(), queryEvents(), queryEventsBySession()
│   │   ├── diagnosis-store.ts          # insertDiagnosis(), queryDiagnoses(), updateDiagnosisStatus()
│   │   ├── score-store.ts             # insertHealthScore(), queryScoreHistory()
│   │   ├── schema.sql                  # Raw SQL for reference (CREATE TABLE statements from spec §8.1)
│   │   └── store.test.ts
│   ├── collector/
│   │   ├── snapshot-collector.ts       # SnapshotCollector: orchestrates all sub-collectors
│   │   ├── session-parser.ts           # Parse session JSONL → ClawDoctorEvent[]
│   │   ├── config-scanner.ts           # Read openclaw.json → ConfigSnapshotData event
│   │   ├── memory-scanner.ts           # Scan workspace memory files → MemorySnapshotData event
│   │   ├── plugin-scanner.ts           # Read plugin manifests → PluginSnapshotData event
│   │   ├── log-parser.ts              # Parse /tmp/openclaw/*.log → supplementary events (DEFERRED: Phase 1 uses session JSONL only)
│   │   ├── session-parser.test.ts
│   │   ├── config-scanner.test.ts
│   │   ├── memory-scanner.test.ts
│   │   └── plugin-scanner.test.ts
│   ├── analysis/
│   │   ├── metric-aggregator.ts        # Aggregate events → MetricSet (SQL queries)
│   │   ├── rule-engine.ts              # RuleEngine: evaluate MetricSet against disease rules
│   │   ├── health-scorer.ts            # computeDepartmentScore, computeOverallScore, linearScore, apdexScore
│   │   ├── analysis-pipeline.ts        # Orchestrate: collect → aggregate → rules → score → persist
│   │   ├── metric-aggregator.test.ts
│   │   ├── rule-engine.test.ts
│   │   └── health-scorer.test.ts
│   ├── diseases/
│   │   ├── registry.ts                 # DiseaseRegistry: getAll(), getById(), getByDepartment()
│   │   ├── vitals.ts                   # VIT-001~005 (all 5; all rule-based)
│   │   ├── skill.ts                    # SK-001~010 (all 10; rule engine evaluates rule-only, LLM/hybrid defs registered for Phase 2)
│   │   ├── memory.ts                   # MEM-001~007 (all 7; rule engine evaluates MEM-003/005 only)
│   │   ├── behavior.ts                # BHV-001~007 (all 7; rule engine evaluates BHV-005/007 only)
│   │   ├── cost.ts                     # CST-001~006 (all 6; all rule-based)
│   │   ├── security.ts                # SEC-001~008 (all 8; rule engine evaluates SEC-001~004/006~008)
│   │   └── registry.test.ts
│   ├── report/
│   │   ├── terminal-report.tsx         # Ink component: render full health report
│   │   ├── progress-bar.tsx            # Ink component: ████████░░ bar
│   │   ├── report-data.ts             # Transform HealthScore + DiseaseInstance[] → report view model
│   │   └── terminal-report.test.ts
│   └── commands/
│       ├── checkup.ts                  # clawdoctor checkup command handler
│       ├── config-cmd.ts               # clawdoctor config init/set/show
│       ├── skill-cmd.ts                # clawdoctor skill list
│       ├── memory-cmd.ts               # clawdoctor memory scan
│       ├── cost-cmd.ts                 # clawdoctor cost report
│       ├── behavior-cmd.ts             # clawdoctor behavior report
│       └── security-cmd.ts             # clawdoctor security audit
├── fixtures/
│   ├── sessions/                       # Sample session JSONL files for testing
│   │   ├── healthy-session.jsonl
│   │   ├── failing-tools-session.jsonl
│   │   ├── compacted-session.jsonl
│   │   └── multi-provider-session.jsonl
│   ├── config/
│   │   ├── valid-openclaw.json
│   │   └── corrupt-openclaw.json
│   └── memory/
│       ├── MEMORY.md
│       ├── fresh-memory.md
│       └── stale-memory.md
└── docs/
    ├── 2026-03-17-clawdoctor-design.md    # Design spec (exists)
    └── plans/
        └── 2026-03-17-clawdoctor-phase1.md # This plan
```

**Dependency graph between tasks (determines parallelism):**

```
Task 1: Project Scaffold
  │
  ├──► Task 2: Domain Types (depends on 1)
  │      │
  │      ├──► Task 5: Disease Registry (depends on 2)
  │      │
  │      └──► Task 3: Config System (depends on 2)
  │
  ├──► Task 4: SQLite Store (depends on 2)
  │      │
  │      └──► Task 7: Metric Aggregator (depends on 4)
  │
  ├──► Task 6: Snapshot Collector (depends on 2)
  │
  ├──► Task 8: Rule Engine (depends on 5, 7)
  │
  ├──► Task 9: Health Scorer (depends on 2)
  │
  ├──► Task 10: Analysis Pipeline (depends on 7, 8, 9)
  │
  ├──► Task 11: Terminal Report (depends on 2, 9)
  │
  └──► Task 12: CLI Commands + Integration (depends on 10, 11, 3)
         │
         └──► Task 13: E2E Test + Release Prep (depends on 12)
```

**Agent team parallelism windows:**

```
Sequential: Task 1 (scaffold)
            ↓
Parallel:   Task 2 (types)
            ↓
Parallel:   Task 3 (config) | Task 4 (store) | Task 5 (diseases) | Task 6 (collector) | Task 9 (scorer)
            ↓
Parallel:   Task 7 (aggregator, needs 4)
            ↓
Sequential: Task 8 (rule engine, needs 5+7)
            ↓
Parallel:   Task 10 (pipeline) | Task 11 (report)
            ↓
Sequential: Task 12 (CLI integration)
            ↓
Sequential: Task 13 (E2E + release)
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/bin.ts` (skeleton)

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/cjy/work/workspace/openclaw-workspace/clawdoctortor
pnpm init
```

Then edit `package.json`:

```json
{
  "name": "clawdoctor",
  "version": "0.1.0",
  "description": "Health diagnostics for OpenClaw agents",
  "type": "module",
  "bin": {
    "clawdoctor": "./dist/bin.js"
  },
  "exports": {
    ".": "./dist/index.js",
    "./plugin": "./dist/plugin.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/bin.ts",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "check": "tsc --noEmit"
  },
  "engines": {
    "node": ">=22"
  },
  "keywords": ["openclaw", "diagnostics", "health", "agent"],
  "license": "MIT"
}
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add commander better-sqlite3 ulid ink react
pnpm add -D typescript @types/node @types/better-sqlite3 @types/react vitest tsx @ink/testing-library
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "fixtures"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-wal
*.db-shm
.DS_Store
```

- [ ] **Step 6: Create skeleton bin.ts**

```typescript
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("clawdoctor")
  .description("Health diagnostics for OpenClaw agents")
  .version("0.1.0");

program.parse();
```

- [ ] **Step 7: Verify scaffold compiles**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: initialize project scaffold with TypeScript ESM, pnpm, vitest"
```

---

## Task 2: Domain Types

**Files:**
- Create: `src/types/domain.ts`
- Create: `src/types/events.ts`
- Create: `src/types/scoring.ts`

All types come directly from spec §3.1, §3.2, §5.1, §6.6.1. No tests needed — these are pure type definitions.

- [ ] **Step 1: Create src/types/domain.ts**

Transcribe from spec §3.1: `Department`, `Severity`, `I18nString`, `DiseaseDefinition`, `DiseaseInstance`, `Evidence`, `DiagnosisRef`, `PrescriptionTemplate`, `MetricSnapshot`, `VerificationResult`, `RollbackResult`, `DetectionStrategy`, `RuleDetection`, `LLMDetection`, `HybridDetection`.

Also add `PrescriptionAction` union type from spec §7.2 (needed by `PrescriptionTemplate.actionTypes`).

- [ ] **Step 2: Create src/types/events.ts**

Transcribe from spec §5.1: `EventType`, `EventDataMap`, `ClawDoctorEvent`, `TypedClawDoctorEvent<T>`, and all 10 `*Data` interfaces (`LLMCallData`, `ToolCallData` with `paramsSummary`/`resultSummary`, `SessionLifecycleData`, `AgentLifecycleData`, `MemorySnapshotData`, `SubagentEventData`, `MessageEventData`, `CompactionEventData`, `ConfigSnapshotData`, `PluginSnapshotData`).

- [ ] **Step 3: Create src/types/scoring.ts**

Transcribe from spec §6.6.1: `DataMode`, `HealthScore`, `DataCoverage`, `DepartmentScore`, `Grade`.

Add the `scoreToGrade` function:

```typescript
export type Grade = "A" | "B" | "C" | "D" | "F" | "N/A";

export function scoreToGrade(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 25) return "D";
  return "F";
}
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/types/
git commit -m "feat: add domain types, event types, and scoring types from spec"
```

---

## Task 3: Config System

**Files:**
- Create: `src/types/config.ts`
- Create: `src/config/loader.ts`
- Create: `src/config/loader.test.ts`

- [ ] **Step 1: Write the failing test**

`src/config/loader.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, DEFAULT_CONFIG } from "./loader.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("loadConfig", () => {
  const tmpDir = path.join(os.tmpdir(), "clawdoctor-test-config");

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(path.join(tmpDir, "nonexistent"));
    expect(config.locale).toBe("en");
    expect(config.thresholds["skill.successRate"].warning).toBe(0.75);
    expect(config.weights.skill).toBe(0.26);
  });

  it("merges user overrides with defaults", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({
      locale: "zh",
      thresholds: { "skill.successRate": { warning: 0.80, critical: 0.40 } },
    }));
    const config = loadConfig(configPath);
    expect(config.locale).toBe("zh");
    expect(config.thresholds["skill.successRate"].warning).toBe(0.80);
    // Other thresholds still have defaults
    expect(config.thresholds["cost.dailyTokens"].warning).toBe(100_000);
  });

  it("ignores malformed config file and returns defaults", () => {
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, "not json {{{");
    const config = loadConfig(configPath);
    expect(config.locale).toBe("en");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/config/loader.test.ts`
Expected: FAIL — `loadConfig` not found

- [ ] **Step 3: Create src/types/config.ts with defaults**

Transcribe `ClawDoctorConfig` interface from spec §4.1. Export `DEFAULT_THRESHOLDS`, `DEFAULT_WEIGHTS`, `DEFAULT_CONFIG`.

- [ ] **Step 4: Implement src/config/loader.ts**

```typescript
import fs from "node:fs";
import type { ClawDoctorConfig } from "../types/config.js";
import { DEFAULT_CONFIG } from "../types/config.js";

export { DEFAULT_CONFIG } from "../types/config.js";

export function loadConfig(configPath: string): ClawDoctorConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function mergeConfig(defaults: ClawDoctorConfig, overrides: Partial<ClawDoctorConfig>): ClawDoctorConfig {
  return {
    locale: overrides.locale ?? defaults.locale,
    thresholds: { ...defaults.thresholds, ...overrides.thresholds },
    weights: { ...defaults.weights, ...overrides.weights },
    llm: { ...defaults.llm, ...overrides.llm },
    retention: { ...defaults.retention, ...overrides.retention },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/config/loader.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/config.ts src/config/
git commit -m "feat: add config system with defaults, file loading, and merge"
```

---

## Task 4: SQLite Store

**Files:**
- Create: `src/store/database.ts`
- Create: `src/store/event-store.ts`
- Create: `src/store/diagnosis-store.ts`
- Create: `src/store/score-store.ts`
- Create: `src/store/store.test.ts`

- [ ] **Step 1: Write failing tests for database + event store**

`src/store/store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase } from "./database.js";
import { createEventStore } from "./event-store.js";
import { createDiagnosisStore } from "./diagnosis-store.js";
import { createScoreStore } from "./score-store.js";
import type Database from "better-sqlite3";

describe("Store", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("EventStore", () => {
    it("inserts and queries events", () => {
      const store = createEventStore(db);
      store.insertEvent({
        id: "01HTEST000001",
        source: "snapshot",
        timestamp: Date.now(),
        agentId: "default",
        sessionKey: "test:123",
        type: "tool_call",
        data: { toolName: "file_read", paramsSummary: { path: "string" }, success: true },
      });

      const events = store.queryEvents({ agentId: "default", type: "tool_call" });
      expect(events).toHaveLength(1);
      expect(events[0].data.toolName).toBe("file_read");
    });

    it("queries events by session with source priority", () => {
      const store = createEventStore(db);
      const now = Date.now();

      // Insert snapshot event for session A
      store.insertEvent({
        id: "01SNAP001",
        source: "snapshot",
        timestamp: now,
        agentId: "default",
        sessionKey: "session-a",
        type: "tool_call",
        data: { toolName: "snap_tool", paramsSummary: {}, success: true },
      });

      // Insert stream event for same session A
      store.insertEvent({
        id: "01STRM001",
        source: "stream",
        timestamp: now,
        agentId: "default",
        sessionKey: "session-a",
        type: "tool_call",
        data: { toolName: "stream_tool", paramsSummary: {}, success: true, durationMs: 50 },
      });

      // Source priority: stream wins for session-a
      const events = store.queryEventsWithSourcePriority({ agentId: "default" });
      expect(events).toHaveLength(1);
      expect(events[0].data.toolName).toBe("stream_tool");
    });
  });

  describe("DiagnosisStore", () => {
    it("inserts and queries diagnoses", () => {
      const store = createDiagnosisStore(db);
      store.insertDiagnosis({
        id: "01DIAG001",
        diseaseId: "SK-001",
        agentId: "default",
        severity: "warning",
        confidence: 0.95,
        evidenceJson: "[]",
        status: "active",
        firstDetected: Date.now(),
        lastSeen: Date.now(),
      });

      const diagnoses = store.queryDiagnoses({ agentId: "default", status: "active" });
      expect(diagnoses).toHaveLength(1);
      expect(diagnoses[0].diseaseId).toBe("SK-001");
    });
  });

  describe("ScoreStore", () => {
    it("inserts and queries health scores", () => {
      const store = createScoreStore(db);
      store.insertHealthScore({
        id: "01SCORE001",
        agentId: "default",
        timestamp: Date.now(),
        dataMode: "snapshot",
        coverage: 0.63,
        overall: 72,
        vitals: 95,
        skill: 70,
        memory: 52,
        behavior: null,
        cost: 65,
        security: 85,
      });

      const scores = store.queryScoreHistory("default", 7);
      expect(scores).toHaveLength(1);
      expect(scores[0].dataMode).toBe("snapshot");
      expect(scores[0].behavior).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/store/store.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement src/store/database.ts**

```typescript
import Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrateIfNeeded(db);
  return db;
}

function migrateIfNeeded(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current < SCHEMA_VERSION) {
    for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
      MIGRATIONS[v]?.(db);
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }
}

const MIGRATIONS: Record<number, (db: Database.Database) => void> = {
  1: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, timestamp INTEGER NOT NULL,
        agent_id TEXT NOT NULL, session_key TEXT, session_id TEXT,
        type TEXT NOT NULL, data TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_agent_ts ON events(agent_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_key, timestamp);

      CREATE TABLE IF NOT EXISTS diagnoses (
        id TEXT PRIMARY KEY, disease_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        severity TEXT NOT NULL, confidence REAL NOT NULL,
        evidence_json TEXT NOT NULL, context_json TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        first_detected INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        resolved_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_diagnoses_agent ON diagnoses(agent_id, status);
      CREATE INDEX IF NOT EXISTS idx_diagnoses_disease ON diagnoses(disease_id);

      CREATE TABLE IF NOT EXISTS prescriptions (
        id TEXT PRIMARY KEY,
        diagnosis_id TEXT NOT NULL REFERENCES diagnoses(id),
        type TEXT NOT NULL, actions_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        backup_json TEXT, pre_apply_metrics_json TEXT,
        applied_at INTEGER, rolled_back_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      );

      CREATE TABLE IF NOT EXISTS followups (
        id TEXT PRIMARY KEY,
        prescription_id TEXT NOT NULL REFERENCES prescriptions(id),
        checkpoint TEXT NOT NULL, scheduled_at INTEGER NOT NULL,
        completed_at INTEGER, result_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_followups_pending ON followups(completed_at) WHERE completed_at IS NULL;

      CREATE TABLE IF NOT EXISTS health_scores (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
        data_mode TEXT NOT NULL, coverage REAL NOT NULL,
        overall REAL, vitals REAL, skill REAL, memory REAL,
        behavior REAL, cost REAL, security REAL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_scores_agent_ts ON health_scores(agent_id, timestamp);
    `);
  },
};
```

- [ ] **Step 4: Implement event-store.ts, diagnosis-store.ts, score-store.ts**

Each store is a thin wrapper around parameterized SQL queries. `event-store.ts` must implement `queryEventsWithSourcePriority()` using the source-priority merge strategy from spec §5.6:

```typescript
// Key logic for source priority merge:
// For each session_key, check if stream events exist.
// If yes, exclude snapshot events for that session.
queryEventsWithSourcePriority(filter) {
  // Step 1: find sessions that have stream data
  const streamSessions = db.prepare(`
    SELECT DISTINCT session_key FROM events
    WHERE agent_id = ? AND source = 'stream' AND session_key IS NOT NULL
  `).all(filter.agentId);

  const streamSessionSet = new Set(streamSessions.map(r => r.session_key));

  // Step 2: query all events, filtering out snapshot events for stream-covered sessions
  return db.prepare(`
    SELECT * FROM events
    WHERE agent_id = ?
    AND (source = 'stream' OR session_key IS NULL OR session_key NOT IN (
      SELECT DISTINCT session_key FROM events WHERE agent_id = ? AND source = 'stream' AND session_key IS NOT NULL
    ))
    ORDER BY timestamp ASC
  `).all(filter.agentId, filter.agentId);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/store/store.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/store/
git commit -m "feat: add SQLite store layer with events, diagnoses, and scores"
```

---

## Task 5: Disease Registry

**Files:**
- Create: `src/diseases/registry.ts`
- Create: `src/diseases/vitals.ts`
- Create: `src/diseases/skill.ts`
- Create: `src/diseases/memory.ts`
- Create: `src/diseases/behavior.ts`
- Create: `src/diseases/cost.ts`
- Create: `src/diseases/security.ts`
- Create: `src/diseases/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { getDiseaseRegistry } from "./registry.js";

describe("DiseaseRegistry", () => {
  const registry = getDiseaseRegistry();

  it("contains exactly 43 disease definitions", () => {
    expect(registry.getAll()).toHaveLength(43);
  });

  it("has 27 Phase 1 rule-based diseases", () => {
    const ruleBased = registry.getAll().filter(d =>
      d.detection.type === "rule" ||
      (d.detection.type === "hybrid" && d.detection.preFilter)
    );
    // Rule-only diseases (not hybrid) for Phase 1
    const ruleOnly = registry.getAll().filter(d => d.detection.type === "rule");
    expect(ruleOnly.length).toBeGreaterThanOrEqual(20); // most are pure rule
  });

  it("groups diseases by department correctly", () => {
    expect(registry.getByDepartment("vitals")).toHaveLength(5);
    expect(registry.getByDepartment("skill")).toHaveLength(10);
    expect(registry.getByDepartment("memory")).toHaveLength(7);
    expect(registry.getByDepartment("behavior")).toHaveLength(7);
    expect(registry.getByDepartment("cost")).toHaveLength(6);
    expect(registry.getByDepartment("security")).toHaveLength(8);
  });

  it("looks up by ID", () => {
    const sk001 = registry.getById("SK-001");
    expect(sk001).toBeDefined();
    expect(sk001!.name.en).toBe("Token Obesity");
    expect(sk001!.name.zh).toBe("Token 肥胖症");
    expect(sk001!.detection.type).toBe("rule");
  });

  it("every disease has en + zh names", () => {
    for (const disease of registry.getAll()) {
      expect(disease.name.en, `${disease.id} missing en name`).toBeTruthy();
      expect(disease.name.zh, `${disease.id} missing zh name`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/diseases/registry.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement disease definition files**

Create each file (`vitals.ts`, `skill.ts`, etc.) with disease definitions transcribed from spec §3.3. Each file exports an array of `DiseaseDefinition` objects.

Example for `vitals.ts`:

```typescript
import type { DiseaseDefinition } from "../types/domain.js";

export const vitalsDiseases: DiseaseDefinition[] = [
  {
    id: "VIT-001",
    department: "vitals",
    category: "availability",
    name: { en: "Gateway Offline", zh: "网关离线" },
    description: { en: "OpenClaw gateway is unreachable", zh: "OpenClaw 网关不可达" },
    rootCauses: [
      { en: "Gateway process not running", zh: "网关进程未运行" },
      { en: "Port blocked or misconfigured", zh: "端口被阻止或配置错误" },
    ],
    detection: { type: "rule", metric: "vitals.gatewayReachable", direction: "lower_is_worse", defaultThresholds: { warning: 1, critical: 1 } },
    prescriptionTemplate: { level: "manual", actionTypes: ["command"], promptTemplate: "", estimatedImprovementTemplate: { en: "Restore gateway connectivity", zh: "恢复网关连接" }, risk: "low" },
    relatedDiseases: [],
    defaultSeverity: "critical",
    tags: ["availability", "gateway"],
  },
  // ... VIT-002 through VIT-005
];
```

Repeat for all 6 department files.

- [ ] **Step 4: Implement src/diseases/registry.ts**

```typescript
import type { DiseaseDefinition, Department } from "../types/domain.js";
import { vitalsDiseases } from "./vitals.js";
import { skillDiseases } from "./skill.js";
import { memoryDiseases } from "./memory.js";
import { behaviorDiseases } from "./behavior.js";
import { costDiseases } from "./cost.js";
import { securityDiseases } from "./security.js";

const ALL_DISEASES: DiseaseDefinition[] = [
  ...vitalsDiseases,
  ...skillDiseases,
  ...memoryDiseases,
  ...behaviorDiseases,
  ...costDiseases,
  ...securityDiseases,
];

const byId = new Map(ALL_DISEASES.map(d => [d.id, d]));
const byDept = new Map<Department, DiseaseDefinition[]>();
for (const d of ALL_DISEASES) {
  const list = byDept.get(d.department) ?? [];
  list.push(d);
  byDept.set(d.department, list);
}

export function getDiseaseRegistry() {
  return {
    getAll: () => ALL_DISEASES,
    getById: (id: string) => byId.get(id),
    getByDepartment: (dept: Department) => byDept.get(dept) ?? [],
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/diseases/registry.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/diseases/
git commit -m "feat: add disease registry with 43 diseases across 6 departments"
```

---

## Task 6: Snapshot Collector

**Files:**
- Create: `src/collector/snapshot-collector.ts`
- Create: `src/collector/session-parser.ts`
- Create: `src/collector/config-scanner.ts`
- Create: `src/collector/memory-scanner.ts`
- Create: `src/collector/plugin-scanner.ts`
- Create: `src/collector/session-parser.test.ts`
- Create: `src/collector/memory-scanner.test.ts`
- Create: `fixtures/sessions/*.jsonl`
- Create: `fixtures/memory/*.md`
- Create: `fixtures/config/*.json`

This is the most complex task. Start with a **spike on real session JSONL** (as mandated by spec §5.2), then build parsers against fixtures.

- [ ] **Step 1: Create session JSONL fixtures**

Create `fixtures/sessions/healthy-session.jsonl` and `fixtures/sessions/failing-tools-session.jsonl` based on the JSONL format documented in spec §5.2:

```jsonl
{"type":"session","id":"test-session-001"}
{"role":"user","content":"Search for TypeScript best practices"}
{"role":"assistant","content":[{"type":"toolUse","id":"call_001","name":"web_search","input":{"query":"TypeScript best practices"}}]}
{"role":"toolResult","toolUseId":"call_001","content":"Results: ...","timestamp":1710600000000}
{"role":"assistant","content":"Here are the best practices...","usage":{"input":1200,"output":450}}
```

Also create `fixtures/sessions/failing-tools-session.jsonl` with error patterns, and `fixtures/sessions/compacted-session.jsonl` with compaction artifacts.

- [ ] **Step 2: Write failing test for session parser**

```typescript
import { describe, it, expect } from "vitest";
import { parseSessionFile } from "./session-parser.js";
import path from "node:path";

describe("SessionParser", () => {
  const fixturesDir = path.join(import.meta.dirname, "../../fixtures/sessions");

  it("extracts tool call events from healthy session", () => {
    const events = parseSessionFile(path.join(fixturesDir, "healthy-session.jsonl"), "default");
    const toolCalls = events.filter(e => e.type === "tool_call");
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0].data.toolName).toBe("web_search");
    expect(toolCalls[0].data.success).toBe(true);
  });

  it("extracts LLM call events with token usage", () => {
    const events = parseSessionFile(path.join(fixturesDir, "healthy-session.jsonl"), "default");
    const llmCalls = events.filter(e => e.type === "llm_call");
    expect(llmCalls.length).toBeGreaterThan(0);
  });

  it("derives sessionKey from filename, not header id", () => {
    const events = parseSessionFile(path.join(fixturesDir, "healthy-session.jsonl"), "default");
    // sessionKey derived from filename "healthy-session.jsonl" → "healthy-session"
    expect(events[0].sessionKey).toBe("healthy-session");
  });

  it("handles failing tool calls", () => {
    const events = parseSessionFile(path.join(fixturesDir, "failing-tools-session.jsonl"), "default");
    const failed = events.filter(e => e.type === "tool_call" && !e.data.success);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].data.error).toBeTruthy();
  });

  it("stores only paramsSummary, not raw params", () => {
    const events = parseSessionFile(path.join(fixturesDir, "healthy-session.jsonl"), "default");
    const toolCall = events.find(e => e.type === "tool_call");
    expect(toolCall!.data.paramsSummary).toBeDefined();
    expect(toolCall!.data.paramsSummary.query).toBe("string"); // type descriptor, not value
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/collector/session-parser.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement session-parser.ts**

Core logic: read JSONL line by line, parse session header for sessionId, derive sessionKey from filename, walk assistant messages for tool call blocks (handle `toolUse`, `toolCall`, `functionCall` variants), match with `toolResult` messages by call ID, extract usage fields for LLM call events, produce `ClawDoctorEvent[]`.

Key implementation details:
- `paramsSummary`: iterate `Object.entries(params)`, output `{ key: typeof value }` (e.g. `{ "query": "string", "limit": "number" }`)
- `resultSummary`: `{ type: typeof result, length: JSON.stringify(result).length }`
- `error`: truncate to 200 chars, apply basic redaction (mask strings matching common API key patterns)
- Generate ULID for each event's `id`

- [ ] **Step 5: Write and implement remaining scanners**

`config-scanner.ts`: Read `~/.openclaw/openclaw.json`, produce a `config_snapshot` event.
`memory-scanner.ts`: Glob workspace memory directory for `*.md` files with frontmatter, produce `memory_snapshot` event.
`plugin-scanner.ts`: Read OpenClaw plugin manifests (check `node_modules` for installed plugins), produce `plugin_snapshot` event.

Each with a corresponding test using fixtures.

- [ ] **Step 6: Implement snapshot-collector.ts orchestrator**

```typescript
import type { ClawDoctorEvent } from "../types/events.js";
import { parseSessionFiles } from "./session-parser.js";
import { scanConfig } from "./config-scanner.js";
import { scanMemory } from "./memory-scanner.js";
import { scanPlugins } from "./plugin-scanner.js";

export interface SnapshotCollectorOptions {
  agentId: string;
  stateDir: string;       // ~/.openclaw
  workspaceDir: string;
  since?: number;         // unix ms, only collect events after this
}

export async function collectSnapshot(opts: SnapshotCollectorOptions): Promise<ClawDoctorEvent[]> {
  const events: ClawDoctorEvent[] = [];

  // Session JSONL → tool_call, llm_call, session_lifecycle, agent_lifecycle
  const sessionsDir = `${opts.stateDir}/agents/${opts.agentId}/sessions`;
  events.push(...parseSessionFiles(sessionsDir, opts.agentId, opts.since));

  // Config → config_snapshot
  events.push(scanConfig(`${opts.stateDir}/openclaw.json`, opts.agentId));

  // Memory → memory_snapshot
  events.push(scanMemory(opts.workspaceDir, opts.agentId));

  // Plugins → plugin_snapshot
  events.push(scanPlugins(opts.workspaceDir, opts.agentId));

  return events;
}
```

- [ ] **Step 7: Run all collector tests**

Run: `pnpm test src/collector/`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/collector/ fixtures/
git commit -m "feat: add snapshot collector with session parser, config/memory/plugin scanners"
```

---

## Task 7: Metric Aggregator

**Files:**
- Create: `src/analysis/metric-aggregator.ts`
- Create: `src/analysis/metric-aggregator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase } from "../store/database.js";
import { createEventStore } from "../store/event-store.js";
import { aggregateMetrics } from "./metric-aggregator.js";
import type Database from "better-sqlite3";

describe("MetricAggregator", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
    const store = createEventStore(db);
    // Insert test events
    store.insertEvent({
      id: "01E001", source: "snapshot", timestamp: Date.now(), agentId: "default",
      sessionKey: "s1", type: "tool_call",
      data: { toolName: "file_read", paramsSummary: { path: "string" }, success: true },
    });
    store.insertEvent({
      id: "01E002", source: "snapshot", timestamp: Date.now(), agentId: "default",
      sessionKey: "s1", type: "tool_call",
      data: { toolName: "file_read", paramsSummary: { path: "string" }, success: false, error: "ENOENT" },
    });
  });

  afterEach(() => { db.close(); });

  it("computes tool success rate", () => {
    const metrics = aggregateMetrics(db, "default", { from: 0, to: Date.now() + 1000 });
    expect(metrics.skill.toolCallCount).toBe(2);
    expect(metrics.skill.toolSuccessRate).toBe(0.5);
  });

  it("identifies top error tools", () => {
    const metrics = aggregateMetrics(db, "default", { from: 0, to: Date.now() + 1000 });
    expect(metrics.skill.topErrorTools[0].tool).toBe("file_read");
    expect(metrics.skill.topErrorTools[0].errorCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/analysis/metric-aggregator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement metric-aggregator.ts**

Aggregate from events table using SQL queries to compute each field of `MetricSet` (spec §6.2). Fields that require stream-only data (like `avgToolDurationMs`, `cacheHitRate`) return `null` when no stream events are found.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/analysis/metric-aggregator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analysis/metric-aggregator.*
git commit -m "feat: add metric aggregator computing MetricSet from events"
```

---

## Task 8: Rule Engine

**Files:**
- Create: `src/analysis/rule-engine.ts`
- Create: `src/analysis/rule-engine.test.ts`

- [ ] **Step 1: Write failing tests — one per disease category**

```typescript
import { describe, it, expect } from "vitest";
import { evaluateRules } from "./rule-engine.js";
import { getDiseaseRegistry } from "../diseases/registry.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";
import { DEFAULT_CONFIG } from "../types/config.js";

// Helper to create a MetricSet with specific overrides
function makeMetrics(overrides: Partial<MetricSet>): MetricSet { /* merge with healthy defaults */ }

describe("RuleEngine", () => {
  const registry = getDiseaseRegistry();

  it("detects CST-001 Metabolic Overload when daily tokens exceed threshold", () => {
    const metrics = makeMetrics({
      cost: { dailyTrend: [{ date: "2026-03-17", tokens: 600_000 }], /* ... */ },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const cst001 = results.find(r => r.diseaseId === "CST-001");
    expect(cst001).toBeDefined();
    expect(cst001!.severity).toBe("critical"); // 600K > 500K critical threshold
  });

  it("does not trigger CST-001 for healthy token usage", () => {
    const metrics = makeMetrics({
      cost: { dailyTrend: [{ date: "2026-03-17", tokens: 50_000 }], /* ... */ },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const cst001 = results.find(r => r.diseaseId === "CST-001");
    expect(cst001).toBeUndefined();
  });

  it("detects SK-007 Zombie Skill for unused plugins", () => {
    const metrics = makeMetrics({
      skill: { unusedPlugins: ["browser-tool"], /* ... */ },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    expect(results.find(r => r.diseaseId === "SK-007")).toBeDefined();
  });

  it("detects SEC-001 when sandbox is disabled", () => {
    const metrics = makeMetrics({
      security: { sandboxEnabled: false, /* ... */ },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    const sec001 = results.find(r => r.diseaseId === "SEC-001");
    expect(sec001).toBeDefined();
    expect(sec001!.severity).toBe("critical");
  });

  // Additional critical test cases (implementer should add all 27):

  it("skips CST-003 in snapshot mode (cacheHitRate is null)", () => {
    const metrics = makeMetrics({
      cost: { cacheHitRate: null, /* ... */ },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    expect(results.find(r => r.diseaseId === "CST-003")).toBeUndefined();
  });

  it("detects CST-005 Cost Spike when daily tokens > N * 7-day average", () => {
    const metrics = makeMetrics({
      cost: { dailyTrend: [
        { date: "2026-03-11", tokens: 50_000 },
        { date: "2026-03-12", tokens: 55_000 },
        { date: "2026-03-13", tokens: 48_000 },
        { date: "2026-03-14", tokens: 52_000 },
        { date: "2026-03-15", tokens: 50_000 },
        { date: "2026-03-16", tokens: 53_000 },
        { date: "2026-03-17", tokens: 300_000 }, // spike: ~6x average
      ] },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    expect(results.find(r => r.diseaseId === "CST-005")).toBeDefined();
  });

  it("detects SEC-002 Credential Leak from pattern hits", () => {
    const metrics = makeMetrics({
      security: { credentialPatternHits: [{ file: "memory.md", line: 5, pattern: "sk-..." }] },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    expect(results.find(r => r.diseaseId === "SEC-002")?.severity).toBe("critical");
  });

  it("detects SK-006 Repetition Compulsion from repeat call patterns", () => {
    const metrics = makeMetrics({
      skill: { repeatCallPatterns: [{ tool: "file_read", params: '{"path":"/foo"}', count: 6 }] },
    });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    expect(results.find(r => r.diseaseId === "SK-006")).toBeDefined();
  });

  it("detects VIT-001 when gateway is unreachable", () => {
    const metrics = makeMetrics({ vitals: { gatewayReachable: false } });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    expect(results.find(r => r.diseaseId === "VIT-001")?.severity).toBe("critical");
  });

  it("detects MEM-003 Memory Bloat when file count exceeds threshold", () => {
    const metrics = makeMetrics({ memory: { fileCount: 250, totalSizeBytes: 3_000_000 } });
    const results = evaluateRules(metrics, DEFAULT_CONFIG, registry);
    expect(results.find(r => r.diseaseId === "MEM-003")).toBeDefined();
  });
});
```

Add a separate test for the security CVSS special rule in health-scorer.test.ts (Task 9):

```typescript
  describe("Security CVSS special rule", () => {
    it("forces security department score to 0 when a critical security disease exists", () => {
      const diseases = [{ definitionId: "SEC-001", severity: "critical" as const }];
      const score = computeSecurityDepartmentScore(diseases, metricScores);
      expect(score.score).toBe(0);
      expect(score.grade).toBe("F");
    });
  });

  describe("scoreToGrade boundaries", () => {
    it("maps boundary values correctly", () => {
      expect(scoreToGrade(100)).toBe("A");
      expect(scoreToGrade(90)).toBe("A");
      expect(scoreToGrade(89.9)).toBe("B");
      expect(scoreToGrade(70)).toBe("B");
      expect(scoreToGrade(69.9)).toBe("C");
      expect(scoreToGrade(50)).toBe("C");
      expect(scoreToGrade(49.9)).toBe("D");
      expect(scoreToGrade(25)).toBe("D");
      expect(scoreToGrade(24.9)).toBe("F");
      expect(scoreToGrade(0)).toBe("F");
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/analysis/rule-engine.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement rule-engine.ts**

```typescript
import type { ClawDoctorConfig } from "../types/config.js";
import type { MetricSet } from "./metric-aggregator.js";
import type { DiseaseDefinition, Severity, Evidence } from "../types/domain.js";

export interface RuleResult {
  diseaseId: string;
  status: "confirmed" | "suspect";
  severity: Severity;
  evidence: Evidence[];
  confidence: number;
}

export function evaluateRules(
  metrics: MetricSet,
  config: ClawDoctorConfig,
  registry: { getAll(): DiseaseDefinition[] },
): RuleResult[] {
  const results: RuleResult[] = [];

  for (const disease of registry.getAll()) {
    if (disease.detection.type !== "rule") continue;

    const result = evaluateSingleRule(disease, metrics, config);
    if (result) results.push(result);
  }

  return results;
}

function evaluateSingleRule(
  disease: DiseaseDefinition,
  metrics: MetricSet,
  config: ClawDoctorConfig,
): RuleResult | null {
  const detection = disease.detection;
  if (detection.type !== "rule") return null;

  const threshold = config.thresholds[detection.metric] ?? detection.defaultThresholds;
  const value = resolveMetricValue(detection.metric, metrics);

  if (value === null || value === undefined) return null; // no data

  const { triggered, severity } = checkThreshold(value, threshold, detection.direction);
  if (!triggered) return null;

  return {
    diseaseId: disease.id,
    status: "confirmed",
    severity,
    evidence: [{
      type: "metric",
      description: { en: `${detection.metric} = ${value}` },
      value,
      threshold: severity === "critical" ? threshold.critical : threshold.warning,
      confidence: 1.0,
    }],
    confidence: 1.0,
  };
}

function resolveMetricValue(metric: string, metrics: MetricSet): number | null {
  // Map metric key to MetricSet field path
  // e.g. "skill.successRate" → metrics.skill.toolSuccessRate
  // e.g. "cost.dailyTokens" → metrics.cost.dailyTrend[-1].tokens
  // Each mapping is explicit — no eval or dynamic path resolution
  const METRIC_MAP: Record<string, (m: MetricSet) => number | null> = {
    "skill.successRate": m => m.skill.toolCallCount > 0 ? m.skill.toolSuccessRate : null,
    "cost.dailyTokens": m => m.cost.dailyTrend.at(-1)?.tokens ?? null,
    "cost.cacheHitRate": m => m.cost.cacheHitRate,
    "security.sandboxEnabled": m => m.security.sandboxEnabled ? 1 : 0,
    // ... one entry per threshold key
  };

  return METRIC_MAP[metric]?.(metrics) ?? null;
}

function checkThreshold(
  value: number,
  threshold: { warning: number; critical: number },
  direction: "higher_is_worse" | "lower_is_worse",
): { triggered: boolean; severity: Severity } {
  if (direction === "higher_is_worse") {
    if (value > threshold.critical) return { triggered: true, severity: "critical" };
    if (value > threshold.warning) return { triggered: true, severity: "warning" };
  } else {
    if (value < threshold.critical) return { triggered: true, severity: "critical" };
    if (value < threshold.warning) return { triggered: true, severity: "warning" };
  }
  return { triggered: false, severity: "info" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/analysis/rule-engine.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/analysis/rule-engine.*
git commit -m "feat: add rule engine evaluating 27 diseases against MetricSet"
```

---

## Task 9: Health Scorer

**Files:**
- Create: `src/analysis/health-scorer.ts`
- Create: `src/analysis/health-scorer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { apdexScore, linearScore, computeDepartmentScore, computeOverallScore } from "./health-scorer.js";
import { DEFAULT_CONFIG } from "../types/config.js";

describe("HealthScorer", () => {
  describe("apdexScore", () => {
    it("returns null for empty values", () => {
      expect(apdexScore([], { satisfied: 0.75, frustrated: 0.5 }, true)).toBeNull();
    });

    it("returns 100 when all values are satisfied", () => {
      expect(apdexScore([0.9, 0.8, 0.85], { satisfied: 0.75, frustrated: 0.5 }, true)).toBe(100);
    });

    it("returns 50 when all values are tolerating", () => {
      expect(apdexScore([0.6, 0.65], { satisfied: 0.75, frustrated: 0.5 }, true)).toBe(50);
    });
  });

  describe("linearScore", () => {
    it("returns null for null input", () => {
      expect(linearScore(null, { warning: 100_000, critical: 500_000 })).toBeNull();
    });

    it("returns 100 at warning boundary (higher_is_worse scenario)", () => {
      // daily tokens: warning=100K, critical=500K
      // 100K is the "OK" boundary → score 100
      expect(linearScore(100_000, { warning: 100_000, critical: 500_000 })).toBe(100);
    });

    it("returns 0 at critical boundary", () => {
      expect(linearScore(500_000, { warning: 100_000, critical: 500_000 })).toBe(0);
    });

    it("returns 50 at midpoint", () => {
      expect(linearScore(300_000, { warning: 100_000, critical: 500_000 })).toBe(50);
    });

    it("works for lower_is_worse metrics (success rate)", () => {
      // success rate: warning=0.75, critical=0.50
      expect(linearScore(0.75, { warning: 0.75, critical: 0.50 })).toBe(100);
      expect(linearScore(0.50, { warning: 0.75, critical: 0.50 })).toBe(0);
      expect(linearScore(0.625, { warning: 0.75, critical: 0.50 })).toBe(50);
    });

    it("returns 50 for degenerate threshold (warning === critical)", () => {
      expect(linearScore(100, { warning: 100, critical: 100 })).toBe(50);
    });
  });

  describe("computeOverallScore", () => {
    it("skips departments with null scores", () => {
      const departments = {
        vitals: { score: 90, grade: "A" as const, weight: 0.08, coverage: 1, evaluatedDiseases: 5, skippedDiseases: 0, activeDiseases: 0, criticalCount: 0, warningCount: 0, infoCount: 0 },
        behavior: { score: null, grade: "N/A" as const, weight: 0.26, coverage: 0.2, evaluatedDiseases: 1, skippedDiseases: 5, activeDiseases: 0, criticalCount: 0, warningCount: 0, infoCount: 0 },
        // ... other departments
      };
      const result = computeOverallScore(departments, DEFAULT_CONFIG.weights);
      // behavior (null) should be excluded, weights re-normalized
      expect(result.overall).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Implement health-scorer.ts**

Transcribe `apdexScore`, `linearScore`, `computeDepartmentScore`, `computeOverallScore` from spec §6.6.2-6.6.3. All scoring functions return `number | null` (null = no data).

- [ ] **Step 3: Run tests**

Run: `pnpm test src/analysis/health-scorer.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/analysis/health-scorer.*
git commit -m "feat: add health scorer with Apdex, linear, department, and overall scoring"
```

---

## Task 10: Analysis Pipeline

**Files:**
- Create: `src/analysis/analysis-pipeline.ts`
- Create: `src/analysis/analysis-pipeline.test.ts`

This orchestrates: Snapshot Collect → Store → Aggregate → Rules → Score → Persist.

- [ ] **Step 1: Write failing integration test**

```typescript
import { describe, it, expect } from "vitest";
import { runCheckup } from "./analysis-pipeline.js";
import path from "node:path";

describe("AnalysisPipeline", () => {
  it("runs full checkup with fixture data and produces health score", async () => {
    const result = await runCheckup({
      agentId: "default",
      stateDir: path.join(import.meta.dirname, "../../fixtures"),
      workspaceDir: path.join(import.meta.dirname, "../../fixtures"),
      noLlm: true,
    });

    expect(result.healthScore).toBeDefined();
    expect(result.healthScore.dataMode).toBe("snapshot");
    expect(result.healthScore.coverage.ratio).toBeGreaterThan(0);
    expect(result.diseases.length).toBeGreaterThanOrEqual(0);
    expect(result.healthScore.departments.vitals.grade).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement analysis-pipeline.ts**

```typescript
export interface CheckupOptions {
  agentId: string;
  stateDir: string;
  workspaceDir: string;
  departments?: Department[];
  since?: number;
  noLlm: boolean;
}

export interface CheckupResult {
  healthScore: HealthScore;
  diseases: DiseaseInstance[];
  ruleResults: RuleResult[];
}

export async function runCheckup(opts: CheckupOptions): Promise<CheckupResult> {
  // 1. Open temp SQLite
  const db = openDatabase(":memory:");

  // 2. Collect snapshot events
  const events = await collectSnapshot({ ... });

  // 3. Store events
  const eventStore = createEventStore(db);
  for (const event of events) eventStore.insertEvent(event);

  // 4. Aggregate metrics
  const metrics = aggregateMetrics(db, opts.agentId, { from: opts.since ?? 0, to: Date.now() });

  // 5. Run rule engine
  const registry = getDiseaseRegistry();
  const ruleResults = evaluateRules(metrics, config, registry);

  // 6. Convert RuleResults to DiseaseInstances
  const diseases = ruleResults.map(r => toDiseaseInstance(r));

  // 7. Compute health scores
  const healthScore = computeHealthScore(diseases, metrics, "snapshot", registry);

  // 8. Persist to score store
  const scoreStore = createScoreStore(db);
  scoreStore.insertHealthScore(healthScoreToRow(healthScore));

  db.close();
  return { healthScore, diseases, ruleResults };
}
```

- [ ] **Step 3: Run test**

Run: `pnpm test src/analysis/analysis-pipeline.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/analysis/analysis-pipeline.*
git commit -m "feat: add analysis pipeline orchestrating collect → aggregate → rules → score"
```

---

## Task 11: Terminal Report

**Files:**
- Create: `src/report/terminal-report.tsx`
- Create: `src/report/progress-bar.tsx`
- Create: `src/report/report-data.ts`
- Create: `src/report/terminal-report.test.ts`
- Create: `src/i18n/i18n.ts`
- Create: `src/i18n/locales.ts`
- Create: `src/i18n/i18n.test.ts`

- [ ] **Step 1: Write failing i18n test**

`src/i18n/i18n.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { t } from "./i18n.js";

describe("i18n", () => {
  it("returns locale string when available", () => {
    expect(t({ en: "Hello", zh: "你好" }, "zh")).toBe("你好");
  });

  it("falls back to en when locale is missing", () => {
    expect(t({ en: "Hello" }, "ja")).toBe("Hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/i18n/i18n.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement i18n module**

`src/i18n/i18n.ts`:

```typescript
import type { I18nString } from "../types/domain.js";

export function t(str: I18nString, locale: string): string {
  return str[locale] ?? str.en;
}
```

`src/i18n/locales.ts` — UI strings for report titles, labels, grade names in en + zh.

- [ ] **Step 4: Run i18n test to verify it passes**

Run: `pnpm test src/i18n/i18n.test.ts`
Expected: PASS

- [ ] **Step 5: Implement report-data.ts**

Transform `CheckupResult` into a view model for rendering. Includes: per-department lines, progress bars, disease lists, coverage indicators.

- [ ] **Step 6: Implement terminal-report.tsx**

Ink component that renders the full health report matching the two examples in spec §9.2 (stream full vs snapshot partial). Uses `report-data.ts` for the view model.

Key elements:
- Header with agent name, data range, mode, coverage
- Per-department row: score, grade, progress bar, `[evaluated/total]`
- Active disease list under each department
- Skipped checks note (for snapshot mode)
- Footer with quick actions or plugin CTA

- [ ] **Step 7: Write terminal report test**

```typescript
import { describe, it, expect } from "vitest";
import { render } from "@ink/testing-library";
import { TerminalReport } from "./terminal-report.js";

describe("TerminalReport", () => {
  it("renders snapshot mode report with coverage info", () => {
    const { lastFrame } = render(<TerminalReport result={mockSnapshotResult} locale="en" />);
    const output = lastFrame();
    expect(output).toContain("Mode: snapshot");
    expect(output).toContain("Coverage:");
    expect(output).toContain("N/A"); // behavior dept should show N/A
  });

  it("renders stream mode report without warnings", () => {
    const { lastFrame } = render(<TerminalReport result={mockStreamResult} locale="en" />);
    const output = lastFrame();
    expect(output).toContain("Mode: stream");
    expect(output).not.toContain("install plugin");
  });

  it("renders in Chinese when locale is zh", () => {
    const { lastFrame } = render(<TerminalReport result={mockSnapshotResult} locale="zh" />);
    const output = lastFrame();
    expect(output).toContain("网关"); // VIT-001 or similar Chinese text
  });
});
```

- [ ] **Step 8: Run tests**

Run: `pnpm test src/report/ src/i18n/`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add src/report/ src/i18n/
git commit -m "feat: add terminal health report renderer with i18n and coverage display"
```

---

## Task 12: CLI Commands + Integration

**Files:**
- Create: `src/commands/checkup.ts`
- Create: `src/commands/config-cmd.ts`
- Create: `src/commands/skill-cmd.ts`
- Create: `src/commands/memory-cmd.ts`
- Create: `src/commands/cost-cmd.ts`
- Create: `src/commands/behavior-cmd.ts`
- Create: `src/commands/security-cmd.ts`
- Modify: `src/bin.ts`

- [ ] **Step 1: Implement checkup command**

`src/commands/checkup.ts`:

```typescript
import { Command } from "commander";
import { render } from "ink";
import React from "react";
import { runCheckup } from "../analysis/analysis-pipeline.js";
import { TerminalReport } from "../report/terminal-report.js";
import { loadConfig } from "../config/loader.js";

export function registerCheckupCommand(program: Command): void {
  program
    .command("checkup")
    .description("Run health checkup on your OpenClaw agent")
    .option("--dept <departments>", "Focus on specific departments (comma-separated)")
    .option("--since <duration>", "Data time range (e.g. 7d, 30d)", "7d")
    .option("--no-llm", "Rules only, no LLM analysis")
    .option("--json", "Output as JSON")
    .option("--agent <agentId>", "Agent ID", "default")
    .action(async (opts) => {
      const config = loadConfig(resolveConfigPath());
      const result = await runCheckup({
        agentId: opts.agent,
        stateDir: resolveStateDir(),
        workspaceDir: process.cwd(),
        departments: opts.dept?.split(","),
        since: parseSince(opts.since),
        noLlm: true, // Phase 1: always no LLM
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        render(React.createElement(TerminalReport, { result, locale: config.locale }));
      }
    });
}
```

- [ ] **Step 2: Implement config commands**

`clawdoctor config init` — create `~/.clawdoctor/config.json` with defaults
`clawdoctor config set <key> <value>` — update a specific key
`clawdoctor config show` — print current config

- [ ] **Step 3: Implement department-specific commands**

`clawdoctor skill list`, `clawdoctor memory scan`, `clawdoctor cost report`, `clawdoctor security audit` — each runs a focused checkup and renders a department-specific view.

- [ ] **Step 4: Wire all commands into bin.ts**

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { registerCheckupCommand } from "./commands/checkup.js";
import { registerConfigCommand } from "./commands/config-cmd.js";
import { registerSkillCommand } from "./commands/skill-cmd.js";
import { registerMemoryCommand } from "./commands/memory-cmd.js";
import { registerCostCommand } from "./commands/cost-cmd.js";
import { registerBehaviorCommand } from "./commands/behavior-cmd.js";
import { registerSecurityCommand } from "./commands/security-cmd.js";

const program = new Command();
program.name("clawdoctor").description("Health diagnostics for OpenClaw agents").version("0.1.0");

registerCheckupCommand(program);
registerConfigCommand(program);
registerSkillCommand(program);
registerMemoryCommand(program);
registerCostCommand(program);
registerBehaviorCommand(program);
registerSecurityCommand(program);

program.parse();
```

- [ ] **Step 5: Manual smoke test**

```bash
pnpm dev checkup --agent default --no-llm
pnpm dev config show
pnpm dev skill list
```

Verify output looks reasonable.

- [ ] **Step 6: Commit**

```bash
git add src/commands/ src/bin.ts
git commit -m "feat: add CLI commands — checkup, config, skill, memory, cost, security"
```

---

## Task 13: E2E Test + Release Prep

**Files:**
- Create: `src/e2e.test.ts`
- Modify: `package.json` (verify bin, exports, files)
- Create: `README.md`

- [ ] **Step 1: Write E2E test**

```typescript
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

describe("E2E", () => {
  it("clawdoctor checkup --json produces valid JSON output", () => {
    const output = execSync("tsx src/bin.ts checkup --json --agent default", {
      cwd: path.join(import.meta.dirname, ".."),
      env: { ...process.env, OPENCLAW_STATE_DIR: path.join(import.meta.dirname, "../fixtures") },
      encoding: "utf-8",
    });

    const result = JSON.parse(output);
    expect(result.healthScore).toBeDefined();
    expect(result.healthScore.dataMode).toBe("snapshot");
    expect(typeof result.healthScore.overall).toBe("number");
    expect(result.healthScore.coverage).toBeDefined();
  });

  it("clawdoctor config show outputs config", () => {
    const output = execSync("tsx src/bin.ts config show", {
      cwd: path.join(import.meta.dirname, ".."),
      encoding: "utf-8",
    });
    expect(output).toContain("locale");
    expect(output).toContain("thresholds");
  });
});
```

- [ ] **Step 2: Run E2E test**

Run: `pnpm test src/e2e.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 4: Build and verify**

```bash
pnpm build
node dist/bin.js checkup --json --agent default
```

- [ ] **Step 5: Create README.md**

Brief README with: what ClawDoctor does, `npx clawdoctor checkup` quick start, CLI command reference, configuration, link to design spec.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: add E2E tests and README for Phase 1 release"
```

---

## Summary

| Task | Description | Dependencies | Parallelizable With |
|------|-------------|-------------|-------------------|
| 1 | Project Scaffold | — | — |
| 2 | Domain Types | 1 | — |
| 3 | Config System | 2 | 4, 5, 9 |
| 4 | SQLite Store | 2 | 3, 5, 9 |
| 5 | Disease Registry | 2 | 3, 4, 9 |
| 6 | Snapshot Collector | 2 | 3, 4, 5, 9 |
| 7 | Metric Aggregator | 4 | — |
| 8 | Rule Engine | 5, 7 | — |
| 9 | Health Scorer | 2 | 3, 4, 5 |
| 10 | Analysis Pipeline | 7, 8, 9 | 11 |
| 11 | Terminal Report | 2, 9 | 10 |
| 12 | CLI Commands | 10, 11, 3 | — |
| 13 | E2E + Release | 12 | — |

**Optimal agent team allocation (4 parallel agents):**

```
Round 1: Agent A → Task 1 (scaffold)
Round 2: Agent A → Task 2 (types)
Round 3: Agent A → Task 3 (config)  |  Agent B → Task 4 (store)  |  Agent C → Task 5 (diseases)  |  Agent D → Task 6 (collector)  |  Agent E → Task 9 (scorer)
Round 4: Agent A → Task 7 (aggregator)
Round 5: Agent A → Task 8 (rule engine)
Round 6: Agent A → Task 10 (pipeline)  |  Agent B → Task 11 (report)
Round 7: Agent A → Task 12 (CLI)
Round 8: Agent A → Task 13 (E2E)
```
