# ClawDoctor — Design Specification

> Comprehensive health diagnostics for OpenClaw agents.
> v2.1 | 2026-03-17

---

## 1. Vision

**ClawDoctor is the private doctor for your lobster — a full-spectrum diagnostic agent system that checks health, finds root causes, prescribes remedies, and tracks recovery.**

### Analogy

```
Human Checkup                         Lobster Checkup (ClawDoctor)
────────────                           ──────────────────────────
Blood test     → basic metrics         System Vitals → runtime metrics
ECG            → cardiac function      Skill & Tool Health → tool quality
CT / MRI       → deep structure        Agent Behavior → behavioral patterns
Blood sugar    → metabolic level       Cost Metabolism → cost metabolism
Immune panel   → defense ability       Security Immunity → security immunity
Brain function → cognitive ability     Memory Cognition → memory cognition
Report         → overall assessment    Health Report → comprehensive report
Prescription   → improvement plan      Prescription → auto-improvement plan
Follow-up      → track recovery        Follow-up → continuous monitoring
```

### Core Diagnostic Target

A ClawDoctor instance diagnoses **one OpenClaw workspace agent**, covering:

```
~/.openclaw/agents/<agentId>/
  ├── sessions/*.jsonl          → behavior analysis, cost analysis
  ├── agent/                    → agent configuration
  └── ...
+ ~/.openclaw/openclaw.json     → global configuration
+ /tmp/openclaw/*.log           → runtime logs
+ workspace memory files        → memory health analysis
+ installed plugins/skills      → skill & security analysis
```

### Target Users

| Priority | User Type | Needs |
|----------|-----------|-------|
| Primary | OpenClaw end users (non-technical) + geeks | "Why did my lobster get dumber?" One-click checkup, clear report |
| Secondary | Skill developers | "Is my skill healthy? How to improve?" |
| Secondary | OpenClaw operators | "Is the gateway stable? Where are the costs going?" |

### Deployment Model

**Hybrid**: single npm package with two entry points.

```
npm package: clawdoctor
  ├── bin: clawdoctor             → standalone CLI (zero-config, works without OpenClaw plugin)
  └── exports: ./plugin        → OpenClaw Plugin entry (loaded by gateway for real-time data)
```

- **CLI mode**: `npx clawdoctor checkup` — reads disk files, zero setup
- **Plugin mode**: install as OpenClaw plugin — real-time event collection via hooks
- Both modes share the same analysis engine and data model

### Relationship to `openclaw doctor`

The existing `openclaw doctor` command handles **config repair and system migration** — normalizing legacy config keys, migrating on-disk state layouts, repairing service installations, and verifying auth profiles. It is a repair tool.

ClawDoctor handles **agent health diagnostics** — analyzing tool usage patterns, memory quality, behavioral efficiency, cost trends, and security posture. It is a diagnostic tool.

The two are complementary:
- `openclaw doctor` answers: "Is my OpenClaw installation configured correctly?"
- `clawdoctor checkup` answers: "Is my agent performing well?"

Overlap exists in the `VIT-*` (System Vitals) department, which checks some of the same signals (gateway health, config validity, plugin load errors). ClawDoctor's VIT checks are intentionally shallow — they serve as context for the agent-level diagnosis, not as a replacement for `openclaw doctor`. If ClawDoctor detects VIT-level issues, it should recommend running `openclaw doctor` for repair rather than attempting fixes itself.

---

## 2. Product Architecture

### 2.1 Six Departments

```
┌──────────────────────┬──────────────────────────────────────────┐
│ Department           │ Scope & Data Sources                     │
├──────────────────────┼──────────────────────────────────────────┤
│ 1. System Vitals     │ Gateway status, config integrity,        │
│    VIT-*             │ plugin load status                       │
│                      │ Sources: config + gateway health         │
│                      │ Analysis: rules only                     │
├──────────────────────┼──────────────────────────────────────────┤
│ 2. Skill & Tool      │ Plugin/Skill health, tool call success   │
│    SK-*              │ rate, error patterns, call duration       │
│                      │ Sources: after_tool_call hooks + manifests│
│                      │ Analysis: rules + LLM (root cause)       │
├──────────────────────┼──────────────────────────────────────────┤
│ 3. Memory Cognition  │ Memory file health, freshness, conflicts │
│    MEM-*             │ session context utilization              │
│                      │ Sources: filesystem scan + session JSONL  │
│                      │ Analysis: rules + LLM (content quality)  │
├──────────────────────┼──────────────────────────────────────────┤
│ 4. Agent Behavior    │ Task completion, tool selection accuracy  │
│    BHV-*             │ death loop detection, conversation       │
│                      │ efficiency                               │
│                      │ Sources: agent_end + tool hooks + session │
│                      │ Analysis: LLM primary (pattern recognition)│
├──────────────────────┼──────────────────────────────────────────┤
│ 5. Cost Metabolism   │ Token consumption, cache hit rate, model  │
│    CST-*             │ routing, per-session/tool/model breakdown │
│                      │ Sources: llm_output hooks (usage field)   │
│                      │ Analysis: rules only (numeric thresholds) │
├──────────────────────┼──────────────────────────────────────────┤
│ 6. Security Immunity │ Plugin security audit, permission exposure│
│    SEC-*             │ credential leak, skill code analysis      │
│                      │ Sources: config + plugin manifests + logs │
│                      │ Analysis: rules + LLM (skill code scan)  │
└──────────────────────┴──────────────────────────────────────────┘
```

### 2.2 LLM vs Rules Decision Matrix

| Scenario | Method | Rationale |
|----------|--------|-----------|
| Numeric threshold checks (token > X, success rate < Y) | Rules | Deterministic, no LLM needed |
| Config integrity checks | Rules | Binary valid/invalid |
| Filesystem scans (stale files, bloat) | Rules | File metadata directly computable |
| Security audit (credential exposure, permissions) | Rules | Pattern matching; security shouldn't depend on probabilistic output |
| Error pattern attribution (why does this tool fail) | LLM | Requires understanding error message semantics |
| Behavioral pattern recognition (death loops, decision paralysis) | LLM | Requires analyzing tool call sequence patterns |
| Memory content quality (contradictions, staleness, hallucination) | LLM | Requires understanding text semantics |
| Prescription generation (concrete improvement suggestions) | LLM | Requires creative output |
| Cross-department causal chain reasoning | LLM | Multi-dimensional causal reasoning is LLM's strength |

### 2.3 Top-Level Architecture

```
╔══════════════════════════════════════════════════════════════════╗
║                    ClawDoctor — Dual-Mode Architecture              ║
║                                                                  ║
║  ┌─────────────────┐          ┌─────────────────┐               ║
║  │  CLI (npx)      │          │  Web Dashboard   │               ║
║  │  checkup/rx/... │          │  trends/details   │               ║
║  └────────┬────────┘          └────────┬────────┘               ║
║           │                            │                         ║
║  ┌────────▼────────────────────────────▼────────┐               ║
║  │              Analysis Engine                  │               ║
║  │                                               │               ║
║  │  ┌─────────┐ ┌─────────┐ ┌────────────────┐  │               ║
║  │  │ Rules   │ │ LLM     │ │ Cross-Dept     │  │               ║
║  │  │ Engine  │ │ Analyzer│ │ Linker         │  │               ║
║  │  └─────────┘ └─────────┘ └────────────────┘  │               ║
║  └──────────────────┬───────────────────────────┘               ║
║                     │                                            ║
║  ┌──────────────────▼───────────────────────────┐               ║
║  │           Unified Data Store (SQLite)         │               ║
║  │  events | metrics | diagnoses | prescriptions │               ║
║  └──────────┬──────────────────┬────────────────┘               ║
║             │                  │                                 ║
║  ┌──────────▼──────┐ ┌────────▼─────────┐                      ║
║  │ Snapshot         │ │ Stream            │                      ║
║  │ Collector        │ │ Collector         │                      ║
║  │                  │ │                   │                      ║
║  │ Session JSONL    │ │ Plugin Hooks:     │                      ║
║  │ Config files     │ │  llm_input/output │                      ║
║  │ Memory files     │ │  tool_call        │                      ║
║  │ Log files        │ │  session lifecycle│                      ║
║  │ Plugin manifests │ │  agent_end        │                      ║
║  │                  │ │  subagent events  │                      ║
║  │ (zero-config)    │ │ (requires plugin) │                      ║
║  └──────────────────┘ └───────────────────┘                      ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 3. Disease Domain Model

### 3.1 Core Types

```typescript
// ═══════════════════════════════════════════════
//  Core Domain: Disease
// ═══════════════════════════════════════════════

type Department =
  | "vitals"     // System Vitals
  | "skill"      // Skill & Tool
  | "memory"     // Memory Cognition
  | "behavior"   // Agent Behavior
  | "cost"       // Cost Metabolism
  | "security";  // Security Immunity

type Severity = "critical" | "warning" | "info";

// i18n support: default English, extensible
type I18nString = {
  en: string;
  [locale: string]: string;  // zh, ja, ko, ...
};

// ─── Disease Definition (static registry) ───
interface DiseaseDefinition {
  id: string;                        // "SK-001", "MEM-003"
  department: Department;
  category: string;                  // intra-department grouping: "efficiency", "reliability"
  name: I18nString;                  // { en: "Token Obesity", zh: "Token 肥胖症" }
  description: I18nString;
  rootCauses: I18nString[];
  detection: DetectionStrategy;
  prescriptionTemplate: PrescriptionTemplate;
  relatedDiseases: string[];         // cross-department links
  defaultSeverity: Severity;
  tags: string[];                    // for search/filter
}

// ─── Disease Instance (runtime diagnosis result) ───
interface DiseaseInstance {
  id: string;                        // unique instance ID (ULID)
  definitionId: string;
  severity: Severity;
  evidence: Evidence[];
  confidence: number;                // 0-1
  firstDetectedAt: number;
  lastSeenAt: number;
  status: "active" | "recovering" | "resolved";
  prescription?: Prescription;
  context: Record<string, unknown>;  // e.g. specific tool name, session key
}

// ─── Evidence ───
interface Evidence {
  type: "metric" | "log" | "file" | "config" | "llm_analysis";
  description: I18nString;
  value?: number | string;
  threshold?: number;
  dataReference?: string;            // pointer to specific data (file path, event id)
  confidence: number;
}

