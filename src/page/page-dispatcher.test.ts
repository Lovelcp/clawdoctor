import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPageDispatcher } from "./page-dispatcher.js";
import type { PageChannel } from "./page-channel.js";
import type { PageMessage, SendResult } from "../types/monitor.js";
import type { PageDispatcherConfig } from "./page-dispatcher.js";
import { openDatabase } from "../store/database.js";
import type Database from "better-sqlite3";

function createMsg(overrides: Partial<PageMessage> = {}): PageMessage {
  return {
    priority: "critical",
    title: { en: "Test Alert" },
    body: { en: "Something broke" },
    diseaseId: "INFRA-001",
    probeId: "gateway",
    agentId: "main",
    timestamp: Date.now(),
    ...overrides,
  };
}

function createMockChannel(
  type: "telegram" | "webhook" = "telegram",
): PageChannel & { send: ReturnType<typeof vi.fn> } {
  return {
    type,
    send: vi.fn<(msg: PageMessage) => Promise<SendResult>>().mockResolvedValue({
      success: true,
    }),
  };
}

function createDefaultConfig(
  overrides: Partial<PageDispatcherConfig> = {},
): PageDispatcherConfig {
  return {
    rateLimit: {
      perProbeMs: 60_000,
      globalMaxPerHour: 100,
    },
    dedup: {
      info: 3600_000,
      warning: 1800_000,
      critical: 600_000,
      emergency: 0,
    },
    ...overrides,
  };
}

describe("PageDispatcher", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  it("dispatches a message to all channels", async () => {
    const ch1 = createMockChannel("telegram");
    const ch2 = createMockChannel("webhook");
    const config = createDefaultConfig();
    const dispatcher = createPageDispatcher(config, [ch1, ch2], db);

    await dispatcher.dispatch(createMsg());

    expect(ch1.send).toHaveBeenCalledTimes(1);
    expect(ch2.send).toHaveBeenCalledTimes(1);
  });

  it("suppresses duplicate alerts within the dedup window", async () => {
    const ch = createMockChannel();
    const config = createDefaultConfig({
      dedup: { info: 3600_000, warning: 1800_000, critical: 600_000, emergency: 0 },
    });
    const dispatcher = createPageDispatcher(config, [ch], db);

    const msg = createMsg({ priority: "critical" });

    await dispatcher.dispatch(msg);
    await dispatcher.dispatch(msg);

    // Only the first should go through
    expect(ch.send).toHaveBeenCalledTimes(1);
  });

  it("allows message after dedup window expires", async () => {
    const ch = createMockChannel();
    const config = createDefaultConfig({
      dedup: { info: 3600_000, warning: 1800_000, critical: 100, emergency: 0 },
    });
    const dispatcher = createPageDispatcher(config, [ch], db);

    const msg = createMsg({ priority: "critical" });

    await dispatcher.dispatch(msg);
    expect(ch.send).toHaveBeenCalledTimes(1);

    // Manually expire the dedup entry
    db.prepare("UPDATE page_dedup SET last_sent_at = last_sent_at - 200").run();

    await dispatcher.dispatch(msg);
    expect(ch.send).toHaveBeenCalledTimes(2);
  });

  it("does not dedup emergency priority (window = 0)", async () => {
    const ch = createMockChannel();
    const config = createDefaultConfig({
      dedup: { info: 3600_000, warning: 1800_000, critical: 600_000, emergency: 0 },
    });
    const dispatcher = createPageDispatcher(config, [ch], db);

    const msg = createMsg({ priority: "emergency" });

    await dispatcher.dispatch(msg);
    await dispatcher.dispatch(msg);
    await dispatcher.dispatch(msg);

    // All should go through
    expect(ch.send).toHaveBeenCalledTimes(3);
  });

  it("enforces global max per hour rate limit", async () => {
    const ch = createMockChannel();
    const config = createDefaultConfig({
      rateLimit: { perProbeMs: 0, globalMaxPerHour: 2 },
      dedup: { info: 0, warning: 0, critical: 0, emergency: 0 },
    });
    const dispatcher = createPageDispatcher(config, [ch], db);

    await dispatcher.dispatch(createMsg({ timestamp: Date.now() }));
    await dispatcher.dispatch(createMsg({ timestamp: Date.now() + 1 }));
    await dispatcher.dispatch(createMsg({ timestamp: Date.now() + 2 }));

    // Only 2 should go through due to global max
    expect(ch.send).toHaveBeenCalledTimes(2);
  });

  it("constructs dedup key from probeId:diseaseId:agentId", async () => {
    const ch = createMockChannel();
    const config = createDefaultConfig({
      dedup: { info: 3600_000, warning: 1800_000, critical: 600_000, emergency: 0 },
    });
    const dispatcher = createPageDispatcher(config, [ch], db);

    // Same disease + probe but different agent → not deduped
    const msg1 = createMsg({ agentId: "agent-a", priority: "critical" });
    const msg2 = createMsg({ agentId: "agent-b", priority: "critical" });

    await dispatcher.dispatch(msg1);
    await dispatcher.dispatch(msg2);

    expect(ch.send).toHaveBeenCalledTimes(2);
  });

  it("handles channel failure gracefully", async () => {
    const ch = createMockChannel();
    ch.send.mockResolvedValue({ success: false, error: "Network error" });

    const config = createDefaultConfig({
      dedup: { info: 0, warning: 0, critical: 0, emergency: 0 },
    });
    const dispatcher = createPageDispatcher(config, [ch], db);

    // Should not throw
    await expect(dispatcher.dispatch(createMsg())).resolves.not.toThrow();
  });

  it("triggers circuit breaker after 5 consecutive failures", async () => {
    const ch = createMockChannel();
    ch.send.mockResolvedValue({ success: false, error: "down" });

    const config = createDefaultConfig({
      dedup: { info: 0, warning: 0, critical: 0, emergency: 0 },
      rateLimit: { perProbeMs: 0, globalMaxPerHour: 1000 },
    });
    const dispatcher = createPageDispatcher(config, [ch], db);

    // Fail 5 times to trigger circuit breaker
    for (let i = 0; i < 5; i++) {
      await dispatcher.dispatch(createMsg({ timestamp: Date.now() + i }));
    }

    // Reset mock to track calls after circuit breaker triggers
    ch.send.mockClear();
    ch.send.mockResolvedValue({ success: true });

    // 6th call — channel should be disabled by circuit breaker
    await dispatcher.dispatch(createMsg({ timestamp: Date.now() + 10 }));

    expect(ch.send).toHaveBeenCalledTimes(0);
  });

  it("uses default agentId in dedup key when agentId is undefined", async () => {
    const ch = createMockChannel();
    const config = createDefaultConfig({
      dedup: { info: 3600_000, warning: 1800_000, critical: 600_000, emergency: 0 },
    });
    const dispatcher = createPageDispatcher(config, [ch], db);

    const msg = createMsg({ agentId: undefined, priority: "critical" });

    await dispatcher.dispatch(msg);
    await dispatcher.dispatch(msg);

    // Should be deduped
    expect(ch.send).toHaveBeenCalledTimes(1);
  });
});
