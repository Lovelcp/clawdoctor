import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWebhookPageChannel } from "./webhook-page.js";
import { createHmac } from "node:crypto";
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

describe("createWebhookPageChannel", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs JSON payload to the webhook URL", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const channel = createWebhookPageChannel("https://example.com/hook");
    const msg = createPageMessage();
    const result = await channel.send(msg);

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [url, opts] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(opts?.method).toBe("POST");

    const headers = opts?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts?.body as string);
    expect(body.priority).toBe("critical");
    expect(body.diseaseId).toBe("INFRA-001");
    expect(body.title).toEqual({ en: "Gateway Cardiac Arrest", zh: "网关心脏骤停" });
  });

  it("includes HMAC-SHA256 signature when secret is provided", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const secret = "my-webhook-secret";
    const channel = createWebhookPageChannel("https://example.com/hook", secret);
    const msg = createPageMessage();
    await channel.send(msg);

    const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = opts?.headers as Record<string, string>;
    const signature = headers["X-ClawDoc-Signature"];

    expect(signature).toBeTruthy();
    expect(signature).toMatch(/^sha256=/);

    // Verify the HMAC is correct
    const bodyStr = opts?.body as string;
    const expectedHmac = createHmac("sha256", secret)
      .update(bodyStr)
      .digest("hex");
    expect(signature).toBe(`sha256=${expectedHmac}`);
  });

  it("does not include signature header when no secret", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("OK", { status: 200 }),
    );

    const channel = createWebhookPageChannel("https://example.com/hook");
    await channel.send(createPageMessage());

    const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = opts?.headers as Record<string, string>;
    expect(headers["X-ClawDoc-Signature"]).toBeUndefined();
  });

  it("returns failure on non-2xx response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const channel = createWebhookPageChannel("https://example.com/hook");
    const result = await channel.send(createPageMessage());

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns failure on fetch error", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new Error("Connection refused"),
    );

    const channel = createWebhookPageChannel("https://example.com/hook");
    const result = await channel.send(createPageMessage());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Connection refused");
  });

  it("has type 'webhook'", () => {
    const channel = createWebhookPageChannel("https://example.com/hook");
    expect(channel.type).toBe("webhook");
  });
});
