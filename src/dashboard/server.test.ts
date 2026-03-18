// ===================================================
//  Dashboard Server Tests
//  Tests ALL 15 API endpoints against in-memory DB
// ===================================================

import { describe, it, expect, beforeEach } from "vitest";
import { createDashboardApp } from "./server.js";
import { openDatabase } from "../store/database.js";
import { createEventStore } from "../store/event-store.js";
import { createDiagnosisStore } from "../store/diagnosis-store.js";
import { createScoreStore } from "../store/score-store.js";
import { DEFAULT_CONFIG } from "../types/config.js";
import type Database from "better-sqlite3";
import type { ClawInsightEvent } from "../types/events.js";
import type { DiseaseInstance } from "../types/domain.js";
import type { Hono } from "hono";

// --- Test helpers ---

const AUTH_TOKEN = "test-secret-token-123";

function makeEvent(overrides: Partial<ClawInsightEvent> = {}): ClawInsightEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    source: "snapshot",
    timestamp: Date.now(),
    agentId: "default",
    sessionKey: "telegram:12345",
    sessionId: "session-uuid-abc",
    type: "tool_call",
    data: {
      toolName: "Bash",
      paramsSummary: { command: "string" },
      success: true,
    },
    ...overrides,
  };
}

function makeDiagnosis(overrides: Partial<DiseaseInstance> = {}): DiseaseInstance {
  return {
    id: `diag_${Math.random().toString(36).slice(2)}`,
    definitionId: "SK-001",
    severity: "warning",
    evidence: [
      {
        type: "metric",
        description: { en: "success rate below threshold" },
        value: 0.4,
        threshold: 0.7,
        confidence: 0.9,
      },
    ],
    confidence: 0.85,
    firstDetectedAt: Date.now() - 3600_000,
    lastSeenAt: Date.now(),
    status: "active",
    context: { toolName: "Bash" },
    ...overrides,
  };
}

async function request(
  app: Hono,
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) {
    headers["Authorization"] = `Bearer ${opts.token}`;
  }
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers,
  };
  if (opts.body) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await app.request(path, init);
  const json = await res.json();
  return { status: res.status, json };
}

// --- Test suite ---

