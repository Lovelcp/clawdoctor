// ═══════════════════════════════════════════════
//  Monitor Command
//  clawdoc monitor start/stop/status
// ═══════════════════════════════════════════════

import { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { loadConfig } from "../config/loader.js";
import { createMonitorEngine } from "../monitor/monitor-engine.js";
import {
  readMonitorState,
  isProcessRunning,
} from "../monitor/monitor-state.js";
import { openDatabase } from "../store/database.js";
import { t } from "../i18n/i18n.js";
import { UI_STRINGS } from "../i18n/locales.js";
import type { ShellExecutor, ShellResult } from "../monitor/probe.js";
import type { PageChannel } from "../page/page-channel.js";
import type { ClawDoctorConfig } from "../types/config.js";

// ─── Real shell executor using child_process.execFile ───

function createRealShellExecutor(): ShellExecutor {
  return (
    bin: string,
    args: readonly string[],
    opts?: { readonly timeoutMs?: number; readonly cwd?: string },
  ): Promise<ShellResult> =>
    new Promise((resolve) => {
      const options: Record<string, unknown> = {};
      if (opts?.timeoutMs) options.timeout = opts.timeoutMs;
      if (opts?.cwd) options.cwd = opts.cwd;

      execFile(bin, [...args], options, (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error ? (error as { code?: number }).code ?? 1 : 0,
        });
      });
    });
}

// ─── Build page channels from config ───

function buildPageChannels(_config: ClawDoctorConfig): PageChannel[] {
  const channels: PageChannel[] = [];

  // Telegram and webhook channels are created lazily
  // to avoid importing heavy dependencies unless needed
  if (_config.page.telegram.enabled) {
    // Dynamic import handled at runtime to keep CLI startup fast
    channels.push({
      type: "telegram",
      send: async (msg) => {
        const { createTelegramPageChannel } = await import(
          "../page/channels/telegram-page.js"
        );
        const ch = createTelegramPageChannel(
          _config.page.telegram.botToken,
          _config.page.telegram.chatId,
        );
        return ch.send(msg);
      },
    });
  }

  if (_config.page.webhook.enabled) {
    channels.push({
      type: "webhook",
      send: async (msg) => {
        const { createWebhookPageChannel } = await import(
          "../page/channels/webhook-page.js"
        );
        const ch = createWebhookPageChannel(
          _config.page.webhook.url,
          _config.page.webhook.secret,
        );
        return ch.send(msg);
      },
    });
  }

  return channels;
}

// ─── Format duration for display ───

