// ═══════════════════════════════════════════════
//  Prescription Backup — two-phase file backup
//  Design spec §7.2 (rollback support)
// ═══════════════════════════════════════════════

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import type { PrescriptionAction, PrescriptionBackup, RollbackResult } from "../types/domain.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BackupEntry {
  path: string;
  originalContent: string | null;   // null = file didn't exist before backup
  preApplyHash: string | null;      // null = file didn't exist before backup
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function readFileSafe(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Extract all unique file paths that may be modified by these actions.
 * Only file_edit and file_delete actions affect the filesystem.
 */
function extractFilePaths(actions: PrescriptionAction[]): string[] {
  const paths = new Set<string>();
  for (const action of actions) {
    if (action.type === "file_edit" || action.type === "file_delete") {
      paths.add(action.filePath);
    }
  }
  return Array.from(paths);
}

// ─── Phase 1: createBackup ────────────────────────────────────────────────────

/**
 * Phase 1: Read current files and compute their SHA-256 preApplyHash.
 * Must be called BEFORE applying any actions.
 *
 * Returns one BackupEntry per unique file affected by the actions.
 * Files that don't exist get originalContent = null and preApplyHash = null.
 */
export function createBackup(actions: PrescriptionAction[]): BackupEntry[] {
  const paths = extractFilePaths(actions);
  return paths.map((filePath) => {
    const content = readFileSafe(filePath);
    return {
      path: filePath,
      originalContent: content,
      preApplyHash: content !== null ? sha256(content) : null,
    };
  });
}

// ─── Phase 2: finalizeBackup ──────────────────────────────────────────────────

/**
 * Phase 2: After applying actions, read the files again to compute postApplyHash.
 * For files that were deleted, postApplyHash = null.
 *
 * Returns the PrescriptionBackup entries array.
 */
export function finalizeBackup(
  entries: BackupEntry[],
): PrescriptionBackup["entries"] {
  return entries.map((entry) => {
    const currentContent = readFileSafe(entry.path);
    const postApplyHash = currentContent !== null ? sha256(currentContent) : null;

    return {
      type: "file_content" as const,
      path: entry.path,
      originalContent: entry.originalContent,
      preApplyHash: entry.preApplyHash,
      postApplyHash,
    };
  });
}

// ─── executeRollback ─────────────────────────────────────────────────────────

/**
 * Three-way comparison rollback:
 *   - If currentHash === preApplyHash → already reverted, skip
 *   - If currentHash === postApplyHash → apply rollback (restore original)
 *   - Otherwise → conflict (file was externally modified after Rx application)
 */
export function executeRollback(backup: PrescriptionBackup): RollbackResult {
  const restoredFiles: string[] = [];
  const skippedFiles: string[] = [];
  const conflicts: RollbackResult["conflicts"] = [];

  try {
    for (const entry of backup.entries) {
      // Only handle file_content entries (config_snapshot handled elsewhere)
      if (entry.type !== "file_content") continue;

      // Read current file state
      const currentContent = readFileSafe(entry.path);
      const currentHash = currentContent !== null ? sha256(currentContent) : null;

      const preApplyHash = entry.preApplyHash;
      const postApplyHash = entry.postApplyHash;

      // ─── Already reverted check ────────────────────────────────────────────
      // currentHash equals preApplyHash → file is already back to original state
      if (currentHash === preApplyHash) {
        skippedFiles.push(entry.path);
        continue;
      }

      // ─── Conflict check ────────────────────────────────────────────────────
      // currentHash differs from BOTH pre and post → external modification
      if (currentHash !== postApplyHash) {
        conflicts.push({
          path: entry.path,
          preApplyHash: preApplyHash ?? "(null)",
          postApplyHash: postApplyHash ?? "(null)",
          currentHash: currentHash ?? "(null)",
        });
        continue;
      }

      // ─── Normal rollback ───────────────────────────────────────────────────
      // currentHash === postApplyHash → safe to restore
      if (entry.originalContent === null) {
        // File didn't exist before — delete it
        if (existsSync(entry.path)) {
          unlinkSync(entry.path);
        }
      } else {
        // Restore original content
        writeFileSync(entry.path, entry.originalContent, "utf8");
      }
      restoredFiles.push(entry.path);
    }

    return {
      success: conflicts.length === 0,
      restoredFiles,
      skippedFiles,
      conflicts,
    };
  } catch (err: unknown) {
    return {
      success: false,
      restoredFiles,
      skippedFiles,
      conflicts,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
