// ═══════════════════════════════════════════════
//  Badge Command
//  clawdoctor badge — generate a Skill Quality Badge
//  Design spec: Phase 3, Task 1
// ═══════════════════════════════════════════════

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { Command } from "commander";
import { openDatabase } from "../store/database.js";
import { createScoreStore } from "../store/score-store.js";
import { scoreToGrade } from "../types/scoring.js";
import { generateBadge } from "../badge/badge-generator.js";
import { loadConfig } from "../config/loader.js";
import { tf } from "../i18n/i18n.js";
import { UI_STRINGS } from "../i18n/locales.js";

// ─── registerBadgeCommand ─────────────────────────────────────────────────────

export function registerBadgeCommand(program: Command): void {
  program
    .command("badge")
    .description("Generate a Skill Quality Badge SVG for the latest health score")
    .option("--agent <agentId>", "Agent ID", "default")
    .option("--output <file>", "Save badge SVG to file (e.g. badge.svg)")
    .option(
      "--format <format>",
      "Output format: svg (default) | markdown",
      "svg",
    )
    .option("--label <label>", "Badge label text", "ClawDoctor")
    .action(async (opts) => {
      try {
        const dbDir = join(homedir(), ".clawdoctor");
        mkdirSync(dbDir, { recursive: true });
        const dbPath = join(dbDir, "clawdoctor.db");
        const db = openDatabase(dbPath);
        const scoreStore = createScoreStore(db);

        const config = loadConfig(join(homedir(), ".clawdoctor", "config.json"));
        const locale = config.locale ?? "en";

        const agentId: string = opts.agent ?? "default";
        const latest = scoreStore.queryLatestScore(agentId);

        // Resolve grade/score from latest record (or N/A when no data)
        const score = latest?.overall ?? 0;
        const grade = scoreToGrade(latest?.overall ?? null);

        db.close();

        const svg = generateBadge({
          grade,
          score,
          label: opts.label ?? "ClawDoctor",
        });

        // ── Output handling ──

        const format: string = opts.format ?? "svg";

        if (format === "markdown") {
          const outputFile: string = opts.output ?? "badge.svg";
          // Also write the SVG file when markdown is requested
          const dir = dirname(outputFile);
          if (dir && dir !== ".") {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(outputFile, svg, "utf-8");
          const altText = `ClawDoctor: ${grade} ${grade === "N/A" ? "" : Math.round(score)}`.trim();
          process.stdout.write(`![${altText}](${outputFile})\n`);
          return;
        }

        // Default: SVG output
        if (opts.output) {
          const dir = dirname(opts.output as string);
          if (dir && dir !== ".") {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(opts.output as string, svg, "utf-8");
          process.stderr.write(tf(UI_STRINGS["badge.saved"], locale, { path: opts.output }) + "\n");
        } else {
          process.stdout.write(svg + "\n");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[clawdoctor] badge failed: ${message}\n`);
        process.exit(1);
      }
    });
}
