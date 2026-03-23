// ═══════════════════════════════════════════════
//  Chart Command
//  clawdoc chart — query and display audit trail
// ═══════════════════════════════════════════════

import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { openDatabase } from "../store/database.js";
import { createChartStore } from "../chart/chart-store.js";
import { loadConfig } from "../config/loader.js";
import { t } from "../i18n/i18n.js";
import { UI_STRINGS } from "../i18n/locales.js";
import type { ChartFilter } from "../chart/chart-store.js";
import type { ChartOutcome } from "../types/monitor.js";

// ─── Parse --since date flag ───

function parseSinceDate(since: string): number | undefined {
  // Try ISO date format
  const dateMs = Date.parse(since);
  if (!isNaN(dateMs)) return dateMs;

  // Try duration format: "7d", "24h"
  const match = since.match(/^(\d+)(d|h|m)$/i);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    switch (unit) {
      case "d":
        return Date.now() - value * 86_400_000;
      case "h":
        return Date.now() - value * 3_600_000;
      case "m":
        return Date.now() - value * 60_000;
    }
  }

  return undefined;
}

// ─── Format timestamp for display ───

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

// ─── Pad string to width ───

function pad(str: string, width: number): string {
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
}

// ─── Register chart command ───

export function registerChartCommand(program: Command): void {
  program
    .command("chart")
    .description("Query monitor audit trail (chart entries)")
    .option("-n, --limit <limit>", "Maximum entries to display", "20")
    .option("--probe <probeId>", "Filter by probe ID")
    .option("--outcome <outcome>", "Filter by outcome (success, failed, skipped, expired, cancelled)")
    .option("--since <date>", "Filter entries since date (ISO or duration: 7d, 24h)")
    .option("--json", "Output as JSON")
    .action((opts) => {
      try {
        const configFilePath = join(homedir(), ".clawdoctor", "config.json");
        const config = loadConfig(configFilePath);
        const locale = config.locale ?? "en";

        const dbPath = join(homedir(), ".clawdoctor", "clawdoctor.db");
        if (!existsSync(dbPath)) {
          console.log(t(UI_STRINGS["chart.noData"], locale));
          return;
        }

        const db = openDatabase(dbPath);
        const chartStore = createChartStore(db);

        const filter: ChartFilter = {
          limit: parseInt(opts.limit as string, 10) || 20,
          probeId: opts.probe as string | undefined,
          outcome: opts.outcome as ChartOutcome | undefined,
          since: opts.since ? parseSinceDate(opts.since as string) : undefined,
        };

        const entries = chartStore.query(filter);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
          db.close();
          return;
        }

        if (entries.length === 0) {
          console.log(t(UI_STRINGS["chart.noEntries"], locale));
          db.close();
          return;
        }

        // Table header
        const header = [
          pad(t(UI_STRINGS["chart.colTime"], locale), 19),
          pad(t(UI_STRINGS["chart.colProbe"], locale), 10),
          pad(t(UI_STRINGS["chart.colDisease"], locale), 12),
          pad(t(UI_STRINGS["chart.colAction"], locale), 16),
          pad(t(UI_STRINGS["chart.colOutcome"], locale), 10),
          pad(t(UI_STRINGS["chart.colTriage"], locale), 8),
        ].join(" | ");

        console.log(header);
        console.log("-".repeat(header.length));

        for (const entry of entries) {
          const row = [
            pad(formatTimestamp(entry.timestamp), 19),
            pad(entry.probeId ?? "-", 10),
            pad(entry.diseaseId ?? "-", 12),
            pad(entry.action, 16),
            pad(entry.outcome, 10),
            pad(entry.triageLevel ?? "-", 8),
          ].join(" | ");
          console.log(row);
        }

        console.log(`\n${entries.length} ${t(UI_STRINGS["chart.entriesShown"], locale)}`);

        db.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] chart failed: ${message}`);
        process.exit(1);
      }
    });
}
