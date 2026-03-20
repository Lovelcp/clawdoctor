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
import { t, tf } from "../i18n/i18n.js";
import { UI_STRINGS } from "../i18n/locales.js";

// ─── Helper: resolve default DB path ─────────────────────────────────────────

function defaultDbPath(): string {
  return join(homedir(), ".clawdoctor", "clawdoctor.db");
}

function defaultConfigPath(): string {
  return join(homedir(), ".clawdoctor", "config.json");
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
        const config = loadConfig(defaultConfigPath());
        const locale = config.locale ?? "en";
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
            console.log(t(UI_STRINGS["rx.noPrescriptions"], locale));
            return;
          }
          console.log(`\n${tf(UI_STRINGS["rx.prescriptionCount"], locale, { count: prescriptions.length })}`);
          console.log("─".repeat(72));
          for (const p of prescriptions) {
            const status = (p as unknown as { status: string }).status ?? "pending";
            const appliedAt = (p as unknown as { appliedAt?: number }).appliedAt;
            const rolledBackAt = (p as unknown as { rolledBackAt?: number }).rolledBackAt;
            console.log(`  ${t(UI_STRINGS["rx.labelId"], locale)}      ${p.id}`);
            console.log(`  ${t(UI_STRINGS["rx.labelLevel"], locale)}   ${p.level}  ${t(UI_STRINGS["rx.labelRisk"], locale)} ${p.risk}  ${t(UI_STRINGS["rx.labelStatus"], locale)} ${status}`);
            console.log(`  ${t(UI_STRINGS["rx.labelActions"], locale)} ${p.actions.length}`);
            if (appliedAt) console.log(`  ${t(UI_STRINGS["rx.labelApplied"], locale)} ${fmtTime(appliedAt)}`);
            if (rolledBackAt) console.log(`  ${t(UI_STRINGS["rx.labelRolledBack"], locale)} ${fmtTime(rolledBackAt)}`);
            console.log("─".repeat(72));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] rx list failed: ${message}`);
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
        const locale = config.locale ?? "en";
        const executor = createPrescriptionExecutor(db, config);
        const preview = await executor.preview(id);

        console.log(`\n${tf(UI_STRINGS["rx.preview"], locale, { id })}`);
        console.log(`${t(UI_STRINGS["rx.diagnosis"], locale)} ${t(preview.diagnosisName, locale)}`);
        console.log(`${t(UI_STRINGS["rx.estimatedImprovement"], locale)} ${JSON.stringify(preview.estimatedImprovement)}`);
        console.log(`${t(UI_STRINGS["rx.rollbackAvailable"], locale)} ${preview.rollbackAvailable}`);
        console.log(`\n${tf(UI_STRINGS["rx.actionsCount"], locale, { count: preview.actions.length })}`);
        console.log("─".repeat(72));
        for (const action of preview.actions) {
          console.log(`  ${t(UI_STRINGS["rx.labelType"], locale)} ${action.type}  ${t(UI_STRINGS["rx.labelRisk"], locale)} ${action.risk}`);
          console.log(`  ${t(action.description, locale)}`);
          if ("diff" in action && action.diff) {
            console.log(`  ${t(UI_STRINGS["rx.labelDiff"], locale)}\n${action.diff}`);
          }
          if ("command" in action && action.command) {
            console.log(`  ${t(UI_STRINGS["rx.labelCommand"], locale)} ${action.command}`);
          }
          console.log("─".repeat(72));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] rx preview failed: ${message}`);
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
        const locale = config.locale ?? "en";
        const executor = createPrescriptionExecutor(db, config);

        if (opts.all) {
          // Apply all pending guided (non-manual) prescriptions
          const store = createPrescriptionStore(db);
          const pending = store.queryPrescriptions({ status: "pending" }).filter(
            (p) => p.level === "guided",
          );

          if (pending.length === 0) {
            console.log(t(UI_STRINGS["rx.noPendingGuided"], locale));
            return;
          }

          console.log(tf(UI_STRINGS["rx.pendingGuidedCount"], locale, { count: pending.length }));

          for (const p of pending) {
            if (opts.dryRun) {
              console.log(`\n${tf(UI_STRINGS["rx.previewDryRun"], locale, { id: p.id })}`);
              const preview = await executor.preview(p.id);
              console.log(`  ${t(UI_STRINGS["rx.diagnosis"], locale)} ${t(preview.diagnosisName, locale)}`);
              for (const action of preview.actions) {
                console.log(`  - ${action.type}: ${t(action.description, locale)}`);
              }
            } else {
              console.log(`\n${tf(UI_STRINGS["rx.applyingPrescription"], locale, { id: p.id })}`);
              const result = await executor.execute(p.id);
              console.log(`  ${t(UI_STRINGS["rx.success"], locale)} ${result.success}`);
              for (const a of result.appliedActions) {
                console.log(`  - ${a.action.type}: ${a.status}${a.error ? ` (${a.error})` : ""}`);
              }
            }
          }
        } else if (id) {
          if (opts.dryRun) {
            const preview = await executor.preview(id);
            console.log(`\n${tf(UI_STRINGS["rx.previewDryRun"], locale, { id })}`);
            console.log(`  ${t(UI_STRINGS["rx.diagnosis"], locale)} ${t(preview.diagnosisName, locale)}`);
            for (const action of preview.actions) {
              console.log(`  - ${action.type}: ${t(action.description, locale)}`);
            }
          } else {
            console.log(tf(UI_STRINGS["rx.applyingPrescription"], locale, { id }));
            const result = await executor.execute(id);
            console.log(`${t(UI_STRINGS["rx.success"], locale)} ${result.success}`);
            for (const a of result.appliedActions) {
              console.log(`  - ${a.action.type}: ${a.status}${a.error ? ` (${a.error})` : ""}`);
            }
            if (result.immediateVerification) {
              console.log(`\n${t(UI_STRINGS["rx.verification"], locale)} ${result.immediateVerification.currentStatus}`);
              if (result.immediateVerification.note) {
                console.log(`  ${t(result.immediateVerification.note, locale)}`);
              }
            }
          }
        } else {
          console.error(t(UI_STRINGS["rx.provideIdOrAll"], locale));
          process.exit(1);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] rx apply failed: ${message}`);
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
        const locale = config.locale ?? "en";
        const executor = createPrescriptionExecutor(db, config);

        console.log(tf(UI_STRINGS["rx.rollingBack"], locale, { id }));
        const result = await executor.rollback(id);
        console.log(`${t(UI_STRINGS["rx.success"], locale)} ${result.success}`);
        if (result.restoredFiles.length > 0) {
          console.log(t(UI_STRINGS["rx.restoredFiles"], locale));
          for (const f of result.restoredFiles) {
            console.log(`  - ${f}`);
          }
        }
        if (result.skippedFiles.length > 0) {
          console.log(t(UI_STRINGS["rx.skippedFiles"], locale));
          for (const f of result.skippedFiles) {
            console.log(`  - ${f}`);
          }
        }
        if (result.conflicts && result.conflicts.length > 0) {
          console.log(t(UI_STRINGS["rx.conflicts"], locale));
          for (const c of result.conflicts) {
            console.log(`  - ${c}`);
          }
        }
        if (result.error) {
          console.error(tf(UI_STRINGS["rx.error"], locale, { message: result.error }));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] rx rollback failed: ${message}`);
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
        const locale = config.locale ?? "en";
        const executor = createPrescriptionExecutor(db, config);

        if (id) {
          console.log(tf(UI_STRINGS["rx.runningFollowUp"], locale, { id }));
          const result = await executor.followUp(id);
          console.log(`${t(UI_STRINGS["rx.verdict"], locale)} ${result.verdict}`);
          console.log(tf(UI_STRINGS["rx.timeSinceApplied"], locale, { seconds: Math.round(result.timeSinceApplied / 1000) }));
          const improvement = result.comparison.improvement;
          const keys = Object.keys(improvement);
          if (keys.length > 0) {
            console.log(t(UI_STRINGS["rx.metricChanges"], locale));
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
            console.log(t(UI_STRINGS["rx.noDueFollowups"], locale));
            return;
          }

          console.log(tf(UI_STRINGS["rx.dueFollowups"], locale, { count: due.length }));
          for (const f of due) {
            console.log(`\n${tf(UI_STRINGS["rx.followUpCheckpoint"], locale, { id: f.prescriptionId, checkpoint: f.checkpoint })}`);
            try {
              const result = await executor.followUp(f.prescriptionId);
              console.log(`  ${t(UI_STRINGS["rx.verdict"], locale)} ${result.verdict}`);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(`  ${tf(UI_STRINGS["rx.failed"], locale, { message })}`);
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] rx followup failed: ${message}`);
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
        const config = loadConfig(defaultConfigPath());
        const locale = config.locale ?? "en";
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
            console.log(t(UI_STRINGS["rx.noHistory"], locale));
            return;
          }
          console.log(`\n${tf(UI_STRINGS["rx.historyCount"], locale, { count: history.length })}`);
          console.log("─".repeat(72));
          for (const p of history) {
            const status = (p as unknown as { status: string }).status ?? "applied";
            const appliedAt = (p as unknown as { appliedAt?: number }).appliedAt;
            const rolledBackAt = (p as unknown as { rolledBackAt?: number }).rolledBackAt;
            console.log(`  ${t(UI_STRINGS["rx.labelId"], locale)}     ${p.id}`);
            console.log(`  ${t(UI_STRINGS["rx.labelLevel"], locale)}  ${p.level}  ${t(UI_STRINGS["rx.labelRisk"], locale)} ${p.risk}  ${t(UI_STRINGS["rx.labelStatus"], locale)} ${status}`);
            if (appliedAt) console.log(`  ${t(UI_STRINGS["rx.labelApplied"], locale)} ${fmtTime(appliedAt)}`);
            if (rolledBackAt) console.log(`  ${t(UI_STRINGS["rx.labelRolledBack"], locale)} ${fmtTime(rolledBackAt)}`);
            console.log("─".repeat(72));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] rx history failed: ${message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });
}
