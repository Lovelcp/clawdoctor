// ===============================================
//  Cost Probe — detects cost spikes via rolling average
//  Emits CST-010 when latest session cost > N * average
// ===============================================

import type { ProbeConfig, ProbeResult, ProbeStatus, Finding } from "../../types/monitor.js";
import type { Probe, ProbeDeps } from "../probe.js";

const DEFAULT_MIN_SESSIONS = 20;
const DEFAULT_SPIKE_MULTIPLIER = 3;

// --- Row shape from aggregate query ---

interface SessionCostRow {
  readonly session_key: string;
  readonly total_tokens: number;
}

export const costProbe: Probe = async (
  config: ProbeConfig,
  deps: ProbeDeps,
): Promise<ProbeResult> => {
  const timestamp = Date.now();
  const agentId = (config.params.agentId as string | undefined) ?? "default";
  const minSessions = (config.params.minSessionsForBaseline as number | undefined) ?? DEFAULT_MIN_SESSIONS;
  const spikeMultiplier = (config.params.spikeMultiplier as number | undefined) ?? DEFAULT_SPIKE_MULTIPLIER;

  const sessionCosts = querySessionCosts(deps, agentId, minSessions + 1);

  if (sessionCosts.length === 0) {
    return {
      probeId: "cost",
      status: "ok",
      findings: [],
      metrics: { sessionCount: 0 },
      timestamp,
    };
  }

  if (sessionCosts.length < minSessions + 1) {
    return {
      probeId: "cost",
      status: "ok",
      findings: [],
      metrics: { sessionCount: sessionCosts.length },
      timestamp,
    };
  }

  // sessionCosts[0] is the latest session (highest MAX(timestamp))
  const latestCost = sessionCosts[0].total_tokens;
  // Baseline = average of sessions [1..minSessions]
  const baselineSessions = sessionCosts.slice(1, minSessions + 1);
  const baselineAvg =
    baselineSessions.reduce((sum, row) => sum + row.total_tokens, 0) / baselineSessions.length;

  const ratio = baselineAvg > 0 ? latestCost / baselineAvg : 0;

  const findings: Finding[] = [];
  let status: ProbeStatus = "ok";

  if (ratio >= spikeMultiplier) {
    status = "critical";
    findings.push({
      code: "CST-010",
      message: {
        en: `Session cost spike detected: ${latestCost} tokens (${ratio.toFixed(1)}x the rolling average of ${Math.round(baselineAvg)})`,
        zh: `检测到会话成本飙升：${latestCost} 个 Token（滚动平均值 ${Math.round(baselineAvg)} 的 ${ratio.toFixed(1)} 倍）`,
      },
      severity: "critical",
      context: {
        latestSessionKey: sessionCosts[0].session_key,
        latestCost,
        rollingAverage: Math.round(baselineAvg),
        spikeMultiplier: ratio,
        threshold: spikeMultiplier,
      },
    });
  }

  return {
    probeId: "cost",
    status,
    findings,
    metrics: {
      sessionCount: sessionCosts.length,
      latestCost,
      rollingAverage: Math.round(baselineAvg),
      spikeRatio: Math.round(ratio * 100) / 100,
    },
    timestamp,
  };
};

// --- Raw SQL query for session costs ---

function querySessionCosts(
  deps: ProbeDeps,
  agentId: string,
  limit: number,
): SessionCostRow[] {
  const sql = `
    SELECT
      session_key,
      SUM(
        COALESCE(json_extract(data, '$.inputTokens'), 0)
        + COALESCE(json_extract(data, '$.outputTokens'), 0)
      ) as total_tokens
    FROM events
    WHERE type = 'llm_call' AND agent_id = @agentId AND session_key IS NOT NULL
    GROUP BY session_key
    ORDER BY MAX(timestamp) DESC
    LIMIT @limit
  `;

  return deps.db.prepare(sql).all({ agentId, limit }) as SessionCostRow[];
}
