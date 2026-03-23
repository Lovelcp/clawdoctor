import { describe, it, expect, vi } from "vitest";
import { gatewayProbe } from "./gateway-probe.js";
import type { ProbeConfig } from "../../types/monitor.js";
import type { ShellExecutor, ProbeDeps } from "../probe.js";

function makeDeps(exec: ShellExecutor): ProbeDeps {
  return {
    stateDir: "/tmp/test-state",
    exec,
    store: {} as ProbeDeps["store"],
    db: {} as ProbeDeps["db"],
  };
}

const config: ProbeConfig = {
  id: "gateway",
  intervalMs: 30000,
  enabled: true,
  params: {},
};

describe("gatewayProbe", () => {
  it("returns ok when gateway status command succeeds", async () => {
    const exec = vi.fn<ShellExecutor>().mockResolvedValue({
      stdout: "Gateway running on port 8080",
      stderr: "",
      exitCode: 0,
    });

    const result = await gatewayProbe(config, makeDeps(exec));

    expect(result.probeId).toBe("gateway");
    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(0);
  });

  it("falls back to pgrep when gateway status fails, returns ok if process found", async () => {
    const exec = vi.fn<ShellExecutor>()
      .mockResolvedValueOnce({ stdout: "", stderr: "not found", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: "12345", stderr: "", exitCode: 0 });

    const result = await gatewayProbe(config, makeDeps(exec));

    expect(result.probeId).toBe("gateway");
    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(0);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenNthCalledWith(2, "pgrep", ["-f", "openclaw-gateway"]);
  });

  it("returns critical finding INFRA-001 when gateway not running", async () => {
    const exec = vi.fn<ShellExecutor>()
      .mockResolvedValueOnce({ stdout: "", stderr: "not found", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 });

    const result = await gatewayProbe(config, makeDeps(exec));

    expect(result.probeId).toBe("gateway");
    expect(result.status).toBe("critical");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].code).toBe("INFRA-001");
    expect(result.findings[0].severity).toBe("critical");
    expect(result.findings[0].message.en).toBeTruthy();
  });

  it("returns error status when shell command throws", async () => {
    const exec = vi.fn<ShellExecutor>().mockRejectedValue(new Error("command not found"));

    const result = await gatewayProbe(config, makeDeps(exec));

    expect(result.probeId).toBe("gateway");
    expect(result.status).toBe("error");
    expect(result.findings).toHaveLength(0);
  });
});