// ─── Diagnosis Reference (for cross-department linking) ───
type DiagnosisRef = {
  diseaseId: string;                 // e.g. "MEM-004"
  instanceId: string;                // the specific DiseaseInstance.id
  summary: I18nString;               // brief description for display in causal chains
};

// ─── Prescription Template (carried by each DiseaseDefinition) ───
interface PrescriptionTemplate {
  level: "guided" | "manual";
  actionTypes: PrescriptionAction["type"][];  // which action types this disease typically needs
  promptTemplate: string;            // LLM prompt template for generating concrete prescriptions
  estimatedImprovementTemplate: I18nString;  // e.g. { en: "+{value}% success rate" }
  risk: "low" | "medium" | "high";
}

// ─── Metric Snapshot (for follow-up before/after comparison) ───
interface MetricSnapshot {
  timestamp: number;
  metrics: Record<string, number>;   // key → value, e.g. "skill.successRate" → 0.45
  diseaseId: string;                 // which disease this snapshot relates to
}

// ─── Verification Result (post-prescription immediate check) ───
interface VerificationResult {
  diseaseId: string;
  previousSeverity: Severity;
  currentStatus: "improved" | "unchanged" | "worsened" | "needs_data";
  newMetrics: Record<string, number>;
  note: I18nString;
}

// ─── Rollback Result ───
interface RollbackResult {
  success: boolean;
  restoredFiles: string[];
  skippedFiles: string[];            // already reverted (currentHash === preApplyHash)
  conflicts: Array<{                 // files modified after Rx application
    path: string;
    preApplyHash: string;
    postApplyHash: string;
    currentHash: string;             // !== postApplyHash AND !== preApplyHash
  }>;
  error?: string;
}
```

### 3.2 Detection Strategy

```typescript
type DetectionStrategy =
  | RuleDetection
  | LLMDetection
  | HybridDetection;

// Rule detection — configurable thresholds
interface RuleDetection {
  type: "rule";
  metric: string;                    // "skill.successRate", "cost.dailyTokens"
  direction: "higher_is_worse"       // e.g. token count, error rate, duration
           | "lower_is_worse";       // e.g. success rate, cache hit rate
  // Threshold semantics:
  //   higher_is_worse: value > warning → warning, value > critical → critical
  //   lower_is_worse:  value < warning → warning, value < critical → critical
  defaultThresholds: {
    warning: number;
    critical: number;
  };
}

// LLM detection — semantic analysis
interface LLMDetection {
  type: "llm";
  analysisPromptTemplate: string;
  inputDataKeys: string[];
  outputSchema: Record<string, unknown>;
}

// Hybrid — rule pre-filter + LLM deep analysis
interface HybridDetection {
  type: "hybrid";
  preFilter: RuleDetection;
  deepAnalysis: LLMDetection;
}
```

### 3.3 Disease Registry

ID prefix convention:

| Prefix | Department | Count |
|--------|-----------|-------|
| `VIT-` | System Vitals | 5 |
| `SK-`  | Skill & Tool | 10 |
| `MEM-` | Memory Cognition | 7 |
| `BHV-` | Agent Behavior | 7 |
| `CST-` | Cost Metabolism | 6 |
| `SEC-` | Security Immunity | 8 |

**System Vitals (rules only)**

| ID | Name (en) | Name (zh) | Detection | Severity |
|----|-----------|-----------|-----------|----------|
| VIT-001 | Gateway Offline | 网关离线 | Rule: gateway unreachable | critical |
| VIT-002 | Config Corruption | 配置损坏 | Rule: openclaw.json parse failure | critical |
| VIT-003 | Stale Gateway Version | 网关版本过旧 | Rule: current vs latest version | info |
| VIT-004 | Plugin Load Failure | 插件加载失败 | Rule: plugin load error | warning |
| VIT-005 | Storage Pressure | 存储空间不足 | Rule: state dir disk usage | warning |

**Skill & Tool (hybrid)**

| ID | Name (en) | Name (zh) | Detection | Severity |
|----|-----------|-----------|-----------|----------|
| SK-001 | Token Obesity | Token 肥胖症 | Rule: single call tokens > threshold | warning |
| SK-002 | Scenario Paralysis | 场景偏瘫 | Hybrid: rule pre-filter + LLM error pattern | warning |
| SK-003 | Trigger Disorder | 触发失调 | LLM: analyze tool call sequences | warning |
| SK-004 | Silent Failure | 沉默失败 | Rule: success but empty/invalid result | warning |
| SK-005 | Tool Chain Break | 工具链断裂 | Hybrid: rule detects consecutive failures + LLM breakpoint analysis | critical |
| SK-006 | Repetition Compulsion | 重复强迫症 | Rule: same tool+params N times in session | warning |
| SK-007 | Zombie Skill | 僵尸技能 | Rule: installed but zero calls in N days | info |
| SK-008 | Conflict Allergy | 冲突过敏 | LLM: analyze concurrent tool call interference | warning |
| SK-009 | Context Overflow | 上下文溢出 | Rule: skill context token ratio > threshold | warning |
| SK-010 | Evolution Stagnation | 进化停滞 | Hybrid: rule detects repeated errors + LLM learning opportunity analysis | info |

**Memory Cognition (hybrid)**

| ID | Name (en) | Name (zh) | Detection | Severity |
|----|-----------|-----------|-----------|----------|
| MEM-001 | Memory Amnesia | 记忆失忆症 | LLM: key preferences ignored in sessions | warning |
| MEM-002 | Memory Hallucination | 记忆幻觉 | LLM: factually incorrect memory content | critical |
| MEM-003 | Memory Bloat | 记忆肥大 | Rule: file count/size > threshold | warning |
| MEM-004 | Memory Conflict | 记忆冲突 | LLM: contradictory information across files | warning |
| MEM-005 | Stale Memory | 记忆过期 | Rule: last modified > threshold days | info |
| MEM-006 | Memory Fragmentation | 记忆碎片化 | Rule: many small files + LLM merge analysis | info |
| MEM-007 | Config Drift | 配置漂移 | Hybrid: rule detects stale CLAUDE.md/AGENTS.md (age/size heuristic) + LLM compares content vs recent behavior | warning |

**Agent Behavior (LLM primary)**

| ID | Name (en) | Name (zh) | Detection | Severity |
|----|-----------|-----------|-----------|----------|
| BHV-001 | Decision Paralysis | 选择困难症 | LLM: tool switching patterns | warning |
| BHV-002 | Death Loop | 死循环 | Hybrid: rule detects repeated actions + LLM confirms | critical |
| BHV-003 | Over-Service | 过度服务 | LLM: simple question triggers complex workflow | info |
| BHV-004 | Handoff Amnesia | 交接失忆 | LLM: sub-agent loses critical context | warning |
| BHV-005 | Premature Abort | 过早放弃 | Rule: agent_end.success=false ratio > threshold | warning |
| BHV-006 | Tool Misselection | 工具误选 | LLM: first tool choice accuracy analysis | warning |
| BHV-007 | Verbose Waste | 冗余浪费 | Rule: conversation turns vs effective output ratio | info |

**Cost Metabolism (rules only)**

| ID | Name (en) | Name (zh) | Detection | Severity |
|----|-----------|-----------|-----------|----------|
| CST-001 | Metabolic Overload | 代谢亢进 | Rule: daily tokens > threshold | warning |
| CST-002 | Luxury Invocation | 奢侈调用 | Rule: session total tokens < threshold AND model in expensive-model list (configurable) | warning |
| CST-003 | Cache Miss Epidemic | 缓存失效 | Rule: cacheRead/(cacheRead+input) < threshold (stream-only; skipped in snapshot mode) | warning |
| CST-004 | Sunk Cost | 沉没成本 | Rule: failed session token ratio > threshold | warning |
| CST-005 | Cost Spike | 成本尖峰 | Rule: daily tokens > N * 7-day average | warning |
| CST-006 | Compaction Drain | 压缩消耗 | Rule: compaction token ratio > threshold | info |

**Security Immunity (rules + skill audit)**

| ID | Name (en) | Name (zh) | Detection | Severity |
|----|-----------|-----------|-----------|----------|
| SEC-001 | Immune Deficiency | 免疫缺陷 | Rule: sandbox disabled | critical |
| SEC-002 | Credential Leak | 凭据泄露 | Rule: API key patterns in logs/memory | critical |
| SEC-003 | Skill Supply Chain Risk | 技能供应链风险 | Rule: non-official source, unsigned | warning |
| SEC-004 | Skill Permission Overreach | 技能权限越界 | Rule: requested vs used permissions | warning |
| SEC-005 | Skill Code Injection Risk | 技能代码注入风险 | Hybrid: static rules (eval/exec patterns) + LLM analysis | critical |
| SEC-006 | Injection Hit | 注入中招 | Rule: prompt injection patterns in logs | critical |
| SEC-007 | Open DM Policy | DM 策略开放 | Rule: channel without allowList | warning |
| SEC-008 | Stale Credentials | 凭据过期 | Rule: OAuth token expired or expiring | warning |

---

## 4. Configuration System

### 4.1 Config File

Location: `~/.clawdoctor/config.json` (standalone) or `clawdoctor` key in `~/.openclaw/openclaw.json` (plugin mode).

```typescript
interface ClawDoctorConfig {
  // ─── Display ───
  locale: string;                    // default "en", supports "zh" etc.

