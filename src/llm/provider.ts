// ═══════════════════════════════════════════════
//  LLM Provider
//  Provider-agnostic interface + Anthropic implementation
// ═══════════════════════════════════════════════

import type { ClawInsightConfig } from "../types/config.js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface LLMProvider {
  chat(system: string, user: string, opts?: { maxTokens?: number }): Promise<LLMResponse>;
}

export interface LLMResponse {
  text: string;
  tokensUsed: { input: number; output: number };
  error?: string;
}

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;  // injectable for testing
}

// ─── Anthropic implementation ─────────────────────────────────────────────────

export function createAnthropicProvider(opts: AnthropicProviderOptions): LLMProvider {
  const baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
  const fetchFn = opts.fetch ?? globalThis.fetch;

  return {
    async chat(system: string, user: string, chatOpts?: { maxTokens?: number }): Promise<LLMResponse> {
      const body: Record<string, unknown> = {
        model: opts.model,
        system,
        messages: [{ role: "user", content: user }],
      };

      if (chatOpts?.maxTokens !== undefined) {
        body.max_tokens = chatOpts.maxTokens;
      }

      try {
        const response = await fetchFn(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": opts.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          return {
            text: "",
            tokensUsed: { input: 0, output: 0 },
            error: `HTTP ${response.status}: request failed`,
          };
        }

        const data = await response.json() as {
          content: Array<{ type: string; text: string }>;
          usage: { input_tokens: number; output_tokens: number };
        };

        const text = data.content[0]?.text ?? "";
        return {
          text,
          tokensUsed: {
            input: data.usage.input_tokens,
            output: data.usage.output_tokens,
          },
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          text: "",
          tokensUsed: { input: 0, output: 0 },
          error: message,
        };
      }
    },
  };
}

// ─── Provider resolution ──────────────────────────────────────────────────────

export function resolveLLMProvider(
  config: ClawInsightConfig,
): { provider: LLMProvider; model: string } | { provider: null; reason: string } {
  if (!config.llm.enabled) {
    return { provider: null, reason: "llm_disabled" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { provider: null, reason: "no_api_key" };
  }

  const model = config.llm.model ?? "claude-sonnet-4-20250514";
  return {
    provider: createAnthropicProvider({ apiKey, model }),
    model,
  };
}
