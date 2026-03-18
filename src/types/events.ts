// ═══════════════════════════════════════════════
//  Unified Event Model
//  Source: design spec §5.1
// ═══════════════════════════════════════════════

export type EventType =
  | "llm_call"
  | "tool_call"
  | "session_lifecycle"
  | "agent_lifecycle"
  | "subagent_event"
  | "message_event"
  | "compaction_event"
  | "config_snapshot"
  | "memory_snapshot"
  | "plugin_snapshot";

// ─── Event data interfaces ───

export interface LLMCallData {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;           // stream only
  cacheWriteTokens?: number;          // stream only
  totalTokens?: number;
  durationMs?: number;
  success: boolean;
  error?: string;
}

export interface ToolCallData {
  toolName: string;
  // PRIVACY: params and result are stored as REDACTED summaries, not raw values.
  // - params: only key names + value types (e.g. { "query": "string", "limit": "number" })
  // - result: only success/failure + size (e.g. { "type": "string", "length": 1234 })
  // - Raw params/result are available via RawSampleProvider at analysis time, not persisted.
  paramsSummary: Record<string, string>;  // key → value type descriptor
  resultSummary?: { type: string; length?: number };
  error?: string;                     // first 200 chars, redacted via redactPatterns
  durationMs?: number;                // stream only (precise)
  success: boolean;
}

export interface SessionLifecycleData {
  event: "start" | "end";
  messageCount?: number;
  durationMs?: number;
}

export interface AgentLifecycleData {
  event: "start" | "end";
  success?: boolean;
  error?: string;
  durationMs?: number;
  trigger?: string;                   // "user" | "heartbeat" | "cron" | "memory"
}

export interface MemorySnapshotData {
  files: Array<{
    path: string;
    sizeBytes: number;
    modifiedAt: number;
    type?: string;                    // frontmatter type field
    name?: string;
  }>;
  totalCount: number;
  totalSizeBytes: number;
}

export interface SubagentEventData {
  event: "spawned" | "ended";
  childSessionKey: string;
  agentId: string;
  outcome?: "ok" | "error" | "timeout" | "killed" | "reset";
  error?: string;
  durationMs?: number;
}

export interface MessageEventData {
  event: "received" | "sent";
  channelId: string;
  success: boolean;
  error?: string;
}

export interface CompactionEventData {
  messageCountBefore: number;
  messageCountAfter: number;
  tokenCountBefore?: number;
  tokenCountAfter?: number;
}

export interface ConfigSnapshotData {
  configHash: string;                 // hash of openclaw.json for change detection
  agentId: string;
  model?: string;
  modelProvider?: string;
  sandboxEnabled?: boolean;
  pluginCount: number;
  channelCount: number;
}

export interface PluginSnapshotData {
  plugins: Array<{
    id: string;
    name: string;
    version?: string;
    source: string;                   // "bundled" | "global" | "workspace" | "config"
    status: "loaded" | "error" | "disabled";
    error?: string;
    registeredTools: string[];
    registeredHooks: string[];
    permissions?: string[];
  }>;
}

// ─── EventType → data type mapping ───

export type EventDataMap = {
  llm_call: LLMCallData;
  tool_call: ToolCallData;
  session_lifecycle: SessionLifecycleData;
  agent_lifecycle: AgentLifecycleData;
  subagent_event: SubagentEventData;
  message_event: MessageEventData;
  compaction_event: CompactionEventData;
  config_snapshot: ConfigSnapshotData;
  memory_snapshot: MemorySnapshotData;
  plugin_snapshot: PluginSnapshotData;
};

// ─── Base event ───

export interface ClawInsightEvent {
  id: string;                         // ULID (ordered, contains timestamp)
  source: "snapshot" | "stream";
  timestamp: number;                  // unix ms
  agentId: string;
  sessionKey?: string;
  sessionId?: string;
  type: EventType;
  data: EventDataMap[EventType];
}

// ─── Type-safe event: event.type determines event.data shape ───

export type TypedClawInsightEvent<T extends EventType = EventType> = Omit<ClawInsightEvent, "type" | "data"> & {
  type: T;
  data: EventDataMap[T];
};