  // ─── Thresholds (all overridable) ───
  thresholds: {
    // Skill & Tool
    "skill.successRate": { warning: 0.75; critical: 0.50 };
    "skill.avgDurationMs": { warning: 5000; critical: 15000 };
    "skill.errorBurstCount": { warning: 3; critical: 10 };
    "skill.singleCallTokens": { warning: 50_000; critical: 200_000 };
    "skill.zombieDays": { warning: 14; critical: 30 };
    "skill.repetitionCount": { warning: 3; critical: 5 };
    "skill.contextTokenRatio": { warning: 0.30; critical: 0.50 };

    // Memory
    "memory.staleAgeDays": { warning: 30; critical: 90 };
    "memory.totalFiles": { warning: 50; critical: 200 };
    "memory.totalSizeKB": { warning: 512; critical: 2048 };
    "memory.conflictCount": { warning: 1; critical: 5 };

    // Behavior
    "behavior.taskCompletionRate": { warning: 0.70; critical: 0.50 };
    "behavior.avgStepsPerTask": { warning: 8; critical: 15 };
    "behavior.loopDetectionThreshold": { warning: 3; critical: 5 };
    "behavior.verboseRatio": { warning: 3.0; critical: 5.0 };

    // Cost
    "cost.dailyTokens": { warning: 100_000; critical: 500_000 };
    "cost.cacheHitRate": { warning: 0.30; critical: 0.10 };
    "cost.singleCallTokens": { warning: 50_000; critical: 200_000 };
    "cost.luxurySessionTokenCeiling": { warning: 2000; critical: 1000 };
    // CST-002: sessions below this token count are "simple" — if routed to an expensive model, flag it
    "cost.spikeMultiplier": { warning: 2.0; critical: 5.0 };
    "cost.failedSessionTokenRatio": { warning: 0.30; critical: 0.50 };
    "cost.compactionTokenRatio": { warning: 0.20; critical: 0.40 };

    // Security
    "security.exposedCredentials": { warning: 1; critical: 1 };
    "security.unsandboxedPlugins": { warning: 1; critical: 3 };

    // Vitals
    "vitals.diskUsageMB": { warning: 500; critical: 1000 };

    [key: string]: { warning: number; critical: number };
  };

  // ─── Health Score Weights (AHP-derived defaults) ───
  weights: {
    vitals: 0.08;
    skill: 0.26;
    memory: 0.14;
    behavior: 0.26;
    cost: 0.11;
    security: 0.15;
  };

  // ─── LLM Settings ───
  llm: {
    enabled: boolean;                // default true
    model?: string;                  // override diagnosis model; defaults to OpenClaw config
    maxTokensPerDiagnosis?: number;  // token budget per LLM call
    maxTokensPerCheckup?: number;    // total token budget per checkup
  };

  // ─── Data Retention ───
  retention: {
    eventMaxAgeDays: number;         // default 90
    diagnosisMaxAgeDays: number;     // default 365
    healthScoreMaxAgeDays: number;   // default 365
  };
}
```

### 4.2 i18n Strategy

- Disease definitions embed multi-language text via `I18nString`
- Runtime selects language based on `config.locale`
- Fallback chain: `config.locale` → `"en"` (if a key is missing for the requested locale, English is used)
- CLI/Dashboard UI framework text maintained in a separate locale file
- No external translation file splitting (disease count is bounded; inline is simpler and type-safe)

```typescript
// Example: SK-001 full definition
const SK001: DiseaseDefinition = {
  id: "SK-001",
  department: "skill",
  category: "efficiency",
  name: {
    en: "Token Obesity",
    zh: "Token 肥胖症",
  },
  description: {
    en: "Single tool invocation consumes far more tokens than peers",
    zh: "单次工具调用消耗的 Token 远超同类",
  },
  rootCauses: [
    {
      en: "Skill instructions too verbose, no modular split",
      zh: "Skill 指令过长，未做模块拆分",
    },
    {
      en: "Excessive context injected per call",
      zh: "每次调用注入了过多上下文",
    },
  ],
  detection: {
    type: "rule",
    metric: "skill.singleCallTokens",
    direction: "higher_is_worse",
    defaultThresholds: { warning: 50_000, critical: 200_000 },
  },
  prescriptionTemplate: {
    level: "guided",
    actionTypes: ["file_edit"],
    promptTemplate: "Suggest how to reduce token usage for this skill...",
    estimatedImprovementTemplate: { en: "-{value}% token consumption", zh: "Token 消耗降低 {value}%" },
    risk: "low",
  },
  relatedDiseases: ["CST-001", "SK-009"],
  defaultSeverity: "warning",
  tags: ["performance", "cost", "skill"],
};
```

---

## 5. Data Collection Layer

### 5.1 Unified Event Model

Both collection paths produce the same event model.

```typescript
interface ClawDoctorEvent {
  id: string;                         // ULID (ordered, contains timestamp)
  source: "snapshot" | "stream";
  timestamp: number;                  // unix ms
  agentId: string;
  sessionKey?: string;
  sessionId?: string;
  type: EventType;
  data: EventDataMap[EventType];
}

type EventType =
  | "llm_call"
  | "tool_call"
  | "session_lifecycle"
  | "agent_lifecycle"
  | "subagent_event"
  | "message_event"
  | "compaction_event"
  | "config_snapshot"
  | "memory_snapshot"
  | "plugin_snapshot";
```

**Event type → data type mapping (discriminated union):**

```typescript
type EventDataMap = {
  llm_call: LLMCallData;
  tool_call: ToolCallData;
  session_lifecycle: SessionLifecycleData;
  agent_lifecycle: AgentLifecycleData;
  subagent_event: SubagentEventData;
  message_event: MessageEventData;
  compaction_event: CompactionEventData;
  config_snapshot: ConfigSnapshotData;
  memory_snapshot: MemorySnapshotData;
  plugin_snapshot: PluginSnapshotData;
};

// Type-safe event: event.type determines event.data shape
type TypedClawDoctorEvent<T extends EventType = EventType> = Omit<ClawDoctorEvent, "type" | "data"> & {
  type: T;
  data: EventDataMap[T];
};
```

**Event data types:**

```typescript
interface LLMCallData {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;           // stream only
  cacheWriteTokens?: number;          // stream only
  totalTokens?: number;
  durationMs?: number;
  success: boolean;
  error?: string;
}

interface ToolCallData {
  toolName: string;
  // PRIVACY: params and result are stored as REDACTED summaries, not raw values.
  // - params: only key names + value types (e.g. { "query": "string", "limit": "number" })
  // - result: only success/failure + size (e.g. { "type": "string", "length": 1234 })
  // - Raw params/result are available via RawSampleProvider at analysis time, not persisted.
  paramsSummary: Record<string, string>;  // key → value type descriptor
  resultSummary?: { type: string; length?: number };
  error?: string;                     // first 200 chars, redacted via redactPatterns
  durationMs?: number;                // stream only (precise)
  success: boolean;
}

interface SessionLifecycleData {
  event: "start" | "end";
  messageCount?: number;
  durationMs?: number;
}

interface AgentLifecycleData {
  event: "start" | "end";
  success?: boolean;
  error?: string;
  durationMs?: number;
  trigger?: string;                   // "user" | "heartbeat" | "cron" | "memory"
}

interface MemorySnapshotData {
  files: Array<{
    path: string;
    sizeBytes: number;
    modifiedAt: number;
    type?: string;                    // frontmatter type field
    name?: string;
  }>;
  totalCount: number;
  totalSizeBytes: number;
}

interface SubagentEventData {
  event: "spawned" | "ended";
  childSessionKey: string;
  agentId: string;
  outcome?: "ok" | "error" | "timeout" | "killed" | "reset";
  error?: string;
  durationMs?: number;
}

interface MessageEventData {
  event: "received" | "sent";
  channelId: string;
  success: boolean;
  error?: string;
}

interface CompactionEventData {
  messageCountBefore: number;
  messageCountAfter: number;
  tokenCountBefore?: number;
  tokenCountAfter?: number;
}

interface ConfigSnapshotData {
  configHash: string;                 // hash of openclaw.json for change detection
  agentId: string;
  model?: string;
  modelProvider?: string;
  sandboxEnabled?: boolean;
  pluginCount: number;
  channelCount: number;
}

interface PluginSnapshotData {
  plugins: Array<{
    id: string;
    name: string;
    version?: string;
    source: string;                   // "bundled" | "global" | "workspace" | "config"
    status: "loaded" | "error" | "disabled";
    error?: string;
    registeredTools: string[];
    registeredHooks: string[];
    permissions?: string[];
  }>;
}
```

### 5.2 Snapshot Collector

Zero-config, reads files on disk.

```
Data Source                              Event Type          Reliability
────────────────────────────────────    ────────────────    ───────────
~/.openclaw/agents/<id>/sessions/       llm_call            medium
  *.jsonl                               tool_call           medium
                                        session_lifecycle   high
                                        agent_lifecycle     high

~/.openclaw/openclaw.json               config_snapshot     high

workspace memory files                  memory_snapshot     high
  (MEMORY.md + *.md with frontmatter)

/tmp/openclaw/openclaw-*.log            supplementary       medium
                                        tool_call data
                                        message_event

plugin manifests (node_modules          plugin_snapshot     high
  or openclaw CLI query)
