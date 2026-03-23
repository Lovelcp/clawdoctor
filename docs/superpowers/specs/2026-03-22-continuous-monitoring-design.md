# Continuous Monitoring, Self-Healing & Alert System Design

> Date: 2026-03-22
> Status: Draft (v2 — revised after independent review)
> Author: ClawDoctor Core Team

## Motivation

ClawDoctor currently operates as a **point-in-time diagnostic tool** — users run `clawdoc checkup` to get a snapshot of their agent's health. This works well for post-mortem analysis, but misses a critical capability: **real-time detection and automated response**.

Production OpenClaw deployments need:

1. **Continuous observation** — detect gateway crashes, stuck sessions, and auth failures as they happen, not hours later
2. **Automated remediation** — restart a crashed gateway without waiting for a human to notice
3. **Budget protection** — stop runaway API spend before it becomes a $500 surprise
4. **Proactive alerting** — push notifications when something goes wrong, not pull-based checking

This design extends ClawDoctor from a diagnostic tool into a **full clinical system** — adding continuous monitoring (Monitor), risk classification (Triage), automated fixes (Intervention), alert notifications (Page), approval workflows (Consent), and audit trails (Chart).

## Design Principles

1. **Dual-engine collection** — event-driven (Plugin Stream) + periodic polling (Probe) cover both session-level and infrastructure-level health
2. **Function-over-inheritance** — Probes and Interventions are composable functions with dependency injection, not class hierarchies
3. **Safety-first automation** — every automated action is classified by risk; high-risk actions require explicit human approval
4. **Unified data layer** — all new components write to the existing SQLite store, so `checkup`, `dashboard`, and `monitor` share the same data
5. **Channel-agnostic communication** — alerts and approvals flow through abstract interfaces; adding a new channel (Slack, Discord, etc.) requires only implementing the interface
6. **Foreground-first** — the monitor runs as a foreground process; OS-level daemonization (systemd, launchd, Docker) is the user's responsibility, not ours

## Concept Map

ClawDoctor uses a medical metaphor throughout. New concepts extend this naturally:

| Patient Journey | Concept | Description |
|----------------|---------|-------------|
| Registration | Config | System configuration and thresholds |
| Collection | Snapshot | One-time disk scan (checkup mode) |
| | Stream | Real-time hook events (plugin mode) |
| | **Probe** | Periodic infrastructure checks (monitor mode) |
| Lab Work | Metrics | Aggregated measurements from events |
| | Rule Engine | Threshold-based automated detection |
| Consultation | LLM Analyzer | Deep pattern analysis (3-round) |
| | Causal Chain | Cross-department root cause reasoning |
| Diagnosis | Disease | Identified health issue |
| | Evidence | Supporting data points |
| | Department | Classification (vitals, skill, memory, behavior, cost, security, **infra**) |
| Scoring | Health Score | Apdex + AHP weighted composite |
| | Grade | Letter grade (A/B/C/D/F/N/A) |
| Prescription | Rx | Generated fix plan |
| **Triage** | **Triage** | Risk classification: green (auto) / yellow (approval) / red (alert only) |
| **Treatment** | **Intervention** | Execute remediation action |
| | **Consent** | Human approval for risky operations (4 channels) |
| **Monitoring** | **Monitor** | Continuous vital signs engine with multiple Probes |
| | **Page** | Alert notification dispatch (Telegram + Webhook) |
| Recovery | Follow-up | T+1h/24h/7d verification checkpoints |
| | Rollback | Undo failed interventions |
| | **Chart** | Structured audit trail of all interventions |

## Architecture

### Module Structure

```
src/
├── monitor/                     # Continuous monitoring engine
│   ├── monitor-engine.ts        # Probe scheduling, lifecycle
│   ├── monitor-state.ts         # Persisted runtime state (SQLite)
│   ├── probe.ts                 # Probe interface + factory
│   ├── probe-scheduler.ts       # Non-overlapping async scheduling
│   └── probes/                  # Individual probe implementations
│       ├── gateway-probe.ts     # Gateway process health
│       ├── cron-probe.ts        # Cron job health
│       ├── auth-probe.ts        # Authentication status
│       ├── session-probe.ts     # Stuck/silent session detection
│       ├── budget-probe.ts      # Daily spend tracking
│       └── cost-probe.ts        # Cost anomaly detection
│
├── triage/                      # Risk classification
│   ├── triage-engine.ts         # Severity × risk → triage level
│   └── triage-rules.ts          # Configurable triage rule definitions
│
├── intervention/                # Automated remediation
│   ├── intervention-engine.ts   # Dispatch: triage result → execute or request consent
│   ├── intervention.ts          # Intervention interface + registry
│   └── interventions/           # Individual intervention implementations
│       ├── gateway-restart.ts
│       ├── cron-retry.ts
│       ├── auth-refresh.ts
│       ├── session-kill.ts
│       └── budget-halt.ts
│
├── consent/                     # Human approval system
│   ├── consent-engine.ts        # Multi-channel routing, first-response-wins
│   ├── consent-channel.ts       # ConsentChannel interface
│   └── channels/
│       ├── telegram-channel.ts  # Inline button approval
│       ├── cli-channel.ts       # Terminal interactive approval (foreground only)
│       ├── webhook-channel.ts   # External system callback
│       └── dashboard-channel.ts # Web UI approval (via shared SQLite)
│
├── page/                        # Alert notifications
│   ├── page-dispatcher.ts       # Rate limiting, dedup, priority routing
│   ├── page-channel.ts          # PageChannel interface
│   └── channels/
│       ├── telegram-page.ts
│       └── webhook-page.ts
│
├── chart/                       # Intervention audit trail
│   ├── chart-store.ts           # SQLite persistence
│   └── chart-query.ts           # Filtering and reporting
│
├── diseases/
│   └── infra.ts                 # NEW: Infrastructure department diseases
```

### Data Flow

#### Existing Flow (unchanged)

```
clawdoc checkup
  Snapshot → Store → Metrics → Rules → LLM → Prescription → Score → Report
```

#### New: Monitor Flow

