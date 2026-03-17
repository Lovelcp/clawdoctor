#!/usr/bin/env node
import { Command } from "commander";
import { registerCheckupCommand } from "./commands/checkup.js";
import { registerConfigCommand } from "./commands/config-cmd.js";
import { registerSkillCommand } from "./commands/skill-cmd.js";
import { registerMemoryCommand } from "./commands/memory-cmd.js";
import { registerCostCommand } from "./commands/cost-cmd.js";
import { registerBehaviorCommand } from "./commands/behavior-cmd.js";
import { registerSecurityCommand } from "./commands/security-cmd.js";

const program = new Command();
program.name("clawdoc").description("Health diagnostics for OpenClaw agents").version("0.1.0");

registerCheckupCommand(program);
registerConfigCommand(program);
registerSkillCommand(program);
registerMemoryCommand(program);
registerCostCommand(program);
registerBehaviorCommand(program);
registerSecurityCommand(program);

program.parse();