```

**Session JSONL format (from OpenClaw source code analysis):**

The session files at `~/.openclaw/agents/<id>/sessions/*.jsonl` use the following structure:

```
Line 1: { "type": "session", "id": "...", ... }          ← session header
Line 2+: AgentMessage objects (from @mariozechner/pi-agent-core)
```

Each `AgentMessage` has a `role` field:
- `"user"` — user input message
- `"assistant"` — LLM response, may contain tool call blocks
- `"toolResult"` — tool execution result (may carry a `timestamp` field)
- `"system"` — system prompt

Tool calls are embedded as content blocks inside `role: "assistant"` messages.
The block type varies by provider: `"toolCall"`, `"toolUse"`, or `"functionCall"`.

**Parsing strategy:**
1. Parse the session header to get session metadata
2. Walk assistant messages to extract tool call blocks (handle all provider formats)
3. Match tool calls with subsequent `toolResult` messages by call ID
4. Extract token usage from messages that carry `usage` fields
5. Handle compaction artifacts: compacted sessions may have summarized content blocks that replace original messages

**Session JSONL parsing limitations:**
- `durationMs` is approximate (some `toolResult` messages carry timestamps, but not all)
- No cache hit/miss detail (only stream mode has this via `llm_output` hook)
- Tool call params may be truncated after compaction
- Provider-specific tool call block formats require multi-format parsing
- **Phase 1 Week 1 must include a spike** to read real session files and validate the parser against actual data before committing to Snapshot Collector capabilities

### 5.3 Stream Collector

Runs as OpenClaw Plugin, real-time event collection via hooks.

```typescript
const clawdoctorPlugin: OpenClawPluginDefinition = {
  id: "clawdoctor",
  name: "ClawDoctor",
  description: "Agent health diagnostics",

  register(api) {
    const store = initStore(api);

    // LLM calls
    api.on("llm_output", (event, ctx) => {
      store.insertEvent({
        type: "llm_call",
        source: "stream",
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
        data: {
          provider: event.provider,
          model: event.model,
          inputTokens: event.usage?.input,
          outputTokens: event.usage?.output,
          cacheReadTokens: event.usage?.cacheRead,
          cacheWriteTokens: event.usage?.cacheWrite,
          success: true,
        },
      });
    });

    // Tool calls
    api.on("after_tool_call", (event, ctx) => {
      store.insertEvent({
        type: "tool_call",
        source: "stream",
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
        data: {
          toolName: event.toolName,
          paramsSummary: summarizeParams(event.params),   // keys + types only
          resultSummary: summarizeResult(event.result),   // type + length only
          error: redactAndTruncate(event.error, 200),
          durationMs: event.durationMs,
          success: !event.error,
        },
      });
    });

    // Session lifecycle
    api.on("session_end", (event, ctx) => { /* ... */ });

    // Agent lifecycle
    api.on("agent_end", (event, ctx) => { /* ... */ });

    // Subagent events
    api.on("subagent_ended", (event, ctx) => { /* ... */ });

    // Compaction events
    api.on("after_compaction", (event, ctx) => { /* ... */ });

    // Periodic snapshots (config / memory / plugins)
    let snapshotTimer: ReturnType<typeof setInterval>;
    api.registerService({
      id: "clawdoctor-snapshotter",
      async start(ctx) {
        snapshotTimer = setInterval(() => {
          snapshotConfig(ctx);
          snapshotMemory(ctx);
          snapshotPlugins(ctx);
        }, 30 * 60 * 1000); // every 30 minutes
      },
      async stop() { clearInterval(snapshotTimer); },
    });

    // Register CLI commands
    api.registerCli((ctx) => {
      ctx.program
        .command("clawdoctor")
        .description("ClawDoctor health diagnostics");
    });

    // Register Dashboard HTTP route
    api.registerHttpRoute({
      path: "/clawdoctor",
      handler: dashboardHandler,
      auth: "gateway",
      match: "prefix",
    });
  },
};
```

### 5.4 SQLite Lifecycle

```
Scenario 1: CLI-only (no plugin installed)
  npx clawdoctor checkup
    → create temp SQLite (in-memory or /tmp)
    → Snapshot Collector writes events
    → Analysis Engine runs
    → output report
    → SQLite discarded (or optionally saved to ~/.clawdoctor/)

Scenario 2: Plugin mode running
  OpenClaw Gateway starts → ClawDoctor Plugin registers hooks
    → Stream Collector continuously writes to ~/.clawdoctor/clawdoctor.db
    → periodic snapshots also write to same db

Scenario 3: Plugin installed, CLI queries
  npx clawdoctor checkup (or openclaw clawdoctor checkup)
    → detects existing ~/.clawdoctor/clawdoctor.db with stream data
    → queries existing data (no re-snapshot for stream-covered events)
    → supplements with snapshot-only data (current memory/config state)
    → merged analysis, richer report

Principle: one SQLite, two writers, multiple readers.
```

**Concurrency contract:**

```
Writer safety (WAL mode + busy_timeout):
  - SQLite is opened with: PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  - WAL mode allows concurrent reads while one writer holds the lock.
  - busy_timeout prevents immediate SQLITE_BUSY errors on write contention.

Scenario 3 specifics (plugin running + CLI queries):
  - CLI opens the existing DB in READ-ONLY mode for querying stream data.
  - CLI creates a separate temp DB for snapshot-only supplement data.
  - Analysis Engine merges both sources in memory — no dual-writer contention.
  - If plugin DB is unavailable (locked/corrupt), CLI falls back to full snapshot mode.

Stream Collector write strategy:
  - Buffer events in memory (array).
  - Flush to SQLite every 5 seconds or when buffer reaches 100 events.
  - Single write transaction per flush (bulk INSERT).
  - This limits write lock acquisition to brief, infrequent bursts.
```

### 5.5 Session Identity Canonicalization

The snapshot and stream collectors produce different raw session identifiers:
- **Snapshot**: reads `{ "type": "session", "id": "..." }` from JSONL header — this is a session UUID
- **Stream**: receives `ctx.sessionKey` from plugin hooks — this is a routing key (e.g. `"telegram:12345"`)

These are different concepts. OpenClaw internally maps `sessionKey → sessionId` but both are
useful: `sessionKey` is stable across resets (identifies the conversation partner), while
`sessionId` is ephemeral (regenerated on `/new` and `/reset`).

**Canonical identity for ClawDoctor:**

```
ClawDoctorEvent.sessionKey  = OpenClaw sessionKey (e.g. "telegram:12345")
                           This is the primary grouping key for dedup and analysis.
                           Snapshot collector derives it from the JSONL file path
                           (session files are stored at sessions/<sessionKey>.jsonl).

ClawDoctorEvent.sessionId   = OpenClaw sessionId (UUID, optional)
                           Stream gets it from ctx.sessionId.
                           Snapshot gets it from the JSONL header's id field.
                           Used for per-conversation-instance analysis only.
```

Both collectors MUST normalize to the same `sessionKey` format. The snapshot collector
derives `sessionKey` from the filename (not the header's `id`), ensuring it matches
the stream collector's `ctx.sessionKey`.

### 5.6 Event Deduplication

When both snapshot and stream data coexist, use a **source-priority merge** strategy
rather than per-event dedup (which is fragile with timestamp windows):

```
For a given session:
  1. If stream events exist for this session → use stream data exclusively
     (stream data is strictly richer: has durationMs, cache stats, precise timing)
  2. If no stream events exist → use snapshot data
  3. Never mix stream and snapshot events for the same session

Implementation: query events grouped by (session_key, source).
If both sources have data for a session, filter to source="stream" only.
```

This avoids false positive/negative dedup issues entirely. The trade-off is that
snapshot data is discarded for sessions already covered by stream — this is acceptable
because stream data is a strict superset in quality.

### 5.6 Data Capability Comparison

| Data Dimension | Snapshot | Stream |
|---------------|----------|--------|
| Tool call success/failure | Inferred from session JSONL | Precise (hook provides directly) |
| Tool call duration | Unavailable | Precise (durationMs) |
| Token usage totals | Session metadata | Precise per-call |
| Cache hit/miss | Unavailable | Precise (cacheRead/cacheWrite) |
| Model / Provider | Session metadata | Precise per-call |
| Memory file health | Full (filesystem scan) | Full + change tracking |
| Config checks | Full | Full + change tracking |
| Plugin manifests | Full | Full + load error real-time capture |
| Behavioral pattern analysis | Limited (conversation records only) | Rich (complete event stream) |
| Trend analysis | Single snapshot, no trends | Continuous data, trend support |

---

## 6. Analysis Engine

### 6.1 Pipeline

```
                  ┌──────────────────────┐
                  │  RawSampleProvider   │  ← live filesystem reads (not persisted)
                  │  session transcripts │
                  │  memory file content │
                  │  skill definitions   │
                  └──────────┬───────────┘
                             │ (on-demand, per-analysis)
events (SQLite)              │
  │                          │
  ▼                          ▼
Step 1: Metric Aggregation   │
  from events table (SQL)    │
  │                          │
  ▼                          │
Step 2: Rule Engine          │
  threshold checks           │
  │                          │
  ▼                          │
Step 3: LLM Analyzer  ◄─────┘  (raw samples fed here)
  confirm suspects + deep analysis
  │
  ▼
Step 4: Cross-Department Linker
  │
  ▼
Step 5: Prescription Generator
  │
  ▼
Step 6: Health Scorer
  │
  ▼
Output: diagnoses, prescriptions, health_scores → SQLite + report
```

### 6.1.1 RawSampleProvider

The LLM Analyzer, Prescription Generator, and Dashboard detail pages all need
access to raw content (session transcripts, memory files, skill code) that is
intentionally **not persisted** in the events table (see §8.3 Data Privacy).

This is resolved by a `RawSampleProvider` — a read-only, on-demand filesystem
accessor that fetches live data at analysis time. It is **not** a data store;
it reads the current state of the filesystem each time it is called.

```typescript
interface RawSampleProvider {
  // Session transcript excerpts (for LLM behavioral analysis)
  // Reads live from ~/.openclaw/agents/<id>/sessions/*.jsonl
  getRecentSessionSamples(
    agentId: string,
    limit: number,
  ): Promise<SessionSample[]>;

  // Memory file contents (for LLM memory quality analysis)
  // Reads live from workspace memory directory
  getMemoryFileContents(
    limit: number,
    maxTokensPerFile: number,
  ): Promise<MemoryFileSample[]>;

  // Skill/Plugin definitions (for SEC-005 code analysis)
  // Reads live from plugin manifests / node_modules
  getSkillDefinitions(
    pluginIds: string[],
  ): Promise<SkillDefinitionSample[]>;
}

interface SessionSample {
  sessionKey: string;
  messageCount: number;
  // Only structural data: tool call sequences, roles, errors
  // Message bodies are REDACTED before passing to LLM
  toolCallSequence: Array<{
    toolName: string;
    success: boolean;
    errorSummary?: string;  // first 200 chars, redacted
  }>;
  tokenUsage?: { input: number; output: number };
}

interface MemoryFileSample {
  path: string;
  content: string;          // truncated to maxTokensPerFile
  frontmatter?: Record<string, unknown>;
  modifiedAt: number;
}

interface SkillDefinitionSample {
  pluginId: string;
  source: string;
  // Code content for security analysis (SEC-005)
  codeSnippets: string[];   // truncated, relevant files only
}
```

**Data flow for each consumer:**

```
Consumer                    Data Source              Persistence
─────────────────────────  ─────────────────────    ────────────
checkup (LLM analysis)     RawSampleProvider        none (live read)
follow-up re-check         RawSampleProvider        none (live read)
Dashboard detail pages      RawSampleProvider        none (live read)
Dashboard overview/trends   events table (SQLite)    persisted
Rule Engine                 MetricSet (from events)  persisted
```

All three consumers that need raw content call `RawSampleProvider` at request
time. Raw content never enters SQLite. This closes the data provenance loop.

### 6.2 Metric Aggregation

```typescript
interface MetricSet {
  timeRange: { from: number; to: number };
  agentId: string;

  skill: {
    toolCallCount: number;
    toolSuccessRate: number;
    toolErrorRate: number;
    avgToolDurationMs: number | null;      // stream only
    topErrorTools: Array<{
      tool: string;
      errorCount: number;
      errorMessages: string[];
    }>;
    repeatCallPatterns: Array<{
      tool: string;
      params: string;
      count: number;
    }>;
    unusedPlugins: string[];
    tokenPerToolCall: Record<string, number>;
    contextTokenRatio: Record<string, number>;  // per-skill: skill context tokens / total context window
  };

