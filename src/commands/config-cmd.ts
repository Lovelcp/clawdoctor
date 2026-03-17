// ═══════════════════════════════════════════════
//  Config Command
//  clawdoc config init | set <key> <value> | show
// ═══════════════════════════════════════════════

import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../types/config.js";
import { loadConfig } from "../config/loader.js";

const CONFIG_DIR = join(homedir(), ".clawdoc");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// ─── registerConfigCommand ────────────────────────────────────────────────────

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Manage ClawDoc configuration");

  // clawdoc config init
  config
    .command("init")
    .description("Create ~/.clawdoc/config.json with default settings")
    .action(() => {
      try {
        if (existsSync(CONFIG_FILE)) {
          console.log(`[clawdoc] Config already exists at ${CONFIG_FILE}`);
          return;
        }

        if (!existsSync(CONFIG_DIR)) {
          mkdirSync(CONFIG_DIR, { recursive: true });
        }

        writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
        console.log(`[clawdoc] Config initialized at ${CONFIG_FILE}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoc] config init failed: ${message}`);
        process.exit(1);
      }
    });

  // clawdoc config set <key> <value>
  config
    .command("set <key> <value>")
    .description("Update a key in the config file (dot-notation, e.g. llm.enabled)")
    .action((key: string, value: string) => {
      try {
        if (!existsSync(CONFIG_DIR)) {
          mkdirSync(CONFIG_DIR, { recursive: true });
        }

        // Read existing config (or start from defaults)
        let existing: Record<string, unknown>;
        if (existsSync(CONFIG_FILE)) {
          const raw = readFileSync(CONFIG_FILE, "utf-8");
          try {
            existing = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            existing = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, unknown>;
          }
        } else {
          existing = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, unknown>;
        }

        // Parse value: try JSON, fall back to string
        let parsedValue: unknown;
        try {
          parsedValue = JSON.parse(value);
        } catch {
          parsedValue = value;
        }

        // Set nested key using dot notation
        setNestedKey(existing, key, parsedValue);

        writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2) + "\n", "utf-8");
        console.log(`[clawdoc] Set ${key} = ${JSON.stringify(parsedValue)}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoc] config set failed: ${message}`);
        process.exit(1);
      }
    });

  // clawdoc config show
  config
    .command("show")
    .description("Print the current effective config as JSON")
    .action(() => {
      try {
        const cfg = loadConfig(CONFIG_FILE);
        console.log(JSON.stringify(cfg, null, 2));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoc] config show failed: ${message}`);
        process.exit(1);
      }
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setNestedKey(obj: Record<string, unknown>, dotKey: string, value: unknown): void {
  const parts = dotKey.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}
