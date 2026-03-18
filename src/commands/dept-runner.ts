// ═══════════════════════════════════════════════
//  Department Runner — shared logic for all
//  single-department focused checkup commands.
// ═══════════════════════════════════════════════

import { homedir } from "node:os";
import { join } from "node:path";
import { runCheckup } from "../analysis/analysis-pipeline.js";
import { renderReport } from "../report/terminal-report.js";
import { buildReportViewModel } from "./report-builder.js";
import { parseSince } from "./checkup.js";
import type { Department } from "../types/domain.js";
import type { CheckupOptions } from "../analysis/analysis-pipeline.js";

export interface DeptRunOptions {
  agent?: string;
  since?: string;
  json?: boolean;
  // Cost-specific
  by?: string;
}

export async function runDeptCheckup(
  department: Department,
  opts: DeptRunOptions,
): Promise<void> {
  try {
    const stateDir = join(homedir(), ".openclaw");
    const workspaceDir = process.cwd();
    const since = parseSince(opts.since ?? "7d");
    const agentId = opts.agent ?? "default";

    const checkupOpts: CheckupOptions = {
      agentId,
      stateDir,
      workspaceDir,
      since,
      noLlm: true,
      departments: [department],
    };

    const result = await runCheckup(checkupOpts);

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const sinceDate = new Date(since);
    const nowDate = new Date();
    const dateRange = `${sinceDate.toISOString().slice(0, 10)} ~ ${nowDate.toISOString().slice(0, 10)}`;

    const viewModel = buildReportViewModel(
      result,
      agentId,
      dateRange,
      [department],
    );

    const report = renderReport(viewModel, "en");
    console.log(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[clawdoctor] ${department} checkup failed: ${message}`);
    process.exit(1);
  }
}
