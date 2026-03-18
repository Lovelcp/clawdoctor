import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEventBuffer } from "./event-buffer.js";
import type { ClawDocEvent } from "../types/events.js";

function makeEvent(id: string): ClawDocEvent {
  return {
    id,
    source: "stream",
    timestamp: Date.now(),
    agentId: "agent-1",
    type: "tool_call",
    data: {
      toolName: "bash",
      paramsSummary: {},
      success: true,
    },
  };
}

describe("createEventBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buffers events and flushes when size limit is reached", () => {
    const flushed: ClawDocEvent[][] = [];
    const buffer = createEventBuffer({
      maxSize: 3,
      flushIntervalMs: 5000,
      onFlush: (events) => flushed.push(events),
    });

    buffer.push(makeEvent("1"));
    buffer.push(makeEvent("2"));
    expect(flushed).toHaveLength(0);

    buffer.push(makeEvent("3"));
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toHaveLength(3);
    expect(flushed[0].map((e) => e.id)).toEqual(["1", "2", "3"]);

    buffer.stop();
  });

  it("flushes remaining events on stop", () => {
    const flushed: ClawDocEvent[][] = [];
    const buffer = createEventBuffer({
      maxSize: 100,
      flushIntervalMs: 5000,
      onFlush: (events) => flushed.push(events),
    });

    buffer.push(makeEvent("a"));
    buffer.push(makeEvent("b"));
    expect(flushed).toHaveLength(0);

    buffer.stop();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("auto-flushes after interval fires", () => {
    const flushed: ClawDocEvent[][] = [];
    const buffer = createEventBuffer({
      maxSize: 100,
      flushIntervalMs: 5000,
      onFlush: (events) => flushed.push(events),
    });

    buffer.push(makeEvent("x"));
    buffer.push(makeEvent("y"));
    expect(flushed).toHaveLength(0);

    vi.advanceTimersByTime(5000);
    expect(flushed).toHaveLength(1);
    expect(flushed[0].map((e) => e.id)).toEqual(["x", "y"]);

    buffer.stop();
  });

  it("does not flush an empty buffer", () => {
    const onFlush = vi.fn();
    const buffer = createEventBuffer({
      maxSize: 10,
      flushIntervalMs: 5000,
      onFlush,
    });

    vi.advanceTimersByTime(5000);
    expect(onFlush).not.toHaveBeenCalled();

    buffer.stop();
    expect(onFlush).not.toHaveBeenCalled();
  });
});
