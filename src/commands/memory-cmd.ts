// ═══════════════════════════════════════════════
//  Memory Command
//  clawinsight memory scan — focused memory department checkup
// ═══════════════════════════════════════════════

import { Command } from "commander";
import { runDeptCheckup } from "./dept-runner.js";

export function registerMemoryCommand(program: Command): void {
  const memory = program
    .command("memory")
    .description("Memory Cognition health diagnostics");

  memory
    .command("scan")
    .description("Run a focused memory department checkup")
    .option("--agent <agentId>", "Agent ID", "default")
    .option("--since <duration>", "Data time range (e.g., 7d, 30d)", "7d")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await runDeptCheckup("memory", opts);
    });
}
