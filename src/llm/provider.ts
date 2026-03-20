// ═══════════════════════════════════════════════
//  LLM Provider
//  Provider-agnostic interface + Anthropic implementation
// ═══════════════════════════════════════════════

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { ClawDoctorConfig } from "../types/config.js";

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

// ─── OpenAI-compatible implementation ────────────────────────────────────────

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export function createOpenAICompatibleProvider(opts: OpenAICompatibleProviderOptions): LLMProvider {
  const fetchFn = opts.fetch ?? globalThis.fetch;

  return {
    async chat(system: string, user: string, chatOpts?: { maxTokens?: number }): Promise<LLMResponse> {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };
      if (chatOpts?.maxTokens !== undefined) {
        body.max_tokens = chatOpts.maxTokens;
      }

      try {
        const url = opts.baseUrl.replace(/\/+$/, "") + "/chat/completions";
        const response = await fetchFn(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
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
          choices: Array<{ message: { content: string } }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
        };

        const text = data.choices?.[0]?.message?.content ?? "";
        return {
          text,
          tokensUsed: {
            input: data.usage?.prompt_tokens ?? 0,
            output: data.usage?.completion_tokens ?? 0,
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

// ─── OpenClaw config reader ──────────────────────────────────────────────────

export interface OpenClawModelInfo {
  provider: string;
  model: string;
  baseUrl: string;
  apiFormat: string;
}

/**
 * Read model configuration from OpenClaw's openclaw.json.
 * Returns null if no usable model config found.
 */
export function readOpenClawModelConfig(stateDir?: string): OpenClawModelInfo | null {
  const dir = stateDir ?? join(homedir(), ".openclaw");
  const candidates = [
    join(dir, "openclaw.json"),
    join(dirname(dir), "openclaw.json"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;

      // Extract default model: agents.defaults.model.primary = "provider/model"
      const agents = config.agents as Record<string, unknown> | undefined;
      const defaults = agents?.defaults as Record<string, unknown> | undefined;
      const modelConfig = defaults?.model as Record<string, unknown> | undefined;
      const primary = modelConfig?.primary as string | undefined;

      if (!primary) continue;

      // Parse "provider/model" format
      const slashIdx = primary.indexOf("/");
      if (slashIdx < 0) continue;
      const providerName = primary.slice(0, slashIdx);
      const modelName = primary.slice(slashIdx + 1);

      // Find provider config: models.providers[providerName]
      const models = config.models as Record<string, unknown> | undefined;
      const providers = models?.providers as Record<string, unknown> | undefined;
      const providerConf = providers?.[providerName] as Record<string, unknown> | undefined;

      if (!providerConf) continue;

      const baseUrl = providerConf.baseUrl as string | undefined;
      const apiFormat = providerConf.api as string | undefined;

      if (!baseUrl) continue;

      return {
        provider: providerName,
        model: modelName,
        baseUrl,
        apiFormat: apiFormat ?? "openai-completions",
      };
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Provider resolution ──────────────────────────────────────────────────────

export function resolveLLMProvider(
  config: ClawDoctorConfig,
  stateDir?: string,
): { provider: LLMProvider; model: string } | { provider: null; reason: string } {
  if (!config.llm.enabled) {
    return { provider: null, reason: "llm_disabled" };
  }

  // Priority 1: Config-stored API key (from dashboard settings)
  if (config.llm.apiKey) {
    const providerType = config.llm.provider ?? "anthropic";
    if (providerType === "openai-compatible" && config.llm.baseUrl) {
      const model = config.llm.model ?? "gpt-4";
      return {
        provider: createOpenAICompatibleProvider({
          apiKey: config.llm.apiKey,
          model,
          baseUrl: config.llm.baseUrl,
        }),
        model,
      };
    }
    // Default to Anthropic
    const model = config.llm.model ?? "claude-sonnet-4-20250514";
    return {
      provider: createAnthropicProvider({
        apiKey: config.llm.apiKey,
        model,
        baseUrl: config.llm.baseUrl,
      }),
      model,
    };
  }

  // Priority 2: Environment variable
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    const model = config.llm.model ?? "claude-sonnet-4-20250514";
    return {
      provider: createAnthropicProvider({ apiKey: envKey, model, baseUrl: config.llm.baseUrl }),
      model,
    };
  }

  // Priority 3: OpenClaw model config (still needs API key from user)
  return { provider: null, reason: "no_api_key" };
}
