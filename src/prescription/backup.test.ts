// ═══════════════════════════════════════════════
//  Backup Tests (TDD)
//  All tests run in a temporary directory
// ═══════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createBackup, finalizeBackup, executeRollback } from "./backup.js";
import type { PrescriptionBackup, PrescriptionAction } from "../types/domain.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function makeBackup(
  id: string,
  prescriptionId: string,
  entries: PrescriptionBackup["entries"],
): PrescriptionBackup {
  return {
    id,
    prescriptionId,
    createdAt: Date.now(),
    entries,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("backup", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "clawinsight-backup-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── file_edit scenario ────────────────────────────────────────────────────

  describe("file_edit: create → backup → edit → verify → rollback → verify restored", () => {
    it("full lifecycle", () => {
      const filePath = join(tmpDir, "config.txt");
      const originalContent = "original content";
      writeFileSync(filePath, originalContent, "utf8");

      // 1. createBackup
      const actions: PrescriptionAction[] = [
        { type: "file_edit", filePath, diff: "@@ -1 +1 @@\n-original\n+new", description: { en: "Edit file" } },
      ];
      const entries = createBackup(actions);

      expect(entries).toHaveLength(1);
      expect(entries[0].path).toBe(filePath);
      expect(entries[0].originalContent).toBe(originalContent);
      expect(entries[0].preApplyHash).toBe(sha256(originalContent));

      // 2. Apply (simulate edit)
      const newContent = "new content";
      writeFileSync(filePath, newContent, "utf8");

      // 3. finalizeBackup
      const finalEntries = finalizeBackup(entries);
      expect(finalEntries[0].preApplyHash).toBe(sha256(originalContent));
      expect(finalEntries[0].postApplyHash).toBe(sha256(newContent));
      expect(finalEntries[0].originalContent).toBe(originalContent);

      // 4. Rollback
      const backup = makeBackup("bk-001", "rx-001", finalEntries);
      const result = executeRollback(backup);

      expect(result.success).toBe(true);
      expect(result.restoredFiles).toContain(filePath);
      expect(result.skippedFiles).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);

      // 5. Verify file restored
      const restored = readFileSync(filePath, "utf8");
      expect(restored).toBe(originalContent);
    });
  });

  // ─── file_delete scenario ──────────────────────────────────────────────────

  describe("file_delete: create → backup → delete → rollback → verify restored", () => {
    it("full lifecycle", () => {
      const filePath = join(tmpDir, "to-delete.txt");
      const originalContent = "content to preserve";
      writeFileSync(filePath, originalContent, "utf8");

      // 1. createBackup
      const actions: PrescriptionAction[] = [
        { type: "file_delete", filePath, description: { en: "Delete file" } },
      ];
      const entries = createBackup(actions);

      expect(entries[0].originalContent).toBe(originalContent);
      expect(entries[0].preApplyHash).toBe(sha256(originalContent));

      // 2. Apply (simulate delete)
      rmSync(filePath);
      expect(existsSync(filePath)).toBe(false);

      // 3. finalizeBackup
      const finalEntries = finalizeBackup(entries);
      expect(finalEntries[0].postApplyHash).toBeNull(); // file was deleted

      // 4. Rollback
      const backup = makeBackup("bk-002", "rx-002", finalEntries);
      const result = executeRollback(backup);

      expect(result.success).toBe(true);
      expect(result.restoredFiles).toContain(filePath);

      // 5. Verify file restored
      expect(existsSync(filePath)).toBe(true);
      const restored = readFileSync(filePath, "utf8");
      expect(restored).toBe(originalContent);
    });
  });

  // ─── new file scenario ─────────────────────────────────────────────────────

  describe("file_edit on non-existent file: backup → create → rollback → file removed", () => {
    it("removes a newly created file on rollback", () => {
      const filePath = join(tmpDir, "new-file.txt");
      // File does not exist yet

      const actions: PrescriptionAction[] = [
        { type: "file_edit", filePath, diff: "@@ -0,0 +1 @@\n+new", description: { en: "Create file" } },
      ];
      const entries = createBackup(actions);

      expect(entries[0].originalContent).toBeNull();
      expect(entries[0].preApplyHash).toBeNull();

      // Apply: create the file
      writeFileSync(filePath, "new content", "utf8");

      const finalEntries = finalizeBackup(entries);
      expect(finalEntries[0].postApplyHash).not.toBeNull();

      // Rollback
      const backup = makeBackup("bk-003", "rx-003", finalEntries);
      const result = executeRollback(backup);

      expect(result.success).toBe(true);
      expect(result.restoredFiles).toContain(filePath);
      expect(existsSync(filePath)).toBe(false);
    });
  });

  // ─── conflict detection ────────────────────────────────────────────────────

  describe("conflict detection: backup → apply → externally modify → rollback → conflict", () => {
    it("detects conflict when file modified after Rx application", () => {
      const filePath = join(tmpDir, "conflict.txt");
      writeFileSync(filePath, "original", "utf8");

      const actions: PrescriptionAction[] = [
        { type: "file_edit", filePath, diff: "", description: { en: "Edit" } },
      ];
      const entries = createBackup(actions);

      // Apply
      writeFileSync(filePath, "rx-applied", "utf8");
      const finalEntries = finalizeBackup(entries);

      // External modification (neither original nor rx-applied)
      writeFileSync(filePath, "externally modified", "utf8");

      const backup = makeBackup("bk-004", "rx-004", finalEntries);
      const result = executeRollback(backup);

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].path).toBe(filePath);
      expect(result.restoredFiles).toHaveLength(0);
    });
  });

  // ─── already-reverted ─────────────────────────────────────────────────────

  describe("already-reverted: backup → apply → manually revert → rollback → skip", () => {
    it("skips files already restored to pre-apply state", () => {
      const filePath = join(tmpDir, "already-reverted.txt");
      writeFileSync(filePath, "original", "utf8");

      const actions: PrescriptionAction[] = [
        { type: "file_edit", filePath, diff: "", description: { en: "Edit" } },
      ];
      const entries = createBackup(actions);

      // Apply
      writeFileSync(filePath, "rx-applied", "utf8");
      const finalEntries = finalizeBackup(entries);

      // Manually revert (file is back to original before we call executeRollback)
      writeFileSync(filePath, "original", "utf8");

      const backup = makeBackup("bk-005", "rx-005", finalEntries);
      const result = executeRollback(backup);

      expect(result.success).toBe(true);
      expect(result.skippedFiles).toContain(filePath);
      expect(result.restoredFiles).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
    });
  });

  // ─── no filesystem actions ─────────────────────────────────────────────────

  it("createBackup returns empty array when no file actions", () => {
    const actions: PrescriptionAction[] = [
      { type: "manual", instruction: { en: "Do this manually" } },
      { type: "command", command: "echo hi", description: { en: "Run command" } },
    ];
    const entries = createBackup(actions);
    expect(entries).toHaveLength(0);
  });

  // ─── multiple files ────────────────────────────────────────────────────────

  it("handles multiple files in one backup", () => {
    const file1 = join(tmpDir, "file1.txt");
    const file2 = join(tmpDir, "file2.txt");
    writeFileSync(file1, "content1", "utf8");
    writeFileSync(file2, "content2", "utf8");

    const actions: PrescriptionAction[] = [
      { type: "file_edit", filePath: file1, diff: "", description: { en: "Edit 1" } },
      { type: "file_delete", filePath: file2, description: { en: "Delete 2" } },
    ];

    const entries = createBackup(actions);
    expect(entries).toHaveLength(2);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain(file1);
    expect(paths).toContain(file2);
  });

  // ─── deduplication ────────────────────────────────────────────────────────

  it("deduplicates file paths when same file appears multiple times in actions", () => {
    const filePath = join(tmpDir, "dup.txt");
    writeFileSync(filePath, "content", "utf8");

    const actions: PrescriptionAction[] = [
      { type: "file_edit", filePath, diff: "patch1", description: { en: "Edit 1" } },
      { type: "file_edit", filePath, diff: "patch2", description: { en: "Edit 2" } },
    ];

    const entries = createBackup(actions);
    expect(entries).toHaveLength(1);
  });
});
