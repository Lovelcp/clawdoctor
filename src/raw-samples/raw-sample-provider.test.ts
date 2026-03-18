import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRawSampleProvider } from "./raw-sample-provider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fixtures live at <repo-root>/fixtures/
// From src/raw-samples/ we go up two levels to reach the repo root.
const fixturesRoot = join(__dirname, "..", "..", "fixtures");
const memoryFixtureDir = join(fixturesRoot, "memory");

// ─── Path trick for sessions directory ────────────────────────────────────────
// We need: join(stateDir, "agents", agentId, "sessions") = fixturesRoot/sessions
//
// Setting stateDir = repoRoot (= fixturesRoot/..) and agentId = "../fixtures":
//   join(repoRoot, "agents", "../fixtures", "sessions")
//   normalises to: repoRoot/fixtures/sessions ✓
//
const repoRoot = join(fixturesRoot, "..");
const FAKE_STATE_DIR = repoRoot;
const FAKE_AGENT_ID = "../fixtures";

describe("RawSampleProvider", () => {
  describe("getRecentSessionSamples", () => {
    it("parses session samples from fixture JSONL files", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const samples = await provider.getRecentSessionSamples(FAKE_AGENT_ID, 10);
      expect(samples.length).toBeGreaterThan(0);
    });

    it("includes toolCallSequence with toolName and success fields", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const samples = await provider.getRecentSessionSamples(FAKE_AGENT_ID, 10);
      const allToolCalls = samples.flatMap((s) => s.toolCallSequence);
      expect(allToolCalls.length).toBeGreaterThan(0);

      for (const tc of allToolCalls) {
        expect(typeof tc.toolName).toBe("string");
        expect(tc.toolName.length).toBeGreaterThan(0);
        expect(typeof tc.success).toBe("boolean");
      }
    });

    it("includes errorSummary for failed tool calls, truncated to 200 chars", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const samples = await provider.getRecentSessionSamples(FAKE_AGENT_ID, 10);
      const failedToolCalls = samples
        .flatMap((s) => s.toolCallSequence)
        .filter((tc) => !tc.success);

      expect(failedToolCalls.length).toBeGreaterThan(0);
      for (const tc of failedToolCalls) {
        if (tc.errorSummary !== undefined) {
          expect(tc.errorSummary.length).toBeLessThanOrEqual(200);
        }
      }
    });

    it("parses token usage from session files", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const samples = await provider.getRecentSessionSamples(FAKE_AGENT_ID, 10);
      const withUsage = samples.filter((s) => s.tokenUsage !== undefined);
      expect(withUsage.length).toBeGreaterThan(0);
    });

    it("respects the limit parameter", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const samples = await provider.getRecentSessionSamples(FAKE_AGENT_ID, 1);
      expect(samples.length).toBeLessThanOrEqual(1);
    });

    it("returns empty array for missing sessions directory", async () => {
      const provider = createRawSampleProvider({
        stateDir: "/nonexistent/state/dir",
        workspaceDir: memoryFixtureDir,
      });

      const samples = await provider.getRecentSessionSamples("no-agent", 10);
      expect(samples).toEqual([]);
    });
  });

  describe("getMemoryFileContents", () => {
    it("reads memory files from the workspace directory", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const files = await provider.getMemoryFileContents(10, 5000);
      expect(files.length).toBeGreaterThan(0);
    });

    it("includes file path, content, and modifiedAt", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const files = await provider.getMemoryFileContents(10, 5000);
      for (const file of files) {
        expect(typeof file.path).toBe("string");
        expect(file.path.endsWith(".md")).toBe(true);
        expect(typeof file.content).toBe("string");
        expect(typeof file.modifiedAt).toBe("number");
      }
    });

    it("parses frontmatter from memory files", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const files = await provider.getMemoryFileContents(10, 5000);
      const withFrontmatter = files.filter((f) => f.frontmatter !== undefined);
      expect(withFrontmatter.length).toBeGreaterThan(0);

      for (const f of withFrontmatter) {
        expect(typeof f.frontmatter).toBe("object");
      }
    });

    it("truncates content to maxTokensPerFile characters", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const maxTokens = 10;
      const files = await provider.getMemoryFileContents(10, maxTokens);
      for (const file of files) {
        expect(file.content.length).toBeLessThanOrEqual(maxTokens);
      }
    });

    it("respects the limit parameter", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const files = await provider.getMemoryFileContents(1, 5000);
      expect(files.length).toBeLessThanOrEqual(1);
    });

    it("returns empty array for missing workspace directory", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: "/nonexistent/workspace",
      });

      const files = await provider.getMemoryFileContents(10, 5000);
      expect(files).toEqual([]);
    });
  });

  describe("getSkillDefinitions", () => {
    it("returns empty array (stub for Phase 2)", async () => {
      const provider = createRawSampleProvider({
        stateDir: FAKE_STATE_DIR,
        workspaceDir: memoryFixtureDir,
      });

      const skills = await provider.getSkillDefinitions(["plugin-a", "plugin-b"]);
      expect(skills).toEqual([]);
    });
  });
});
