// ═══════════════════════════════════════════════
//  Config System
//  Source: design spec §4.1
// ═══════════════════════════════════════════════

import type { Department } from "./domain.js";

export interface ThresholdPair {
  warning: number;
  critical: number;
}

export interface ClawDoctorConfig {
  // ─── Display ───
  locale: string;                    // default "en", supports "zh" etc.

  // ─── Thresholds (all overridable) ───
  thresholds: {
    // Skill & Tool
    "skill.successRate": ThresholdPair;
    "skill.avgDurationMs": ThresholdPair;
    "skill.errorBurstCount": ThresholdPair;
    "skill.singleCallTokens": ThresholdPair;
    "skill.zombieDays": ThresholdPair;
    "skill.repetitionCount": ThresholdPair;
    "skill.contextTokenRatio": ThresholdPair;

    // Memory
    "memory.staleAgeDays": ThresholdPair;
    "memory.totalFiles": ThresholdPair;
    "memory.totalSizeKB": ThresholdPair;
    "memory.conflictCount": ThresholdPair;

    // Behavior
    "behavior.taskCompletionRate": ThresholdPair;
    "behavior.avgStepsPerTask": ThresholdPair;
    "behavior.loopDetectionThreshold": ThresholdPair;
    "behavior.verboseRatio": ThresholdPair;

    // Cost
    "cost.dailyTokens": ThresholdPair;
    "cost.cacheHitRate": ThresholdPair;
    "cost.singleCallTokens": ThresholdPair;
    "cost.luxurySessionTokenCeiling": ThresholdPair;
    "cost.spikeMultiplier": ThresholdPair;
    "cost.failedSessionTokenRatio": ThresholdPair;
    "cost.compactionTokenRatio": ThresholdPair;

    // Security
    "security.exposedCredentials": ThresholdPair;
    "security.unsandboxedPlugins": ThresholdPair;

    // Vitals
    "vitals.diskUsageMB": ThresholdPair;

    // Allow custom thresholds
    [key: string]: ThresholdPair;
  };

  // ─── Health Score Weights (AHP-derived defaults) ───
  weights: Record<Department, number>;

  // ─── LLM Settings ───
  llm: {
    enabled: boolean;                // default true
    provider?: string;               // "anthropic" | "openai-compatible"
    model?: string;                  // override diagnosis model; defaults to OpenClaw config
    apiKey?: string;                 // API key (stored in config, overrides env)
    baseUrl?: string;                // base URL for API calls
    maxTokensPerDiagnosis?: number;  // token budget per LLM call
    maxTokensPerCheckup?: number;    // total token budget per checkup
  };

  // ─── Data Retention ───
  retention: {
    eventMaxAgeDays: number;         // default 90
    diagnosisMaxAgeDays: number;     // default 365
    healthScoreMaxAgeDays: number;   // default 365
  };

  // ─── Continuous Monitoring ───
  monitor: {
    probes: {
      gateway:  { enabled: boolean; intervalMs: number; params: Record<string, unknown> };
      cron:     { enabled: boolean; intervalMs: number; params: Record<string, unknown> };
      auth:     { enabled: boolean; intervalMs: number; params: Record<string, unknown> };
      session:  { enabled: boolean; intervalMs: number; params: Record<string, unknown> };
      budget:   { enabled: boolean; intervalMs: number; dailyLimitUsd: number; timezone?: string };
      cost:     { enabled: boolean; intervalMs: number; spikeMultiplier: number; minSessionsForBaseline?: number };
    };
    triage: {
      autoGreen: boolean;
      defaultOnTimeout: "reject";
    };
  };

  // ─── Page (alerting) ───
  page: {
    telegram: {
      enabled: boolean;
      botToken: string;
      chatId: string;
    };
    webhook: {
      enabled: boolean;
      url: string;
      secret?: string;
    };
    rateLimit: {
      perProbeMs: number;
      globalMaxPerHour: number;
    };
    dedup: {
      info: number;
      warning: number;
      critical: number;
      emergency: number;
    };
  };

  // ─── Consent (Phase 2+) ───
  consent: {
    channels: ConsentChannelType[];
    timeoutMs: number;
    telegram?: {
      allowedUserIds: string[];
    };
  };

