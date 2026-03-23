import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createProbeScheduler } from "./probe-scheduler.js";
import type { ProbeConfig, ProbeResult } from "../types/monitor.js";
import type { Probe } from "./probe.js";

describe("ProbeScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs a probe at the configured interval", async () => {
    const fn = vi.fn<Probe>().mockResolvedValue({
      probeId: "gateway",
      status: "ok",
      findings: [],
      metrics: {},
      timestamp: Date.now(),
    });

    const config: ProbeConfig = { id: "gateway", intervalMs: 1000, enabled: true, params: {} };
    const onResult = vi.fn();
    const scheduler = createProbeScheduler(onResult);
    scheduler.start([{ config, fn }]);

    // First run is immediate
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Second run after interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });

  it("does not overlap — next run waits for completion", async () => {
    // Use a controllable delay instead of a manually resolved promise
    // so we can precisely control timing without hanging microtask chains
    let callCount = 0;
    const callTimestamps: number[] = [];
    const fn = vi.fn<Probe>().mockImplementation(async () => {
      callCount++;
      callTimestamps.push(Date.now());
      // First call: simulate a slow probe (takes 500ms, longer than interval)
      if (callCount === 1) {
        await new Promise<void>((r) => setTimeout(r, 500));
      }
      return {
        probeId: "gateway",
        status: "ok",
        findings: [],
        metrics: {},
        timestamp: Date.now(),
      };
    });

    const config: ProbeConfig = { id: "gateway", intervalMs: 100, enabled: true, params: {} };
    const onResult = vi.fn();
    const scheduler = createProbeScheduler(onResult);
    scheduler.start([{ config, fn }]);

    // Fire the initial setTimeout(0) — starts first probe
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance 200ms — probe is still running (takes 500ms), should NOT call again
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance to 500ms — probe completes, schedules next after intervalMs (100)
    await vi.advanceTimersByTimeAsync(300);
    expect(fn).toHaveBeenCalledTimes(1); // just finished, next run scheduled

    // Advance another 100ms — next probe fires
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    await scheduler.stop();
  });

  it("tracks consecutive errors and resets on success", async () => {
    let callCount = 0;
    const fn = vi.fn<Probe>().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) throw new Error("fail");
      return { probeId: "gateway", status: "ok", findings: [], metrics: {}, timestamp: Date.now() };
    });

    const config: ProbeConfig = { id: "gateway", intervalMs: 100, enabled: true, params: {} };
    const onResult = vi.fn();
    const scheduler = createProbeScheduler(onResult);
    scheduler.start([{ config, fn }]);

    // Run 1: error
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.stats()["gateway"].consecutiveErrors).toBe(1);

    // Run 2: error
    await vi.advanceTimersByTimeAsync(100);
    expect(scheduler.stats()["gateway"].consecutiveErrors).toBe(2);

    // Run 3: success
    await vi.advanceTimersByTimeAsync(100);
    expect(scheduler.stats()["gateway"].consecutiveErrors).toBe(0);

    await scheduler.stop();
  });

  it("calls onResult with probe results", async () => {
    const result: ProbeResult = {
      probeId: "gateway",
      status: "warning",
      findings: [{ code: "INFRA-001", message: { en: "down" }, severity: "critical", context: {} }],
      metrics: {},
      timestamp: Date.now(),
    };
    const fn = vi.fn<Probe>().mockResolvedValue(result);
    const config: ProbeConfig = { id: "gateway", intervalMs: 1000, enabled: true, params: {} };
    const onResult = vi.fn();
    const scheduler = createProbeScheduler(onResult);
    scheduler.start([{ config, fn }]);

    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith(result);

    await scheduler.stop();
  });

  it("does not call onResult when probe throws", async () => {
    const fn = vi.fn<Probe>().mockRejectedValue(new Error("boom"));
    const config: ProbeConfig = { id: "gateway", intervalMs: 1000, enabled: true, params: {} };
    const onResult = vi.fn();
    const scheduler = createProbeScheduler(onResult);
    scheduler.start([{ config, fn }]);

    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).not.toHaveBeenCalled();

    await scheduler.stop();
  });

  it("tracks runCount across runs", async () => {
    const fn = vi.fn<Probe>().mockResolvedValue({
      probeId: "gateway",
      status: "ok",
      findings: [],
      metrics: {},
      timestamp: Date.now(),
    });
    const config: ProbeConfig = { id: "gateway", intervalMs: 100, enabled: true, params: {} };
    const onResult = vi.fn();
    const scheduler = createProbeScheduler(onResult);
    scheduler.start([{ config, fn }]);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(100);

    expect(scheduler.stats()["gateway"].runCount).toBe(3);

    await scheduler.stop();
  });
});
