// ===============================================
//  Gateway Probe — checks OpenClaw gateway health
//  Emits INFRA-001 if gateway process not running
// ===============================================

import type { ProbeConfig, ProbeResult, Finding } from "../../types/monitor.js";
import type { Probe, ProbeDeps } from "../probe.js";

export const gatewayProbe: Probe = async (
  config: ProbeConfig,
  deps: ProbeDeps,
): Promise<ProbeResult> => {
  const timestamp = Date.now();

  try {
    // Primary check: openclaw gateway status
    const statusResult = await deps.exec("openclaw", ["gateway", "status"]);

    if (statusResult.exitCode === 0) {
      return {
        probeId: "gateway",
        status: "ok",
        findings: [],
        metrics: {},
        timestamp,
      };
    }

    // Fallback: pgrep for gateway process
    const pgrepResult = await deps.exec("pgrep", ["-f", "openclaw-gateway"]);

    if (pgrepResult.exitCode === 0) {
      return {
        probeId: "gateway",
        status: "ok",
        findings: [],
        metrics: {},
        timestamp,
      };
    }

    // Gateway not running — emit INFRA-001
    const finding: Finding = {
      code: "INFRA-001",
      message: {
        en: "OpenClaw gateway process is not running",
        zh: "OpenClaw 网关进程未运行",
      },
      severity: "critical",
      context: {
        statusExitCode: statusResult.exitCode,
        statusStderr: statusResult.stderr,
      },
    };

    return {
      probeId: "gateway",
      status: "critical",
      findings: [finding],
      metrics: {},
      timestamp,
    };
  } catch (err) {
    // Shell command itself failed (e.g., binary not found)
    return {
      probeId: "gateway",
      status: "error",
      findings: [],
      metrics: {},
      timestamp,
    };
  }
};
