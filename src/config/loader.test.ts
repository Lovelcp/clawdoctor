import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "./loader.js";
import { DEFAULT_CONFIG } from "../types/config.js";

// Temporary directory for test config files
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `clawdoc-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const nonExistentPath = join(testDir, "does-not-exist.json");
    const config = loadConfig(nonExistentPath);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges user overrides with defaults (locale and a specific threshold)", () => {
    const configPath = join(testDir, "config.json");
    const userConfig = {
      locale: "zh",
      thresholds: {
        "skill.successRate": { warning: 0.80, critical: 0.60 },
      },
    };
    writeFileSync(configPath, JSON.stringify(userConfig));

    const config = loadConfig(configPath);

    // User overrides win
    expect(config.locale).toBe("zh");
    expect(config.thresholds["skill.successRate"]).toEqual({ warning: 0.80, critical: 0.60 });

    // Defaults are preserved for unspecified keys
    expect(config.thresholds["cost.dailyTokens"]).toEqual(DEFAULT_CONFIG.thresholds["cost.dailyTokens"]);
    expect(config.llm).toEqual(DEFAULT_CONFIG.llm);
    expect(config.retention).toEqual(DEFAULT_CONFIG.retention);
    expect(config.weights).toEqual(DEFAULT_CONFIG.weights);
  });

  it("ignores malformed config file and returns defaults", () => {
    const configPath = join(testDir, "config.json");
    writeFileSync(configPath, "{ this is not valid json !!!}");

    const config = loadConfig(configPath);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("retains defaults for other thresholds when only one threshold is overridden", () => {
    const configPath = join(testDir, "config.json");
    const userConfig = {
      thresholds: {
        "vitals.diskUsageMB": { warning: 1000, critical: 2000 },
      },
    };
    writeFileSync(configPath, JSON.stringify(userConfig));

    const config = loadConfig(configPath);

    // The overridden threshold uses user values
    expect(config.thresholds["vitals.diskUsageMB"]).toEqual({ warning: 1000, critical: 2000 });

    // All other thresholds retain their defaults
    expect(config.thresholds["skill.successRate"]).toEqual(DEFAULT_CONFIG.thresholds["skill.successRate"]);
    expect(config.thresholds["skill.avgDurationMs"]).toEqual(DEFAULT_CONFIG.thresholds["skill.avgDurationMs"]);
    expect(config.thresholds["memory.staleAgeDays"]).toEqual(DEFAULT_CONFIG.thresholds["memory.staleAgeDays"]);
    expect(config.thresholds["behavior.taskCompletionRate"]).toEqual(DEFAULT_CONFIG.thresholds["behavior.taskCompletionRate"]);
    expect(config.thresholds["cost.dailyTokens"]).toEqual(DEFAULT_CONFIG.thresholds["cost.dailyTokens"]);
    expect(config.thresholds["security.exposedCredentials"]).toEqual(DEFAULT_CONFIG.thresholds["security.exposedCredentials"]);
  });
});
