// ═══════════════════════════════════════════════
//  Memory Scanner
//  Source: design spec §5.2
// ═══════════════════════════════════════════════

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { ulid } from "ulid";
import type { ClawDoctorEvent, MemorySnapshotData } from "../types/events.js";

// ─── Frontmatter parser ───

interface Frontmatter {
  name?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Parse YAML-like frontmatter from a markdown file.
 * Handles the `---\nkey: value\n---` pattern.
 * Only parses simple key: value string pairs (no nested objects/arrays).
 */
function parseFrontmatter(content: string): Frontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const block = match[1];
  const result: Frontmatter = {};

  for (const line of block.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Glob *.md files in the given workspace memory directory.
 * Returns a memory_snapshot event with file metadata and frontmatter info.
 * The memory directory is expected to be workspaceDir directly (caller selects the right dir).
 */
export function scanMemory(workspaceDir: string, agentId: string): ClawDoctorEvent {
  const files: MemorySnapshotData["files"] = [];
  let totalSizeBytes = 0;

  if (existsSync(workspaceDir)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(workspaceDir);
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (extname(entry).toLowerCase() !== ".md") continue;

      const fullPath = join(workspaceDir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (!stat.isFile()) continue;

      let fm: Frontmatter | null = null;
      try {
        const content = readFileSync(fullPath, "utf-8");
        fm = parseFrontmatter(content);
      } catch {
        // ignore read errors; still include the file entry
      }

      const sizeBytes = stat.size;
      totalSizeBytes += sizeBytes;

      files.push({
        path: fullPath,
        sizeBytes,
        modifiedAt: stat.mtimeMs,
        type: fm?.type as string | undefined,
        name: fm?.name as string | undefined,
      });
    }
  }

  const now = Date.now();
  const data: MemorySnapshotData = {
    files,
    totalCount: files.length,
    totalSizeBytes,
  };

  return {
    id: ulid(now),
    source: "snapshot",
    timestamp: now,
    agentId,
    type: "memory_snapshot",
    data,
  };
}
