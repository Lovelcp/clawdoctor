// ═══════════════════════════════════════════════
//  Monitor Types
//  Source: continuous monitoring design spec
// ═══════════════════════════════════════════════

import type { Severity, I18nString, DiseaseInstance } from "./domain.js";

// ─── Probe identification and status ───

export type ProbeId = "gateway" | "cron" | "auth" | "session" | "budget" | "cost";

export type ProbeStatus = "ok" | "warning" | "critical" | "error";

export interface ProbeConfig {
  readonly id: ProbeId;
  readonly intervalMs: number;
  readonly enabled: boolean;
  readonly params: Readonly<Record<string, unknown>>;
}

// ─── Probe results and findings ───

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

// ─── Triage ───

export type TriageLevel = "green" | "yellow" | "red";

export interface TriageResult {
  readonly level: TriageLevel;
  readonly diseaseId: string;
  readonly agentId?: string;
  readonly reason: I18nString;
}

// ─── Page (alerting) ───

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

// ─── Chart (audit trail) ───

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

// ─── Monitor state ───

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
