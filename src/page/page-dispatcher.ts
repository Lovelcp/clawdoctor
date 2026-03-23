// ===============================================
//  Page Dispatcher
//  Coordinates alert delivery across page channels
//  with dedup, rate limiting, retry, and circuit
//  breaker protection.
// ===============================================

import type Database from "better-sqlite3";
import type { PageMessage, PagePriority } from "../types/monitor.js";
import type { PageChannel } from "./page-channel.js";

// ─── Configuration ───

export interface PageDispatcherConfig {
  readonly rateLimit: {
    readonly perProbeMs: number;
    readonly globalMaxPerHour: number;
  };
  readonly dedup: Readonly<Record<PagePriority, number>>;
}

// ─── Dispatcher interface ───

export interface PageDispatcher {
  readonly dispatch: (msg: PageMessage) => Promise<void>;
}

// ─── Circuit breaker state per channel ───

interface ChannelState {
  consecutiveFailures: number;
  disabledUntil: number;
}

// ─── Rate limit state ───

interface RateLimitState {
  readonly hourStart: number;
  count: number;
}

// ─── Factory ───

/**
 * Create a page dispatcher that coordinates message delivery
 * across multiple page channels.
 *
 * Features:
 *   - Dedup: suppresses duplicate alerts within a configurable window
 *     per priority level, keyed by `probeId:diseaseId:agentId`
 *   - Rate limit: per-probe frequency + global max per hour
 *   - Retry: one retry attempt on channel failure (5s delay)
 *   - Circuit breaker: 5 consecutive failures disables channel for 1h
 */
export function createPageDispatcher(
  config: PageDispatcherConfig,
  channels: readonly PageChannel[],
  db: Database.Database,
): PageDispatcher {
  // ─── Prepared statements ───
  const lookupDedup = db.prepare(
    "SELECT last_sent_at FROM page_dedup WHERE key = ?",
  );
  const upsertDedup = db.prepare(
    `INSERT INTO page_dedup (key, priority, last_sent_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET priority = excluded.priority, last_sent_at = excluded.last_sent_at`,
  );

  // ─── Circuit breaker state ───
  const channelStates = new Map<PageChannel, ChannelState>();
  for (const ch of channels) {
    channelStates.set(ch, { consecutiveFailures: 0, disabledUntil: 0 });
  }

  // ─── Rate limit state ───
  const globalRate: RateLimitState = {
    hourStart: Date.now(),
    count: 0,
  };

  // ─── Dedup check ───

  function isDuplicate(msg: PageMessage): boolean {
    const dedupWindowMs = config.dedup[msg.priority];
    if (dedupWindowMs === 0) {
      return false;
    }

    const key = buildDedupKey(msg);
    const row = lookupDedup.get(key) as { last_sent_at: number } | undefined;

    if (!row) {
      return false;
    }

    const elapsed = Date.now() - row.last_sent_at;
    return elapsed < dedupWindowMs;
  }

  function recordDedup(msg: PageMessage): void {
    const key = buildDedupKey(msg);
    upsertDedup.run(key, msg.priority, Date.now());
  }

  // ─── Rate limit check ───

  function isRateLimited(): boolean {
    const now = Date.now();
    const hourMs = 3600_000;

    // Reset counter if we've passed into a new hour window
    if (now - globalRate.hourStart >= hourMs) {
      globalRate.hourStart = now;
      globalRate.count = 0;
    }

    return globalRate.count >= config.rateLimit.globalMaxPerHour;
  }

  function incrementRateCounter(): void {
    globalRate.count += 1;
  }

  // ─── Send to a single channel with retry ───

  async function sendToChannel(
    channel: PageChannel,
    msg: PageMessage,
  ): Promise<void> {
    const state = channelStates.get(channel);
    if (!state) return;

    // Circuit breaker check
    if (state.disabledUntil > Date.now()) {
      return;
    }

    const result = await channel.send(msg);

    if (result.success) {
      state.consecutiveFailures = 0;
      return;
    }

    // First failure — retry once after 5s
    await delay(5);
    const retryResult = await channel.send(msg);

    if (retryResult.success) {
      state.consecutiveFailures = 0;
      return;
    }

    // Both attempts failed
    state.consecutiveFailures += 1;

    // Circuit breaker: disable channel for 1h after 5 consecutive failures
    if (state.consecutiveFailures >= 5) {
      state.disabledUntil = Date.now() + 3600_000;
    }
  }

  return {
    async dispatch(msg: PageMessage): Promise<void> {
      // 1. Dedup check
      if (isDuplicate(msg)) {
        return;
      }

      // 2. Rate limit check
      if (isRateLimited()) {
        return;
      }

      // 3. Record dedup entry
      recordDedup(msg);

      // 4. Increment rate counter
      incrementRateCounter();

      // 5. Dispatch to all enabled channels
      const sendPromises = channels.map((ch) =>
        sendToChannel(ch, msg).catch(() => {
          // Swallow errors — individual channel failures don't stop dispatch
        }),
      );

      await Promise.all(sendPromises);
    },
  };
}

// ─── Helpers ───

function buildDedupKey(msg: PageMessage): string {
  const probeId = msg.probeId ?? "unknown";
  const diseaseId = msg.diseaseId ?? "unknown";
  const agentId = msg.agentId ?? "default";
  return `${probeId}:${diseaseId}:${agentId}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
