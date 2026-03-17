#!/usr/bin/env node
import { Command } from "commander";
const program = new Command();
program.name("clawdoc").description("Health diagnostics for OpenClaw agents").version("0.1.0");
program.parse();
