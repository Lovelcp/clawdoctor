// ═══════════════════════════════════════════════
//  Rule Engine
//  Design spec §6.3 — Phase 1: rule-based disease evaluation
// ═══════════════════════════════════════════════

import type { Severity, Evidence, RuleDetection } from "../types/domain.js";
import type { ClawDocConfig } from "../types/config.js";
import type { MetricSet } from "./metric-aggregator.js";
import type { getDiseaseRegistry } from "../diseases/registry.js";

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RuleResult {
  diseaseId: string;
  status: "confirmed" | "suspect";
  severity: Severity;
  evidence: Evidence[];
  confidence: number;
}

/**
 * Evaluate all rule-based diseases from the registry against the given
 * MetricSet.  Diseases with detection.type !== "rule" are skipped (Phase 2).
 *
 * Returns only diseases that are actually triggered.
 */
export function evaluateRules(
  metrics: MetricSet,
  config: ClawDocConfig,
  registry: ReturnType<typeof getDiseaseRegistry>,
): RuleResult[] {
  const results: RuleResult[] = [];

  for (const disease of registry.getAll()) {
    // Phase 1: only handle pure rule-based detection
    if (disease.detection.type !== "rule") continue;

    const detection = disease.detection as RuleDetection;
    const result = evaluateDisease(disease.id, detection, metrics, config);
    if (result !== null) {
      results.push(result);
    }
  }

  return results;
}

// ─── Per-disease evaluation dispatcher ───────────────────────────────────────

/**
 * Dispatch to either a special-case evaluator or the generic threshold path.
 */
function evaluateDisease(
  diseaseId: string,
  detection: RuleDetection,
  metrics: MetricSet,
  config: ClawDocConfig,
): RuleResult | null {
  // Special-case diseases that cannot be reduced to a single scalar metric
  switch (diseaseId) {
    case "SK-006": return evaluateSK006(metrics, config);
    case "SK-007": return evaluateSK007(metrics);
    case "SEC-002": return evaluateSEC002(metrics);
    case "SEC-006": return evaluateSEC006(metrics);
    case "SEC-007": return evaluateSEC007(metrics);
    case "CST-002": return evaluateCST002(metrics, config);
    case "CST-005": return evaluateCST005(metrics, config);
    default:
      return evaluateGeneric(diseaseId, detection, metrics, config);
  }
}

// ─── Generic threshold evaluator ─────────────────────────────────────────────

function evaluateGeneric(
  diseaseId: string,
  detection: RuleDetection,
  metrics: MetricSet,
  config: ClawDocConfig,
): RuleResult | null {
  const value = resolveMetricValue(detection.metric, metrics);
  if (value === null) return null;

  const threshold = config.thresholds[detection.metric] ?? detection.defaultThresholds;
  const severity = checkThreshold(value, threshold, detection.direction);
  if (severity === null) return null;

  const confidence = severity === "critical" ? 0.95 : 0.75;

  return {
    diseaseId,
    status: "confirmed",
    severity,
    evidence: [
      makeMetricEvidence(
        detection.metric,
        value,
        threshold[severity === "critical" ? "critical" : "warning"],
        confidence,
      ),
    ],
    confidence,
  };
}

// ─── Metric value resolver ────────────────────────────────────────────────────

/**
 * Map the detection metric key to an actual numeric value from MetricSet.
 * Returns null when data is unavailable (skip evaluation for this metric).
 */
