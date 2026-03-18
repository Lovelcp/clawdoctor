// ═══════════════════════════════════════════════
//  RawSampleProvider
//  Phase 2: reads raw filesystem data for LLM analysis.
//  Does NOT reuse session-parser or memory-scanner
//  (those produce privacy-redacted event summaries).
// ═══════════════════════════════════════════════

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { SessionSample, MemoryFileSample, SkillDefinitionSample } from "../types/domain.js";

export interface RawSampleProvider {
  getRecentSessionSamples(agentId: string, limit: number): Promise<SessionSample[]>;
  getMemoryFileContents(limit: number, maxTokensPerFile: number): Promise<MemoryFileSample[]>;
  getSkillDefinitions(pluginIds: string[]): Promise<SkillDefinitionSample[]>;
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(content: string): Record<string, unknown> | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;

  const block = match[1];
  const result: Record<string, unknown> = {};

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

// ─── JSONL session parser (raw — not privacy-redacted) ───────────────────────

interface RawToolUseBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface RawAgentMessage {
  role?: string;
  content?: string | unknown[];
  toolUseId?: string;
  isError?: boolean;
  errorMessage?: string;
  timestamp?: number;
  usage?: { input?: number; output?: number; inputTokens?: number; outputTokens?: number };
}

function parseSessionJsonl(filePath: string): SessionSample | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  const parsed: unknown[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  if (parsed.length === 0) return null;

  // Derive sessionKey from first line (header)
  const header = parsed[0] as Record<string, unknown>;
  const sessionKey: string =
    header["type"] === "session" && typeof header["id"] === "string"
      ? (header["id"] as string)
      : filePath;

  // Build toolResult map for quick lookup
  const toolResultMap = new Map<string, RawAgentMessage>();
  for (const item of parsed) {
    const msg = item as RawAgentMessage;
    if (msg.role === "toolResult" && msg.toolUseId) {
      toolResultMap.set(msg.toolUseId, msg);
    }
  }

  const toolCallSequence: SessionSample["toolCallSequence"] = [];
  let messageCount = 0;
  let totalInput: number | undefined;
  let totalOutput: number | undefined;

  for (const item of parsed) {
    const msg = item as RawAgentMessage;
    if (!msg.role) continue;

    messageCount++;

    if (msg.role === "assistant") {
      // Extract tool calls from array content
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block !== "object" || block === null) continue;
          const b = block as RawToolUseBlock;
          if (b.type !== "toolUse" && b.type !== "toolCall" && b.type !== "functionCall") continue;

          const toolName = b.name ?? "unknown";
          const toolId = b.id ?? "";
          const toolResult = toolResultMap.get(toolId);
          const isError = toolResult?.isError ?? false;
          const rawError = toolResult?.errorMessage ?? undefined;

          toolCallSequence.push({
            toolName,
            success: !isError,
            errorSummary: rawError ? rawError.slice(0, 200) : undefined,
          });
        }
      }

      // Accumulate token usage
      if (msg.usage) {
        const inp = msg.usage.input ?? msg.usage.inputTokens;
        const out = msg.usage.output ?? msg.usage.outputTokens;
        if (inp !== undefined) totalInput = (totalInput ?? 0) + inp;
        if (out !== undefined) totalOutput = (totalOutput ?? 0) + out;
      }
    }
  }

  const tokenUsage =
    totalInput !== undefined || totalOutput !== undefined
      ? { input: totalInput ?? 0, output: totalOutput ?? 0 }
      : undefined;

  return {
    sessionKey,
    messageCount,
    toolCallSequence,
    tokenUsage,
  };
}

// ─── createRawSampleProvider ──────────────────────────────────────────────────

export function createRawSampleProvider(opts: {
  stateDir: string;      // ~/.openclaw
  workspaceDir: string;
}): RawSampleProvider {
  const { stateDir, workspaceDir } = opts;

  return {
    // ── getRecentSessionSamples ──────────────────────────────────────────────
    async getRecentSessionSamples(agentId: string, limit: number): Promise<SessionSample[]> {
      const sessionsDir = join(stateDir, "agents", agentId, "sessions");

      if (!existsSync(sessionsDir)) return [];

      let entries: string[] = [];
      try {
        entries = readdirSync(sessionsDir);
      } catch {
        return [];
      }

      // Collect .jsonl files with their mtime for sorting
      const files: Array<{ path: string; mtimeMs: number }> = [];
      for (const entry of entries) {
        if (extname(entry).toLowerCase() !== ".jsonl") continue;
        const fullPath = join(sessionsDir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isFile()) {
            files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
          }
        } catch {
          // skip unreadable files
        }
      }

      // Sort newest first, take up to `limit`
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const selected = files.slice(0, limit);

      const results: SessionSample[] = [];
      for (const file of selected) {
        const sample = parseSessionJsonl(file.path);
        if (sample) results.push(sample);
      }

      return results;
    },

    // ── getMemoryFileContents ────────────────────────────────────────────────
    async getMemoryFileContents(limit: number, maxTokensPerFile: number): Promise<MemoryFileSample[]> {
      // Glob workspaceDir/**/*.md (recursive)
      const mdFiles: Array<{ path: string; mtimeMs: number }> = [];

      function walk(dir: string): void {
        if (!existsSync(dir)) return;
        let entries: string[] = [];
        try {
          entries = readdirSync(dir);
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              walk(fullPath);
            } else if (stat.isFile() && extname(entry).toLowerCase() === ".md") {
              mdFiles.push({ path: fullPath, mtimeMs: stat.mtimeMs });
            }
          } catch {
            // skip
          }
        }
      }

      walk(workspaceDir);

      // Sort newest first, take up to `limit`
      mdFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const selected = mdFiles.slice(0, limit);

      const results: MemoryFileSample[] = [];
      for (const file of selected) {
        let raw: string;
        try {
          raw = readFileSync(file.path, "utf-8");
        } catch {
          continue;
        }

        const frontmatter = parseFrontmatter(raw);

        // Truncate content to maxTokensPerFile chars (1 token ≈ 1 char for simplicity)
        const content = raw.length > maxTokensPerFile ? raw.slice(0, maxTokensPerFile) : raw;

        results.push({
          path: file.path,
          content,
          frontmatter,
          modifiedAt: file.mtimeMs,
        });
      }

      return results;
    },

    // ── getSkillDefinitions ──────────────────────────────────────────────────
    // Stub for Phase 2 — real implementation needs OpenClaw plugin manifests.
    async getSkillDefinitions(_pluginIds: string[]): Promise<SkillDefinitionSample[]> {
      return [];
    },
  };
}
