// ═══════════════════════════════════════════════
//  Behavior Command
//  clawdoctor behavior report — focused behavior department checkup
// ═══════════════════════════════════════════════

import { Command } from "commander";
import { runDeptCheckup } from "./dept-runner.js";

export function registerBehaviorCommand(program: Command): void {
  const behavior = program
    .command("behavior")
    .description("Agent Behavior health diagnostics");

  behavior
    .command("report")
    .description("Run a focused behavior department checkup")
    .option("--agent <agentId>", "Agent ID", "default")
    .option("--since <duration>", "Data time range (e.g., 7d, 30d)", "7d")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await runDeptCheckup("behavior", opts);
    });
}