function formatUptime(startedAt: number): string {
  const elapsed = Date.now() - startedAt;
  const seconds = Math.floor(elapsed / 1000) % 60;
  const minutes = Math.floor(elapsed / 60_000) % 60;
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ─── Register monitor command ───

export function registerMonitorCommand(program: Command): void {
  const monitor = program
    .command("monitor")
    .description("Continuous monitoring for OpenClaw infrastructure");

  // ── start ───────────────────────────────────────────────────────────────────

  monitor
    .command("start")
    .description("Start the monitor process")
    .option("--dry-run", "Start in dry-run mode (no real alerts)")
    .action(async (opts) => {
      try {
        const configFilePath = join(homedir(), ".clawdoctor", "config.json");
        const config = loadConfig(configFilePath);
        const locale = config.locale ?? "en";

        const stateDir = join(homedir(), ".clawdoctor");
        const dbPath = join(stateDir, "clawdoctor.db");
        const db = openDatabase(dbPath);

        // Check if already running
        const existingState = readMonitorState(stateDir);
        if (existingState && isProcessRunning(existingState.pid)) {
          console.error(
            t(UI_STRINGS["monitor.alreadyRunning"], locale),
          );
          process.exit(1);
        }

        const exec = createRealShellExecutor();
        const pageChannels = opts.dryRun ? [] : buildPageChannels(config);

        const engine = createMonitorEngine(config, {
          db,
          stateDir,
          exec,
          pageChannels,
        });

        // Handle SIGINT and SIGTERM for graceful shutdown
        const shutdown = async () => {
          console.log(t(UI_STRINGS["monitor.stopping"], locale));
          await engine.stop();
          db.close();
          process.exit(0);
        };

        process.on("SIGINT", () => void shutdown());
        process.on("SIGTERM", () => void shutdown());

        console.log(
          opts.dryRun
            ? t(UI_STRINGS["monitor.startingDryRun"], locale)
            : t(UI_STRINGS["monitor.starting"], locale),
        );

        engine.start();

        console.log(t(UI_STRINGS["monitor.started"], locale));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] monitor start failed: ${message}`);
        process.exit(1);
      }
    });

  // ── stop ────────────────────────────────────────────────────────────────────

  monitor
    .command("stop")
    .description("Stop the running monitor process")
    .action(() => {
      try {
        const configFilePath = join(homedir(), ".clawdoctor", "config.json");
        const config = loadConfig(configFilePath);
        const locale = config.locale ?? "en";
        const stateDir = join(homedir(), ".clawdoctor");

        const state = readMonitorState(stateDir);
        if (!state) {
          console.log(t(UI_STRINGS["monitor.notRunning"], locale));
          return;
        }

        if (!isProcessRunning(state.pid)) {
          console.log(t(UI_STRINGS["monitor.staleState"], locale));
          return;
        }

        try {
          process.kill(state.pid, "SIGTERM");
          console.log(
            `${t(UI_STRINGS["monitor.sentStop"], locale)} (PID: ${state.pid})`,
          );
        } catch {
          console.error(t(UI_STRINGS["monitor.stopFailed"], locale));
          process.exit(1);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] monitor stop failed: ${message}`);
        process.exit(1);
      }
    });

  // ── status ──────────────────────────────────────────────────────────────────

  monitor
    .command("status")
    .description("Show monitor status")
    .action(() => {
      try {
        const configFilePath = join(homedir(), ".clawdoctor", "config.json");
        const config = loadConfig(configFilePath);
        const locale = config.locale ?? "en";
        const stateDir = join(homedir(), ".clawdoctor");

        const state = readMonitorState(stateDir);
        if (!state) {
          console.log(t(UI_STRINGS["monitor.notRunning"], locale));
          return;
        }

        const alive = isProcessRunning(state.pid);
        if (!alive) {
          console.log(t(UI_STRINGS["monitor.staleState"], locale));
          return;
        }

        console.log(
          `${t(UI_STRINGS["monitor.statusRunning"], locale)} (PID: ${state.pid})`,
        );
        console.log(
          `  ${t(UI_STRINGS["monitor.uptime"], locale)}: ${formatUptime(state.startedAt)}`,
        );
        console.log(
          `  ${t(UI_STRINGS["monitor.pendingConsents"], locale)}: ${state.pendingConsents}`,
        );
        console.log(
          `  ${t(UI_STRINGS["monitor.interventions"], locale)}: ${state.todayInterventions.executed} ${t(UI_STRINGS["monitor.executed"], locale)}, ${state.todayInterventions.failed} ${t(UI_STRINGS["monitor.failed"], locale)}`,
        );

        // Probe stats table
        console.log(`\n  ${t(UI_STRINGS["monitor.probeStats"], locale)}:`);
        for (const [probeId, stats] of Object.entries(state.probeStats)) {
          const probeStats = stats as {
            lastRunAt: number | null;
            lastStatus: string | null;
            runCount: number;
            consecutiveErrors: number;
          };
          const lastRun = probeStats.lastRunAt
            ? new Date(probeStats.lastRunAt).toISOString()
            : "never";
          console.log(
            `    ${probeId}: status=${probeStats.lastStatus ?? "unknown"} runs=${probeStats.runCount} errors=${probeStats.consecutiveErrors} last=${lastRun}`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[clawdoctor] monitor status failed: ${message}`);
        process.exit(1);
      }
    });
}