Probes have their **own dedicated disease-matching path** — they do NOT feed into the existing rule engine (which operates on `MetricSet` aggregated from session events). Instead, each `Finding` emitted by a Probe is matched directly to a `DiseaseDefinition` by ID from the registry. The Probe is the detector; the registry is the catalog; the Triage is the dispatcher.

```
clawdoc monitor start

┌─────────────────────────────────────────────────────────────┐
│  Monitor Engine (foreground process)                         │
│                                                              │
│  ┌──────────────┐  Non-overlapping async scheduler           │
│  │ ProbeScheduler│  Each probe: setTimeout after completion  │
│  └──────┬───────┘  (never setInterval — prevents overlap)    │
│         │                                                    │
│         │ ProbeResult { status, findings[], metrics }        │
│         ▼                                                    │
│  ┌──────────┐                                                │
│  │ Store    │  Write probe_result event to SQLite             │
│  └──────┬───┘                                                │
│         ▼                                                    │
│  ┌──────────────┐  Match finding.code → DiseaseDefinition.id │
│  │ ProbeMatcher │  Direct lookup from registry (not MetricSet)│
│  └──────┬───────┘                                            │
│         │ DiseaseInstance[]                                   │
│         ▼                                                    │
│  ┌──────────┐  green / yellow / red                          │
│  │ Triage   │  Based on severity × intervention risk          │
│  └──────┬───┘                                                │
│         │                                                    │
│  ┌──────────────────┐  Concurrent result queue               │
│  │ ActionDispatcher  │  Decoupled from probe scheduling       │
│  └──────┬───────────┘  (slow intervention ≠ blocked probes)  │
│         │                                                    │
│         ├── green ──→ Intervention auto-execute               │
│         │                  → Chart record                    │
│         │                                                    │
│         ├── yellow ─→ Page alert                             │
│         │                  → Consent (wait for human)        │
│         │                  → Intervention or skip            │
│         │                  → Chart record                    │
│         │                                                    │
│         └── red ───→ Page emergency alert (no action)        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key architecture decision: ProbeScheduler and ActionDispatcher are decoupled.** Probes push results into a queue; ActionDispatcher processes the queue independently. This ensures a slow intervention (e.g., waiting for consent) never blocks probe execution.

#### Plugin Mode Enhancement

```
OpenClaw Plugin Mode

  Stream Collector (existing)      Monitor Engine (new)
       │                               │
       │ Hook events (real-time)        │ Probe checks (periodic)
       │                               │
       └──────── shared ──────────────┘
                    │
               SQLite Store (WAL mode)
                    │
            Unified disease registry
```

## Required Changes to Existing Types

Adding the `infra` department requires updating the following existing definitions:

1. **`Department` type** (`src/types/domain.ts`): Add `"infra"` to the union
2. **`HealthScore.departments`** (`src/types/scoring.ts`): Now `Record<Department, DepartmentScore>` includes infra
3. **`health_scores` table**: Add `infra REAL` column in migration v3
4. **`DEPARTMENT_METRICS`** (`src/analysis/analysis-pipeline.ts`): Add infra metric specs
5. **`computeOverallScore()`** (`src/analysis/health-scorer.ts`): Update to handle 7 departments
6. **`VALID_DEPARTMENTS`** (`src/dashboard/server.ts`): Add `"infra"` to the set
7. **Dashboard SPA**: Add infra department rendering in department views
8. **i18n**: Add `"infra"` department name to `UI_STRINGS` and `LOCALE_DICT`
9. **Infra score when monitor is off**: `null` (treated as N/A, same convention as other departments with insufficient data)

## Type Definitions

### Shared Utilities

```typescript
// Shell command executor — injectable for testing
// Uses execFile(bin, args), NOT exec(shell string), to prevent injection.
// Implementations MUST: validate bin against an allowlist, enforce timeoutMs,
// kill child process on cancellation, and run with minimal privileges.
type ShellExecutor = (
  bin: string,
  args: readonly string[],
  opts?: { readonly timeoutMs?: number; readonly cwd?: string }
) => Promise<ShellResult>;

interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// Allowed binaries (validated at ShellExecutor construction):
// "openclaw", "systemctl", "pgrep", "journalctl"
// Any other binary → reject with error.
```

### Probe

```typescript
// ProbeId is a typed union, not a generic string
type ProbeId = "gateway" | "cron" | "auth" | "session" | "budget" | "cost";

interface ProbeConfig {
  readonly id: ProbeId;
  readonly intervalMs: number;
  readonly enabled: boolean;
  // Probe-specific params — each probe reads what it needs from here
  readonly params: Readonly<Record<string, unknown>>;
}

// Probe-specific params examples:
// gateway: { processName: "openclaw-gateway" }
// cron:    { schedules: Record<string, { intervalMs: number; graceMs: number }> }
// auth:    { logSource: "journalctl" | "file"; logPath?: string }
// budget:  { dailyLimitUsd: number; timezone: string }
// cost:    { spikeMultiplier: number; minSessionsForBaseline: number }
// session: { inactiveThresholdMs: number }

// ProbeResult.status vocabulary — unified across all probe outputs
type ProbeStatus = "ok" | "warning" | "critical" | "error";
// "ok" = healthy, "warning" = issue detected, "critical" = severe issue,
// "error" = probe itself failed (e.g., permission denied)

interface ProbeResult {
  readonly probeId: ProbeId;
  readonly status: ProbeStatus;
  readonly findings: readonly Finding[];
  readonly metrics: Readonly<Record<string, number>>;
  readonly timestamp: number;               // Unix ms
}

interface Finding {
  readonly code: string;                     // Disease ID, e.g. "INFRA-001"
  readonly message: I18nString;
  readonly severity: Severity;               // Reuses existing: "critical" | "warning" | "info"
  readonly context: Readonly<Record<string, unknown>>;
}

// ProbeError — distinct from Finding. Probe self-errors are NOT findings.
interface ProbeError {
  readonly probeId: ProbeId;
  readonly error: string;
  readonly timestamp: number;
}

type Probe = (config: ProbeConfig, deps: ProbeDeps) => Promise<ProbeResult>;

