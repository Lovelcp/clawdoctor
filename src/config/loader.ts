// ═══════════════════════════════════════════════
//  Config Loader
//  Deep merges a user config file with DEFAULT_CONFIG.
//  Strategy: user overrides win; missing keys fall back to defaults.
//  Threshold merge is at the key level (both warning + critical together).
// ═══════════════════════════════════════════════

import { readFileSync, existsSync } from "node:fs";
import { type ClawDoctorConfig, DEFAULT_CONFIG } from "../types/config.js";

/**
 * Load and merge a config file with defaults.
 *
 * - File doesn't exist → return defaults
 * - File exists but is malformed JSON → return defaults
 * - File exists and is valid JSON → deep merge (user overrides win)
 *
 * Threshold merge is at the key level: if the user provides a threshold key
 * its { warning, critical } pair replaces the default for that key entirely.
 * All other threshold keys retain their default values.
 */
export function loadConfig(configPath: string): ClawDoctorConfig {
  if (!existsSync(configPath)) {
    return structuredClone(DEFAULT_CONFIG);
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return structuredClone(DEFAULT_CONFIG);
  }

  return deepMerge(DEFAULT_CONFIG, parsed as Record<string, unknown>);
}

/**
 * Deep merge: returns a new ClawDoctorConfig where user values override defaults.
 * Special handling for `thresholds`: merge at the threshold-key level so that
 * providing one threshold key doesn't wipe out all others.
 */
function deepMerge(
  defaults: ClawDoctorConfig,
  user: Record<string, unknown>,
): ClawDoctorConfig {
  const result: ClawDoctorConfig = structuredClone(defaults);

  // locale
  if (typeof user["locale"] === "string") {
    result.locale = user["locale"];
  }

  // thresholds — merge at the threshold-key level
  if (isRecord(user["thresholds"])) {
    for (const [key, value] of Object.entries(user["thresholds"])) {
      if (isThresholdPair(value)) {
        (result.thresholds as Record<string, { warning: number; critical: number }>)[key] = {
          warning: value.warning,
          critical: value.critical,
        };
      }
    }
  }

  // weights — merge at the department key level
  if (isRecord(user["weights"])) {
    for (const [dept, value] of Object.entries(user["weights"])) {
      if (typeof value === "number") {
        (result.weights as Record<string, number>)[dept] = value;
      }
    }
  }

  // llm — shallow merge
  if (isRecord(user["llm"])) {
    const userLlm = user["llm"];
    if (typeof userLlm["enabled"] === "boolean") {
      result.llm.enabled = userLlm["enabled"];
    }
    if (typeof userLlm["provider"] === "string") {
      result.llm.provider = userLlm["provider"];
    }
    if (typeof userLlm["model"] === "string") {
      result.llm.model = userLlm["model"];
    }
    if (typeof userLlm["apiKey"] === "string") {
      result.llm.apiKey = userLlm["apiKey"];
    }
    if (typeof userLlm["baseUrl"] === "string") {
      result.llm.baseUrl = userLlm["baseUrl"];
    }
    if (typeof userLlm["maxTokensPerDiagnosis"] === "number") {
      result.llm.maxTokensPerDiagnosis = userLlm["maxTokensPerDiagnosis"];
    }
    if (typeof userLlm["maxTokensPerCheckup"] === "number") {
      result.llm.maxTokensPerCheckup = userLlm["maxTokensPerCheckup"];
    }
  }

  // plugins — array of plugin package names
  if (Array.isArray(user["plugins"])) {
    result.plugins = (user["plugins"] as unknown[]).filter(
      (p): p is string => typeof p === "string",
    );
  }

  // retention — shallow merge
  if (isRecord(user["retention"])) {
    const userRetention = user["retention"];
    if (typeof userRetention["eventMaxAgeDays"] === "number") {
      result.retention.eventMaxAgeDays = userRetention["eventMaxAgeDays"];
    }
    if (typeof userRetention["diagnosisMaxAgeDays"] === "number") {
      result.retention.diagnosisMaxAgeDays = userRetention["diagnosisMaxAgeDays"];
    }
    if (typeof userRetention["healthScoreMaxAgeDays"] === "number") {
      result.retention.healthScoreMaxAgeDays = userRetention["healthScoreMaxAgeDays"];
    }
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThresholdPair(value: unknown): value is { warning: number; critical: number } {
  return (
    isRecord(value) &&
    typeof value["warning"] === "number" &&
    typeof value["critical"] === "number"
  );
}
