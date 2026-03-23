import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTelegramPageChannel } from "./telegram-page.js";
import type { PageMessage } from "../../types/monitor.js";

function createPageMessage(
  overrides: Partial<PageMessage> = {},
): PageMessage {
  return {
    priority: "critical",
    title: { en: "Gateway Cardiac Arrest", zh: "网关心脏骤停" },
    body: { en: "Gateway is not running", zh: "网关进程未运行" },
    diseaseId: "INFRA-001",
    probeId: "gateway",
    agentId: "main",
    timestamp: 1711152000000,
    ...overrides,
  };
}

describe("createTelegramPageChannel", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends a message to Telegram Bot API", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const channel = createTelegramPageChannel("bot-token-123", "chat-456");
    const msg = createPageMessage();
    const result = await channel.send(msg);

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [url, opts] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botbot-token-123/sendMessage");
    expect(opts?.method).toBe("POST");

    const body = JSON.parse(opts?.body as string);
    expect(body.chat_id).toBe("chat-456");
    expect(body.parse_mode).toBe("HTML");
    expect(body.text).toContain("INFRA-001");
  });

  it("includes severity emoji in message text", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const channel = createTelegramPageChannel("tok", "chat");
    await channel.send(createPageMessage({ priority: "emergency" }));

    const body = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls[0][1]?.body as string),
    );
    // Emergency should have a red siren emoji
    expect(body.text).toMatch(/🚨/);
  });

  it("returns failure on non-200 response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: "Bad Request" }), {
        status: 400,
      }),
    );

    const channel = createTelegramPageChannel("tok", "chat");
    const result = await channel.send(createPageMessage());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns failure on fetch error", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new Error("Network error"),
    );

    const channel = createTelegramPageChannel("tok", "chat");
    const result = await channel.send(createPageMessage());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
  });

  it("has type 'telegram'", () => {
    const channel = createTelegramPageChannel("tok", "chat");
    expect(channel.type).toBe("telegram");
  });

  it("includes agent and disease info in the message", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const channel = createTelegramPageChannel("tok", "chat");
    await channel.send(
      createPageMessage({ agentId: "prod-agent", diseaseId: "CST-010" }),
    );

    const body = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls[0][1]?.body as string),
    );
    expect(body.text).toContain("prod-agent");
    expect(body.text).toContain("CST-010");
  });
});
