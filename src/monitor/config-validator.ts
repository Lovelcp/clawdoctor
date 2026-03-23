// ===============================================
//  Config Validator
//  Validates monitor-related configuration at
//  startup time, before the monitor engine starts.
// ===============================================

import type { ClawDoctorConfig } from "../types/config.js";

export interface ConfigValidationResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Validate monitor, page, and consent configuration.
 *
 * Returns errors (which should prevent startup) and
 * warnings (informational, non-blocking).
 */
export function validateMonitorConfig(
  config: ClawDoctorConfig,
): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ─── Page: Telegram ───
  if (config.page.telegram.enabled) {
    if (!config.page.telegram.botToken) {
      errors.push("Telegram enabled but botToken missing");
    }
    if (!config.page.telegram.chatId) {
      errors.push("Telegram enabled but chatId missing");
    }
  }

  // ─── Page: Webhook ───
  if (config.page.webhook.enabled) {
    if (!config.page.webhook.url) {
      errors.push("Webhook enabled but URL missing");
    }
  }

  // ─── Weights sum ───
  const weightSum = Object.values(config.weights).reduce(
    (sum, w) => sum + w,
    0,
  );
  if (Math.abs(weightSum - 1.0) > 0.01) {
    errors.push(
      `Weights must sum to 1.0 (current sum: ${weightSum.toFixed(4)})`,
    );
  }

  // ─── Budget probe ───
  if (config.monitor.probes.budget.enabled) {
    if (config.monitor.probes.budget.dailyLimitUsd <= 0) {
      errors.push("Budget limit must be positive");
    }
  }

  // ─── Consent: Telegram ───
  if (config.consent.channels.includes("telegram")) {
    const allowedUsers = config.consent.telegram?.allowedUserIds;
    if (!allowedUsers || allowedUsers.length === 0) {
      errors.push("Telegram consent enabled but no allowedUserIds");
    }
  }

  // ─── Consent: CLI without TTY ───
  if (config.consent.channels.includes("cli")) {
    if (typeof process !== "undefined" && process.stdin && !process.stdin.isTTY) {
      warnings.push("CLI consent channel may not work (no TTY detected)");
    }
  }

  return { errors, warnings };
}
