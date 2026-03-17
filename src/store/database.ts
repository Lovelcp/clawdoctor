// ═══════════════════════════════════════════════
//  SQLite Database — open + migrate
//  Design spec §5.4, §8.1, §8.2
// ═══════════════════════════════════════════════

import BetterSqlite3 from "better-sqlite3";
import type Database from "better-sqlite3";

// ─── Schema version ───

const CURRENT_SCHEMA_VERSION = 1;

// ─── Migration: version 1 — initial schema ───

function migration1(db: Database.Database): void {
  db.exec(`
    -- Unified events table
    CREATE TABLE events (
      id          TEXT PRIMARY KEY,
      source      TEXT NOT NULL,
      timestamp   INTEGER NOT NULL,
      agent_id    TEXT NOT NULL,
      session_key TEXT,
      session_id  TEXT,
      type        TEXT NOT NULL,
      data        TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );

    CREATE INDEX idx_events_type_ts   ON events(type, timestamp);
    CREATE INDEX idx_events_agent_ts  ON events(agent_id, timestamp);
    CREATE INDEX idx_events_session   ON events(session_key, timestamp);

    -- Diagnosis results
    CREATE TABLE diagnoses (
      id              TEXT PRIMARY KEY,
      disease_id      TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      severity        TEXT NOT NULL,
      confidence      REAL NOT NULL,
      evidence_json   TEXT NOT NULL,
      context_json    TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      first_detected  INTEGER NOT NULL,
      last_seen       INTEGER NOT NULL,
      resolved_at     INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );

    CREATE INDEX idx_diagnoses_agent   ON diagnoses(agent_id, status);
    CREATE INDEX idx_diagnoses_disease ON diagnoses(disease_id);

    -- Prescriptions
    CREATE TABLE prescriptions (
      id                     TEXT PRIMARY KEY,
      diagnosis_id           TEXT NOT NULL REFERENCES diagnoses(id),
      type                   TEXT NOT NULL,
      actions_json           TEXT NOT NULL,
      status                 TEXT NOT NULL DEFAULT 'pending',
      backup_json            TEXT,
      pre_apply_metrics_json TEXT,
      applied_at             INTEGER,
      rolled_back_at         INTEGER,
      created_at             INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );

    -- Follow-up schedules
    CREATE TABLE followups (
      id              TEXT PRIMARY KEY,
      prescription_id TEXT NOT NULL REFERENCES prescriptions(id),
      checkpoint      TEXT NOT NULL,
      scheduled_at    INTEGER NOT NULL,
      completed_at    INTEGER,
      result_json     TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );

    CREATE INDEX idx_followups_pending ON followups(completed_at)
      WHERE completed_at IS NULL;

    -- Health score history
    CREATE TABLE health_scores (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      timestamp   INTEGER NOT NULL,
      data_mode   TEXT NOT NULL,
      coverage    REAL NOT NULL,
      overall     REAL,
      vitals      REAL,
      skill       REAL,
      memory      REAL,
      behavior    REAL,
      cost        REAL,
      security    REAL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
    );

    CREATE INDEX idx_scores_agent_ts ON health_scores(agent_id, timestamp);
  `);
}

// ─── Migration registry ───

const MIGRATIONS: Record<number, (db: Database.Database) => void> = {
  1: migration1,
};

// ─── Migrate if needed ───

function migrateIfNeeded(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current < CURRENT_SCHEMA_VERSION) {
    for (let v = current + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      MIGRATIONS[v](db);
    }
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  }
}

// ─── openDatabase ───

/**
 * Opens (or creates) a better-sqlite3 database at `path`.
 * Configures WAL mode, busy_timeout, and runs schema migrations.
 *
 * Pass ":memory:" for an ephemeral in-memory database.
 */
export function openDatabase(path: string): Database.Database {
  const db = new BetterSqlite3(path);

  // WAL mode for concurrent reads while one writer holds the lock.
  // Note: in-memory DBs stay in 'memory' mode, which is fine.
  db.pragma("journal_mode = WAL");

  // Prevents immediate SQLITE_BUSY errors under write contention.
  db.pragma("busy_timeout = 5000");

  migrateIfNeeded(db);

  return db;
}