describe("Dashboard Server", () => {
  let db: Database.Database;
  let app: Hono;
  let appNoAuth: Hono;

  beforeEach(() => {
    db = openDatabase(":memory:");
    app = createDashboardApp({ db, config: DEFAULT_CONFIG, authToken: AUTH_TOKEN });
    appNoAuth = createDashboardApp({ db, config: DEFAULT_CONFIG });
  });

  // ─── Auth tests ───

  describe("Auth middleware", () => {
    it("rejects GET /api/health without token", async () => {
      const { status, json } = await request(app, "/api/health");
      expect(status).toBe(401);
      expect(json).toHaveProperty("error", "Unauthorized");
    });

    it("rejects PUT /api/config without token", async () => {
      const { status, json } = await request(app, "/api/config", {
        method: "PUT",
        body: { locale: "zh" },
      });
      expect(status).toBe(401);
      expect(json).toHaveProperty("error", "Unauthorized");
    });

    it("rejects POST /api/prescriptions/rx-1/apply without token", async () => {
      const { status } = await request(app, "/api/prescriptions/rx-1/apply", { method: "POST" });
      expect(status).toBe(401);
    });

    it("rejects POST /api/prescriptions/rx-1/rollback without token", async () => {
      const { status } = await request(app, "/api/prescriptions/rx-1/rollback", { method: "POST" });
      expect(status).toBe(401);
    });

    it("accepts requests with correct token", async () => {
      const { status } = await request(app, "/api/health", { token: AUTH_TOKEN });
      // 404 is fine — just means no data, not auth failure
      expect(status).not.toBe(401);
    });

    it("works without auth when no token configured", async () => {
      const { status } = await request(appNoAuth, "/api/health");
      expect(status).not.toBe(401);
    });
  });

  // ─── 1. GET /api/health ───

  describe("GET /api/health", () => {
    it("returns 404 when no health data exists", async () => {
      const { status, json } = await request(app, "/api/health", { token: AUTH_TOKEN });
      expect(status).toBe(404);
      expect(json).toHaveProperty("error");
    });

    it("returns 200 with seeded health data", async () => {
      const store = createScoreStore(db);
      store.insertHealthScore({
        id: "score-1",
        agentId: "default",
        timestamp: Date.now(),
        dataMode: "snapshot",
        coverage: 0.8,
        overall: 72.5,
        vitals: 90,
        skill: 65,
        memory: 80,
        behavior: 70,
        cost: 60,
        security: 85,
      });

      const { status, json } = await request(app, "/api/health", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveProperty("overall", 72.5);
    });

    it("returns parsed healthScoreJson when available", async () => {
      const store = createScoreStore(db);
      const healthObj = { overall: 85, overallGrade: "B", dataMode: "stream", departments: {} };
      store.insertHealthScoreWithJson(
        {
          id: "score-json",
          agentId: "default",
          timestamp: Date.now(),
          dataMode: "stream",
          coverage: 0.9,
          overall: 85,
          vitals: null,
          skill: null,
          memory: null,
          behavior: null,
          cost: null,
          security: null,
        },
        JSON.stringify(healthObj),
      );

      const { status, json } = await request(app, "/api/health", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveProperty("overallGrade", "B");
    });
  });

  // ─── 2. GET /api/diseases ───

  describe("GET /api/diseases", () => {
    it("returns empty array when no diagnoses exist", async () => {
      const { status, json } = await request(app, "/api/diseases", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });

    it("returns seeded diagnoses", async () => {
      const store = createDiagnosisStore(db);
      store.insertDiagnosis("default", makeDiagnosis({ id: "d-1" }));
      store.insertDiagnosis("default", makeDiagnosis({ id: "d-2" }));

      const { status, json } = await request(app, "/api/diseases", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveLength(2);
    });

    it("filters by department", async () => {
      const store = createDiagnosisStore(db);
      store.insertDiagnosis("default", makeDiagnosis({ id: "d-sk", definitionId: "SK-001" }));
      store.insertDiagnosis("default", makeDiagnosis({ id: "d-mem", definitionId: "MEM-001" }));

      const { json } = await request(app, "/api/diseases?dept=skill", { token: AUTH_TOKEN });
      expect(json).toHaveLength(1);
      expect((json as Array<{ id: string }>)[0].id).toBe("d-sk");
    });

    it("filters by severity", async () => {
      const store = createDiagnosisStore(db);
      store.insertDiagnosis("default", makeDiagnosis({ id: "d-warn", severity: "warning" }));
      store.insertDiagnosis("default", makeDiagnosis({ id: "d-crit", severity: "critical" }));

      const { json } = await request(app, "/api/diseases?severity=critical", { token: AUTH_TOKEN });
      expect(json).toHaveLength(1);
      expect((json as Array<{ id: string }>)[0].id).toBe("d-crit");
    });

    it("filters by status", async () => {
      const store = createDiagnosisStore(db);
      store.insertDiagnosis("default", makeDiagnosis({ id: "d-active", status: "active" }));
      store.insertDiagnosis("default", makeDiagnosis({ id: "d-resolved", status: "resolved" }));

      const { json } = await request(app, "/api/diseases?status=active", { token: AUTH_TOKEN });
      expect(json).toHaveLength(1);
      expect((json as Array<{ id: string }>)[0].id).toBe("d-active");
    });
  });

  // ─── 3. GET /api/diseases/:id ───

  describe("GET /api/diseases/:id", () => {
    it("returns 404 for non-existent diagnosis", async () => {
      const { status } = await request(app, "/api/diseases/nonexistent", { token: AUTH_TOKEN });
      expect(status).toBe(404);
    });

    it("returns a specific diagnosis by ID", async () => {
      const store = createDiagnosisStore(db);
      store.insertDiagnosis("default", makeDiagnosis({ id: "diag-specific" }));

      const { status, json } = await request(app, "/api/diseases/diag-specific", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveProperty("id", "diag-specific");
    });
  });

  // ─── 4. GET /api/prescriptions ───

  describe("GET /api/prescriptions", () => {
    it("returns empty array when no prescriptions exist", async () => {
      const { status, json } = await request(app, "/api/prescriptions", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });
  });

  // ─── 5. GET /api/prescriptions/:id/followup ───

  describe("GET /api/prescriptions/:id/followup", () => {
    it("returns empty array for non-existent prescription followup", async () => {
      const { status, json } = await request(app, "/api/prescriptions/rx-1/followup", {
        token: AUTH_TOKEN,
      });
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });
  });

  // ─── 6. GET /api/metrics/:dept ───

  describe("GET /api/metrics/:dept", () => {
    it("returns 400 for invalid department", async () => {
      const { status } = await request(app, "/api/metrics/invalid", { token: AUTH_TOKEN });
      expect(status).toBe(400);
    });

    it("returns metrics for a valid department", async () => {
      const { status, json } = await request(app, "/api/metrics/skill", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveProperty("department", "skill");
      expect(json).toHaveProperty("metrics");
    });
  });

  // ─── 7. GET /api/trends ───

  describe("GET /api/trends", () => {
    it("returns empty array when no score history", async () => {
      const { status, json } = await request(app, "/api/trends", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });

    it("returns score history as array", async () => {
      const store = createScoreStore(db);
      const now = Date.now();
      store.insertHealthScore({
        id: "s-1",
        agentId: "default",
        timestamp: now - 1000,
        dataMode: "snapshot",
        coverage: 0.8,
        overall: 70,
        vitals: null,
        skill: null,
        memory: null,
        behavior: null,
        cost: null,
        security: null,
      });
      store.insertHealthScore({
        id: "s-2",
        agentId: "default",
        timestamp: now,
        dataMode: "snapshot",
        coverage: 0.9,
        overall: 80,
        vitals: null,
        skill: null,
        memory: null,
        behavior: null,
        cost: null,
        security: null,
      });

      const { status, json } = await request(app, "/api/trends", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveLength(2);
    });
  });

  // ─── 8. GET /api/events ───

  describe("GET /api/events", () => {
    it("returns paginated events with defaults", async () => {
      const { status, json } = await request(app, "/api/events", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveProperty("items");
      expect(json).toHaveProperty("page", 1);
      expect(json).toHaveProperty("limit", 20);
      expect(json).toHaveProperty("total");
      expect(json).toHaveProperty("totalPages");
    });

    it("paginates correctly", async () => {
      const store = createEventStore(db);
      for (let i = 0; i < 25; i++) {
        store.insertEvent(makeEvent({ id: `evt-${i}`, timestamp: Date.now() + i }));
      }

      // Page 1
      const p1 = await request(app, "/api/events?page=1&limit=10", { token: AUTH_TOKEN });
      expect(p1.status).toBe(200);
      expect((p1.json as { items: unknown[] }).items).toHaveLength(10);
      expect(p1.json).toHaveProperty("total", 25);
      expect(p1.json).toHaveProperty("totalPages", 3);

      // Page 3
      const p3 = await request(app, "/api/events?page=3&limit=10", { token: AUTH_TOKEN });
      expect(p3.status).toBe(200);
      expect((p3.json as { items: unknown[] }).items).toHaveLength(5);
    });

    it("filters events by type", async () => {
      const store = createEventStore(db);
      store.insertEvent(makeEvent({ id: "e-tc", type: "tool_call" }));
      store.insertEvent(
        makeEvent({
          id: "e-llm",
          type: "llm_call",
          data: { provider: "anthropic", model: "claude-3-5-sonnet", success: true },
        }),
      );

      const { json } = await request(app, "/api/events?type=tool_call", { token: AUTH_TOKEN });
      expect((json as { items: Array<{ id: string }> }).items).toHaveLength(1);
      expect((json as { items: Array<{ id: string }> }).items[0].id).toBe("e-tc");
    });
  });

  // ─── 9. GET /api/causal-chains ───

  describe("GET /api/causal-chains", () => {
    it("returns empty array when no chains exist", async () => {
      const { status, json } = await request(app, "/api/causal-chains", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });

    it("returns seeded causal chains", async () => {
      db.prepare(`
        INSERT INTO causal_chains (id, agent_id, name_json, root_cause_json, chain_json, impact_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        "chain-1",
        "default",
        JSON.stringify({ en: "Test Chain" }),
        JSON.stringify({ diseaseId: "SK-001", instanceId: "d-1", summary: { en: "Root" } }),
        JSON.stringify([]),
        JSON.stringify({ en: "High impact" }),
      );

      const { status, json } = await request(app, "/api/causal-chains", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveLength(1);
      expect((json as Array<{ id: string }>)[0].id).toBe("chain-1");
    });
  });

  // ─── 10. GET /api/config ───

  describe("GET /api/config", () => {
    it("returns the config", async () => {
      const { status, json } = await request(app, "/api/config", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveProperty("locale", "en");
      expect(json).toHaveProperty("thresholds");
      expect(json).toHaveProperty("weights");
    });
  });

  // ─── 11. GET /api/skills ───

  describe("GET /api/skills", () => {
    it("returns empty plugins when no snapshot exists", async () => {
      const { status, json } = await request(app, "/api/skills", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveProperty("plugins");
      expect((json as { plugins: unknown[] }).plugins).toEqual([]);
    });

    it("returns latest plugin snapshot data", async () => {
      const store = createEventStore(db);
      store.insertEvent(
        makeEvent({
          id: "ps-1",
          type: "plugin_snapshot",
          data: {
            plugins: [
              {
                id: "my-plugin",
                name: "My Plugin",
                version: "1.0.0",
                source: "workspace",
                status: "loaded",
                registeredTools: ["tool1"],
                registeredHooks: [],
              },
            ],
          },
        }),
      );

      const { status, json } = await request(app, "/api/skills", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect((json as { plugins: Array<{ id: string }> }).plugins).toHaveLength(1);
      expect((json as { plugins: Array<{ id: string }> }).plugins[0].id).toBe("my-plugin");
    });
  });

  // ─── 12. GET /api/memory ───

  describe("GET /api/memory", () => {
    it("returns empty memory when no snapshot exists", async () => {
      const { status, json } = await request(app, "/api/memory", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveProperty("totalCount", 0);
    });

    it("returns latest memory snapshot data", async () => {
      const store = createEventStore(db);
      store.insertEvent(
        makeEvent({
          id: "ms-1",
          type: "memory_snapshot",
          data: {
            files: [{ path: "memory/test.md", sizeBytes: 1024, modifiedAt: Date.now() }],
            totalCount: 1,
            totalSizeBytes: 1024,
          },
        }),
      );

      const { status, json } = await request(app, "/api/memory", { token: AUTH_TOKEN });
      expect(status).toBe(200);
      expect(json).toHaveProperty("totalCount", 1);
      expect((json as { files: Array<{ path: string }> }).files).toHaveLength(1);
    });
  });

  // ─── 13. PUT /api/config ───

  describe("PUT /api/config", () => {
    it("is rejected without auth", async () => {
      const { status } = await request(app, "/api/config", {
        method: "PUT",
        body: { locale: "zh" },
      });
      expect(status).toBe(401);
    });

    it("accepts config update with auth", async () => {
      const { status, json } = await request(app, "/api/config", {
        method: "PUT",
        body: { locale: "zh" },
        token: AUTH_TOKEN,
      });
      expect(status).toBe(200);
      expect(json).toHaveProperty("status", "accepted");
    });
  });

  // ─── 14. POST /api/prescriptions/:id/apply ───

  describe("POST /api/prescriptions/:id/apply", () => {
    it("is rejected without auth", async () => {
      const { status } = await request(app, "/api/prescriptions/rx-1/apply", { method: "POST" });
      expect(status).toBe(401);
    });

    it("returns 501 not implemented placeholder", async () => {
      const { status, json } = await request(app, "/api/prescriptions/rx-1/apply", {
        method: "POST",
        token: AUTH_TOKEN,
      });
      expect(status).toBe(501);
      expect(json).toHaveProperty("status", "not_implemented");
    });
  });

  // ─── 15. POST /api/prescriptions/:id/rollback ───

  describe("POST /api/prescriptions/:id/rollback", () => {
    it("is rejected without auth", async () => {
      const { status } = await request(app, "/api/prescriptions/rx-1/rollback", { method: "POST" });
      expect(status).toBe(401);
    });

    it("returns 501 not implemented placeholder", async () => {
      const { status, json } = await request(app, "/api/prescriptions/rx-1/rollback", {
        method: "POST",
        token: AUTH_TOKEN,
      });
      expect(status).toBe(501);
      expect(json).toHaveProperty("status", "not_implemented");
    });
  });

  // ─── SPA shell ───

  describe("SPA shell", () => {
    it("GET / returns HTML (no auth required)", async () => {
      const res = await app.request("/");
      expect(res.status).toBe(200);
      const contentType = res.headers.get("content-type") ?? "";
      expect(contentType).toContain("text/html");
    });
  });
});