  memory: {
    fileCount: number;
    totalSizeBytes: number;
    avgAgeDays: number;
    staleFiles: Array<{ path: string; ageDays: number }>;
  };

  behavior: {
    sessionCount: number;
    avgMessagesPerSession: number;
    agentSuccessRate: number;
    avgStepsPerSession: number;
    subagentSpawnCount: number;
    subagentFailureRate: number;
    verboseRatio: number | null;      // (total assistant tokens) / (tool call count)
                                      // high ratio = agent talking more than acting
  };

  cost: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;          // stream only
    totalCacheWriteTokens: number;         // stream only
    cacheHitRate: number | null;           // stream only
    tokensByModel: Record<string, number>;
    tokensByTool: Record<string, number>;
    tokensBySession: Array<{ sessionKey: string; tokens: number }>;
    dailyTrend: Array<{ date: string; tokens: number }>;
  };

  security: {
    sandboxEnabled: boolean;
    pluginSources: Record<string, string>;
    channelAllowLists: Record<string, boolean>;
    credentialPatternHits: Array<{
      file: string;
      line: number;
      pattern: string;
    }>;
  };

  vitals: {
    gatewayReachable: boolean;
    configValid: boolean;
    configWarnings: string[];
    pluginLoadErrors: Array<{ pluginId: string; error: string }>;
    openclawVersion: string;
    diskUsageBytes: number;
  };
}
```

### 6.3 Rule Engine

```typescript
interface RuleEngine {
  evaluate(metrics: MetricSet, config: ClawDoctorConfig): RuleResult[];
}

interface RuleResult {
  diseaseId: string;
  status: "confirmed" | "suspect";
  severity: Severity;
  evidence: Evidence[];
  confidence: number;                // rules typically produce 0.9-1.0
}
```

### 6.4 LLM Analyzer

**Three responsibilities:** confirm suspects, detect LLM-only diseases, root cause attribution.

**Prompt structure:**

```
1. System Prompt: ClawDoctor role definition + output format constraints
2. Disease Knowledge Base: inject relevant DiseaseDefinitions
3. Metric Data: structured MetricSet (JSON)
4. Raw Samples: selected N most relevant data points
5. Task Instruction: explicitly state which diseases to confirm/rule out
```

**System prompt:**

```
You are ClawDoctor, an AI agent health diagnostics engine.
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
- Consider cross-symptom relationships
```

**Call optimization — batched + layered:**

```
Round 1 (quick scan):
  Input: MetricSet + suspects list
  Task: confirm/rule_out all suspects
  Token budget: ~2K input, ~1K output
  Expected: 2-3 seconds

Round 2 (deep analysis, confirmed only):
  Input: confirmed diseases + relevant raw data samples
  Task: root cause analysis + prescription suggestions
  Token budget: ~5K input, ~2K output
  Expected: 3-5 seconds

Round 3 (cross-department, optional):
  Input: all confirmed diagnoses
  Task: discover causal chains
  Token budget: ~3K input, ~2K output
  Expected: 2-3 seconds
```

**Token budget enforcement:**

```
Before sending data to LLM, apply truncation:

1. MetricSet: serialize to JSON, if > 3K tokens:
   - Drop per-session breakdowns (tokensBySession), keep only top 10
   - Drop individual errorMessages, keep only tool name + error count
   - Drop repeatCallPatterns details, keep only tool + count

2. Raw data samples: cap at configurable limits:
   - recentToolCalls: max 20 (most recent)
   - recentSessions: max 5 (summarized, not full transcripts)
   - memoryFileContents: max 10 files, max 500 tokens each
   - skillDefinitions: max 5, max 1K tokens each

3. Per-round enforcement:
   - Count input tokens before each LLM call
   - If exceeding maxTokensPerDiagnosis: progressively drop lower-priority data
   - If exceeding maxTokensPerCheckup: skip remaining LLM rounds, report partial

4. Priority order for data dropping:
   Raw samples (lowest) → MetricSet details → Suspect list (never drop)
```

**Failure degradation:**

When LLM calls fail (network error, malformed output, token budget exceeded):
- Fall back to rule-only results
- Mark report: `"LLM analysis unavailable — showing rule-based results only"`
- Do not block the entire diagnostic pipeline
- Retry with exponential backoff for transient errors only

### 6.5 Cross-Department Linker

```typescript
interface CausalChain {
  id: string;
  name: I18nString;
  rootCause: DiagnosisRef;
  chain: DiagnosisRef[];              // [MEM-004] → [SK-002] → [CST-001]
  impact: I18nString;
  unifiedPrescription: Prescription;  // targets root cause
}
```

### 6.6 Health Scoring

**References:**
- Apdex Score (Application Performance Index) — for per-event metrics
- CVSS v3.1 — for Security department severity
- AHP (Analytic Hierarchy Process, Saaty 1980) — for department weight determination
- SonarQube Quality Model — for A-F grade mapping

#### 6.6.1 Data Coverage Model

Snapshot and stream modes have fundamentally different data density. The scoring
system must make this visible, not hide it behind identical-looking scores.

**Core principle: a score only reflects what was measurable. Missing data is "unknown", not "healthy".**

```typescript
type DataMode = "snapshot" | "stream" | "hybrid"; // hybrid = stream DB exists + fresh snapshot supplement

interface HealthScore {
  overall: number;              // 0-100, weighted from evaluable departments only
  overallGrade: Grade;
  dataMode: DataMode;
  coverage: DataCoverage;       // how much of the possible analysis was performed
  departments: Record<Department, DepartmentScore>;
}

interface DataCoverage {
  evaluableMetrics: number;     // metrics with data
  totalMetrics: number;         // metrics attempted
  ratio: number;                // evaluableMetrics / totalMetrics (0-1)
  skippedDiseases: Array<{      // diseases that couldn't be evaluated
    diseaseId: string;
    reason: "no_data" | "stream_only" | "llm_disabled";
  }>;
}

interface DepartmentScore {
  score: number | null;         // null = insufficient data to score this department
  grade: Grade | "N/A";        // "N/A" when score is null
  weight: number;
  coverage: number;             // 0-1: what fraction of this dept's checks had data
  evaluatedDiseases: number;
  skippedDiseases: number;      // due to missing data
  activeDiseases: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}
```

**Per-mode coverage expectations:**

```
Department       Snapshot coverage    Stream coverage    Gap
───────────────  ─────────────────    ────────────────   ────────────────────
System Vitals    100%                 100%               (none)
Skill & Tool     ~60%                 100%               durationMs, precise error context
Memory Cognition 100%                 100%               (none — filesystem-based)
Agent Behavior   ~40%                 100%               precise step timing, subagent details
Cost Metabolism  ~50%                 100%               cache hit/miss, per-call breakdown
Security         100%                 100%               (none — config/filesystem-based)
```

**Overall score computation with coverage:**

```typescript
function computeOverallScore(
  departments: Record<Department, DepartmentScore>,
  weights: Record<Department, number>,
): { overall: number; grade: Grade } {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [dept, score] of Object.entries(departments)) {
    if (score.score === null) continue;  // skip departments with insufficient data
    const w = weights[dept as Department];
    weightedSum += score.score * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return { overall: 0, grade: "N/A" as Grade };

  // Re-normalize weights to sum to 1 over evaluable departments
  const overall = weightedSum / totalWeight;
  return { overall, grade: scoreToGrade(overall) };
}
```

#### 6.6.2 Scoring Functions

```typescript
// Per-event metrics (success rate, duration) → Apdex
function apdexScore(
  values: number[],
  threshold: { satisfied: number; frustrated: number },
  higherIsBetter: boolean,
): number | null {
  if (values.length === 0) return null;  // NO DATA = UNKNOWN, not healthy
  let satisfied = 0, tolerating = 0;
  for (const v of values) {
    if (higherIsBetter) {
      if (v >= threshold.satisfied) satisfied++;
      else if (v >= threshold.frustrated) tolerating++;
    } else {
      if (v <= threshold.satisfied) satisfied++;
      else if (v <= threshold.frustrated) tolerating++;
    }
  }
  return ((satisfied + tolerating * 0.5) / values.length) * 100;
}

// Aggregate metrics → linear threshold mapping
// Uses same { warning, critical } shape as ClawDoctorConfig.thresholds.
// Direction is implicit in the threshold values:
//   success rate: warning=0.75 > critical=0.50 → higher is better
//   daily tokens: warning=100K < critical=500K → lower is better
function linearScore(
  value: number | null,
  threshold: { warning: number; critical: number },
): number | null {
  if (value === null) return null;     // NO DATA = UNKNOWN
  const lo = threshold.critical;
  const hi = threshold.warning;
  if (lo === hi) return 50;
  return Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
}
```

#### 6.6.3 Department Score Aggregation

```typescript
function computeDepartmentScore(
  metricScores: Array<{ metric: string; score: number | null }>,
): DepartmentScore {
  const evaluable = metricScores.filter(m => m.score !== null);
  const skipped = metricScores.length - evaluable.length;

  if (evaluable.length === 0) {
    return { score: null, grade: "N/A", coverage: 0, /* ... */ };
  }

  const avg = evaluable.reduce((s, m) => s + m.score!, 0) / evaluable.length;
  const coverage = evaluable.length / metricScores.length;

  return {
    score: avg,
    grade: scoreToGrade(avg),
    coverage,
    evaluatedDiseases: evaluable.length,
    skippedDiseases: skipped,
    /* ... */
  };
}
```

#### 6.6.4 Weights, Grades, Special Rules

**Department weights (AHP defaults):**

```typescript
const DEFAULT_AHP_WEIGHTS: Record<Department, number> = {
  vitals:   0.08,
  skill:    0.26,
  memory:   0.14,
  behavior: 0.26,
  cost:     0.11,
  security: 0.15,
  // CR (consistency ratio) < 0.1, passes consistency check
};
```

**Grade mapping (SonarQube style):**

```
A:   90-100  Excellent
B:   70-89   Good
C:   50-69   Fair
D:   25-49   Poor
F:   0-24    Critical
N/A: —       Insufficient data
```

**Security department special rule (CVSS-inspired):**

Any critical security disease → department score forced to 0 (grade F).

#### 6.6.5 Threshold ↔ Score Relationship (explicit contract)

Detection thresholds (from `ClawDoctorConfig.thresholds`) serve a dual purpose:
1. **Disease detection**: `warning` and `critical` determine when a disease triggers
2. **Health scoring**: the same values define the score curve via `linearScore`

This is intentional — a single source of truth avoids config fragmentation.
When a user adjusts `cost.dailyTokens.warning` from 100K to 200K, it simultaneously:
- Relaxes the CST-001 disease trigger (needs > 200K to warn)
- Shifts the Cost department score curve (200K now maps to score 100 instead of 0)

The mapping is: `linearScore(actualValue, { warning, critical })`
where `warning` → score 100 (at or better = "healthy")
and `critical` → score 0 (at or worse = "failing").
Values between are linearly interpolated.
`null` input → `null` output → excluded from aggregation.

---

## 7. Prescription System

### 7.1 Prescription Levels

| Level | Description | User Involvement |
|-------|-------------|-----------------|
| `guided` | Medium risk, generate diff for confirmation | Approve before execution |
| `manual` | High risk/complex, provide direction and suggestions | User operates manually |

Note: A future `auto` level (execute without confirmation for ultra-low-risk operations) is deferred to Phase 4. All prescriptions in Phase 1-3 require explicit user confirmation.

**Level determination:**

| Modification Target | Max Allowed Level |
|--------------------|-------------------|
| Delete confirmed-stale memory files | Guided |
| Edit memory file content | Guided |
| Modify Skill configuration/instructions | Guided |
| Modify openclaw.json | Manual |
| Modify CLAUDE.md / AGENTS.md | Manual |
| Uninstall Plugin | Manual |
| Modify sandbox/permission config | Manual |

### 7.2 Prescription Types

```typescript
type PrescriptionLevel = "guided" | "manual";

