import type { ClawInsightPlugin } from "./plugin-types.js";

/**
 * Dynamically import each plugin by name.
 * Plugins that fail to import or lack diseases/rules are warned and skipped.
 */
export async function loadPlugins(pluginNames: string[]): Promise<ClawInsightPlugin[]> {
  const loaded: ClawInsightPlugin[] = [];

  for (const name of pluginNames) {
    try {
      const module = await import(name);
      const plugin: ClawInsightPlugin = module.default ?? module;

      if (!isValidPlugin(plugin)) {
        console.warn(
          `[clawinsight] Plugin "${name}" is invalid: must have a name and at least one of diseases or rules. Skipping.`,
        );
        continue;
      }

      loaded.push(plugin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[clawinsight] Failed to load plugin "${name}": ${message}. Skipping.`);
    }
  }

  return loaded;
}

function isValidPlugin(value: unknown): value is ClawInsightPlugin {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== "string" || candidate.name.trim() === "") return false;
  const hasDiseases =
    Array.isArray(candidate.diseases) && candidate.diseases.length > 0;
  const hasRules =
    candidate.rules !== null &&
    typeof candidate.rules === "object" &&
    Object.keys(candidate.rules as object).length > 0;
  return hasDiseases || hasRules;
}