interface ProbeDeps {
  readonly stateDir: string;
  readonly exec: ShellExecutor;
  readonly store: EventStore;               // For historical queries (rolling averages, etc.)
}
```

### Probe → Event Integration

Probes have a **dedicated disease-matching path**, separate from the existing rule engine:

```typescript
// New event type added to EventType union
type ProbeEventType = "probe_result";

interface ProbeResultData {
  readonly probeId: ProbeId;
  readonly status: ProbeStatus;
  readonly findings: readonly Finding[];
  readonly metrics: Readonly<Record<string, number>>;
}
// Added to EventDataMap: { probe_result: ProbeResultData }

// Direct disease matching — does NOT use MetricSet or the existing rule engine.
// The Probe is the detector; the registry is the lookup table.
type ProbeDiseaseMatch = (
  finding: Finding,
  registry: DiseaseRegistry
) => DiseaseInstance | null;
// Looks up finding.code in registry. If found, creates a DiseaseInstance
// with the finding's severity, context, and current timestamp.
// If not found (unknown code), returns null and logs a warning.
```

### Non-Overlapping Probe Scheduler

```typescript
// Uses setTimeout-after-completion, NOT setInterval.
// If a probe takes 5s and interval is 30s, next run starts 30s after completion (35s gap).
// If a probe takes 40s and interval is 30s, next run starts immediately after completion.
// This prevents overlapping executions.

interface ProbeScheduler {
  readonly start: (probes: ReadonlyArray<{ config: ProbeConfig; fn: Probe }>) => void;
  readonly stop: () => Promise<void>;   // Waits for in-flight probes (max 10s timeout)
  readonly stats: () => Readonly<Record<ProbeId, ProbeStats>>;
}

interface ProbeStats {
  readonly lastRunAt: number | null;
  readonly lastStatus: ProbeStatus | null;
  readonly runCount: number;
  readonly consecutiveErrors: number;        // Reset to 0 on any non-error result
  readonly totalErrors: number;
}
```

### Action Queue (decouples probes from interventions)

```typescript
// ProbeResults are pushed into an async queue.
// ActionDispatcher processes them independently of probe scheduling.
// This ensures a slow intervention never blocks probe execution.

interface ActionItem {
  readonly finding: Finding;
  readonly disease: DiseaseInstance;
  readonly triageResult: TriageResult;
  readonly timestamp: number;
}

interface ActionDispatcher {
  readonly enqueue: (item: ActionItem) => void;
  readonly start: () => void;
  readonly stop: () => Promise<void>;  // Drains queue, waits for in-flight actions (max 30s)
}
```

### Triage

```typescript
type TriageLevel = "green" | "yellow" | "red";

interface TriageResult {
  readonly level: TriageLevel;
  readonly diseaseId: string;
  readonly agentId?: string;                 // Target agent (for dedup and identity)
  readonly reason: I18nString;
  readonly interventionId?: string;
}

// Triage considers: disease severity, intervention risk, confidence, and retry count.
type TriageRule = (
  disease: DiseaseInstance,
  intervention: InterventionDef | undefined,
  retryCount: number                         // How many times this intervention has been tried
) => TriageLevel;
```

### Intervention

```typescript
interface InterventionDef {
  readonly id: string;
  readonly targetDiseaseIds: readonly string[];
  readonly riskLevel: "low" | "medium" | "high";
  readonly reversible: boolean;
  readonly maxRetries: number;               // Default 3. After this, escalate to red.
  readonly description: I18nString;          // Human-readable description of what this does
}

type InterventionExecutor = (
  target: InterventionTarget,
  deps: InterventionDeps
) => Promise<InterventionOutcome>;

interface InterventionDeps {
  readonly exec: ShellExecutor;
  readonly store: EventStore;
  readonly chartStore: ChartStore;
  readonly stateDir: string;
  readonly snapshotDir: string;              // ~/.clawdoctor/snapshots/
}

interface InterventionTarget {
  readonly diseaseInstance: DiseaseInstance;
  readonly agentId?: string;
  readonly context: Readonly<Record<string, unknown>>;
}

interface InterventionOutcome {
  readonly success: boolean;
  readonly action: string;                   // Human-readable: "Executed: openclaw gateway restart"
  readonly snapshotId?: string;
  readonly message: I18nString;
}

// Registry for looking up interventions
type InterventionRegistry = {
  readonly getByDiseaseId: (diseaseId: string) => InterventionDef | undefined;
  readonly getExecutor: (interventionId: string) => InterventionExecutor | undefined;
  readonly all: () => readonly InterventionDef[];
};

// Concrete intervention specifications:
//
// gateway-restart:
//   action: openclaw gateway restart (or systemctl restart openclaw-gateway)
//   precondition: verify gateway is actually down (re-check before acting)
//   reversible: false (restart is not undoable, but safe)
//
// cron-retry:
//   action: openclaw cron retry <job-name>
//   precondition: verify job is in failed state
//   reversible: false
//
// auth-refresh:
//   action: openclaw auth refresh
//   precondition: verify auth is actually expired (re-check before acting)
//   dependency: requires valid refresh token (if not available, skip with message)
//   reversible: false
//   NOTE: defaults to dry-run even when triage is green. Must be explicitly enabled.
//
// session-kill:
//   action: openclaw session kill <agent> <session-id>
//   precondition: verify session is still stuck (re-check mtime + confirm cost threshold)
//   reversible: false
//   NOTE: only kills sessions inactive > threshold AND cost > configurable minimum
//
// budget-halt:
//   action: openclaw gateway pause (graceful request rejection, NOT process kill)
//   precondition: verify spend is still over budget
//   reversible: true (openclaw gateway resume)
//   NOTE: does NOT kill sessions or revoke keys. Pauses new request acceptance.
//   This is the least destructive option that still stops spend.
```

### Consent

```typescript
type ConsentChannelType = "telegram" | "cli" | "webhook" | "dashboard";

interface ConsentRequest {
  readonly id: string;                       // ULID
  readonly triageResult: TriageResult;
  readonly intervention: InterventionDef;
  readonly context: Readonly<Record<string, unknown>>;
  readonly expiresAt: number;                // Unix ms
  readonly agentId?: string;
}

