// ═══════════════════════════════════════════════
//  Security Command
//  clawdoc security audit — focused security department checkup
// ═══════════════════════════════════════════════

import { Command } from "commander";
import { runDeptCheckup } from "./dept-runner.js";

export function registerSecurityCommand(program: Command): void {
  const security = program
    .command("security")
    .description("Security Immunity health diagnostics");

  security
    .command("audit")
    .description("Run a focused security department checkup")
    .option("--agent <agentId>", "Agent ID", "default")
    .option("--since <duration>", "Data time range (e.g., 7d, 30d)", "7d")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await runDeptCheckup("security", opts);
    });
}
