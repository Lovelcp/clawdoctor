// ═══════════════════════════════════════════════
//  Cost Command
//  clawinsight cost report — focused cost department checkup
//  Supports --by model | --by tool breakdowns
// ═══════════════════════════════════════════════

import { Command } from "commander";
import { runDeptCheckup } from "./dept-runner.js";

export function registerCostCommand(program: Command): void {
  const cost = program
    .command("cost")
    .description("Cost Metabolism health diagnostics");

  cost
    .command("report")
    .description("Run a focused cost department checkup")
    .option("--agent <agentId>", "Agent ID", "default")
    .option("--since <duration>", "Data time range (e.g., 7d, 30d)", "7d")
    .option("--by <grouping>", "Group cost breakdown (model | tool)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      if (opts.by && opts.by !== "model" && opts.by !== "tool") {
        console.error(`[clawinsight] --by must be "model" or "tool", got: ${opts.by as string}`);
        process.exit(1);
      }
      await runDeptCheckup("cost", opts);
    });
}
