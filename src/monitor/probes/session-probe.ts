// ===============================================
//  Session Probe — detects stuck/inactive sessions
//  Emits BHV-010 for sessions with stale file mtime
// ===============================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { ProbeConfig, ProbeResult, ProbeStatus, Finding } from "../../types/monitor.js";
import type { Probe, ProbeDeps } from "../probe.js";

const DEFAULT_INACTIVE_THRESHOLD_MS = 7_200_000; // 2 hours

export const sessionProbe: Probe = async (
  config: ProbeConfig,
  deps: ProbeDeps,
): Promise<ProbeResult> => {
  const timestamp = Date.now();
  const thresholdMs = (config.params.inactiveThresholdMs as number | undefined) ?? DEFAULT_INACTIVE_THRESHOLD_MS;

  const sessionsDir = path.join(deps.stateDir, "sessions");

  if (!fs.existsSync(sessionsDir)) {
    return {
      probeId: "session",
      status: "ok",
      findings: [],
      metrics: {},
      timestamp,
    };
  }

  const sessionDirs = readDirectoryEntries(sessionsDir);
  const findings: Finding[] = [];

  for (const sessionKey of sessionDirs) {
    const sessionPath = path.join(sessionsDir, sessionKey);
    const latestMtime = getLatestMtime(sessionPath);

    if (latestMtime === null) {
      continue; // empty session directory
    }

    const inactiveMs = timestamp - latestMtime;

    if (inactiveMs > thresholdMs) {
      findings.push({
        code: "BHV-010",
        message: {
          en: `Session "${sessionKey}" has been inactive for ${Math.round(inactiveMs / 60_000)} minutes`,
          zh: `会话 "${sessionKey}" 已不活跃 ${Math.round(inactiveMs / 60_000)} 分钟`,
        },
        severity: "warning",
        context: {
          sessionKey,
          inactiveMs,
          lastActivityAt: latestMtime,
          thresholdMs,
        },
      });
    }
  }

  const status: ProbeStatus = findings.length > 0 ? "warning" : "ok";

  return {
    probeId: "session",
    status,
    findings,
    metrics: {
      totalSessions: sessionDirs.length,
      inactiveSessions: findings.length,
    },
    timestamp,
  };
};

// --- Helpers ---

function readDirectoryEntries(dirPath: string): string[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function getLatestMtime(dirPath: string): number | null {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile());

    if (files.length === 0) return null;

    let latest = 0;
    for (const file of files) {
      const stat = fs.statSync(path.join(dirPath, file.name));
      if (stat.mtimeMs > latest) {
        latest = stat.mtimeMs;
      }
    }

    return latest > 0 ? latest : null;
  } catch {
    return null;
  }
}
