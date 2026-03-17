import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanMemory } from "./memory-scanner.js";
import type { MemorySnapshotData } from "../types/events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const memoryFixturesDir = join(__dirname, "..", "..", "fixtures", "memory");

describe("scanMemory", () => {
  it("finds all .md files in the memory directory", () => {
    const event = scanMemory(memoryFixturesDir, "agent-001");

    expect(event.type).toBe("memory_snapshot");
    expect(event.source).toBe("snapshot");

    const data = event.data as MemorySnapshotData;
    // We have: MEMORY.md, fresh-memory.md, stale-memory.md
    expect(data.totalCount).toBe(3);
    expect(data.files).toHaveLength(3);
  });

  it("reads frontmatter name and type from files", () => {
    const event = scanMemory(memoryFixturesDir, "agent-001");
    const data = event.data as MemorySnapshotData;

    const mainMemory = data.files.find((f) => f.path.endsWith("MEMORY.md"));
    expect(mainMemory).toBeDefined();
    expect(mainMemory!.type).toBe("agent");
    expect(mainMemory!.name).toBe("main");

    const freshMemory = data.files.find((f) => f.path.endsWith("fresh-memory.md"));
    expect(freshMemory).toBeDefined();
    expect(freshMemory!.type).toBe("user");
    expect(freshMemory!.name).toBe("test");
  });

  it("records sizeBytes > 0 for each file", () => {
    const event = scanMemory(memoryFixturesDir, "agent-001");
    const data = event.data as MemorySnapshotData;

    for (const file of data.files) {
      expect(file.sizeBytes).toBeGreaterThan(0);
    }
  });

  it("records modifiedAt as a positive unix-ms timestamp", () => {
    const event = scanMemory(memoryFixturesDir, "agent-001");
    const data = event.data as MemorySnapshotData;

    for (const file of data.files) {
      expect(file.modifiedAt).toBeGreaterThan(0);
    }
  });

  it("totalSizeBytes equals sum of individual file sizes", () => {
    const event = scanMemory(memoryFixturesDir, "agent-001");
    const data = event.data as MemorySnapshotData;

    const expectedTotal = data.files.reduce((sum, f) => sum + f.sizeBytes, 0);
    expect(data.totalSizeBytes).toBe(expectedTotal);
  });

  it("returns empty memory_snapshot for non-existent directory", () => {
    const event = scanMemory("/nonexistent/memory/dir", "agent-001");

    expect(event.type).toBe("memory_snapshot");
    const data = event.data as MemorySnapshotData;
    expect(data.totalCount).toBe(0);
    expect(data.files).toHaveLength(0);
    expect(data.totalSizeBytes).toBe(0);
  });

  it("assigns a ULID as event id", () => {
    const event = scanMemory(memoryFixturesDir, "agent-001");
    expect(event.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("sets agentId correctly", () => {
    const event = scanMemory(memoryFixturesDir, "my-custom-agent");
    expect(event.agentId).toBe("my-custom-agent");
  });

  it("file paths are absolute", () => {
    const event = scanMemory(memoryFixturesDir, "agent-001");
    const data = event.data as MemorySnapshotData;

    for (const file of data.files) {
      expect(file.path).toMatch(/^\//); // absolute path starts with /
    }
  });
});