// Full consent lifecycle states
type ConsentStatus = "pending" | "approved" | "executing" | "executed" | "rejected" | "expired" | "cancelled" | "failed";

interface ConsentResponse {
  readonly requestId: string;
  readonly decision: "approved" | "rejected";    // Only human decisions — expired/cancelled are system transitions
  readonly channel: ConsentChannelType;
  readonly respondedBy?: string;                 // Telegram user ID, webhook identity, etc.
  readonly respondedAt: number;
}

type ConsentChannel = {
  readonly type: ConsentChannelType;
  readonly send: (req: ConsentRequest) => Promise<SendResult>;   // Can fail — result tells us
  readonly poll: () => Promise<ConsentResponse | null>;
  readonly cancel: (requestId: string) => Promise<void>;         // Notify channel that request is closed
};

interface SendResult {
  readonly success: boolean;
  readonly error?: string;
}

// CLI channel constraints:
// - Only available when monitor runs in foreground with TTY attached
// - process.stdin.isTTY must be true, otherwise channel is auto-disabled
// - If configured but no TTY, log a warning and skip (do not fail)
```

### Page

```typescript
// Priority vocabulary — consistent with Severity mapping below
type PagePriority = "info" | "warning" | "critical" | "emergency";

// Severity → PagePriority mapping (explicit, no ambiguity):
// Severity "info" → PagePriority "info"
// Severity "warning" → PagePriority "warning"
// Severity "critical" → PagePriority "critical"
// Probe self-error (3+ consecutive) → PagePriority "warning"
// budget-halt triggered → PagePriority "emergency"

interface PageMessage {
  readonly priority: PagePriority;
  readonly title: I18nString;
  readonly body: I18nString;
  readonly diseaseId?: string;
  readonly probeId?: ProbeId;
  readonly agentId?: string;                 // For routing and dedup identity
  readonly timestamp: number;                // Unix ms (always number, never ISO string)
}

type PageChannel = {
  readonly type: "telegram" | "webhook";
  readonly send: (msg: PageMessage) => Promise<SendResult>;   // Can fail
};

interface PageDispatcherConfig {
  readonly rateLimit: {
    readonly perProbeMs: number;              // Default 300000 (5min)
    readonly globalMaxPerHour: number;        // Default 30
  };
  readonly dedup: {
    readonly info: number;                    // Default 21600000 (6h)
    readonly warning: number;                 // Default 3600000 (1h)
    readonly critical: number;               // Default 900000 (15m)
    readonly emergency: number;              // Default 0 (never suppress)
  };
  readonly channels: readonly PageChannel[];
}

// Channel failure handling:
// If a PageChannel.send() fails, retry once after 5s.
// If retry fails, log to Chart and continue (do not block the pipeline).
// No exponential backoff — alerts are time-sensitive.
```

### Chart

```typescript
interface ChartEntry {
  readonly id: string;                       // ULID
  readonly timestamp: number;                // Unix ms
  readonly probeId?: ProbeId;
  readonly diseaseId?: string;
  readonly agentId?: string;
  readonly triageLevel?: TriageLevel;        // Optional: system events have no triage
  readonly interventionId?: string;
  readonly action: string;
  readonly outcome: ChartOutcome;
  readonly consentChannel?: ConsentChannelType;
  readonly consentResponse?: string;         // "approved" | "rejected" | ...
  readonly snapshotId?: string;
  readonly details: Readonly<Record<string, unknown>>;
}

type ChartOutcome = "success" | "failed" | "skipped" | "expired" | "cancelled";
```

### Monitor Engine

```typescript
interface TriageConfig {
  readonly autoGreen: boolean;               // Auto-execute green-level interventions (default true)
  readonly defaultOnTimeout: "reject";       // Hardcoded — safety-first, auto-approve not supported
}

interface MonitorConfig {
  readonly stateDir: string;
  readonly probes: readonly ProbeConfig[];
  readonly triage: TriageConfig;
  readonly page: PageDispatcherConfig;
  readonly consent: ConsentConfig;
  readonly dryRun: boolean;
}

interface ConsentConfig {
  readonly channels: readonly ConsentChannelType[];
  readonly timeoutMs: number;                // Default 1800000 (30 min)
  readonly telegram?: {                      // Telegram-specific consent config
    readonly allowedUserIds: readonly string[];  // Only these Telegram users can approve
  };
}

type MonitorEngine = {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;        // Graceful shutdown (see below)
  readonly status: () => MonitorStatus;      // Reads from persisted state, not in-memory
};

