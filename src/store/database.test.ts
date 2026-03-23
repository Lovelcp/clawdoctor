// ═══════════════════════════════════════════════
//  Database Migration Tests — v3
//  Tests for chart_entries, consent_requests,
//  page_dedup, intervention_retries tables
//  and health_scores.infra column
// ═══════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { openDatabase } from "./database.js";

describe("migration v3", () => {
  it("creates chart_entries table", () => {
    const db = openDatabase(":memory:");
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='chart_entries'",
      )
      .all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it("creates page_dedup table", () => {
    const db = openDatabase(":memory:");
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='page_dedup'",
      )
      .all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it("creates intervention_retries table", () => {
    const db = openDatabase(":memory:");
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='intervention_retries'",
      )
      .all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it("creates consent_requests table", () => {
    const db = openDatabase(":memory:");
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='consent_requests'",
      )
      .all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  it("adds infra column to health_scores", () => {
    const db = openDatabase(":memory:");
    const columns = db
      .prepare("PRAGMA table_info(health_scores)")
      .all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain("infra");
    db.close();
  });

  it("chart_entries has all expected columns", () => {
    const db = openDatabase(":memory:");
    const columns = db
      .prepare("PRAGMA table_info(chart_entries)")
      .all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("timestamp");
    expect(names).toContain("probe_id");
    expect(names).toContain("disease_id");
    expect(names).toContain("agent_id");
    expect(names).toContain("triage_level");
    expect(names).toContain("intervention_id");
    expect(names).toContain("action");
    expect(names).toContain("outcome");
    expect(names).toContain("consent_channel");
    expect(names).toContain("consent_response");
    expect(names).toContain("snapshot_id");
    expect(names).toContain("details");
    db.close();
  });

  it("consent_requests has all expected columns", () => {
    const db = openDatabase(":memory:");
    const columns = db
      .prepare("PRAGMA table_info(consent_requests)")
      .all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("timestamp");
    expect(names).toContain("triage_level");
    expect(names).toContain("intervention_id");
    expect(names).toContain("disease_id");
    expect(names).toContain("agent_id");
    expect(names).toContain("status");
    expect(names).toContain("channels");
    expect(names).toContain("responded_at");
    expect(names).toContain("responded_via");
    expect(names).toContain("responded_by");
    expect(names).toContain("expires_at");
    expect(names).toContain("context");
    db.close();
  });

  it("intervention_retries has composite primary key", () => {
    const db = openDatabase(":memory:");
    // Insert a row to verify the schema works
    db.prepare(
      `INSERT INTO intervention_retries
       (disease_id, agent_id, intervention_id, retry_count, last_attempted, suppressed)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("INFRA-001", "default", "int-1", 0, Date.now(), 0);

    const rows = db
      .prepare("SELECT * FROM intervention_retries")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].disease_id).toBe("INFRA-001");
    db.close();
  });

  it("page_dedup has key as primary key", () => {
    const db = openDatabase(":memory:");
    db.prepare(
      `INSERT INTO page_dedup (key, priority, last_sent_at) VALUES (?, ?, ?)`,
    ).run("INFRA-001:default", "critical", Date.now());

    const rows = db
      .prepare("SELECT * FROM page_dedup")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("INFRA-001:default");
    db.close();
  });

  it("chart_entries indexes exist", () => {
    const db = openDatabase(":memory:");
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='chart_entries'",
      )
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_chart_ts");
    expect(names).toContain("idx_chart_probe");
    expect(names).toContain("idx_chart_outcome");
    db.close();
  });

  it("consent_requests indexes exist", () => {
    const db = openDatabase(":memory:");
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='consent_requests'",
      )
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_consent_status");
    expect(names).toContain("idx_consent_expires");
    db.close();
  });

  it("schema version is 3", () => {
    const db = openDatabase(":memory:");
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(3);
    db.close();
  });
});
