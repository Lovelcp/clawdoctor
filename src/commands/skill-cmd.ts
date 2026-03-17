// ═══════════════════════════════════════════════
//  Skill Command
//  clawdoc skill list — focused skill department checkup
// ═══════════════════════════════════════════════

import { Command } from "commander";
import { runDeptCheckup } from "./dept-runner.js";

export function registerSkillCommand(program: Command): void {
  const skill = program
    .command("skill")
    .description("Skill & Tool health diagnostics");

  skill
    .command("list")
    .description("Run a focused skill department checkup")
    .option("--agent <agentId>", "Agent ID", "default")
    .option("--since <duration>", "Data time range (e.g., 7d, 30d)", "7d")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await runDeptCheckup("skill", opts);
    });
}
