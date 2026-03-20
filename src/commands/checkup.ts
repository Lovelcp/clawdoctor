// ═══════════════════════════════════════════════
//  Checkup Command
//  Runs full or department-scoped health analysis
//  and renders result to stdout (terminal or JSON).
// ═══════════════════════════════════════════════

import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCheckup } from "../analysis/analysis-pipeline.js";
import { renderReport } from "../report/terminal-report.js";
import { buildReportViewModel } from "./report-builder.js";
import { loadPlugins } from "../plugins/plugin-loader.js";
import { openDatabase } from "../store/database.js";
import { createPrescriptionExecutor } from "../prescription/prescription-executor.js";
import { filterAutoApplicable } from "../prescription/auto-apply.js";
import { loadConfig } from "../config/loader.js";
import { tf } from "../i18n/i18n.js";
import { UI_STRINGS } from "../i18n/locales.js";
import type { Department } from "../types/domain.js";
import type { CheckupOptions } from "../analysis/analysis-pipeline.js";

// ─── Helper: parse "7d", "30d", "24h" → unix ms timestamp ────────────────────

export function parseSince(since: string): number {
  const match = since.match(/^(\d+)(d|h|m)$/i);
  if (!match) {
    // Fallback: try to parse as plain number of days
    const days = parseInt(since, 10);
    if (!isNaN(days)) {
      return Date.now() - days * 24 * 60 * 60 * 1000;
    }
    // Default to 7 days if unparseable
    return Date.now() - 7 * 24 * 60 * 60 * 1000;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "d": return Date.now() - value * 24 * 60 * 60 * 1000;
    case "h": return Date.now() - value * 60 * 60 * 1000;
    case "m": return Date.now() - value * 60 * 1000;
    default:  return Date.now() - 7 * 24 * 60 * 60 * 1000;
  }
}

// ─── determineExitCode ────────────────────────────────────────────────────────

export function determineExitCode(
  diseases: Array<{ severity: string }>,
  failOn?: string,
): number {
  if (!failOn) return 0;
  const severityRank: Record<string, number> = { info: 1, warning: 2, critical: 3 };
  const threshold = severityRank[failOn] ?? 3;
  const hasFailure = diseases.some(d => (severityRank[d.severity] ?? 0) >= threshold);
  return hasFailure ? 1 : 0;
}

// ─── registerCheckupCommand ───────────────────────────────────────────────────

export function registerCheckupCommand(program: Command): void {
  program
    .command("checkup")
    .description("Run health checkup on your OpenClaw agent")
    .option("--dept <departments>", "Focus on specific departments (comma-separated)")
    .option("--since <duration>", "Data time range (e.g., 7d, 30d)", "7d")
    .option("--no-llm", "Rules only, no LLM analysis")
    .option("--json", "Output as JSON")
    .option("--agent <agentId>", "Agent ID", "default")
    .option("--fail-on <severity>", "Exit with code 1 if diseases at or above this severity (critical, warning, info)")
    .option("--plugins <list>", "Comma-separated list of community plugin package names to load")
    .option("--auto-fix", "Auto-apply low-risk prescriptions after checkup")
    .action(async (opts) => {
      try {
        const stateDir = process.env.CLAWDOCTOR_STATE_DIR ?? join(homedir(), ".openclaw");
        const workspaceDir = process.env.CLAWDOCTOR_WORKSPACE_DIR ?? process.cwd();

        const since = parseSince(opts.since ?? "7d");

        const departments: Department[] | undefined = opts.dept
          ? (opts.dept as string).split(",").map((d: string) => d.trim() as Department)
          : undefined;

        // ── Load community plugins (CLI flag + config file) ─────────────────
        const configFilePath = join(homedir(), ".clawdoctor", "config.json");
        const config = loadConfig(configFilePath);
        const cliPlugins: string[] = opts.plugins
          ? (opts.plugins as string).split(",").map((p: string) => p.trim()).filter(Boolean)
          : [];
        const configPlugins: string[] = config.plugins ?? [];
        const allPluginNames = [...new Set([...cliPlugins, ...configPlugins])];
        const plugins = allPluginNames.length > 0 ? await loadPlugins(allPluginNames) : [];

        const checkupOpts: CheckupOptions = {
          agentId: opts.agent ?? "default",
          stateDir,
          workspaceDir,
          since,
          noLlm: opts.llm === false,
          departments,
          plugins: plugins.length > 0 ? plugins : undefined,
        };

        const result = await runCheckup(checkupOpts);

        const locale = config.locale ?? "en";

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const sinceDate = new Date(since);
          const nowDate = new Date();
          const dateRange = `${sinceDate.toISOString().slice(0, 10)} ~ ${nowDate.toISOString().slice(0, 10)}`;

          const viewModel = buildReportViewModel(
            result,
            opts.agent ?? "default",
            dateRange,
            departments,
            locale,
          );
          const report = renderReport(viewModel, locale);
          console.log(report);
        }

        process.exitCode = determineExitCode(result.diseases, opts.failOn);

        if (opts.autoFix && result.prescriptions?.length) {
          const { autoApplyPrescriptions } = await import("../prescription/auto-apply.js");
          const applicable = filterAutoApplicable(result.prescriptions);
          if (applicable.length > 0) {
            console.log("\n" + tf(UI_STRINGS["cli.autoApplying"], locale, { count: applicable.length }));
            const dbPath = join(homedir(), ".clawdoctor", "clawdoctor.db");
            const db = openDatabase(dbPath);
            const executor = createPrescriptionExecutor(db, config);
            const autoResult = await autoApplyPrescriptions(applicable, executor);
            for (const r of autoResult.results) {
              console.log(r.success ? `  ✓ ${r.prescriptionId}: applied` : `  ✗ ${r.prescriptionId}: ${r.error}`);
            }
            console.log("\n" + tf(UI_STRINGS["cli.autoFixSummary"], locale, { applied: autoResult.applied, failed: autoResult.failed }));
            db.close();
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] checkup failed: ${message}`);
        process.exit(1);
      }
    });
}