// Runtime state is persisted to SQLite (monitor_state table), not held in memory.
// This allows `clawdoc monitor status` (a separate process) to read it.
interface MonitorStatus {
  readonly running: boolean;
  readonly pid: number;
  readonly startedAt: number | null;
  readonly probeStats: Readonly<Record<ProbeId, ProbeStats>>;
  readonly pendingConsents: number;
  readonly todayInterventions: { readonly executed: number; readonly failed: number };
}
```

## New Disease Definitions

### Infrastructure Department (INFRA-*)

| ID | Name (en) | Name (zh) | Severity | Detection | Description |
|----|-----------|-----------|----------|-----------|-------------|
| INFRA-001 | Gateway Cardiac Arrest | 网关心脏骤停 | critical | rule | Gateway process not running |
| INFRA-002 | Cron Arrhythmia | 定时任务心律不齐 | warning | rule | 3+ consecutive cron job failures |
| INFRA-003 | Cron Arrest | 定时任务停搏 | warning | rule | Cron job overdue beyond schedule + grace window |
| INFRA-004 | Auth Immune Rejection | 认证免疫排斥 | warning | rule | Authentication failures detected (401/403/token expired) |
| INFRA-005 | Budget Hemorrhage | 预算大出血 | critical | rule | Daily API spend exceeded budget limit |
| INFRA-006 | Delivery Failure | 投递衰竭 | info | rule | Cron job delivery failures |

Note: Severity uses the existing `Severity` type: `"critical" | "warning" | "info"`. Disease IDs intentionally skip numbers (BHV-008/009, CST-007~009) to leave gaps for future diseases.

### Additions to Existing Departments

| ID | Dept | Name (en) | Name (zh) | Severity | Detection | Description |
|----|------|-----------|-----------|----------|-----------|-------------|
| BHV-010 | behavior | Session Coma | 会话昏迷 | warning | rule | Session inactive beyond configurable threshold (default 2h), verified by file mtime + event gap |
| BHV-011 | behavior | Silent Completion Syndrome | 静默完成综合征 | info | hybrid | Session completed with zero tool calls in >30s |
| CST-010 | cost | Cost Spike Fever | 成本飙升热 | critical | rule | Session cost >Nx rolling average (N configurable, default 3x, minimum 20 sessions for baseline) |

### Detection Edge Cases

- **CST-010 baseline**: Requires `minSessionsForBaseline` (default 20) sessions before detection activates. New agents with <20 sessions → no spike detection, no false positives.
- **BHV-010 session kill**: Only kills sessions where inactivity exceeds threshold AND session cost exceeds configurable minimum (default $1). Prevents killing legitimate idle sessions.
- **INFRA-003 cron overdue**: Requires per-job schedule metadata in probe config (`params.schedules`). Without schedule config, this disease is not evaluated (fail-open, not fail-closed).
- **INFRA-004 auth source**: Configurable via `params.logSource` — either journalctl (Linux) or log file grep (macOS fallback). If source is unavailable, probe returns `error` status (self-error, not a finding).

### Probe → Disease → Intervention Mapping

| Probe | Diseases | Intervention | Default Triage |
|-------|----------|-------------|----------------|
| gateway-probe | INFRA-001 | gateway-restart | green (auto) |
| cron-probe | INFRA-002, INFRA-003, INFRA-006 | cron-retry | yellow (approval) |
| auth-probe | INFRA-004 | auth-refresh | yellow (approval, dry-run default) |
| session-probe | BHV-010 | session-kill | yellow (approval) |
| budget-probe | INFRA-005 | budget-halt | yellow (approval) |
| cost-probe | CST-010 | — (alert only) | red (no action) |

### AHP Weight Redistribution

```
Before: { vitals: 0.08, skill: 0.26, memory: 0.14, behavior: 0.26, cost: 0.11, security: 0.15 }
After:  { vitals: 0.06, skill: 0.22, memory: 0.12, behavior: 0.22, cost: 0.10, security: 0.13, infra: 0.15 }
```

Infrastructure receives weight 0.15 — infrastructure failures affect all other departments, warranting high priority. When the monitor has never run (no probe data), infra score is `null` → grade `"N/A"`, and the overall score is computed from the remaining 6 departments with re-normalized weights.

## Monitor Engine Design

### Process Model

The monitor is a **foreground process**. It does NOT daemonize itself.

```
clawdoc monitor start         # Runs in foreground, logs to stdout
clawdoc monitor start &       # User can background it with shell
# For production: use systemd, launchd, Docker, or supervisord.
```

**Why foreground-only:**
- Cross-platform daemon management is an unsolved problem (systemd vs launchd vs Windows services)
- OS service managers handle restart-on-crash, log rotation, and resource limits better than we can
- CLI consent channel requires TTY — only works in foreground
- Simpler implementation, fewer bugs

**Process coordination:**
- Monitor writes a state file (`~/.clawdoctor/monitor.state`) on start, updates it periodically
- `clawdoc monitor status` reads this file (no IPC needed)
- `clawdoc monitor stop` sends SIGTERM to the PID in the state file
- Stale state detection: if PID in state file is not alive, `status` reports "not running"

```typescript
interface MonitorStateFile {
  readonly pid: number;
  readonly startedAt: number;
  readonly lastHeartbeat: number;            // Updated every 30s
  readonly probeStats: Readonly<Record<ProbeId, ProbeStats>>;
  readonly pendingConsents: number;
  readonly todayInterventions: { executed: number; failed: number };
}
// File location: ~/.clawdoctor/monitor.state (JSON, mode 0o600)
// Read by: clawdoc monitor status
// Written by: monitor engine (atomically: write tmp + rename)
```

### Scheduling

Each Probe uses `setTimeout`-after-completion (NOT `setInterval`):

```
Monitor Engine start
  │
  ├── ProbeScheduler
  │     For each enabled probe:
  │       1. Run probe
  │       2. Push results to ActionQueue
  │       3. setTimeout(intervalMs) → goto 1
  │     (If probe takes longer than interval, next run starts immediately)
  │     (Never overlaps — next run only starts after previous completes)
  │
  ├── ActionDispatcher (independent loop)
  │     Dequeues results and processes:
  │       1. Write to Store (event)
  │       2. Match Disease (ProbeDiseaseMatch)
  │       3. Triage
  │       4. Route: Intervention / Page+Consent / Page-only
  │       5. Write to Chart
  │     (Slow interventions don't block probe scheduling)
  │
  ├── Consent Poller (independent loop, 10s interval)
  │     Checks consent_requests table for status changes
  │     Processes approved/rejected/expired requests
  │
  ├── Heartbeat (30s interval)
  │     Updates monitor.state file with latest stats
  │
  └── Maintenance (1h interval)
        Prune expired page_dedup entries
        Prune old chart entries (configurable retention)
```

### Graceful Shutdown

```
clawdoc monitor stop → reads PID from monitor.state → sends SIGTERM

Monitor Engine receives SIGTERM:
  1. Stop ProbeScheduler (wait for in-flight probes, max 10s)
     → If timeout: log warning, continue shutdown
  2. Stop ActionDispatcher (drain queue, wait for in-flight actions, max 30s)
     → If timeout: log warning, record partial state
  3. Transition all pending consent requests to "cancelled"
  4. Write final Chart entry: "Monitor stopped"
  5. Delete monitor.state file
  6. Exit 0
```

## Page Alert Design

### Dedup Policy (priority-based)

| Priority | Dedup Window | Rationale |
|----------|-------------|-----------|
| info | 6h | Low urgency, avoid noise |
| warning | 1h | Standard suppression |
| critical | 15m | Allow frequent updates |
| emergency | 0 | Never suppress |

### Dedup Key Format

Keys are composed as `"${probeId}:${diseaseId}:${agentId ?? 'default'}"`. This ensures:
- Different agents produce independent alerts
- Same disease on same agent is deduped
- After a successful self-heal, the dedup window resets (key is deleted on disease resolution)

### Rate Limiting

- Per-probe minimum interval: configurable (default 5m)
- Global cap: configurable max alerts per hour (default 30), prevents alert storms

### Channel Failure Handling

If `PageChannel.send()` fails:
1. Retry once after 5s
2. If retry fails, log error to Chart and continue
3. If a channel fails 5 consecutive times, disable it for 1h with a warning page to other channels

### Webhook Security

**Outbound** (page alerts): `X-ClawDoc-Signature: sha256=<hmac>` header using configured secret.

**Inbound** (consent callbacks): Verified by bearer token. Dashboard API already requires bearer auth; webhook consent callbacks use the same token. See Security section.

### Telegram Message Format

```
🔴 ClawDoctor Alert — CRITICAL

Gateway Cardiac Arrest (INFRA-001)

Agent: main
Detected: 2026-03-22 10:15:03
Probe: gateway (3 consecutive failures)

Intervention: gateway-restart
Risk: low | Triage: green (auto-execute)

──────
Result: Gateway restarted successfully
```

### Webhook Payload

All timestamps are Unix ms (number). The webhook payload uses the same vocabulary as the TypeScript types.

```json
{
  "type": "clawdoc.page",
  "priority": "warning",
  "disease": {
    "id": "INFRA-002",
    "name": { "en": "Cron Arrhythmia", "zh": "定时任务心律不齐" },
    "severity": "warning"
  },
  "probe": { "id": "cron", "status": "warning" },
  "agentId": "main",
  "intervention": {
    "id": "cron-retry",
    "riskLevel": "medium",
    "triageLevel": "yellow"
  },
  "consent": {
    "id": "01JQXYZ...",
    "required": true,
    "approveUrl": "https://your-webhook-receiver.example.com/approve/01JQXYZ..."
  },
  "timestamp": 1711094103000
}
```

Note: `consent.approveUrl` points to the external webhook receiver's own URL (configured by the user), NOT to `127.0.0.1`. The receiver POSTs back to the dashboard's consent API using the bearer token.

## Consent Approval Design

### Multi-Channel Routing

```
ConsentRequest → route to all enabled channels simultaneously
                   ├── Telegram: inline buttons [Approve] [Reject] (verified user ID)
                   ├── CLI: terminal prompt (y/n) — only if TTY attached
                   ├── Webhook: POST to external URL (signed)
                   └── Dashboard: write to consent_requests table (read by SPA)

First response wins → update status atomically → notify other channels → execute or skip
```

### State Machine

```
pending
  ├── approved → executing → executed (success) → Chart record
  │                       └── failed → Chart record (intervention failed)
  ├── rejected → Chart record (skipped)
  ├── expired → Chart record (defaultOnTimeout = reject → skipped)
  └── cancelled → Chart record (monitor shutdown)
```

The `executing` state prevents duplicate execution on crash-restart: if the monitor restarts and finds a consent in `executing` state, it checks the Chart for an outcome. If no outcome exists, it re-attempts the intervention (idempotent). If an outcome exists, it transitions to `executed` or `failed`.

### Concurrency Safety

ConsentResponse acceptance uses atomic CAS:

```sql
UPDATE consent_requests
SET status = 'approved', responded_at = ?, responded_via = ?
WHERE id = ? AND status = 'pending'
RETURNING *;
```

If `RETURNING` is empty, another channel already responded — discard the late response.

### Identity & Authorization

- **Telegram**: Consent only accepted from user IDs in `consent.telegram.allowedUserIds`. Unknown users receive a rejection message.
- **CLI**: Inherently authorized (user is at the terminal)
- **Webhook**: Inbound callback must include the dashboard bearer token
- **Dashboard**: Already authenticated via existing bearer token auth

### Dashboard API

```
GET  /api/consent/pending          → List pending approvals (requires bearer token)
GET  /api/consent/:id              → Approval details (requires bearer token)
POST /api/consent/:id/respond      → Submit decision (requires bearer token)
                                     body: { decision: "approved" | "rejected" }
```

CSRF protection: Dashboard SPA uses bearer token in Authorization header (not cookies), so CSRF is not applicable. Webhook callbacks also use bearer token.

## Storage Extensions

### SQLite Concurrency Model

Multiple processes (monitor, dashboard, CLI) access the same SQLite database. Requirements:

- **WAL mode**: Already enabled in existing `database.ts`. All new tables inherit WAL mode.
- **busy_timeout**: Set to 5000ms (5s) on all connections. Prevents `SQLITE_BUSY` under normal contention.
- **Write serialization**: SQLite WAL allows one writer + multiple readers. The monitor is the primary writer; dashboard writes are rare (consent responses, config updates). No additional locking needed.
- **Migration safety**: Migration v2→v3 runs at startup. If monitor is running during upgrade, it must be stopped first. `clawdoc monitor start` checks schema version and refuses to start if migration is needed.

### SQLite Schema Migration (v2 → v3)

```sql
-- Extend existing health_scores table for infra department
ALTER TABLE health_scores ADD COLUMN infra REAL;

-- Monitor runtime state (replaces in-memory MonitorStatus)
CREATE TABLE monitor_state (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Intervention audit trail
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
  details         TEXT                       -- JSON
);

CREATE INDEX idx_chart_ts ON chart_entries(timestamp);
CREATE INDEX idx_chart_probe ON chart_entries(probe_id);
CREATE INDEX idx_chart_outcome ON chart_entries(outcome);

-- Approval requests
CREATE TABLE consent_requests (
  id              TEXT PRIMARY KEY,
  timestamp       INTEGER NOT NULL,
  triage_level    TEXT NOT NULL,
  intervention_id TEXT NOT NULL,
  disease_id      TEXT NOT NULL,
  agent_id        TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  channels        TEXT NOT NULL,             -- JSON array
  responded_at    INTEGER,
  responded_via   TEXT,
  responded_by    TEXT,                      -- Identity of responder
  expires_at      INTEGER NOT NULL,
  context         TEXT                       -- JSON
);

CREATE INDEX idx_consent_status ON consent_requests(status);
CREATE INDEX idx_consent_expires ON consent_requests(expires_at);

-- Alert dedup state
CREATE TABLE page_dedup (
  key             TEXT PRIMARY KEY,          -- "probeId:diseaseId:agentId"
  priority        TEXT NOT NULL,
  last_sent_at    INTEGER NOT NULL
);

-- Intervention retry tracking
CREATE TABLE intervention_retries (
  disease_id      TEXT NOT NULL,
  agent_id        TEXT NOT NULL DEFAULT 'default',
  intervention_id TEXT NOT NULL,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  last_attempted  INTEGER NOT NULL,
  suppressed      INTEGER NOT NULL DEFAULT 0,  -- 1 = suppressed after max retries
  PRIMARY KEY (disease_id, agent_id, intervention_id)
);
```

### Data Redaction

Probe context, intervention details, and Chart entries may contain sensitive data (error messages, paths, tokens). Redaction rules:

- Error messages: first 200 chars, with pattern-based redaction (same as existing `session-parser.ts`)
- Auth-related context: token values replaced with `"[REDACTED]"` before storage
- Webhook payloads: same redaction applied before sending
- Snapshots: stored locally (mode 0o600), never sent to external channels

## Configuration Extensions

```typescript
interface ClawDoctorConfig {
  // ... existing fields unchanged ...

  readonly monitor: {
    readonly probes: {
      readonly gateway:  { readonly enabled: boolean; readonly intervalMs: number; readonly params?: Record<string, unknown> };
      readonly cron:     { readonly enabled: boolean; readonly intervalMs: number; readonly params?: Record<string, unknown> };
      readonly auth:     { readonly enabled: boolean; readonly intervalMs: number; readonly params?: Record<string, unknown> };
      readonly session:  { readonly enabled: boolean; readonly intervalMs: number; readonly params?: Record<string, unknown> };
      readonly budget:   { readonly enabled: boolean; readonly intervalMs: number; readonly dailyLimitUsd: number; readonly timezone?: string };
      readonly cost:     { readonly enabled: boolean; readonly intervalMs: number; readonly spikeMultiplier: number; readonly minSessionsForBaseline?: number };
    };
    readonly triage: {
      readonly autoGreen: boolean;           // Default true
      readonly defaultOnTimeout: "reject";   // Hardcoded reject for safety
    };
  };

  readonly page: {
    readonly telegram: {
      readonly enabled: boolean;
      readonly botToken: string;
      readonly chatId: string;
    };
    readonly webhook: {
      readonly enabled: boolean;
      readonly url: string;
      readonly secret?: string;              // HMAC signing for outbound
    };
    readonly rateLimit: {
      readonly perProbeMs: number;           // Default 300000 (5min)
      readonly globalMaxPerHour: number;     // Default 30
    };
    readonly dedup: {
      readonly info: number;                 // Default 21600000 (6h)
      readonly warning: number;              // Default 3600000 (1h)
      readonly critical: number;             // Default 900000 (15m)
      readonly emergency: number;            // Default 0
    };
  };

  readonly consent: {
    readonly channels: readonly ConsentChannelType[];   // Default ["cli"]
    readonly timeoutMs: number;                         // Default 1800000 (30 min)
    readonly telegram?: {
      readonly allowedUserIds: readonly string[];       // Telegram user IDs that can approve
    };
  };

  readonly weights: {
    readonly vitals: number;
    readonly skill: number;
    readonly memory: number;
    readonly behavior: number;
    readonly cost: number;
    readonly security: number;
    readonly infra: number;
  };
}
```

### Config Validation

At startup, the monitor validates config and refuses to start on invalid state:

- `page.telegram.enabled && !page.telegram.botToken` → error: "Telegram enabled but botToken missing"
- `consent.channels.includes("telegram") && !consent.telegram?.allowedUserIds?.length` → error: "Telegram consent enabled but no allowedUserIds"
- `consent.channels.includes("cli") && !process.stdin.isTTY` → warning: "CLI consent channel disabled (no TTY)"
- `page.webhook.enabled && !page.webhook.url` → error: "Webhook enabled but URL missing"
- `weights` values don't sum to ~1.0 (±0.01 tolerance) → error: "Weights must sum to 1.0"
- `monitor.probes.budget.dailyLimitUsd <= 0` → error: "Budget limit must be positive"

## CLI Commands

### New Commands

```bash
clawdoc monitor start [--dry-run]    # Start continuous monitoring (foreground)
clawdoc monitor stop                 # Stop monitoring (SIGTERM to running process)
clawdoc monitor status               # Show probe stats (reads state file)
clawdoc chart [-n 20]                # View intervention audit trail
clawdoc chart --probe cron           # Filter by probe
clawdoc chart --outcome failed       # Filter by outcome
clawdoc chart --since 2026-03-21     # Filter by date
```

### Example Output: `clawdoc monitor status`

```
ClawDoctor Monitor — Running since 2026-03-22 09:30:00 (PID 12345)

  Probe            Interval   Last Run      Status    Runs  Errors
  ─────────────────────────────────────────────────────────────────
  gateway          30s        2s ago        ok        120   0
  cron             60s        15s ago       ok        60    2
  auth             60s        45s ago       ok        60    0
  session          60s        30s ago       warning   60    5
  budget           5m         2m ago        ok        12    0
  cost             5m         4m ago        ok        12    1

  Pending Consents: 1 (session-kill, waiting 3m)
  Today's Interventions: 2 executed, 0 failed
```

## Probe Error Handling

When a probe itself fails (not detecting a problem, but encountering an error during execution):

1. **Separate from findings**: Probe self-errors produce a `ProbeError`, NOT a `Finding`. They are never matched to diseases and never trigger interventions.
2. **Error counted**: `ProbeStats.consecutiveErrors` incremented; reset to 0 on any successful run.
3. **Consecutive failures trigger alert**: 3+ consecutive probe errors → Page with `warning` priority. Message: "Probe {probeId} is unhealthy: {error}"
4. **No intervention**: Probe failures are observability issues, not patient health issues.
5. **Logging**: Probe errors logged to Chart with `outcome: "failed"`, `action: "probe-error"`.

## Intervention Retry Semantics

When an intervention fails:

1. **Record failure**: Chart entry with `outcome: "failed"`.
2. **Increment retry counter**: `intervention_retries` table tracks per-disease retry count.
3. **Next probe cycle**: If disease is still detected, triage considers retry count:
   - `retryCount < maxRetries` → same triage level, try again
   - `retryCount >= maxRetries` → escalate to `red` (alert only, no further auto-intervention)
4. **Reset on resolution**: If the disease resolves (probe returns ok), retry counter resets to 0 and suppression is cleared.
5. **No immediate retry**: Failed interventions are never retried in the same probe cycle.

## Dry-Run Mode

`clawdoc monitor start --dry-run` runs the full pipeline but:
- Probes execute normally (read-only checks)
- Triage classification runs normally
- Interventions are **skipped** — logged as `outcome: "skipped"` with `details: { reason: "dry-run" }`
- Consent requests are **not sent**
- Page alerts: sent with `[DRY-RUN]` prefix in title (so users know these are test alerts)
- Chart records all actions with dry-run annotation

## Dual-Engine Coordination (Plugin Stream + Monitor Probes)

When both the OpenClaw plugin (Stream) and Monitor (Probes) are active simultaneously:

1. **No event duplication**: Stream events and Probe events use different `EventType` values (`session_end` vs `probe_result`), stored in the same `events` table but never conflicting.
2. **Complementary detection**: Stream catches session-level issues in real-time (tool errors, token spikes); Probes catch infrastructure issues (gateway down, cron overdue).
3. **Disease dedup by instance**: If both engines detect the same disease for the same agent, the `intervention_retries` table prevents duplicate interventions. A disease instance is identified by `(diseaseId, agentId)`.
4. **Single intervention pipeline**: Regardless of detection source, all confirmed diseases flow through Triage → Intervention → Consent → Chart.

## Security Model

### Threat Boundaries

1. **Local process**: Monitor runs as the same user as OpenClaw. No privilege escalation needed for shell commands.
2. **Telegram bot**: Bot token stored in config (mode 0o600). Consent approval restricted to allowlisted user IDs.
3. **Webhook outbound**: HMAC-signed. Receiver can verify authenticity.
4. **Webhook inbound** (consent callbacks): Must include dashboard bearer token.
5. **Dashboard API**: All consent endpoints require existing bearer token auth. No new auth mechanism needed.
6. **Data in transit**: Telegram uses HTTPS (Bot API). Webhooks should use HTTPS (user's responsibility).
7. **Data at rest**: Config file mode 0o600, snapshot dir mode 0o700, all SQLite files mode 0o600.
8. **Redaction**: Sensitive data (tokens, credentials, raw error messages) redacted before storage and before sending to external channels.

### Replay Protection

- Consent responses include `requestId` + CAS on `status = 'pending'`. Replayed responses fail silently (CAS miss).
- Telegram inline buttons include a unique callback ID per request. Stale button presses are rejected.
- Webhook consent callbacks are idempotent — same decision for same requestId is a no-op.

## Testing Strategy

| Module | Unit Tests | Integration Tests | E2E Tests |
|--------|-----------|-------------------|-----------|
| Probes | Each probe with mock ShellExecutor | Engine scheduling + SQLite writes | — |
| ProbeScheduler | Non-overlap timing, error counting | — | — |
| ActionDispatcher | Queue processing, decoupling | — | — |
| Triage | All severity × risk × retry combinations | — | — |
| Intervention | Each intervention with mock exec | Triage green → auto-execute → Chart | — |
| Consent | Each channel independently | Multi-channel CAS, timeout, cancel | — |
| Page | Dedup logic, rate limiting, channel failure | Message format verification | — |
| Chart | — | CRUD + query filters | — |
| Config | Validation rules | — | — |
| Full Pipeline | — | — | Start monitor → inject fault → verify Chart |

**SQLite testing**: Unit and integration tests use in-memory SQLite (`:memory:`). E2E tests and concurrency tests use file-based SQLite to exercise WAL mode and multi-process access.

Target: 80%+ coverage per module.

## Implementation Phases

### Phase 1 — Read-Only Monitor + Alerting

- Probe interface + ProbeScheduler (non-overlapping)
- `gateway-probe` + `session-probe` + `cost-probe`
- Monitor Engine (foreground, state file, heartbeat)
- ProbeDiseaseMatch (direct disease lookup)
- INFRA-001, BHV-010, CST-010 disease definitions
- `infra` department type + AHP weight extension
- Page Dispatcher + Telegram channel + Webhook channel
- Dedup + rate limiting
- Chart store + `clawdoc chart` command
- `clawdoc monitor start/stop/status`
- Config validation
- Schema migration v3
- **NO interventions, NO consent, NO triage automation in this phase**
- Triage runs but all results are logged as `red` (alert only)
- 80%+ test coverage

### Phase 2 — Triage + Interventions

- Triage Engine (green/yellow/red with retry escalation)
- ActionDispatcher (decoupled queue)
- Intervention Engine + `gateway-restart` + `session-kill`
- Remaining probes (cron, auth, budget)
- Remaining diseases (INFRA-002~006, BHV-011)
- intervention_retries tracking
- Snapshot capture before interventions
- `auth-refresh` (dry-run default), `cron-retry`, `budget-halt`
- 80%+ test coverage

### Phase 3 — Consent System

- Consent Engine + state machine (pending → executing → executed)
- Telegram channel (inline buttons + user ID allowlist)
- CLI channel (TTY check)
- Dashboard channel (consent_requests table + API endpoints)
- Webhook channel (signed callbacks + bearer token verification)
- Multi-channel first-response-wins (CAS)
- Timeout + cancellation handling
- 80%+ test coverage

### Phase 4 — Integration & Polish

- Infra department in Dashboard panels
- Monitor data integrated into checkup reports
- i18n: ~50 new string keys (en/zh)
- `config init` interactive flow enhancement
- Plugin mode + Monitor dual-engine coordination
- Maintenance mode / alert suppression
- Documentation updates