  // ─── Community Plugins ───
  plugins?: string[];                // e.g. ["clawdoctor-plugin-security-extra"]
}

export type ConsentChannelType = "telegram" | "cli" | "webhook" | "dashboard";

export const DEFAULT_CONFIG: ClawDoctorConfig = {
  locale: "en",

  thresholds: {
    // Skill & Tool
    "skill.successRate":         { warning: 0.75,    critical: 0.50 },
    "skill.avgDurationMs":       { warning: 5000,    critical: 15000 },
    "skill.errorBurstCount":     { warning: 3,       critical: 10 },
    "skill.singleCallTokens":    { warning: 50_000,  critical: 200_000 },
    "skill.zombieDays":          { warning: 14,      critical: 30 },
    "skill.repetitionCount":     { warning: 3,       critical: 5 },
    "skill.contextTokenRatio":   { warning: 0.30,    critical: 0.50 },

    // Memory
    "memory.staleAgeDays":       { warning: 30,      critical: 90 },
    "memory.totalFiles":         { warning: 50,      critical: 200 },
    "memory.totalSizeKB":        { warning: 512,     critical: 2048 },
    "memory.conflictCount":      { warning: 1,       critical: 5 },

    // Behavior
    "behavior.taskCompletionRate":    { warning: 0.70, critical: 0.50 },
    "behavior.avgStepsPerTask":       { warning: 8,    critical: 15 },
    "behavior.loopDetectionThreshold":{ warning: 3,    critical: 5 },
    "behavior.verboseRatio":          { warning: 3.0,  critical: 5.0 },

    // Cost
    "cost.dailyTokens":               { warning: 100_000, critical: 500_000 },
    "cost.cacheHitRate":              { warning: 0.30,    critical: 0.10 },
    "cost.singleCallTokens":          { warning: 50_000,  critical: 200_000 },
    "cost.luxurySessionTokenCeiling": { warning: 2000,    critical: 1000 },
    "cost.spikeMultiplier":           { warning: 2.0,     critical: 5.0 },
    "cost.failedSessionTokenRatio":   { warning: 0.30,    critical: 0.50 },
    "cost.compactionTokenRatio":      { warning: 0.20,    critical: 0.40 },

    // Security
    "security.exposedCredentials":    { warning: 1, critical: 1 },
    "security.unsandboxedPlugins":    { warning: 1, critical: 3 },

    // Vitals
    "vitals.diskUsageMB":             { warning: 500, critical: 1000 },
  },

  weights: {
    vitals:   0.06,
    skill:    0.22,
    memory:   0.12,
    behavior: 0.22,
    cost:     0.10,
    security: 0.13,
    infra:    0.15,
  },

  llm: {
    enabled: true,
  },

  retention: {
    eventMaxAgeDays:        90,
    diagnosisMaxAgeDays:    365,
    healthScoreMaxAgeDays:  365,
  },

  monitor: {
    probes: {
      gateway:  { enabled: true,  intervalMs: 30_000,  params: {} },
      cron:     { enabled: false, intervalMs: 60_000,  params: {} },
      auth:     { enabled: false, intervalMs: 60_000,  params: {} },
      session:  { enabled: true,  intervalMs: 60_000,  params: {} },
      budget:   { enabled: false, intervalMs: 300_000, dailyLimitUsd: 10 },
      cost:     { enabled: true,  intervalMs: 300_000, spikeMultiplier: 3, minSessionsForBaseline: 20 },
    },
    triage: {
      autoGreen: true,
      defaultOnTimeout: "reject",
    },
  },

  page: {
    telegram: {
      enabled: false,
      botToken: "",
      chatId: "",
    },
    webhook: {
      enabled: false,
      url: "",
    },
    rateLimit: {
      perProbeMs: 300_000,
      globalMaxPerHour: 30,
    },
    dedup: {
      info: 21_600_000,
      warning: 3_600_000,
      critical: 900_000,
      emergency: 0,
    },
  },

  consent: {
    channels: ["cli"],
    timeoutMs: 1_800_000,
  },
};
