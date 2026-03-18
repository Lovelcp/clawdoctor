// ═══════════════════════════════════════════════
//  ClawDoc OpenClaw Plugin Entry Point
//  Design spec: Phase 2, Task 8
// ═══════════════════════════════════════════════

import { homedir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../store/database.js";
import { createEventStore } from "../store/event-store.js";
import { createEventBuffer } from "./event-buffer.js";
import { registerStreamCollector } from "./stream-collector.js";
import { createDashboardApp } from "../dashboard/server.js";
import { loadConfig } from "../config/loader.js";
import { registerCheckupCommand } from "../commands/checkup.js";
import { registerConfigCommand } from "../commands/config-cmd.js";
import { registerSkillCommand } from "../commands/skill-cmd.js";
import { registerMemoryCommand } from "../commands/memory-cmd.js";
import { registerCostCommand } from "../commands/cost-cmd.js";
import { registerBehaviorCommand } from "../commands/behavior-cmd.js";
import { registerSecurityCommand } from "../commands/security-cmd.js";
import type { OpenClawPluginDefinition, OpenClawPluginApi } from "./openclaw-types.js";
import type { EventBuffer } from "./event-buffer.js";
import type { EventStore } from "../store/event-store.js";
import type Database from "better-sqlite3";

// ─── Snapshot interval (30 min) ──────────────────────────────────────────────

const SNAPSHOT_INTERVAL_MS = 30 * 60 * 1000;

// ─── Follow-up poll interval (10 min) ────────────────────────────────────────

const FOLLOWUP_INTERVAL_MS = 10 * 60 * 1000;

// ─── Plugin definition ────────────────────────────────────────────────────────

export const clawdocPlugin: OpenClawPluginDefinition = {
  id: "clawdoc",
  name: "ClawDoc",
  description: "Agent health diagnostics",

  register(api: OpenClawPluginApi) {
    // 1. Open persistent SQLite at ~/.clawdoc/clawdoc.db
    const dbPath = join(homedir(), ".clawdoc", "clawdoc.db");
    let db: Database.Database;
    try {
      db = openDatabase(dbPath);
    } catch (err) {
      api.logger.error(`[clawdoc] Failed to open database at ${dbPath}: ${err}`);
      return;
    }

    // 2. Create event store + event buffer (maxSize: 100, flushIntervalMs: 5000)
    const eventStore: EventStore = createEventStore(db);
    const buffer: EventBuffer = createEventBuffer({
      maxSize: 100,
      flushIntervalMs: 5000,
      onFlush(events) {
        for (const event of events) {
          try {
            eventStore.insertEvent(event);
          } catch (err) {
            api.logger.warn(`[clawdoc] Failed to persist event ${event.id}: ${err}`);
          }
        }
      },
    });

    // 3. Register stream collector hooks
    registerStreamCollector(api, buffer);

    // 4. Register periodic snapshot service (30min, with stop() cleanup)
    let snapshotIntervalId: ReturnType<typeof setInterval> | undefined;

    api.registerService({
      id: "clawdoc-snapshot",
      start(_ctx) {
        api.logger.info("[clawdoc] Snapshot service started (interval: 30min)");
        snapshotIntervalId = setInterval(() => {
          api.logger.info("[clawdoc] Periodic snapshot tick");
          // Snapshot collection (plugin_snapshot, memory_snapshot, config_snapshot)
          // is deferred to Task 9 (snapshot collector); this service registers the
          // interval so the infrastructure is in place.
        }, SNAPSHOT_INTERVAL_MS);
      },
      stop(_ctx) {
        if (snapshotIntervalId !== undefined) {
          clearInterval(snapshotIntervalId);
          snapshotIntervalId = undefined;
        }
        // Flush any remaining buffered events on shutdown.
        buffer.stop();
        api.logger.info("[clawdoc] Snapshot service stopped, buffer flushed");
      },
    });

    // 5. Register follow-up scheduler service (10min, check pending followups)
    let followupIntervalId: ReturnType<typeof setInterval> | undefined;

    api.registerService({
      id: "clawdoc-followup-scheduler",
      start(_ctx) {
        api.logger.info("[clawdoc] Follow-up scheduler started (interval: 10min)");
        followupIntervalId = setInterval(() => {
          try {
            const now = Date.now();
            // Find pending follow-ups whose scheduled_at has passed.
            const pending = db.prepare(`
              SELECT id, prescription_id, checkpoint, scheduled_at
              FROM followups
              WHERE completed_at IS NULL AND scheduled_at <= ?
            `).all(now) as Array<{
              id: string;
              prescription_id: string;
              checkpoint: string;
              scheduled_at: number;
            }>;

            for (const row of pending) {
              api.logger.info(
                `[clawdoc] Follow-up due: ${row.id} (prescription: ${row.prescription_id}, checkpoint: ${row.checkpoint})`,
              );
              // Full follow-up evaluation is deferred to Task 10 (executor/evaluator).
              // For now we log them so operators can see what's pending.
            }
          } catch (err) {
            api.logger.warn(`[clawdoc] Follow-up scheduler tick failed: ${err}`);
          }
        }, FOLLOWUP_INTERVAL_MS);
      },
      stop(_ctx) {
        if (followupIntervalId !== undefined) {
          clearInterval(followupIntervalId);
          followupIntervalId = undefined;
        }
        api.logger.info("[clawdoc] Follow-up scheduler stopped");
      },
    });

    // 6. Register CLI subcommands
    api.registerCli((ctx: any) => {
      const program = ctx?.program;
      if (!program) {
        api.logger.warn("[clawdoc] CLI context missing program; skipping CLI registration");
        return;
      }

      // Register all clawdoc CLI subcommands under the openclaw CLI.
      const clawdocCmd = program
        .command("clawdoc")
        .description("ClawDoc — agent health diagnostics");

      registerCheckupCommand(clawdocCmd);
      registerConfigCommand(clawdocCmd);
      registerSkillCommand(clawdocCmd);
      registerMemoryCommand(clawdocCmd);
      registerCostCommand(clawdocCmd);
      registerBehaviorCommand(clawdocCmd);
      registerSecurityCommand(clawdocCmd);
    });

    // 7. Register dashboard HTTP route (/clawdoc/*)
    api.registerHttpRoute({
      path: "/clawdoc",
      match: "prefix",
      auth: "plugin",
      handler: async (req: any, res: any) => {
        try {
          const configPath = join(homedir(), ".clawdoc", "clawdoc.json");
          const config = loadConfig(configPath);
          const app = createDashboardApp({ db, config });

          // Strip the /clawdoc prefix so the inner Hono app sees its own routes.
          const url = new URL(req.url, `http://${req.headers?.host ?? "localhost"}`);
          const stripped = url.pathname.replace(/^\/clawdoc/, "") || "/";
          const proxiedUrl = `${stripped}${url.search}`;

          const honoReq = new Request(
            new URL(proxiedUrl, `http://${req.headers?.host ?? "localhost"}`),
            {
              method: req.method,
              headers: req.headers as HeadersInit,
            },
          );

          const honoRes = await app.fetch(honoReq);

          res.statusCode = honoRes.status;
          honoRes.headers.forEach((value: string, key: string) => {
            res.setHeader(key, value);
          });

          const body = await honoRes.arrayBuffer();
          res.end(Buffer.from(body));
          return true;
        } catch (err) {
          api.logger.error(`[clawdoc] Dashboard route error: ${err}`);
          res.statusCode = 500;
          res.end("Internal Server Error");
          return true;
        }
      },
    });

    api.logger.info("[clawdoc] Plugin registered successfully");
  },
};
