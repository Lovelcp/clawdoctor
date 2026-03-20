// ═══════════════════════════════════════════════
//  Dashboard Command
//  Starts the ClawDoctor web dashboard
//  Design spec Phase 2, Task 12
// ═══════════════════════════════════════════════

import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Command } from "commander";
import { openDatabase } from "../store/database.js";
import { createScoreStore } from "../store/score-store.js";
import { loadConfig } from "../config/loader.js";
import { startDashboard } from "../dashboard/server.js";
import { runCheckup } from "../analysis/analysis-pipeline.js";

// ─── registerDashboardCommand ─────────────────────────────────────────────────

export function registerDashboardCommand(program: Command): void {
  program
    .command("dashboard")
    .description("Start web dashboard")
    .option("--port <port>", "Port number", "9800")
    .action(async (opts) => {
      try {
        const dbDir = join(homedir(), ".clawdoctor");
        mkdirSync(dbDir, { recursive: true });
        const dbPath = join(dbDir, "clawdoctor.db");
        const db = openDatabase(dbPath);

        const config = loadConfig(join(dbDir, "config.json"));

        // Check freshness — run checkup if stale (older than 1 hour)
        const scoreStore = createScoreStore(db);
        const latest = scoreStore.queryLatestScore("default");

        if (!latest || Date.now() - latest.timestamp > 3_600_000) {
          console.log("Running fresh checkup to populate dashboard data...");
          db.close();
          await runCheckup({
            agentId: "default",
            stateDir: join(homedir(), ".openclaw"),
            workspaceDir: process.cwd(),
            noLlm: !config.llm.enabled,
            dbPath,
          });
          // Reopen DB for dashboard after checkup closes it
          const freshDb = openDatabase(dbPath);
          const token = randomBytes(16).toString("hex");
          console.log(`\nDashboard: http://127.0.0.1:${opts.port}`);
          console.log(`Auth token: ${token}\n`);
          const stateDir = process.env.CLAWDOCTOR_STATE_DIR ?? join(homedir(), ".openclaw");
          await startDashboard({ db: freshDb, config, port: parseInt(opts.port, 10), authToken: token, stateDir, workspaceDir: process.cwd(), dbPath });
        } else {
          const token = randomBytes(16).toString("hex");
          console.log(`\nDashboard: http://127.0.0.1:${opts.port}`);
          console.log(`Auth token: ${token}\n`);
          const stateDir = process.env.CLAWDOCTOR_STATE_DIR ?? join(homedir(), ".openclaw");
          await startDashboard({ db, config, port: parseInt(opts.port, 10), authToken: token, stateDir, workspaceDir: process.cwd(), dbPath });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] dashboard failed: ${message}`);
        process.exit(1);
      }
    });
}
