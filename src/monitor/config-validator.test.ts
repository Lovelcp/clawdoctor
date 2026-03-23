import { describe, it, expect } from "vitest";
import { validateMonitorConfig } from "./config-validator.js";
import { DEFAULT_CONFIG } from "../types/config.js";
import type { ClawDoctorConfig } from "../types/config.js";

function createConfig(
  overrides: Partial<ClawDoctorConfig> = {},
): ClawDoctorConfig {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    ...overrides,
  };
}

describe("validateMonitorConfig", () => {
  it("returns no errors for the default config", () => {
    const result = validateMonitorConfig(DEFAULT_CONFIG);
    expect(result.errors).toHaveLength(0);
  });

  it("errors when telegram is enabled but botToken is missing", () => {
    const config = createConfig({
      page: {
        ...DEFAULT_CONFIG.page,
        telegram: { enabled: true, botToken: "", chatId: "123" },
      },
    });

    const result = validateMonitorConfig(config);

    expect(result.errors.some((e) => e.includes("botToken"))).toBe(true);
  });

  it("errors when telegram is enabled but chatId is missing", () => {
    const config = createConfig({
      page: {
        ...DEFAULT_CONFIG.page,
        telegram: { enabled: true, botToken: "token", chatId: "" },
      },
    });

    const result = validateMonitorConfig(config);

    expect(result.errors.some((e) => e.includes("chatId"))).toBe(true);
  });

  it("no error when telegram is disabled with empty token", () => {
    const config = createConfig({
      page: {
        ...DEFAULT_CONFIG.page,
        telegram: { enabled: false, botToken: "", chatId: "" },
      },
    });

    const result = validateMonitorConfig(config);

    expect(
      result.errors.filter((e) => e.includes("botToken")),
    ).toHaveLength(0);
  });

  it("errors when webhook is enabled but url is missing", () => {
    const config = createConfig({
      page: {
        ...DEFAULT_CONFIG.page,
        webhook: { enabled: true, url: "" },
      },
    });

    const result = validateMonitorConfig(config);

    expect(result.errors.some((e) => e.includes("url") || e.includes("URL"))).toBe(true);
  });

  it("no error when webhook is disabled with empty url", () => {
    const config = createConfig({
      page: {
        ...DEFAULT_CONFIG.page,
        webhook: { enabled: false, url: "" },
      },
    });

    const result = validateMonitorConfig(config);

    expect(
      result.errors.filter((e) => e.includes("URL") || e.includes("url")),
    ).toHaveLength(0);
  });

  it("errors when weights do not sum to 1.0", () => {
    const config = createConfig({
      weights: {
        vitals: 0.5,
        skill: 0.5,
        memory: 0.5,
        behavior: 0.5,
        cost: 0.5,
        security: 0.5,
        infra: 0.5,
      },
    });

    const result = validateMonitorConfig(config);

    expect(result.errors.some((e) => e.includes("sum") || e.includes("1.0"))).toBe(true);
  });

  it("accepts weights that sum to 1.0 within tolerance", () => {
    // Default weights sum to 1.0
    const result = validateMonitorConfig(DEFAULT_CONFIG);

    expect(
      result.errors.filter((e) => e.includes("sum") || e.includes("1.0")),
    ).toHaveLength(0);
  });

  it("errors when budget dailyLimitUsd <= 0", () => {
    const config = createConfig({
      monitor: {
        ...DEFAULT_CONFIG.monitor,
        probes: {
          ...DEFAULT_CONFIG.monitor.probes,
          budget: {
            ...DEFAULT_CONFIG.monitor.probes.budget,
            enabled: true,
            dailyLimitUsd: 0,
          },
        },
      },
    });

    const result = validateMonitorConfig(config);

    expect(result.errors.some((e) => e.includes("Budget") || e.includes("budget"))).toBe(true);
  });

  it("no error when budget probe is disabled with zero limit", () => {
    const config = createConfig({
      monitor: {
        ...DEFAULT_CONFIG.monitor,
        probes: {
          ...DEFAULT_CONFIG.monitor.probes,
          budget: {
            ...DEFAULT_CONFIG.monitor.probes.budget,
            enabled: false,
            dailyLimitUsd: 0,
          },
        },
      },
    });

    const result = validateMonitorConfig(config);

    expect(
      result.errors.filter((e) => e.includes("Budget") || e.includes("budget")),
    ).toHaveLength(0);
  });

  it("returns warnings array (may be empty)", () => {
    const result = validateMonitorConfig(DEFAULT_CONFIG);

    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
