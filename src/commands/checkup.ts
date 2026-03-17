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
    .action(async (opts) => {
      try {
        const stateDir = process.env.CLAWDOC_STATE_DIR ?? join(homedir(), ".openclaw");
        const workspaceDir = process.env.CLAWDOC_WORKSPACE_DIR ?? process.cwd();

        const since = parseSince(opts.since ?? "7d");

        const departments: Department[] | undefined = opts.dept
          ? (opts.dept as string).split(",").map((d: string) => d.trim() as Department)
          : undefined;

        const checkupOpts: CheckupOptions = {
          agentId: opts.agent ?? "default",
          stateDir,
          workspaceDir,
          since,
          noLlm: opts.llm === false,
          departments,
        };

        const result = await runCheckup(checkupOpts);

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
          );
          const report = renderReport(viewModel, "en");
          console.log(report);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoc] checkup failed: ${message}`);
        process.exit(1);
      }
    });
}
