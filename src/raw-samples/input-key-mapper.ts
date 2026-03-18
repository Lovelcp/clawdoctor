// ═══════════════════════════════════════════════
//  Input Key Mapper
//  Maps disease inputDataKeys → RawSampleProvider / MetricSet data.
// ═══════════════════════════════════════════════

import type { DiseaseDefinition, LLMDetection } from "../types/domain.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";
import type { RawSampleProvider } from "./raw-sample-provider.js";

// ─── INPUT_KEY_MAP ────────────────────────────────────────────────────────────

/**
 * Maps a disease inputDataKey to an async resolver function.
 * Each resolver receives the provider, the current MetricSet, and the agentId.
 */
export const INPUT_KEY_MAP: Record<
  string,
  (provider: RawSampleProvider, metrics: MetricSet, agentId: string) => Promise<unknown>
> = {
  // ── Skill / Tool keys ─────────────────────────────────────────────────────

  /** The name of the most error-prone tool. */
  toolName: async (_p, m, _a) => m.skill.topErrorTools[0]?.tool ?? "unknown",

  /** Newline-separated error messages per tool. */
  errorLog: async (_p, m, _a) =>
    m.skill.topErrorTools
      .map((t) => `${t.tool}: ${t.errorMessages.join(", ")}`)
      .join("\n"),

  /** Placeholder — success log derived from metrics. */
  successLog: async (_p, m, _a) =>
    `tool success rate: ${(m.skill.toolSuccessRate * 100).toFixed(1)}%`,

  /** Recent session samples (raw tool call sequences). */
  sessionToolCallLog: async (p, _m, a) => p.getRecentSessionSamples(a, 5),

  /** Placeholder — tool descriptions come from plugin manifests (Phase 3+). */
  toolDescriptions: async () => "tool descriptions not yet available",

  /** Placeholder — task goal is not tracked at this phase. */
  taskGoal: async () => "task goal not yet available",

  /** TopErrorTools list, used for consecutive failure analysis. */
  consecutiveFailureLog: async (_p, m, _a) => m.skill.topErrorTools,

  /** Placeholder — tool chain definition comes from plugin manifests. */
  toolChainDefinition: async () => "tool chain definition not yet available",

  /** Parallel tool call log — placeholder (requires stream-level tracking). */
  parallelToolCallLog: async (p, _m, a) => p.getRecentSessionSamples(a, 5),

  /** Shared resource map — placeholder for Phase 3+. */
  sharedResourceMap: async () => "shared resource map not yet available",

  /** Error messages from topErrorTools. */
  errorMessages: async (_p, m, _a) =>
    m.skill.topErrorTools.flatMap((t) => t.errorMessages),

  /** Error history — recent sessions showing error patterns. */
  errorHistory: async (p, _m, a) => p.getRecentSessionSamples(a, 10),

  /** Skill configuration — placeholder for Phase 3+. */
  skillConfiguration: async () => "skill configuration not yet available",

  /** Period in days for trend analysis — default 7 days. */
  periodDays: async () => 7,

  // ── Memory keys ───────────────────────────────────────────────────────────

  /** Memory file contents (up to 10 files, 500 chars each). */
  memoryFiles: async (p, _m, _a) => p.getMemoryFileContents(10, 500),

  /** Recent session logs — raw session samples. */
  recentSessionLogs: async (p, _m, a) => p.getRecentSessionSamples(a, 5),

  /** Agent configuration — placeholder for Phase 3+. */
  agentConfiguration: async () => "agent configuration not yet available",

  /** Ground truth sources — placeholder for Phase 3+. */
  groundTruthSources: async () => "ground truth sources not yet available",

  /** Session context — recent session samples. */
  sessionContext: async (p, _m, a) => p.getRecentSessionSamples(a, 3),

  /** File timestamps — from memory file metadata. */
  fileTimestamps: async (p, _m, _a) =>
    (await p.getMemoryFileContents(20, 1)).map((f) => ({
      path: f.path,
      modifiedAt: f.modifiedAt,
    })),

  /** Memory file list — paths and modification times. */
  memoryFileList: async (p, _m, _a) =>
    (await p.getMemoryFileContents(20, 1)).map((f) => ({
      path: f.path,
      modifiedAt: f.modifiedAt,
    })),

  /** Memory file contents for fragmentation analysis. */
  memoryFileContents: async (p, _m, _a) => p.getMemoryFileContents(20, 200),

  /** Config file content (CLAUDE.md / AGENTS.md) — from memory files. */
  configFileContent: async (p, _m, _a) => {
    const files = await p.getMemoryFileContents(20, 2000);
    const configFiles = files.filter(
      (f) =>
        f.path.endsWith("CLAUDE.md") ||
        f.path.endsWith("AGENTS.md") ||
        f.path.endsWith(".clinerules"),
    );
    return configFiles.length > 0 ? configFiles : files.slice(0, 3);
  },

  /** Recent session behavior — recent session samples. */
  recentSessionBehavior: async (p, _m, a) => p.getRecentSessionSamples(a, 5),

  /** Config file age in days — placeholder since exact config path is unknown. */
  configFileAge: async (p, _m, _a) => {
    const files = await p.getMemoryFileContents(20, 1);
    const configFile = files.find(
      (f) =>
        f.path.endsWith("CLAUDE.md") ||
        f.path.endsWith("AGENTS.md"),
    );
    if (!configFile) return null;
    return (Date.now() - configFile.modifiedAt) / (24 * 60 * 60 * 1000);
  },

  // ── Behavior keys ─────────────────────────────────────────────────────────

  /** Task objectives — placeholder for Phase 3+. */
  taskObjectives: async () => "task objectives not yet available",

  /** Completed subtasks — placeholder for Phase 3+. */
  completedSubtasks: async () => "completed subtasks not yet available",

  /** Repeated action sequence — recent session samples. */
  repeatedActionSequence: async (p, _m, a) => p.getRecentSessionSamples(a, 5),

  /** Task objective (singular) — placeholder for Phase 3+. */
  taskObjective: async () => "task objective not yet available",

  /** Session logs — recent session samples. */
  sessionLogs: async (p, _m, a) => p.getRecentSessionSamples(a, 5),

  /** User requests — placeholder, extracted from session samples. */
  userRequests: async (p, _m, a) => p.getRecentSessionSamples(a, 5),

  /** Agent responses — placeholder, extracted from session samples. */
  agentResponses: async (p, _m, a) => p.getRecentSessionSamples(a, 5),

  /** Parent session context for handoff analysis. */
  parentSessionContext: async (p, _m, a) => p.getRecentSessionSamples(a, 3),

  /** Sub-agent session logs. */
  subAgentSessionLogs: async (p, _m, a) => p.getRecentSessionSamples(a, 5),

  /** Handoff prompts — placeholder for Phase 3+. */
  handoffPrompts: async () => "handoff prompts not yet available",

  /** Task descriptions — placeholder for Phase 3+. */
  taskDescriptions: async () => "task descriptions not yet available",

  // ── Security keys ─────────────────────────────────────────────────────────

  /** Skill source code — from getSkillDefinitions (stub returns empty). */
  skillSourceCode: async (p, m, _a) =>
    (await p.getSkillDefinitions(Object.keys(m.security.pluginSources)))
      .map((s) => s.source)
      .join("\n"),

  /** Skill manifest — from getSkillDefinitions. */
  skillManifest: async (p, m, _a) =>
    p.getSkillDefinitions(Object.keys(m.security.pluginSources)),

  /** Sandbox config — from metrics. */
  sandboxConfig: async (_p, m, _a) => ({
    sandboxEnabled: m.security.sandboxEnabled,
    pluginSources: m.security.pluginSources,
  }),
};

// ─── resolveInputData ─────────────────────────────────────────────────────────

/**
 * Resolves all inputDataKeys for a disease definition into a data map.
 * For hybrid diseases, uses deepAnalysis.inputDataKeys.
 * For LLM diseases, uses inputDataKeys directly.
 */
export async function resolveInputData(
  disease: DiseaseDefinition,
  provider: RawSampleProvider,
  metrics: MetricSet,
  agentId: string,
): Promise<Record<string, unknown>> {
  let keys: string[];

  if (disease.detection.type === "llm") {
    keys = (disease.detection as LLMDetection).inputDataKeys;
  } else if (disease.detection.type === "hybrid") {
    keys = disease.detection.deepAnalysis.inputDataKeys;
  } else {
    return {};
  }

  const result: Record<string, unknown> = {};

  await Promise.all(
    keys.map(async (key) => {
      const resolver = INPUT_KEY_MAP[key];
      if (resolver) {
        result[key] = await resolver(provider, metrics, agentId);
      } else {
        result[key] = undefined;
      }
    }),
  );

  return result;
}
