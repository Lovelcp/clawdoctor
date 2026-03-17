// ═══════════════════════════════════════════════
//  Core Domain: Disease
//  Source: design spec §3.1 and §3.2
// ═══════════════════════════════════════════════

export type Department =
  | "vitals"     // System Vitals
  | "skill"      // Skill & Tool
  | "memory"     // Memory Cognition
  | "behavior"   // Agent Behavior
  | "cost"       // Cost Metabolism
  | "security";  // Security Immunity

export type Severity = "critical" | "warning" | "info";

// i18n support: default English, extensible
export type I18nString = {
  en: string;
  [locale: string]: string;  // zh, ja, ko, ...
};

// ─── Disease Definition (static registry) ───
export interface DiseaseDefinition {
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
export interface DiseaseInstance {
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
export interface Evidence {
  type: "metric" | "log" | "file" | "config" | "llm_analysis";
  description: I18nString;
  value?: number | string;
  threshold?: number;
  dataReference?: string;            // pointer to specific data (file path, event id)
  confidence: number;
}

// ─── Diagnosis Reference (for cross-department linking) ───
export type DiagnosisRef = {
  diseaseId: string;                 // e.g. "MEM-004"
  instanceId: string;                // the specific DiseaseInstance.id
  summary: I18nString;               // brief description for display in causal chains
};

// ─── Prescription Template (carried by each DiseaseDefinition) ───
export interface PrescriptionTemplate {
  level: "guided" | "manual";
  actionTypes: PrescriptionAction["type"][];  // which action types this disease typically needs
  promptTemplate: string;            // LLM prompt template for generating concrete prescriptions
  estimatedImprovementTemplate: I18nString;  // e.g. { en: "+{value}% success rate" }
  risk: "low" | "medium" | "high";
}

// ─── Metric Snapshot (for follow-up before/after comparison) ───
export interface MetricSnapshot {
  timestamp: number;
  metrics: Record<string, number>;   // key → value, e.g. "skill.successRate" → 0.45
  diseaseId: string;                 // which disease this snapshot relates to
}

// ─── Verification Result (post-prescription immediate check) ───
export interface VerificationResult {
  diseaseId: string;
  previousSeverity: Severity;
  currentStatus: "improved" | "unchanged" | "worsened" | "needs_data";
  newMetrics: Record<string, number>;
  note: I18nString;
}

// ─── Rollback Result ───
export interface RollbackResult {
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

// ═══════════════════════════════════════════════
//  Detection Strategy
//  Source: design spec §3.2
// ═══════════════════════════════════════════════

export type DetectionStrategy =
  | RuleDetection
  | LLMDetection
  | HybridDetection;

// Rule detection — configurable thresholds
export interface RuleDetection {
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
export interface LLMDetection {
  type: "llm";
  analysisPromptTemplate: string;
  inputDataKeys: string[];
  outputSchema: Record<string, unknown>;
}

// Hybrid — rule pre-filter + LLM deep analysis
export interface HybridDetection {
  type: "hybrid";
  preFilter: RuleDetection;
  deepAnalysis: LLMDetection;
}

// ═══════════════════════════════════════════════
//  Prescription
//  Source: design spec §7.2
// ═══════════════════════════════════════════════

export type PrescriptionLevel = "guided" | "manual";

export interface Prescription {
  id: string;
  diagnosisId: string;
  level: PrescriptionLevel;
  actions: PrescriptionAction[];
  estimatedImprovement: I18nString;
  risk: "low" | "medium" | "high";
}

export type PrescriptionAction =
  | FileEditAction
  | FileDeleteAction
  | ConfigChangeAction
  | CommandAction
  | ManualAction;

export interface FileEditAction {
  type: "file_edit";
  filePath: string;
  diff: string;                     // unified diff format
  description: I18nString;
}

export interface FileDeleteAction {
  type: "file_delete";
  filePath: string;
  description: I18nString;
}

export interface ConfigChangeAction {
  type: "config_change";
  key: string;
  oldValue: unknown;
  newValue: unknown;
  description: I18nString;
}

export interface CommandAction {
  type: "command";
  command: string;
  description: I18nString;
}

export interface ManualAction {
  type: "manual";
  instruction: I18nString;
}