interface Prescription {
  id: string;
  diagnosisId: string;
  level: PrescriptionLevel;
  actions: PrescriptionAction[];
  estimatedImprovement: I18nString;
  risk: "low" | "medium" | "high";
}

type PrescriptionAction =
  | FileEditAction
  | FileDeleteAction
  | ConfigChangeAction
  | CommandAction
  | ManualAction;

interface FileEditAction {
  type: "file_edit";
  filePath: string;
  diff: string;                     // unified diff format
  description: I18nString;
}

interface FileDeleteAction {
  type: "file_delete";
  filePath: string;
  description: I18nString;
}

interface ConfigChangeAction {
  type: "config_change";
  key: string;
  oldValue: unknown;
  newValue: unknown;
  description: I18nString;
}

interface CommandAction {
  type: "command";
  command: string;
  description: I18nString;
}

interface ManualAction {
  type: "manual";
  instruction: I18nString;
}
```

### 7.3 Execution Engine

```typescript
interface PrescriptionExecutor {
  preview(prescriptionId: string): Promise<PrescriptionPreview>;
  execute(prescriptionId: string): Promise<ExecutionResult>;
  rollback(prescriptionId: string): Promise<RollbackResult>;
  followUp(prescriptionId: string): Promise<FollowUpResult>;
}

