// ═══════════════════════════════════════════════
//  Config Scanner
//  Source: design spec §5.2
// ═══════════════════════════════════════════════

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type { ClawDocEvent, ConfigSnapshotData } from "../types/events.js";

// ─── openclaw.json shape (minimal, flexible) ───

interface OpenClawConfig {
  agentId?: string;
  model?: string;
  modelProvider?: string;
  sandboxEnabled?: boolean;
  plugins?: unknown[];
  channels?: unknown[];
  [key: string]: unknown;
}

/**
 * Read openclaw.json at configPath and produce a config_snapshot event.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function scanConfig(configPath: string, agentId: string): ClawDocEvent | null {
  if (!existsSync(configPath)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    return null;
  }

  let config: OpenClawConfig;
  try {
    config = JSON.parse(raw) as OpenClawConfig;
  } catch {
    return null;
  }

  const configHash = createHash("sha256").update(raw).digest("hex");
  const pluginCount = Array.isArray(config.plugins) ? config.plugins.length : 0;
  const channelCount = Array.isArray(config.channels) ? config.channels.length : 0;

  const data: ConfigSnapshotData = {
    configHash,
    agentId: config.agentId ?? agentId,
    pluginCount,
    channelCount,
  };

  if (config.model !== undefined) data.model = config.model;
  if (config.modelProvider !== undefined) data.modelProvider = config.modelProvider;
  if (config.sandboxEnabled !== undefined) data.sandboxEnabled = config.sandboxEnabled;

  const now = Date.now();

  return {
    id: ulid(now),
    source: "snapshot",
    timestamp: now,
    agentId,
    type: "config_snapshot",
    data,
  };
}
