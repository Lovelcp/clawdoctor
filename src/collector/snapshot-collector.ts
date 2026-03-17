// ═══════════════════════════════════════════════
//  Snapshot Collector (orchestrator)
//  Source: design spec §5.2
// ═══════════════════════════════════════════════

import { existsSync, readdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import type { ClawDocEvent } from "../types/events.js";
import { parseSessionFile } from "./session-parser.js";
import { scanConfig } from "./config-scanner.js";
import { scanMemory } from "./memory-scanner.js";
import { scanPlugins } from "./plugin-scanner.js";

export interface CollectSnapshotOptions {
  agentId: string;
  /** Directory where agent state is stored (sessions/ subdir expected here) */
  stateDir: string;
  /** Workspace root directory (for memory files and plugins) */
  workspaceDir: string;
  /** If provided, only parse sessions modified after this unix-ms timestamp */
  since?: number;
  /** Optional explicit path to openclaw.json (overrides auto-discovery) */
  configPath?: string;
}

/**
 * Orchestrate all snapshot sub-collectors and return combined events.
 */
export async function collectSnapshot(opts: CollectSnapshotOptions): Promise<ClawDocEvent[]> {
  const { agentId, stateDir, workspaceDir, since, configPath: explicitConfigPath } = opts;
  const events: ClawDocEvent[] = [];

  // ── 1. Session JSONL files ─────────────────────────────────────────────
  const sessionsDir = join(stateDir, "sessions");
  if (existsSync(sessionsDir)) {
    let sessionFiles: string[] = [];
    try {
      sessionFiles = readdirSync(sessionsDir);
    } catch {
      sessionFiles = [];
    }

    for (const entry of sessionFiles) {
      if (extname(entry).toLowerCase() !== ".jsonl") continue;

      const fullPath = join(sessionsDir, entry);

      // Apply `since` filter using file's last-modified time if available
      if (since !== undefined) {
        try {
          const { statSync } = await import("node:fs");
          const stat = statSync(fullPath);
          if (stat.mtimeMs < since) continue;
        } catch {
          // If we can't stat, include the file anyway
        }
      }

      const sessionEvents = parseSessionFile(fullPath, agentId);
      events.push(...sessionEvents);
    }
  }

  // ── 2. Config snapshot ─────────────────────────────────────────────────
  // Try explicit path first, then common locations for openclaw.json
  const configCandidates = explicitConfigPath
    ? [explicitConfigPath]
    : [
        join(workspaceDir, "openclaw.json"),
        join(stateDir, "..", "openclaw.json"),
      ];

  for (const candidate of configCandidates) {
    const configEvent = scanConfig(candidate, agentId);
    if (configEvent) {
      events.push(configEvent);
      break; // use first found config
    }
  }

  // ── 3. Memory snapshot ─────────────────────────────────────────────────
  const memoryEvent = scanMemory(workspaceDir, agentId);
  events.push(memoryEvent);

  // ── 4. Plugin snapshot ─────────────────────────────────────────────────
  const pluginEvent = scanPlugins(workspaceDir, agentId);
  events.push(pluginEvent);

  return events;
}