export function resolveMetricValue(
  metric: string,
  metrics: MetricSet,
): number | null {
  switch (metric) {
    // ── Skill ──────────────────────────────────────────────────────────
    case "skill.successRate":
      if (metrics.skill.toolCallCount === 0) return null;
      return metrics.skill.toolSuccessRate;

    case "skill.avgDurationMs":
      return metrics.skill.avgToolDurationMs; // already null if no data

    case "skill.errorBurstCount": {
      // Proxy: max error count across topErrorTools
      const top = metrics.skill.topErrorTools;
      if (top.length === 0) return null;
      return top[0].errorCount;
    }

    case "skill.singleCallTokens": {
      // Max tokens-per-call from tokenPerToolCall map
      const values = Object.values(metrics.skill.tokenPerToolCall);
      if (values.length === 0) return null;
      return Math.max(...values);
    }

    case "skill.zombieDays":
      // SK-007 is handled specially; this generic path is a fallback
      return metrics.skill.unusedPlugins.length > 0 ? 999 : null;

    case "skill.repetitionCount": {
      // Max repeat count from repeatCallPatterns
      if (metrics.skill.repeatCallPatterns.length === 0) return null;
      return Math.max(...metrics.skill.repeatCallPatterns.map((p) => p.count));
    }

    case "skill.contextTokenRatio": {
      const values = Object.values(metrics.skill.contextTokenRatio);
      if (values.length === 0) return null;
      return Math.max(...values);
    }

    // ── Memory ─────────────────────────────────────────────────────────
    case "memory.staleAgeDays":
      return metrics.memory.avgAgeDays;

    case "memory.totalFiles":
      return metrics.memory.fileCount;

    case "memory.totalSizeKB":
      return metrics.memory.totalSizeBytes / 1024;

    case "memory.conflictCount":
      // Not tracked directly in MetricSet — return null (no data)
      return null;

    // ── Behavior ───────────────────────────────────────────────────────
    case "behavior.taskCompletionRate":
      return metrics.behavior.agentSuccessRate;

    case "behavior.avgStepsPerTask":
      return metrics.behavior.avgStepsPerSession;

    case "behavior.loopDetectionThreshold":
      // Proxy: max repeat pattern count (indicates looping)
      if (metrics.skill.repeatCallPatterns.length === 0) return null;
      return Math.max(...metrics.skill.repeatCallPatterns.map((p) => p.count));

    case "behavior.verboseRatio":
      return metrics.behavior.verboseRatio; // null if no tool calls

    case "behavior.abortRate":
      // Inverse of agentSuccessRate → failure rate
      return 1 - metrics.behavior.agentSuccessRate;

    // ── Cost ───────────────────────────────────────────────────────────
    case "cost.dailyTokens": {
      const trend = metrics.cost.dailyTrend;
      if (trend.length === 0) return null;
      return trend.at(-1)!.tokens;
    }

    case "cost.cacheHitRate":
      return metrics.cost.cacheHitRate; // null in snapshot mode

    case "cost.singleCallTokens": {
      // Max tokens per tool call — same as skill.singleCallTokens
      const values = Object.values(metrics.cost.tokensByTool);
      if (values.length === 0) return null;
      return Math.max(...values);
    }

    case "cost.luxurySessionTokenCeiling":
      // Handled by special evaluator; this path returns null
      return null;

    case "cost.spikeMultiplier":
      // Handled by special evaluator; this path returns null
      return null;

    case "cost.failedSessionTokenRatio": {
      // Not directly tracked — return null
      return null;
    }

    case "cost.compactionTokenRatio":
      // Not directly tracked — return null
      return null;

    // ── Security ───────────────────────────────────────────────────────
    case "security.exposedCredentials":
      return metrics.security.credentialPatternHits.length;

    case "security.unsandboxedPlugins": {
      if (metrics.security.sandboxEnabled) return 0;
      // When sandbox is disabled, count the loaded plugins (all are unsandboxed).
      // Fall back to 2 (above warning threshold) when no plugin data is available.
      const pluginCount = Object.keys(metrics.security.pluginSources).length;
      return pluginCount > 0 ? pluginCount : 2;
    }

    case "security.unsignedSkills":
      // Not directly tracked — return null
      return null;

    case "security.permissionOverreachCount":
      // Not directly tracked — return null
      return null;

    case "security.injectionPatternCount":
      // Mapped to credentialPatternHits as proxy; SEC-006 is special-cased
      return null;

    case "security.openDmChannels":
      // Special-cased in SEC-007
      return null;

    case "security.staleCredentials":
      // Not tracked — return null
      return null;

    // ── Vitals ─────────────────────────────────────────────────────────
    case "vitals.diskUsageMB":
      return metrics.vitals.diskUsageBytes / (1024 * 1024);

    case "vitals.gatewayReachable":
      // For boolean: map to 1/0 (unreachable = 1, reachable = 0)
      return null; // handled via special key below

    case "vitals.gatewayUnreachable":
      // higher_is_worse: 2 = unreachable (exceeds critical threshold of 1),
      // 0 = reachable (healthy)
      return metrics.vitals.gatewayReachable ? 0 : 2;

    case "vitals.configParseFailure":
      // 2 = invalid (exceeds critical threshold of 1), 0 = valid (healthy)
      return metrics.vitals.configValid ? 0 : 2;

    case "vitals.gatewayVersionDelta":
      // Not tracked — return null
      return null;

    case "vitals.pluginLoadErrors":
      return metrics.vitals.pluginLoadErrors.length;

    case "security.sandboxEnabled":
      return metrics.security.sandboxEnabled ? 1 : 0;

    default:
      return null;
  }
}

