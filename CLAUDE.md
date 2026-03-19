# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClawDoctor is a health diagnostics tool for OpenClaw agents. It analyzes an agent's sessions, config, memory, and plugins to detect issues across 6 departments (vitals, skill, memory, behavior, cost, security), score health, generate prescriptions, and track recovery. It has two modes: standalone CLI (`npx clawdoctor checkup`) and OpenClaw plugin (real-time event streaming via hooks).

## Commands

```bash
pnpm install          # Install dependencies
pnpm check            # TypeScript type-check (tsc --noEmit)
pnpm build            # Build to dist/
pnpm test             # Run all tests (vitest)
pnpm dev checkup      # Run CLI in dev mode (tsx)
```

Run a single test file:
```bash
pnpm test src/analysis/rule-engine.test.ts
```

Run tests matching a pattern:
```bash
pnpm test -t "evaluateRules"
```

Run with real OpenClaw data:
```bash
CLAWDOCTOR_STATE_DIR=~/.openclaw pnpm dev checkup --agent main --no-llm
```

## Architecture

### Data Flow (analysis pipeline)

The core pipeline in `src/analysis/analysis-pipeline.ts` (`runCheckup()`) orchestrates everything:

```
Snapshot Collector (reads ~/.openclaw files)
  → SQLite (persistent at ~/.clawdoctor/clawdoctor.db)
  → Metric Aggregator (SQL queries → MetricSet)
  → Rule Engine (27 rule-based diseases + hybrid preFilters → RuleResult[])
  → LLM Analyzer (3-round: scan → deep → causal chain, when --no-llm is not set)
  → Prescription Generator (LLM-based, for confirmed diseases)
  → Health Scorer (Apdex + linear threshold + AHP weights → HealthScore)
  → Terminal Report / JSON output
```

### Type System

All domain types live in `src/types/`:
- `domain.ts` — `DiseaseDefinition`, `DiseaseInstance`, `Evidence`, `Prescription`, `CausalChain`, detection strategy discriminated union (`RuleDetection | LLMDetection | HybridDetection`)
- `events.ts` — `ClawDoctorEvent`, `EventType`, `EventDataMap` (discriminated union mapping event types to data shapes)
- `config.ts` — `ClawDoctorConfig` with all threshold keys, AHP weights, LLM settings
- `scoring.ts` — `HealthScore`, `DepartmentScore`, `DataCoverage`, `Grade`

### Disease Registry

43 diseases defined across 6 files in `src/diseases/` (vitals.ts, skill.ts, memory.ts, behavior.ts, cost.ts, security.ts). The registry (`registry.ts`) aggregates them and supports merging community plugin diseases via `createMergedRegistry()`.

Disease detection types: `"rule"` (threshold-based, Phase 1), `"llm"` (LLM-only analysis), `"hybrid"` (rule preFilter → LLM confirmation). The rule engine evaluates rule + hybrid preFilters; the LLM analyzer handles the rest.

### SQLite Store

`src/store/database.ts` manages schema migrations (currently v2). Tables: `events`, `diagnoses`, `prescriptions`, `followups`, `health_scores`, `causal_chains`. All stores use `better-sqlite3` with WAL mode and parameterized queries.

`runCheckup()` always writes to persistent `~/.clawdoctor/clawdoctor.db`. Tests pass `dbPath: ":memory:"` explicitly.

### Dual-Mode Collection

- **Snapshot Collector** (`src/collector/`): Parses session JSONL files, scans config/memory/plugins from disk. Privacy-safe: stores `paramsSummary` (key→type) not raw values.
- **Stream Collector** (`src/plugin/`): OpenClaw plugin registers hooks (`llm_output`, `after_tool_call`, `session_end`, etc.) and buffers events before flushing to SQLite.

### Dashboard

`src/dashboard/server.ts` is a Hono app with 15 API routes + single-file SPA at `src/dashboard/public/index.html`. All `/api/*` endpoints require bearer token auth (except `/api/badge`). Server binds to `127.0.0.1` only.

### Community Plugins

`src/plugins/` loads npm packages (`clawdoctor-plugin-*`) via dynamic `import()`. Plugins can contribute `DiseaseDefinition[]` and/or custom `RuleEvaluator` functions. Plugin diseases merge into the registry; custom rules are passed to `evaluateRules()`.

### Prescription Lifecycle

`src/prescription/` handles: generate (LLM-based) → preview (diff) → apply (2-phase backup: pre+post hash) → rollback (3-way conflict detection) → follow-up (T+1h/24h/7d checkpoints).

## Key Conventions

- **ESM-only** — all imports use `.js` extension (`import { foo } from "./bar.js"`)
- **i18n** — user-facing strings use `I18nString` type (`{ en: "...", zh: "..." }`). Resolve with `t(str, locale)` from `src/i18n/i18n.ts`
- **Scoring** — `null` means "no data / unknown" (NOT "healthy"). Departments with <50% coverage get grade `"N/A"`
- **Privacy** — raw tool params/results never stored in SQLite. Only type summaries persisted. Raw data accessed on-demand via `RawSampleProvider`
- **Dedup** — "latest checkup wins": each run resolves stale diagnoses, deletes pending prescriptions and old causal chains before inserting new results

## Design Spec

The authoritative design document is `docs/2026-03-17-clawdoctor-design.md`. It defines all types, disease definitions, scoring algorithms (Apdex, AHP, CVSS), and architectural decisions. Reference it when making changes to core logic.
