// ═══════════════════════════════════════════════
//  OpenClaw Plugin Type Shims (dev-only)
//  Minimal interfaces matching the OpenClaw plugin SDK.
//  At runtime, real types from openclaw/plugin-sdk are used.
//  These stubs exist so ClawInsight can be developed without
//  openclaw installed as a hard dependency.
// ═══════════════════════════════════════════════

// Minimal type stubs for development without OpenClaw installed
// At runtime, real types from openclaw/plugin-sdk are used
export interface OpenClawPluginDefinition {
  id?: string;
  name?: string;
  description?: string;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
}

export interface OpenClawPluginApi {
  id: string;
  name: string;
  config: Record<string, unknown>;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  on: (hookName: string, handler: (...args: any[]) => any) => void;
  registerService: (service: { id: string; start: (ctx: any) => void | Promise<void>; stop?: (ctx: any) => void | Promise<void> }) => void;
  registerCli: (registrar: (ctx: any) => void | Promise<void>) => void;
  registerHttpRoute: (params: { path: string; handler: any; auth: string; match?: string }) => void;
}
