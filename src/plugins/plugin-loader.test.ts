import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClawDocPlugin } from "./plugin-types.js";
import type { DiseaseDefinition } from "../types/domain.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockDisease: DiseaseDefinition = {
  id: "PLG-001",
  department: "security",
  category: "test",
  name: { en: "Test Disease" },
  description: { en: "A test disease added by a plugin." },
  rootCauses: [{ en: "Test root cause" }],
  detection: {
    type: "rule",
    metric: "security.exposedCredentials",
    direction: "higher_is_worse",
    defaultThresholds: { warning: 1, critical: 3 },
  },
  prescriptionTemplate: {
    level: "manual",
    actionTypes: ["manual"],
    promptTemplate: "Fix it.",
    estimatedImprovementTemplate: { en: "+10%" },
    risk: "low",
  },
  relatedDiseases: [],
  defaultSeverity: "warning",
  tags: ["test"],
};

const validPluginWithDiseases: ClawDocPlugin = {
  name: "clawdoc-plugin-test",
  version: "1.0.0",
  diseases: [mockDisease],
};

const validPluginWithRules: ClawDocPlugin = {
  name: "clawdoc-plugin-rules-only",
  rules: {
    "MY-001": (_metrics: any, _config: any) => null,
  },
};

const invalidPlugin = {
  // missing name, no diseases or rules
  version: "0.1.0",
};

const invalidPluginNoDiseaseOrRules: ClawDocPlugin = {
  name: "clawdoc-plugin-empty",
  // explicitly no diseases or rules
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("loadPlugins", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("loads a valid plugin that exports diseases", async () => {
    vi.doMock("clawdoc-plugin-test-diseases", () => ({ default: validPluginWithDiseases }));

    const { loadPlugins } = await import("./plugin-loader.js");
    const plugins = await loadPlugins(["clawdoc-plugin-test-diseases"]);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("clawdoc-plugin-test");
    expect(plugins[0].diseases).toHaveLength(1);
    expect(plugins[0].diseases![0].id).toBe("PLG-001");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("loads a valid plugin that exports only rules (no diseases)", async () => {
    vi.doMock("clawdoc-plugin-rules-only", () => ({ default: validPluginWithRules }));

    const { loadPlugins } = await import("./plugin-loader.js");
    const plugins = await loadPlugins(["clawdoc-plugin-rules-only"]);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("clawdoc-plugin-rules-only");
    expect(plugins[0].rules).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns and skips a plugin that has no diseases or rules", async () => {
    vi.doMock("clawdoc-plugin-empty", () => ({ default: invalidPluginNoDiseaseOrRules }));

    const { loadPlugins } = await import("./plugin-loader.js");
    const plugins = await loadPlugins(["clawdoc-plugin-empty"]);

    expect(plugins).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("clawdoc-plugin-empty");
    expect(warnSpy.mock.calls[0][0]).toContain("invalid");
  });

  it("warns and skips a plugin whose shape is completely invalid (no name field)", async () => {
    vi.doMock("clawdoc-plugin-bad-shape", () => ({ default: invalidPlugin }));

    const { loadPlugins } = await import("./plugin-loader.js");
    const plugins = await loadPlugins(["clawdoc-plugin-bad-shape"]);

    expect(plugins).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("invalid");
  });

  it("handles import failure gracefully and warns", async () => {
    // This module is never mocked, so import() will throw a module-not-found error
    const { loadPlugins } = await import("./plugin-loader.js");
    const plugins = await loadPlugins(["clawdoc-plugin-missing-nonexistent-xyz"]);

    expect(plugins).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("Failed to load plugin");
    expect(warnSpy.mock.calls[0][0]).toContain("clawdoc-plugin-missing-nonexistent-xyz");
  });

  it("loads multiple plugins, skipping invalid ones", async () => {
    vi.doMock("clawdoc-plugin-good", () => ({ default: validPluginWithDiseases }));
    vi.doMock("clawdoc-plugin-bad", () => ({ default: invalidPluginNoDiseaseOrRules }));

    const { loadPlugins } = await import("./plugin-loader.js");
    const plugins = await loadPlugins(["clawdoc-plugin-good", "clawdoc-plugin-bad"]);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("clawdoc-plugin-test");
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("returns an empty array when no plugin names are provided", async () => {
    const { loadPlugins } = await import("./plugin-loader.js");
    const plugins = await loadPlugins([]);

    expect(plugins).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("supports module with .default export (standard ESM default export)", async () => {
    vi.doMock("clawdoc-plugin-esm-default", () => ({ default: validPluginWithDiseases }));

    const { loadPlugins } = await import("./plugin-loader.js");
    const plugins = await loadPlugins(["clawdoc-plugin-esm-default"]);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("clawdoc-plugin-test");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
