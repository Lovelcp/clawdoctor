// ═══════════════════════════════════════════════
//  Plugin Scanner (Phase 1 stub)
//  Source: design spec §5.2
// ═══════════════════════════════════════════════

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import type { ClawInsightEvent, PluginSnapshotData } from "../types/events.js";

// ─── Plugin manifest shape (minimal) ───

interface PluginManifest {
  id?: string;
  name?: string;
  version?: string;
  tools?: string[];
  hooks?: string[];
  permissions?: string[];
  [key: string]: unknown;
}

type PluginEntry = PluginSnapshotData["plugins"][number];

/**
 * Read plugin manifests from the workspace directory.
 * Phase 1 stub: looks for plugin manifest files (openclaw-plugin.json or package.json
 * with openclaw.plugin field) in node_modules under workspaceDir.
 * Returns a plugin_snapshot event.
 */
export function scanPlugins(workspaceDir: string, agentId: string): ClawInsightEvent {
  const plugins: PluginEntry[] = [];

  // Look for node_modules plugins that declare openclaw plugin manifests
  const nodeModulesDir = join(workspaceDir, "node_modules");
  if (existsSync(nodeModulesDir)) {
    let moduleEntries: string[] = [];
    try {
      moduleEntries = readdirSync(nodeModulesDir);
    } catch {
      moduleEntries = [];
    }

    for (const moduleName of moduleEntries) {
      // Skip hidden dirs and scope prefixes for now
      if (moduleName.startsWith(".")) continue;

      const manifestPath = join(nodeModulesDir, moduleName, "openclaw-plugin.json");
      if (!existsSync(manifestPath)) continue;

      let manifest: PluginManifest = {};
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PluginManifest;
      } catch {
        // Record as error status if manifest is unreadable
        plugins.push({
          id: moduleName,
          name: moduleName,
          source: "global",
          status: "error",
          error: "Failed to parse openclaw-plugin.json",
          registeredTools: [],
          registeredHooks: [],
        });
        continue;
      }

      plugins.push({
        id: manifest.id ?? moduleName,
        name: manifest.name ?? moduleName,
        version: manifest.version,
        source: "global",
        status: "loaded",
        registeredTools: Array.isArray(manifest.tools) ? manifest.tools : [],
        registeredHooks: Array.isArray(manifest.hooks) ? manifest.hooks : [],
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions : undefined,
      });
    }
  }

  const now = Date.now();
  const data: PluginSnapshotData = { plugins };

  return {
    id: ulid(now),
    source: "snapshot",
    timestamp: now,
    agentId,
    type: "plugin_snapshot",
    data,
  };
}