// ─── Threshold check ─────────────────────────────────────────────────────────

/**
 * Check a value against thresholds given the direction.
 *
 * - higher_is_worse: value > critical → "critical"; value > warning → "warning"
 * - lower_is_worse:  value < critical → "critical"; value < warning → "warning"
 *
 * Returns null if no threshold is crossed.
 */
export function checkThreshold(
  value: number,
  threshold: { warning: number; critical: number },
  direction: "higher_is_worse" | "lower_is_worse",
): Severity | null {
  if (direction === "higher_is_worse") {
    if (value > threshold.critical) return "critical";
    if (value > threshold.warning) return "warning";
    return null;
  } else {
    // lower_is_worse
    if (value < threshold.critical) return "critical";
    if (value < threshold.warning) return "warning";
    return null;
  }
}

// ─── Evidence builder helper ──────────────────────────────────────────────────

function makeMetricEvidence(
  metric: string,
  value: number,
  threshold: number,
  confidence: number,
): Evidence {
  return {
    type: "metric",
    description: {
      en: `Metric "${metric}" observed value ${value.toFixed(2)} against threshold ${threshold}`,
    },
    value,
    threshold,
    dataReference: metric,
    confidence,
  };
}

// ─── Special-case evaluators ──────────────────────────────────────────────────

/**
 * SK-006 Repetition Compulsion
 * Triggers when any repeatCallPattern has count > threshold.
 */
function evaluateSK006(
  metrics: MetricSet,
  config: ClawDocConfig,
): RuleResult | null {
  const threshold = config.thresholds["skill.repetitionCount"] ?? { warning: 3, critical: 5 };
  const patterns = metrics.skill.repeatCallPatterns;
  if (patterns.length === 0) return null;

  const worst = patterns.reduce((max, p) => (p.count > max.count ? p : max));
  const severity = checkThreshold(worst.count, threshold, "higher_is_worse");
  if (severity === null) return null;

  const confidence = severity === "critical" ? 0.95 : 0.75;
  return {
    diseaseId: "SK-006",
    status: "confirmed",
    severity,
    evidence: [
      {
        type: "metric",
        description: {
          en: `Tool "${worst.tool}" called ${worst.count} times with identical params`,
        },
        value: worst.count,
        threshold: threshold[severity === "critical" ? "critical" : "warning"],
        dataReference: "skill.repeatCallPatterns",
        confidence,
      },
    ],
    confidence,
  };
}

/**
 * SK-007 Zombie Skill
 * Triggers when unusedPlugins.length > 0.
 */
function evaluateSK007(metrics: MetricSet): RuleResult | null {
  const unused = metrics.skill.unusedPlugins;
  if (unused.length === 0) return null;

  return {
    diseaseId: "SK-007",
    status: "confirmed",
    severity: "warning",
    evidence: [
      {
        type: "metric",
        description: {
          en: `${unused.length} unused plugin(s) detected: ${unused.slice(0, 3).join(", ")}`,
        },
        value: unused.length,
        threshold: 0,
        dataReference: "skill.unusedPlugins",
        confidence: 0.85,
      },
    ],
    confidence: 0.85,
  };
}

/**
 * SEC-002 Credential Leak
 * Triggers when credentialPatternHits.length > 0.
 */
function evaluateSEC002(metrics: MetricSet): RuleResult | null {
  const hits = metrics.security.credentialPatternHits;
  if (hits.length === 0) return null;

  return {
    diseaseId: "SEC-002",
    status: "confirmed",
    severity: "critical",
    evidence: [
      {
        type: "metric",
        description: {
          en: `${hits.length} credential pattern(s) detected in logs`,
        },
        value: hits.length,
        threshold: 0,
        dataReference: "security.credentialPatternHits",
        confidence: 0.95,
      },
    ],
    confidence: 0.95,
  };
}

/**
 * SEC-006 Injection Hit
 * Similar to SEC-002: check credentialPatternHits for injection patterns.
 * (In Phase 1, injection pattern detection uses the same hit array.)
 */
