import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanConfig } from "./config-scanner.js";
import type { ConfigSnapshotData } from "../types/events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturesDir = join(__dirname, "..", "..", "fixtures", "config");

describe("scanConfig", () => {
  it("reads valid-openclaw.json and produces config_snapshot event", () => {
    const configPath = join(fixturesDir, "valid-openclaw.json");
    const event = scanConfig(configPath, "agent-001");

    expect(event).not.toBeNull();
    expect(event!.type).toBe("config_snapshot");
    expect(event!.source).toBe("snapshot");
    expect(event!.agentId).toBe("agent-001");
  });

  it("extracts plugin count and channel count from valid config", () => {
    const configPath = join(fixturesDir, "valid-openclaw.json");
    const event = scanConfig(configPath, "agent-001");

    const data = event!.data as ConfigSnapshotData;
    expect(data.pluginCount).toBe(2);
    expect(data.channelCount).toBe(2);
  });

  it("computes a stable configHash (SHA-256 hex)", () => {
    const configPath = join(fixturesDir, "valid-openclaw.json");
    const event1 = scanConfig(configPath, "agent-001");
    const event2 = scanConfig(configPath, "agent-001");

    const data1 = event1!.data as ConfigSnapshotData;
    const data2 = event2!.data as ConfigSnapshotData;

    // Same file → same hash
    expect(data1.configHash).toBe(data2.configHash);
    // SHA-256 is 64 hex chars
    expect(data1.configHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("extracts model and modelProvider from valid config", () => {
    const configPath = join(fixturesDir, "valid-openclaw.json");
    const event = scanConfig(configPath, "agent-001");

    const data = event!.data as ConfigSnapshotData;
    expect(data.model).toBe("claude-3-5-sonnet-20241022");
    expect(data.modelProvider).toBe("anthropic");
  });

  it("returns null for non-existent config file", () => {
    const event = scanConfig("/nonexistent/path/openclaw.json", "agent-001");
    expect(event).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    // Use a temp path that we write inline via a non-existent path we construct manually
    // Instead, test by passing a path to a known non-JSON file (the JSONL fixture)
    const notJsonPath = join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "sessions",
      "healthy-session.jsonl"
    );
    const event = scanConfig(notJsonPath, "agent-001");
    expect(event).toBeNull();
  });

  it("assigns a ULID as event id", () => {
    const configPath = join(fixturesDir, "valid-openclaw.json");
    const event = scanConfig(configPath, "agent-001");
    expect(event!.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("sets timestamp to current time (within 5 seconds)", () => {
    const before = Date.now();
    const configPath = join(fixturesDir, "valid-openclaw.json");
    const event = scanConfig(configPath, "agent-001");
    const after = Date.now();

    expect(event!.timestamp).toBeGreaterThanOrEqual(before);
    expect(event!.timestamp).toBeLessThanOrEqual(after + 5000);
  });
});
