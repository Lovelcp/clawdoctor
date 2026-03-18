import type { ClawInsightEvent } from "../types/events.js";

export interface EventBufferOptions {
  maxSize: number;           // flush when buffer reaches this size (default: 100)
  flushIntervalMs: number;   // flush on interval (default: 5000)
  onFlush: (events: ClawInsightEvent[]) => void;
}

export interface EventBuffer {
  push(event: ClawInsightEvent): void;
  stop(): void;  // flush remaining + clear interval
}

export function createEventBuffer(opts: EventBufferOptions): EventBuffer {
  const { maxSize = 100, flushIntervalMs = 5000, onFlush } = opts;
  let buffer: ClawInsightEvent[] = [];

  function flush(): void {
    if (buffer.length === 0) return;
    const toFlush = buffer;
    buffer = [];
    onFlush(toFlush);
  }

  const intervalId = setInterval(flush, flushIntervalMs);

  return {
    push(event: ClawInsightEvent): void {
      buffer.push(event);
      if (buffer.length >= maxSize) {
        flush();
      }
    },

    stop(): void {
      clearInterval(intervalId);
      flush();
    },
  };
}