interface PrescriptionPreview {
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

interface ExecutionResult {
  success: boolean;
  appliedActions: Array<{
    action: PrescriptionAction;
    status: "applied" | "failed" | "skipped";
    error?: string;
  }>;
  backup: PrescriptionBackup;
  preApplyMetrics: MetricSnapshot;       // captured before apply, persisted for follow-up comparison
  immediateVerification: VerificationResult;
}
```

### 7.4 Backup & Rollback

```typescript
interface PrescriptionBackup {
  id: string;
  prescriptionId: string;
  createdAt: number;
  entries: Array<{
    type: "file_content" | "config_snapshot";
    path: string;
    originalContent: string;
    preApplyHash: string;             // hash of file BEFORE prescription was applied
    postApplyHash: string;            // hash of file AFTER prescription was applied
  }>;
}

// Rollback conflict detection:
// At apply time: store preApplyHash (original) and postApplyHash (after edit).
// At rollback time: compute currentHash of the file on disk.
//   - currentHash === postApplyHash → file untouched since Rx → safe to rollback
//   - currentHash === preApplyHash → file was already reverted → skip (idempotent)
//   - currentHash !== either → file was modified by user/another Rx after apply
//     → warn user, show three-way diff (original / applied / current), ask for confirmation
```

### 7.5 Follow-up System

```typescript
interface FollowUpResult {
  prescriptionId: string;
  diagnosisId: string;
  timeSinceApplied: number;          // ms
  comparison: {
    before: MetricSnapshot;
    after: MetricSnapshot;
    improvement: Record<string, {
      from: number;
      to: number;
      changePercent: number;
    }>;
  };
  verdict: FollowUpVerdict;
}

type FollowUpVerdict =
  | { status: "resolved"; message: I18nString }
  | { status: "improving"; message: I18nString }
  | { status: "unchanged"; message: I18nString }
  | { status: "worsened"; message: I18nString; suggestRollback: boolean };
```

**Follow-up schedule:**

```
T+1h    Immediate effect check (rule-based diseases verifiable immediately)
T+24h   Short-term check (behavioral diseases need data accumulation)
T+7d    Medium-term check (is the trend sustained?)

Stream mode:  auto-execute via Plugin Service timer
Snapshot mode: prompt user "Run clawdoctor checkup again in 24h for follow-up"
```

**Plugin mode auto follow-up:**

```typescript
let followupTimer: ReturnType<typeof setInterval>;
api.registerService({
  id: "clawdoctor-followup",
  async start(ctx) {
    followupTimer = setInterval(async () => {
      const pending = await store.getPendingFollowUps();
      for (const schedule of pending) {
        const due = schedule.checkpoints.find(cp =>
          Date.now() >= schedule.appliedAt + cp.delay && !cp.completed
        );
        if (due) {
          const result = await executor.followUp(schedule.prescriptionId);
          await store.recordFollowUp(schedule.prescriptionId, due, result);
          if (result.verdict.status === "worsened") {
            await notifyUser(ctx, result);
          }
        }
      }
    }, 10 * 60 * 1000); // check every 10 minutes
  },
  async stop() { clearInterval(followupTimer); },
});
```

---

## 8. Data Storage

### 8.1 SQLite Schema

```sql
-- Schema version tracking
PRAGMA user_version = 1;

-- Unified events table
CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,           -- 'snapshot' | 'stream'
  timestamp   INTEGER NOT NULL,
  agent_id    TEXT NOT NULL,
  session_key TEXT,
  session_id  TEXT,
  type        TEXT NOT NULL,
  data        TEXT NOT NULL,           -- JSON
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE INDEX idx_events_type_ts ON events(type, timestamp);
CREATE INDEX idx_events_agent_ts ON events(agent_id, timestamp);
CREATE INDEX idx_events_session ON events(session_key, timestamp);

-- Diagnosis results
CREATE TABLE diagnoses (
  id              TEXT PRIMARY KEY,
  disease_id      TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  severity        TEXT NOT NULL,
  confidence      REAL NOT NULL,
  evidence_json   TEXT NOT NULL,
  context_json    TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  first_detected  INTEGER NOT NULL,
  last_seen       INTEGER NOT NULL,
  resolved_at     INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE INDEX idx_diagnoses_agent ON diagnoses(agent_id, status);
CREATE INDEX idx_diagnoses_disease ON diagnoses(disease_id);

-- Prescriptions
CREATE TABLE prescriptions (
  id              TEXT PRIMARY KEY,
  diagnosis_id    TEXT NOT NULL REFERENCES diagnoses(id),
  type            TEXT NOT NULL,        -- 'guided' | 'manual'
  actions_json    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending | applied | rolled_back | dismissed
  backup_json     TEXT,
  pre_apply_metrics_json TEXT,   -- MetricSnapshot at apply time (for follow-up comparison)
  applied_at      INTEGER,
  rolled_back_at  INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

-- Follow-up schedules
CREATE TABLE followups (
  id              TEXT PRIMARY KEY,
  prescription_id TEXT NOT NULL REFERENCES prescriptions(id),
  checkpoint      TEXT NOT NULL,        -- "1h" | "24h" | "7d"
  scheduled_at    INTEGER NOT NULL,
  completed_at    INTEGER,
  result_json     TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE INDEX idx_followups_pending ON followups(completed_at)
  WHERE completed_at IS NULL;

-- Health score history
CREATE TABLE health_scores (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,
  data_mode   TEXT NOT NULL,           -- 'snapshot' | 'stream' | 'hybrid'
  coverage    REAL NOT NULL,           -- 0-1: fraction of metrics evaluable
  overall     REAL,                    -- NULL if no departments evaluable
  vitals      REAL,                    -- NULL if insufficient data
  skill       REAL,
  memory      REAL,
  behavior    REAL,
  cost        REAL,
  security    REAL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE INDEX idx_scores_agent_ts ON health_scores(agent_id, timestamp);
```

### 8.2 Schema Migration

Simple version-based migration on db open:

```typescript
const CURRENT_SCHEMA_VERSION = 1;

function migrateIfNeeded(db: Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current < CURRENT_SCHEMA_VERSION) {
    for (let v = current + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      MIGRATIONS[v](db);
    }
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  }
}

const MIGRATIONS: Record<number, (db: Database) => void> = {
  1: (db) => { /* initial schema creation */ },
  // future migrations here
};
```

### 8.3 Data Privacy

**What is persisted in SQLite (safe for long-term storage):**
- `LLMCallData`: model, provider, token counts, success/error — no prompt content
- `ToolCallData`: tool name, param key names + types (not values), result type + size (not content), redacted error snippets
- `SessionLifecycleData`, `AgentLifecycleData`: counts and durations only
- Diagnoses, prescriptions, health scores: derived analytics, no raw user data
- `ConfigSnapshotData`: config hash + aggregate counts, not config values

**What is NOT persisted (accessed live via RawSampleProvider when needed):**
- Session message bodies / conversation text
- Tool call parameter values and result content
- Memory file content
- Skill/plugin source code

**Redaction strategy:**
- `ToolCallData.error` is truncated to 200 chars and processed through OpenClaw's `logging.redactPatterns` before storage
- `ToolCallData.paramsSummary` stores only key names and value type descriptors (e.g. `{ "query": "string" }`), never actual values
- `RawSampleProvider` applies the same `redactPatterns` before passing data to LLM Analyzer

**Dashboard API privacy:**
- `GET /api/events` returns persisted events (redacted summaries only)
- Dashboard detail pages that show raw content (e.g. memory file preview) call `RawSampleProvider` live and never cache/persist the result
- All API endpoints respect the same redaction pipeline

### 8.4 Data Retention

Automated cleanup based on `config.retention`:

```typescript
function cleanupExpiredData(db: Database, config: ClawDoctorConfig): void {
  const now = Date.now();
  const eventCutoff = now - config.retention.eventMaxAgeDays * 86400000;
  const diagnosisCutoff = now - config.retention.diagnosisMaxAgeDays * 86400000;
  const scoreCutoff = now - config.retention.healthScoreMaxAgeDays * 86400000;

  db.prepare("DELETE FROM events WHERE timestamp < ?").run(eventCutoff);
  db.prepare("DELETE FROM diagnoses WHERE last_seen < ?").run(diagnosisCutoff);
  db.prepare("DELETE FROM health_scores WHERE timestamp < ?").run(scoreCutoff);
  // cascade: delete followups for deleted prescriptions
  db.prepare(`
    DELETE FROM followups WHERE prescription_id NOT IN (
      SELECT id FROM prescriptions
    )
  `).run();
}
```

---

## 9. User Interface

### 9.1 CLI Commands

```bash
# ─── Core: Checkup ───
clawdoctor checkup                       # full checkup
clawdoctor checkup --dept skill          # single department
clawdoctor checkup --dept skill,memory   # multiple departments
clawdoctor checkup --since 7d            # data time range
clawdoctor checkup --no-llm              # rules only (fast/free)
clawdoctor checkup --json                # JSON output (CI/script integration)
clawdoctor checkup --agent <agentId>     # specific agent (default: default)

# ─── Prescriptions ───
clawdoctor rx list                       # all prescriptions
clawdoctor rx list --status pending      # filter by status
clawdoctor rx preview <id>               # preview diff
clawdoctor rx apply <id>                 # one-click execute
clawdoctor rx apply --all                # execute all guided-level Rx
clawdoctor rx apply --all --dry-run      # preview all changes without applying
clawdoctor rx rollback <id>              # rollback
clawdoctor rx followup [id]              # follow-up check
clawdoctor rx history                    # execution history

# ─── Explore: Per-Department Detail ───
clawdoctor skill list                    # installed skills health overview
clawdoctor skill inspect <name>          # single skill detailed profile
clawdoctor memory scan                   # memory file scan
clawdoctor cost report                   # cost report
clawdoctor cost report --by model        # breakdown by model
clawdoctor cost report --by tool         # breakdown by tool
clawdoctor behavior report               # behavior analysis report
clawdoctor security audit                # security audit

# ─── Monitor (Phase 3, requires plugin) ───
clawdoctor monitor                       # start background health monitoring
clawdoctor monitor --alert               # enable alerts via OpenClaw messaging channels

# ─── Dashboard ───
clawdoctor dashboard                     # start local web dashboard
clawdoctor dashboard --port 9800         # custom port

# ─── Config ───
clawdoctor config init                   # initialize ~/.clawdoctor/config.json
clawdoctor config set <key> <value>      # set threshold/locale/etc
clawdoctor config weights                # interactive weight adjustment (AHP)
clawdoctor config show                   # show current config
```

### 9.2 Terminal Health Report

**Example: stream mode report (full data)**

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   ClawDoctor Health Report                                          │
│   Agent: default | Data: 2026-03-10 ~ 2026-03-17                │
│   Mode: stream | Coverage: 100% (43/43 checks)                  │
│                                                                  │
│   Overall Health: 61/100  Grade C  ██████░░░░  Fair              │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   System Vitals          95  A  ██████████  Excellent  [6/6]     │
│     Gateway: online | Config: valid | Plugins: 8 loaded          │
│     > VIT-003 Stale Gateway Version (2026.3.5 -> 2026.3.13)     │
│                                                                  │
│   Skill & Tool           58  C  ██████░░░░  Fair       [10/10]  │
│     14 tools tracked | 3 need attention                          │
│     > SK-002 web_search: scenario paralysis (success 45%)        │
│     > SK-006 file_edit: repetition compulsion (8x in 1 session)  │
│     > SK-007 browser: zombie skill (0 calls in 14d)              │
│                                                                  │
│   Memory Cognition       52  C  █████░░░░░  Fair       [7/7]    │
│     47 memory files | 12 stale | 2 conflicts detected            │
│     > MEM-004 Conflicting entries about tool preferences         │
│     > MEM-005 12 files not accessed in 30+ days                  │
│                                                                  │
│   Agent Behavior         68  B  ███████░░░  Good       [7/7]    │
│     Task completion: 76% | Avg 4.8 steps/task                    │
│     > BHV-002 Potential death loop in code review workflow        │
│                                                                  │
│   Cost Metabolism        48  D  █████░░░░░  Poor       [6/6]    │
│     7d total: 842K tokens ($18.40) | Daily trend: +23%           │
│     Cache hit rate: 12%                                          │
│     > CST-001 Daily token usage exceeds warning threshold        │
│     > CST-003 Cache hit rate critically low (12%)                │
│                                                                  │
│   Security Immunity      85  B  █████████░  Good       [8/8]    │
│     Sandbox: ON | Credential scan: clean                         │
│     > SEC-004 plugin "custom-tool" requests unused permissions   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Causal Chain Detected                                          │
│     MEM-004 (memory conflict) -> SK-002 (tool failure)           │
│       -> CST-001 (token waste)                                   │
│     Root cause: conflicting memory entry about tool preference   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Prescriptions (4 pending)                                      │
│                                                                  │
│   [guided] RX-001  Fix web_search scenario paralysis             │
│            Est. +25% success rate                                 │
│            > clawdoctor rx preview RX-001                           │
│                                                                  │
│   [guided] RX-002  Clean 12 stale memory files                   │
│            Est. free ~3,200 context tokens                        │
│            > clawdoctor rx preview RX-002                           │
│                                                                  │
│   [guided] RX-003  Resolve memory conflict on tool preference    │
│            Est. fixes causal chain root cause                     │
│            > clawdoctor rx preview RX-003                           │
│                                                                  │
│   [manual] RX-004  Adjust model routing strategy                 │
│            Est. -40% cost on simple tasks                         │
│            > clawdoctor rx preview RX-004                           │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Quick Actions:                                                 │
│     clawdoctor rx apply --all          Apply all guided Rx          │
│     clawdoctor rx followup             Check previous Rx results    │
│     clawdoctor dashboard               Open detailed dashboard      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Example: snapshot mode report (partial data)**

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   ClawDoctor Health Report                                          │
│   Agent: default | Data: 2026-03-10 ~ 2026-03-17                │
│   Mode: snapshot | Coverage: 63% (27/43 checks)                 │
│                                                                  │
│   Overall Health: 72/100  Grade B  ███████░░░  Good              │
│   ! Score based on partial data — install plugin for full report │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   System Vitals          95  A  ██████████  Excellent  [5/5]     │
│     Gateway: online | Config: valid | Plugins: 8 loaded          │
│     > VIT-003 Stale Gateway Version (2026.3.5 -> 2026.3.13)     │
│                                                                  │
│   Skill & Tool           70  B  ███████░░░  Good       [5/10]   │
│     14 tools tracked | 1 need attention                          │
│     > SK-006 file_edit: repetition compulsion (8x in 1 session)  │
│     > SK-007 browser: zombie skill (0 calls in 14d)              │
│     ~ 5 checks skipped (need plugin for tool duration, error     │
│       pattern analysis)                                          │
│                                                                  │
│   Memory Cognition       52  C  █████░░░░░  Fair       [2/7]    │
│     47 memory files | 12 stale                                   │
│     > MEM-005 12 files not accessed in 30+ days                  │
│     ~ 5 checks skipped (need LLM for content quality analysis)   │
│                                                                  │
│   Agent Behavior         --  N/A                       [2/7]    │
│     ~ Insufficient data for scoring (40% coverage)               │
│     > BHV-005 agent_end success rate 68% (from session metadata) │
│     ~ 5 checks skipped (need plugin for behavioral analysis)     │
│                                                                  │
│   Cost Metabolism        65  C  ██████░░░░  Fair        [3/6]    │
│     7d total: 842K tokens (estimated from session metadata)      │
│     ~ Cache analysis unavailable (need plugin)                   │
│     > CST-001 Daily token usage exceeds warning threshold        │
│                                                                  │
│   Security Immunity      85  B  █████████░  Good       [7/8]    │
│     Sandbox: ON | Credential scan: clean                         │
│     > SEC-004 plugin "custom-tool" requests unused permissions   │
│     ~ 1 check skipped (SEC-005 needs LLM for code analysis)     │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ! 16 checks skipped due to limited data                        │
│     Install ClawDoctor plugin for full diagnostics:                 │
│     npm install clawdoctor && openclaw config set plugins.clawdoctor…  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Key report differences by mode:**
- Header shows `Mode:` and `Coverage:` explicitly
- Snapshot mode adds a warning line below the overall score
- Each department shows `[evaluated/total]` check count
- Departments with < 50% coverage show `N/A` instead of a potentially misleading score
- Skipped checks are listed with brief reason
- Snapshot report ends with plugin installation CTA instead of prescriptions

### 9.3 Web Dashboard

Launched via `clawdoctor dashboard` or registered at `/clawdoctor/*` in Plugin mode.

**Tech:** embedded Hono server + single-file SPA (all dependencies bundled, no runtime CDN required).

**Pages:**

| Page | Content |
|------|---------|
| **Overview** | Health score card, score trend line chart, active diseases list, causal chain visualization, quick Rx links |
| **Skills** | Installed Skill/Plugin list, per-skill call count / success rate / duration distribution, error logs, zombie markers |
| **Memory** | Memory file tree (grouped by type), size/age heatmap, conflict markers, content preview |
| **Behavior** | Session timeline, tool call sequence diagram (Gantt-style), death loop visualization, subagent relationship graph |
| **Cost** | Token consumption stacked area chart (by model), pie chart (by tool), cache hit rate trend, daily/weekly/monthly summary |
| **Security** | Plugin source audit table, permission matrix, credential scan results, security score detail |
| **Rx** | Prescription list (pending/applied/rolled_back), diff preview, apply/rollback buttons, follow-up timeline |
| **Timeline** | Global event timeline (all departments merged), filterable by event type |
| **Settings** | Threshold editor, language switch, weight adjustment, LLM toggle, retention policy |

**Dashboard API authentication:**
- Plugin mode: uses `auth: "gateway"` (leverages OpenClaw gateway's existing token auth)
- Standalone mode (`clawdoctor dashboard`): localhost-only binding by default; write endpoints (`PUT /api/config`, `POST /api/prescriptions/:id/apply`, `POST /api/prescriptions/:id/rollback`) require a simple bearer token generated on first launch and printed to the terminal

**Dashboard API:**

```
GET  /api/health                         → HealthScore
GET  /api/diseases                       → DiseaseInstance[] (filterable)
GET  /api/diseases/:id                   → DiseaseInstance + Evidence
GET  /api/prescriptions                  → Prescription[]
POST /api/prescriptions/:id/apply        → ExecutionResult
POST /api/prescriptions/:id/rollback     → RollbackResult
GET  /api/prescriptions/:id/followup     → FollowUpResult
GET  /api/metrics/:dept                  → MetricSet
GET  /api/trends                         → HealthScore[] (time series)
GET  /api/events                         → ClawDoctorEvent[] (paginated)
GET  /api/causal-chains                  → CausalChain[]
GET  /api/config                         → ClawDoctorConfig
PUT  /api/config                         → update config
GET  /api/skills                         → PluginSnapshotData
GET  /api/memory                         → MemorySnapshotData
```

### 9.4 Unified Entry Points

```
Path A: Standalone CLI
  npx clawdoctor checkup
    → Snapshot Collector
    → Analysis Engine (temp SQLite)
    → Terminal report
    → "Run clawdoctor dashboard for details"

Path B: OpenClaw Plugin installed
  openclaw clawdoctor checkup (or clawdoctor checkup detects plugin)
    → Query plugin's persistent SQLite (rich stream data)
    → Supplement with snapshot data (current memory/config state)
    → Terminal report (includes trend data)
    → Dashboard available at http://localhost:18789/clawdoctor/

Path C: Web Dashboard (Plugin mode)
  Browser → http://localhost:18789/clawdoctor/
    → SPA loads
    → Calls /api/* endpoints
    → Real-time refresh (polling or SSE)
```

---

## 10. Technical Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript (ESM) | Consistent with OpenClaw ecosystem |
| Runtime | Node.js 22+ (Bun compatible) | Match OpenClaw baseline |
| Package Manager | pnpm | Match OpenClaw ecosystem |
| Storage | SQLite (better-sqlite3 with prebuilt binaries; fallback: sql.js WASM for npx portability) | Zero-config local-first |
| CLI | Commander.js + Ink | Rich terminal UI |
| Dashboard Server | Hono | Lightweight, embeddable |
| Dashboard Frontend | Single-file SPA (Preact, bundled) | Lightweight, embeddable |
| Charts | Chart.js (bundled into SPA) | Covers line/area/pie/heatmap; ~80KB gzipped |
| Testing | Vitest | Match OpenClaw ecosystem |
| Distribution | `npx clawdoctor` | One-command install |
| LLM Calls | Reuse OpenClaw model config | No extra API key needed |

**SQLite performance note:** Plugin mode hooks can fire on every LLM/tool call. Use WAL mode and batched writes (buffer events in memory, flush every N seconds) to avoid blocking the gateway event loop.

---

## 11. Testing Strategy

| Layer | Method | Coverage |
|-------|--------|----------|
| Rule Engine | Unit tests: given MetricSet → expected RuleResult per disease | Every disease rule has a test case |
| LLM Analyzer | Integration tests with mock LLM responses | Structured output parsing, failure degradation |
| Snapshot Collector | Fixture-based tests with sample session JSONL files | Parse correctness, edge cases (compacted sessions, missing fields) |
| Prescription Executor | Temp directory simulation: apply + verify + rollback | File edit, delete, config change actions |
| Health Scorer | Unit tests: given disease list → expected scores and grades | Scoring algorithm, AHP weights, security special rules |
| Dashboard API | HTTP integration tests against test SQLite | All API endpoints |
| i18n | Snapshot tests: all diseases render in en + zh | No missing translations |
| E2E | Full checkup pipeline with fixture data | Snapshot collect → analyze → report |

---

## 12. Development Roadmap

### Phase 1: Foundation + Full-Spectrum Shallow Diagnosis (Week 1-6)

Goal: `npx clawdoctor checkup` works end-to-end, six departments covered (rule-based), terminal report available.

```
Week 1-2: Infrastructure
  - Project scaffold (TypeScript ESM, pnpm, vitest)
  - SQLite schema + data store layer (better-sqlite3, WAL mode)
  - ClawDoctorEvent unified event model
  - Snapshot Collector: session JSONL parser (spike first to validate format)
  - Snapshot Collector: config/memory/plugin scanner
  - Config system (thresholds + i18n locale)
  - CLI skeleton (Commander.js): clawdoctor checkup, clawdoctor config

Week 3-4: Rule Engine + Six-Department Shallow Diagnosis
  - Metric Aggregation from events
  - Rule Engine framework (threshold evaluation + evidence collection)
  - Disease Registry: register all rule-based diseases
      VIT-001~005, SK-001/004/006/007/009,
      MEM-003/005, BHV-005/007,
      CST-001~006, SEC-001~004/006~008
  - Health Scorer (Apdex + linear + AHP weights + grades)
  - Unit tests: every rule has a test case
  - (27 rule-based diseases total)

Week 5-6: Terminal Report + First Release
  - Terminal health report rendering (Ink)
  - i18n framework: en + zh
  - clawdoctor checkup flags: --dept, --since, --no-llm, --json
  - clawdoctor skill list, memory scan, cost report
  - clawdoctor config init / set / show
  - README, docs, demo
  - npm publish: npx clawdoctor
```

**Phase 1 deliverables:**
- `npx clawdoctor checkup` zero-config checkup (rules only, no LLM cost)
- 27 rule-based disease detections across 6 departments
- Terminal health report (scores, grades, disease list)
- English default, Chinese switchable
- Standalone CLI, no OpenClaw plugin required

### Phase 2: LLM Diagnosis + Prescriptions (Week 7-12)

Goal: LLM deep diagnosis live, prescription system fully functional, Plugin mode live.

```
Week 7-8: LLM Analyzer
  - LLM Analyzer framework (prompt templates, structured output)
  - Hybrid Detection: rule pre-filter → LLM confirm
      SK-002/003/005/008/010, MEM-001/002/004/006/007,
      BHV-001~004/006, SEC-005
  - Cross-Department Linker (causal chain reasoning)
  - LLM call optimization: batching, token budget, failure degradation
  - clawdoctor checkup full version (with LLM analysis)

Week 9-10: Prescription Engine
  - Prescription Generator (LLM-based, level classification)
  - PrescriptionExecutor: preview / apply / rollback
  - Backup system (auto-backup before apply, content hash for conflict detection)
  - Immediate verification (post-apply check)
  - clawdoctor rx list / preview / apply / rollback / followup
  - Integration tests: apply + rollback lifecycle

Week 11-12: OpenClaw Plugin + Stream Collector
  - OpenClaw Plugin adapter (OpenClawPluginDefinition)
  - Stream Collector: register all hooks
      llm_output, after_tool_call, session_end,
      agent_end, subagent_ended, after_compaction
  - Plugin Service: periodic snapshots (config/memory/plugin)
  - Plugin CLI registration: openclaw clawdoctor checkup
  - SQLite lifecycle: persistent + CLI detection and reuse
  - Follow-up scheduler (auto follow-up in plugin mode)
  - npm publish: plugin mode documentation
```

**Phase 2 deliverables:**
- Full LLM deep diagnosis (27 rule + 16 LLM/hybrid = 43 diseases fully covered)
- Cross-department causal chain analysis
- Prescription system (preview → apply → verify → rollback)
- Follow-up scheduling (auto in plugin mode)
- OpenClaw Plugin mode (real-time data collection)

### Phase 3: Web Dashboard + Continuous Monitoring (Week 13-18)

```
Week 13-15: Web Dashboard
  - Hono server (embedded in plugin or CLI standalone)
  - Dashboard API (all /api/* routes)
  - SPA frontend (single-file bundle)
      Overview, Skills, Memory, Behavior, Cost, Security pages
      Rx management page (preview/apply/followup in browser)
      Timeline page, Settings page
  - Charts: line/area/pie/heatmap
  - Causal chain flow visualization
  - Plugin mode: register at /clawdoctor/* HTTP route

Week 16-18: Continuous Monitoring + Polish
  - clawdoctor monitor: background monitoring (Plugin Service)
  - Real-time alerts (via OpenClaw messaging channels)
  - Dashboard SSE/polling real-time refresh
  - Data retention policy (auto-cleanup expired events)
  - Performance optimization (SQLite query optimization for large datasets)
  - CI integration: clawdoctor checkup --json --fail-on critical
  - Full documentation + examples + community release
```

**Phase 3 deliverables:**
- Web Dashboard fully operational
- Continuous monitoring + real-time alerts
- CI integration mode
- Data lifecycle management

### Phase 4: Ecosystem (Month 5+)

```
  - Community custom Disease plugin mechanism
  - Skill Quality Index (public skill health scoring system)
  - ClawHub integration (display health scores in skill marketplace)
  - Multi-agent comparison analysis
  - Team mode (shared dashboard)
  - `auto`-level prescriptions (ultra-low-risk only)
```

---

## 13. Branding

### Name: ClawDoctor

| Aspect | Detail |
|--------|--------|
| Meaning | Claw (lobster) + Doc (Doctor / Document) |
| Pronunciation | /klɔːdɒk/ |
| Tone | Professional, trustworthy — like a real doctor |
| Extensibility | Not limited to skills; naturally covers "full-spectrum diagnostics" |
| Ecosystem | Claw prefix aligns with OpenClaw / ClawHub |
| CLI | `clawdoctor checkup` reads naturally |

### Slogans

- **"Keep your lobster healthy."**
- **"The doctor your agent deserves."**

### Logo Concept

A lobster wearing a stethoscope, or a lobster claw shaped as a medical cross. Simple, recognizable, shareable.
