import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnthropicProvider, resolveLLMProvider } from "./provider.js";
import type { AnthropicProviderOptions, LLMProvider } from "./provider.js";
import { DEFAULT_CONFIG } from "../types/config.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOpts(overrides: Partial<AnthropicProviderOptions> = {}): AnthropicProviderOptions {
  return {
    apiKey: "test-api-key",
    model: "claude-test-model",
    baseUrl: "https://api.anthropic.com",
    ...overrides,
  };
}

function makeSuccessResponse(text: string, inputTokens = 10, outputTokens = 20) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: "text", text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
  };
}

function makeHttpErrorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  };
}

// ─── createAnthropicProvider: successful chat ─────────────────────────────────

describe("createAnthropicProvider - sends structured prompt and returns parsed response", () => {
  it("sends correct request and returns parsed text + usage", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeSuccessResponse("Hello, world!", 15, 25));

    const provider = createAnthropicProvider(makeOpts({ fetch: mockFetch as typeof globalThis.fetch }));
    const result = await provider.chat("You are helpful.", "Say hello.");

    // Verify fetch was called once
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the URL
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");

    // Verify method
    expect(init.method).toBe("POST");

    // Verify headers
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-api-key");
    expect(headers["anthropic-version"]).toBeDefined();
    expect(headers["content-type"]).toBe("application/json");

    // Verify body
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-test-model");
    expect(body.system).toBe("You are helpful.");
    expect(body.messages).toEqual([{ role: "user", content: "Say hello." }]);

    // Verify returned response
    expect(result.text).toBe("Hello, world!");
    expect(result.tokensUsed.input).toBe(15);
    expect(result.tokensUsed.output).toBe(25);
    expect(result.error).toBeUndefined();
  });

  it("sends maxTokens in request body when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeSuccessResponse("ok"));

    const provider = createAnthropicProvider(makeOpts({ fetch: mockFetch as typeof globalThis.fetch }));
    await provider.chat("system", "user", { maxTokens: 512 });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(512);
  });

  it("uses default baseUrl (https://api.anthropic.com) when not provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeSuccessResponse("ok"));

    const provider = createAnthropicProvider({
      apiKey: "key",
      model: "model",
      fetch: mockFetch as typeof globalThis.fetch,
    });
    await provider.chat("system", "user");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });
});

// ─── createAnthropicProvider: HTTP error ──────────────────────────────────────

describe("createAnthropicProvider - HTTP error handling", () => {
  it("returns error field on 401 without throwing", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeHttpErrorResponse(401, "Unauthorized"));

    const provider = createAnthropicProvider(makeOpts({ fetch: mockFetch as typeof globalThis.fetch }));
    const result = await provider.chat("system", "user");

    expect(result.text).toBe("");
    expect(result.tokensUsed.input).toBe(0);
    expect(result.tokensUsed.output).toBe(0);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it("returns error field on 500 without throwing", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeHttpErrorResponse(500, "Internal Server Error"));

    const provider = createAnthropicProvider(makeOpts({ fetch: mockFetch as typeof globalThis.fetch }));
    const result = await provider.chat("system", "user");

    expect(result.text).toBe("");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("500");
  });

  it("returns error field on 429 (rate limit) without throwing", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeHttpErrorResponse(429, "Rate limit exceeded"));

    const provider = createAnthropicProvider(makeOpts({ fetch: mockFetch as typeof globalThis.fetch }));
    const result = await provider.chat("system", "user");

    expect(result.text).toBe("");
    expect(result.error).toBeDefined();
  });
});

// ─── createAnthropicProvider: network error ───────────────────────────────────

describe("createAnthropicProvider - network error handling", () => {
  it("returns error field on network failure without throwing", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED: connection refused"));

    const provider = createAnthropicProvider(makeOpts({ fetch: mockFetch as typeof globalThis.fetch }));
    const result = await provider.chat("system", "user");

    expect(result.text).toBe("");
    expect(result.tokensUsed.input).toBe(0);
    expect(result.tokensUsed.output).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns error field on DNS failure without throwing", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const provider = createAnthropicProvider(makeOpts({ fetch: mockFetch as typeof globalThis.fetch }));
    const result = await provider.chat("system", "user");

    expect(result.text).toBe("");
    expect(result.error).toBeDefined();
  });
});

// ─── resolveLLMProvider ───────────────────────────────────────────────────────

describe("resolveLLMProvider - llm disabled", () => {
  it("returns null provider with reason 'llm_disabled' when llm.enabled is false", () => {
    const config = { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, enabled: false } };
    const result = resolveLLMProvider(config);

    expect(result.provider).toBeNull();
    // TypeScript narrows: access reason only when provider is null
    if (result.provider === null) {
      expect((result as { provider: null; reason: string }).reason).toBe("llm_disabled");
    }
  });
});

describe("resolveLLMProvider - missing API key", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns null provider with reason 'no_api_key' when ANTHROPIC_API_KEY is not set", () => {
    const config = { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, enabled: true } };
    const result = resolveLLMProvider(config);

    expect(result.provider).toBeNull();
    if (result.provider === null) {
      expect((result as { provider: null; reason: string }).reason).toBe("no_api_key");
    }
  });
});

describe("resolveLLMProvider - valid API key", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key-12345";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    }
  });

  it("returns a provider and model when ANTHROPIC_API_KEY is set and llm.enabled is true", () => {
    const config = { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, enabled: true } };
    const result = resolveLLMProvider(config);

    expect(result.provider).not.toBeNull();
    if (result.provider !== null) {
      expect(typeof result.provider.chat).toBe("function");
      const success = result as { provider: LLMProvider; model: string };
      expect(typeof success.model).toBe("string");
      expect(success.model.length).toBeGreaterThan(0);
    }
  });

  it("uses the model from config when provided", () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: { ...DEFAULT_CONFIG.llm, enabled: true, model: "claude-custom-model" },
    };
    const result = resolveLLMProvider(config);
    expect(result.provider).not.toBeNull();
    if (result.provider !== null) {
      const success = result as { provider: LLMProvider; model: string };
      expect(success.model).toBe("claude-custom-model");
    }
  });

  it("uses default model 'claude-sonnet-4-20250514' when config.llm.model is not set", () => {
    const config = {
      ...DEFAULT_CONFIG,
      llm: { enabled: true },  // no model field
    };
    const result = resolveLLMProvider(config);
    expect(result.provider).not.toBeNull();
    if (result.provider !== null) {
      const success = result as { provider: LLMProvider; model: string };
      expect(success.model).toBe("claude-sonnet-4-20250514");
    }
  });
});
