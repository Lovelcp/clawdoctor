import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../store/database.js";
import { createChartStore } from "./chart-store.js";
import type Database from "better-sqlite3";
import type { ChartEntry } from "../types/monitor.js";

describe("ChartStore", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  it("inserts and retrieves a chart entry", () => {
    const store = createChartStore(db);
    const entry: ChartEntry = {
      id: "01ABC",
      timestamp: Date.now(),
      probeId: "gateway",
      diseaseId: "INFRA-001",
      agentId: "main",
      triageLevel: "red",
      action: "alert-sent",
      outcome: "success",
      details: { message: "Gateway down" },
    };
    store.insert(entry);
    const results = store.query({ limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("01ABC");
    expect(results[0].probeId).toBe("gateway");
    expect(results[0].details).toEqual({ message: "Gateway down" });
  });

  it("filters by probe", () => {
    const store = createChartStore(db);
    store.insert({ id: "1", timestamp: 1000, probeId: "gateway", action: "a", outcome: "success", details: {} });
    store.insert({ id: "2", timestamp: 2000, probeId: "cron", action: "b", outcome: "failed", details: {} });
    const results = store.query({ probeId: "gateway", limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].probeId).toBe("gateway");
  });

  it("filters by outcome", () => {
    const store = createChartStore(db);
    store.insert({ id: "1", timestamp: 1000, action: "a", outcome: "success", details: {} });
    store.insert({ id: "2", timestamp: 2000, action: "b", outcome: "failed", details: {} });
    const results = store.query({ outcome: "failed", limit: 10 });
    expect(results).toHaveLength(1);
  });

  it("filters by since timestamp", () => {
    const store = createChartStore(db);
    store.insert({ id: "1", timestamp: 1000, action: "old", outcome: "success", details: {} });
    store.insert({ id: "2", timestamp: 5000, action: "new", outcome: "success", details: {} });
    const results = store.query({ since: 3000, limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("new");
  });

  it("returns results ordered by timestamp desc", () => {
    const store = createChartStore(db);
    store.insert({ id: "1", timestamp: 1000, action: "first", outcome: "success", details: {} });
    store.insert({ id: "2", timestamp: 3000, action: "third", outcome: "success", details: {} });
    store.insert({ id: "3", timestamp: 2000, action: "second", outcome: "success", details: {} });
    const results = store.query({ limit: 10 });
    expect(results[0].action).toBe("third");
    expect(results[1].action).toBe("second");
    expect(results[2].action).toBe("first");
  });

  it("respects limit", () => {
    const store = createChartStore(db);
    for (let i = 0; i < 5; i++) {
      store.insert({ id: `${i}`, timestamp: i * 1000, action: `a${i}`, outcome: "success", details: {} });
    }
    const results = store.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });
});
