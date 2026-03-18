// ═══════════════════════════════════════════════
//  Rx Command
//  Prescription management CLI commands
//  Design spec Phase 2, Task 12
// ═══════════════════════════════════════════════

import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../store/database.js";
import { createPrescriptionStore } from "../store/prescription-store.js";
import { createPrescriptionExecutor } from "../prescription/prescription-executor.js";
import { loadConfig } from "../config/loader.js";

// ─── Helper: resolve default DB path ─────────────────────────────────────────

function defaultDbPath(): string {
  return join(homedir(), ".clawdoc", "clawdoc.db");
}

function defaultConfigPath(): string {
  return join(homedir(), ".clawdoc", "config.json");
}

// ─── Helper: format timestamp ────────────────────────────────────────────────

function fmtTime(ms: number | undefined): string {
  if (ms === undefined) return "-";
  return new Date(ms).toISOString();
}

// ─── registerRxCommand ────────────────────────────────────────────────────────

export function registerRxCommand(program: Command): void {
  const rx = program.command("rx").description("Prescription management");

  // ─── rx list ──────────────────────────────────────────────────────────────

  rx.command("list")
    .description("List prescriptions")
    .option("--status <status>", "Filter by status (pending/applied/rolled_back)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const db = openDatabase(defaultDbPath());
      try {
        const store = createPrescriptionStore(db);
        const filter: { status?: string } = {};
        if (opts.status) {
          filter.status = opts.status;
        }
        const prescriptions = store.queryPrescriptions(filter);

        if (opts.json) {
          console.log(JSON.stringify(prescriptions, null, 2));
        } else {
          if (prescriptions.length === 0) {
            console.log("No prescriptions found.");
            return;
          }
          console.log(`\nPrescriptions (${prescriptions.length}):`);
          console.log("─".repeat(72));
          for (const p of prescriptions) {
            const status = (p as unknown as { status: string }).status ?? "pending";
            const appliedAt = (p as unknown as { appliedAt?: number }).appliedAt;
            const rolledBackAt = (p as unknown as { rolledBackAt?: number }).rolledBackAt;
            console.log(`  ID:      ${p.id}`);
            console.log(`  Level:   ${p.level}  Risk: ${p.risk}  Status: ${status}`);
            console.log(`  Actions: ${p.actions.length}`);
            if (appliedAt) console.log(`  Applied: ${fmtTime(appliedAt)}`);
            if (rolledBackAt) console.log(`  Rolled back: ${fmtTime(rolledBackAt)}`);
            console.log("─".repeat(72));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoc] rx list failed: ${message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });

  // ─── rx preview <id> ──────────────────────────────────────────────────────

  rx.command("preview <id>")
    .description("Preview changes for a prescription")
    .action(async (id: string) => {
      const db = openDatabase(defaultDbPath());
      try {
        const config = loadConfig(defaultConfigPath());
        const executor = createPrescriptionExecutor(db, config);
        const preview = await executor.preview(id);

        console.log(`\nPreview: ${id}`);
        console.log(`Diagnosis: ${preview.diagnosisName.en}`);
        console.log(`Estimated improvement: ${JSON.stringify(preview.estimatedImprovement)}`);
        console.log(`Rollback available: ${preview.rollbackAvailable}`);
        console.log(`\nActions (${preview.actions.length}):`);
        console.log("─".repeat(72));
        for (const action of preview.actions) {
          console.log(`  Type: ${action.type}  Risk: ${action.risk}`);
          console.log(`  ${action.description.en}`);
          if ("diff" in action && action.diff) {
            console.log(`  Diff:\n${action.diff}`);
          }
          if ("command" in action && action.command) {
            console.log(`  Command: ${action.command}`);
          }
          console.log("─".repeat(72));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoc] rx preview failed: ${message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });

  // ─── rx apply [id] ────────────────────────────────────────────────────────

  rx.command("apply [id]")
    .description("Apply a prescription (or all pending guided prescriptions with --all)")
    .option("--all", "Apply all pending guided prescriptions")
    .option("--dry-run", "Preview only, do not apply")
    .action(async (id: string | undefined, opts) => {
      const db = openDatabase(defaultDbPath());
      try {
        const config = loadConfig(defaultConfigPath());
        const executor = createPrescriptionExecutor(db, config);

        if (opts.all) {
          // Apply all pending guided (non-manual) prescriptions
          const store = createPrescriptionStore(db);
          const pending = store.queryPrescriptions({ status: "pending" }).filter(
            (p) => p.level === "guided",
          );

          if (pending.length === 0) {
            console.log("No pending guided prescriptions found.");
            return;
          }

          console.log(`Found ${pending.length} pending guided prescription(s).`);

          for (const p of pending) {
            if (opts.dryRun) {
              console.log(`\n[dry-run] Preview: ${p.id}`);
              const preview = await executor.preview(p.id);
              console.log(`  Diagnosis: ${preview.diagnosisName.en}`);
              for (const action of preview.actions) {
                console.log(`  - ${action.type}: ${action.description.en}`);
              }
            } else {
              console.log(`\nApplying: ${p.id}`);
              const result = await executor.execute(p.id);
              console.log(`  Success: ${result.success}`);
              for (const a of result.appliedActions) {
                console.log(`  - ${a.action.type}: ${a.status}${a.error ? ` (${a.error})` : ""}`);
              }
            }
          }
        } else if (id) {
          if (opts.dryRun) {
            const preview = await executor.preview(id);
            console.log(`\n[dry-run] Preview: ${id}`);
            console.log(`  Diagnosis: ${preview.diagnosisName.en}`);
            for (const action of preview.actions) {
              console.log(`  - ${action.type}: ${action.description.en}`);
            }
          } else {
            console.log(`Applying prescription: ${id}`);
            const result = await executor.execute(id);
            console.log(`Success: ${result.success}`);
            for (const a of result.appliedActions) {
              console.log(`  - ${a.action.type}: ${a.status}${a.error ? ` (${a.error})` : ""}`);
            }
            if (result.immediateVerification) {
              console.log(`\nVerification: ${result.immediateVerification.currentStatus}`);
              if (result.immediateVerification.note) {
                console.log(`  ${result.immediateVerification.note.en}`);
              }
            }
          }
        } else {
          console.error("Provide a prescription <id> or use --all to apply all pending guided prescriptions.");
          process.exit(1);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoc] rx apply failed: ${message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });

  // ─── rx rollback <id> ─────────────────────────────────────────────────────

  rx.command("rollback <id>")
    .description("Roll back an applied prescription")
    .action(async (id: string) => {
      const db = openDatabase(defaultDbPath());
      try {
        const config = loadConfig(defaultConfigPath());
        const executor = createPrescriptionExecutor(db, config);

        console.log(`Rolling back prescription: ${id}`);
        const result = await executor.rollback(id);
        console.log(`Success: ${result.success}`);
        if (result.restoredFiles.length > 0) {
          console.log(`Restored files:`);
          for (const f of result.restoredFiles) {
            console.log(`  - ${f}`);
          }
        }
        if (result.skippedFiles.length > 0) {
          console.log(`Skipped files:`);
          for (const f of result.skippedFiles) {
            console.log(`  - ${f}`);
          }
        }
        if (result.conflicts && result.conflicts.length > 0) {
          console.log(`Conflicts:`);
          for (const c of result.conflicts) {
            console.log(`  - ${c}`);
          }
        }
        if (result.error) {
          console.error(`Error: ${result.error}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoc] rx rollback failed: ${message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });

  // ─── rx followup [id] ─────────────────────────────────────────────────────

  rx.command("followup [id]")
    .description("Run follow-up check for a prescription (or all pending follow-ups)")
    .action(async (id: string | undefined) => {
      const db = openDatabase(defaultDbPath());
      try {
        const config = loadConfig(defaultConfigPath());
        const executor = createPrescriptionExecutor(db, config);

        if (id) {
          console.log(`Running follow-up for prescription: ${id}`);
          const result = await executor.followUp(id);
          console.log(`Verdict: ${result.verdict}`);
          console.log(`Time since applied: ${Math.round(result.timeSinceApplied / 1000)}s`);
          const improvement = result.comparison.improvement;
          const keys = Object.keys(improvement);
          if (keys.length > 0) {
            console.log(`Metric changes:`);
            for (const key of keys) {
              const delta = improvement[key];
              console.log(`  ${key}: ${delta.from} → ${delta.to} (${delta.changePercent.toFixed(1)}%)`);
            }
          }
        } else {
          // Check all pending follow-ups
          const store = createPrescriptionStore(db);
          const pending = store.getPendingFollowups();
          const due = pending.filter((f) => f.scheduledAt <= Date.now());

          if (due.length === 0) {
            console.log("No due follow-ups found.");
            return;
          }

          console.log(`Found ${due.length} due follow-up(s).`);
          for (const f of due) {
            console.log(`\nFollow-up for prescription: ${f.prescriptionId} (${f.checkpoint})`);
            try {
              const result = await executor.followUp(f.prescriptionId);
              console.log(`  Verdict: ${result.verdict}`);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(`  Failed: ${message}`);
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoc] rx followup failed: ${message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });

  // ─── rx history ───────────────────────────────────────────────────────────

  rx.command("history")
    .description("Show prescription history (non-pending)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const db = openDatabase(defaultDbPath());
      try {
        const store = createPrescriptionStore(db);
        // Query applied and rolled_back prescriptions
        const applied = store.queryPrescriptions({ status: "applied" });
        const rolledBack = store.queryPrescriptions({ status: "rolled_back" });
        const history = [...applied, ...rolledBack].sort((a, b) => {
          const aAt = (a as unknown as { appliedAt?: number }).appliedAt ?? 0;
          const bAt = (b as unknown as { appliedAt?: number }).appliedAt ?? 0;
          return aAt - bAt;
        });

        if (opts.json) {
          console.log(JSON.stringify(history, null, 2));
        } else {
          if (history.length === 0) {
            console.log("No prescription history found.");
            return;
          }
          console.log(`\nPrescription History (${history.length}):`);
          console.log("─".repeat(72));
          for (const p of history) {
            const status = (p as unknown as { status: string }).status ?? "applied";
            const appliedAt = (p as unknown as { appliedAt?: number }).appliedAt;
            const rolledBackAt = (p as unknown as { rolledBackAt?: number }).rolledBackAt;
            console.log(`  ID:     ${p.id}`);
            console.log(`  Level:  ${p.level}  Risk: ${p.risk}  Status: ${status}`);
            if (appliedAt) console.log(`  Applied: ${fmtTime(appliedAt)}`);
            if (rolledBackAt) console.log(`  Rolled back: ${fmtTime(rolledBackAt)}`);
            console.log("─".repeat(72));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoc] rx history failed: ${message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });
}