function evaluateSEC006(metrics: MetricSet): RuleResult | null {
  // Phase 1: no injection-specific data tracked; return null until data is available.
  return null;
}

/**
 * SEC-007 Open DM Policy
 * Triggers if any channelAllowLists value is false (no allow-list configured).
 */
function evaluateSEC007(metrics: MetricSet): RuleResult | null {
  const entries = Object.entries(metrics.security.channelAllowLists);
  const openChannels = entries.filter(([, hasAllowList]) => !hasAllowList);
  if (openChannels.length === 0) return null;

  const severity: Severity = openChannels.length >= 3 ? "critical" : "warning";
  const confidence = severity === "critical" ? 0.95 : 0.80;

  return {
    diseaseId: "SEC-007",
    status: "confirmed",
    severity,
    evidence: [
      {
        type: "config",
        description: {
          en: `${openChannels.length} channel(s) have no allowList: ${openChannels.map(([k]) => k).slice(0, 3).join(", ")}`,
        },
        value: openChannels.length,
        threshold: 0,
        dataReference: "security.channelAllowLists",
        confidence,
      },
    ],
    confidence,
  };
}

/**
 * CST-002 Luxury Invocation
 * Check tokensBySession for sessions below the luxurySessionTokenCeiling
 * that appear to use expensive models (tokensByModel heuristic).
 */
function evaluateCST002(
  metrics: MetricSet,
  config: ClawDocConfig,
): RuleResult | null {
  const threshold = config.thresholds["cost.luxurySessionTokenCeiling"] ?? {
    warning: 2000,
    critical: 1000,
  };

  // Find sessions that are "simple" (few tokens) → using expensive model is wasteful
  const simpleSessions = metrics.cost.tokensBySession.filter(
    (s) => s.tokens < threshold.warning,
  );
  if (simpleSessions.length === 0) return null;

  // Check if any expensive model has been used (heuristic: model names containing
  // "opus", "sonnet", "4", "3.7" etc.)
  const expensiveModelNames = Object.keys(metrics.cost.tokensByModel).filter((m) =>
    /opus|sonnet-4|claude-3-7|claude-3\.7|claude-4/i.test(m),
  );
  if (expensiveModelNames.length === 0) return null;

  // The more simple sessions that exist, the worse it is
  const ratio = simpleSessions.length / Math.max(metrics.cost.tokensBySession.length, 1);
  const severity: Severity = simpleSessions.length >= 5 ? "warning" : null!;
  if (!severity) return null;

  const confidence = 0.70;
  return {
    diseaseId: "CST-002",
    status: "suspect",
    severity,
    evidence: [
      {
        type: "metric",
        description: {
          en: `${simpleSessions.length} low-token sessions (< ${threshold.warning} tokens) detected while using expensive models: ${expensiveModelNames.slice(0, 2).join(", ")}`,
        },
        value: simpleSessions.length,
        threshold: threshold.warning,
        dataReference: "cost.tokensBySession",
        confidence,
      },
    ],
    confidence,
  };
}

/**
 * CST-005 Cost Spike
 * Compare latest daily tokens to the previous N-day average × spikeMultiplier.
 */
function evaluateCST005(
  metrics: MetricSet,
  config: ClawDocConfig,
): RuleResult | null {
  const trend = metrics.cost.dailyTrend;
  if (trend.length < 2) return null;

  const latest = trend.at(-1)!.tokens;
  const previous = trend.slice(0, -1);
  const avg = previous.reduce((sum, d) => sum + d.tokens, 0) / previous.length;

  if (avg === 0) return null;

  const multiplier = latest / avg;
  const threshold = config.thresholds["cost.spikeMultiplier"] ?? {
    warning: 2.0,
    critical: 5.0,
  };

  const severity = checkThreshold(multiplier, threshold, "higher_is_worse");
  if (severity === null) return null;

  const confidence = severity === "critical" ? 0.95 : 0.80;

  return {
    diseaseId: "CST-005",
    status: "confirmed",
    severity,
    evidence: [
      {
        type: "metric",
        description: {
          en: `Daily token spike: latest day (${latest.toLocaleString()}) is ${multiplier.toFixed(1)}x the ${previous.length}-day average (${Math.round(avg).toLocaleString()})`,
        },
        value: multiplier,
        threshold: threshold[severity === "critical" ? "critical" : "warning"],
        dataReference: "cost.dailyTrend",
        confidence,
      },
    ],
    confidence,
  };
}
