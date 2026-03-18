// ===================================================
//  Dashboard Server
//  Hono app with 15 API routes + SPA shell
//  Design spec: Phase 2, Task 5
// ===================================================

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import type { ClawDocConfig } from "../types/config.js";
import type { EventType } from "../types/events.js";
import { loadConfig } from "../config/loader.js";
import { createEventStore } from "../store/event-store.js";
import { createDiagnosisStore } from "../store/diagnosis-store.js";
import { createScoreStore } from "../store/score-store.js";
import { aggregateMetrics } from "../analysis/metric-aggregator.js";
import type { Department } from "../types/domain.js";

// --- Types ---

export interface DashboardOptions {
  db: Database.Database;
  config: ClawDocConfig;
  authToken?: string;
}

// --- SPA HTML loader ---

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPA_PATH = resolve(__dirname, "public", "index.html");

function loadSpaHtml(token?: string): string {
  let html: string;
  try {
    html = readFileSync(SPA_PATH, "utf-8");
  } catch {
    html = "<!DOCTYPE html><html><body><h1>ClawDoc Dashboard</h1><p>SPA not found.</p></body></html>";
  }
  if (token) {
    html = html.replace(
      "</head>",
      `<script>window.__CLAWDOC_TOKEN__="${token}";</script></head>`,
    );
  }
  return html;
}

// --- Valid departments for validation ---

const VALID_DEPARTMENTS = new Set<string>([
  "vitals", "skill", "memory", "behavior", "cost", "security",
]);

// --- Factory ---

export function createDashboardApp(opts: DashboardOptions): Hono {
  const { db, config, authToken } = opts;

  const app = new Hono();
  const eventStore = createEventStore(db);
  const diagnosisStore = createDiagnosisStore(db);
  const scoreStore = createScoreStore(db);

  // ─── Auth middleware: ALL /api/* require bearer token ───

  app.use("/api/*", async (c, next) => {
    if (!authToken) {
      return next();
    }
    const authHeader = c.req.header("Authorization");
    if (!authHeader || authHeader !== `Bearer ${authToken}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  // ─── API Routes (15 total) ───

  // 1. GET /api/health — latest health score
  app.get("/api/health", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const latest = scoreStore.queryLatestScore(agentId);
    if (!latest) {
      return c.json({ error: "No health score data" }, 404);
    }
    if (latest.healthScoreJson) {
      try {
        return c.json(JSON.parse(latest.healthScoreJson));
      } catch {
        // fall through to return the record
      }
    }
    return c.json(latest);
  });

  // 2. GET /api/diseases — list diagnoses with optional filters
  app.get("/api/diseases", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const dept = c.req.query("dept");
    const severity = c.req.query("severity");
    const status = c.req.query("status") as "active" | "recovering" | "resolved" | undefined;

    let results = diagnosisStore.queryDiagnoses({
      agentId,
      status: status || undefined,
    });

    // Post-filter by department prefix (disease IDs encode department)
    if (dept) {
      const deptPrefixMap: Record<string, string[]> = {
        vitals: ["VIT-", "VITALS-"],
        skill: ["SK-", "SKILL-"],
        memory: ["MEM-", "MEMORY-"],
        behavior: ["BEH-", "BEHAVIOR-"],
        cost: ["COST-", "CST-"],
        security: ["SEC-", "SECURITY-"],
      };
      const prefixes = deptPrefixMap[dept] ?? [dept.toUpperCase() + "-"];
      results = results.filter((d) =>
        prefixes.some((p) => d.definitionId.toUpperCase().startsWith(p)),
      );
    }

    // Post-filter by severity
    if (severity) {
      results = results.filter((d) => d.severity === severity);
    }

    return c.json(results);
  });

  // 3. GET /api/diseases/:id — single diagnosis
  app.get("/api/diseases/:id", (c) => {
    const id = c.req.param("id");
    const agentId = c.req.query("agentId") ?? "default";
    const all = diagnosisStore.queryDiagnoses({ agentId });
    const found = all.find((d) => d.id === id);
    if (!found) {
      return c.json({ error: "Diagnosis not found" }, 404);
    }
    return c.json(found);
  });

  // 4. GET /api/prescriptions — list prescriptions
  app.get("/api/prescriptions", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    try {
      const rows = db.prepare(`
        SELECT p.* FROM prescriptions p
        JOIN diagnoses d ON p.diagnosis_id = d.id
        WHERE d.agent_id = ?
        ORDER BY p.created_at DESC
      `).all(agentId) as Array<Record<string, unknown>>;
      return c.json(rows);
    } catch {
      return c.json([]);
    }
  });

  // 5. GET /api/prescriptions/:id/followup — follow-up result
  app.get("/api/prescriptions/:id/followup", (c) => {
    const id = c.req.param("id");
    try {
      const rows = db.prepare(`
        SELECT * FROM followups
        WHERE prescription_id = ?
        ORDER BY scheduled_at DESC
      `).all(id) as Array<Record<string, unknown>>;
      return c.json(rows);
    } catch {
      return c.json([]);
    }
  });

  // 6. GET /api/metrics/:dept — department metrics
  app.get("/api/metrics/:dept", (c) => {
    const dept = c.req.param("dept");
    if (!VALID_DEPARTMENTS.has(dept)) {
      return c.json({ error: `Invalid department: ${dept}` }, 400);
    }
    const agentId = c.req.query("agentId") ?? "default";
    const now = Date.now();
    const fromMs = Number(c.req.query("from")) || now - 7 * 24 * 60 * 60 * 1000;
    const toMs = Number(c.req.query("to")) || now;

    const metrics = aggregateMetrics(db, agentId, { from: fromMs, to: toMs });
    const deptData = metrics[dept as Department];
    if (!deptData) {
      return c.json({ error: `No data for department: ${dept}` }, 404);
    }
    return c.json({
      department: dept,
      timeRange: metrics.timeRange,
      agentId: metrics.agentId,
      metrics: deptData,
    });
  });

  // 7. GET /api/trends — score history
  app.get("/api/trends", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const since = c.req.query("since") ? Number(c.req.query("since")) : undefined;
    const until = c.req.query("until") ? Number(c.req.query("until")) : undefined;
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

    const history = scoreStore.queryScoreHistory({ agentId, since, until, limit });
    return c.json(history);
  });

  // 8. GET /api/events — paginated event list
  app.get("/api/events", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 20));
    const type = c.req.query("type") as EventType | undefined;

    const allEvents = eventStore.queryEvents({
      agentId,
      type: type || undefined,
    });

    const total = allEvents.length;
    const offset = (page - 1) * limit;
    const items = allEvents.slice(offset, offset + limit);

    return c.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  });

  // 9. GET /api/causal-chains — list causal chains
  app.get("/api/causal-chains", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    try {
      const rows = db.prepare(`
        SELECT * FROM causal_chains
        WHERE agent_id = ?
        ORDER BY created_at DESC
      `).all(agentId) as Array<{
        id: string;
        agent_id: string;
        name_json: string;
        root_cause_json: string;
        chain_json: string;
        impact_json: string;
        prescription_id: string | null;
        created_at: number;
      }>;

      const chains = rows.map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        name: JSON.parse(row.name_json),
        rootCause: JSON.parse(row.root_cause_json),
        chain: JSON.parse(row.chain_json),
        impact: JSON.parse(row.impact_json),
        prescriptionId: row.prescription_id,
        createdAt: row.created_at,
      }));

      return c.json(chains);
    } catch {
      return c.json([]);
    }
  });

  // 10. GET /api/config — current config
  app.get("/api/config", (c) => {
    return c.json(config);
  });

  // 11. GET /api/skills — latest plugin snapshot
  app.get("/api/skills", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const events = eventStore.queryEvents({ agentId, type: "plugin_snapshot" });
    if (events.length === 0) {
      return c.json({ plugins: [] });
    }
    // Return the latest plugin snapshot
    const latest = events[events.length - 1];
    return c.json(latest.data);
  });

  // 12. GET /api/memory — latest memory snapshot
  app.get("/api/memory", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const events = eventStore.queryEvents({ agentId, type: "memory_snapshot" });
    if (events.length === 0) {
      return c.json({ files: [], totalCount: 0, totalSizeBytes: 0 });
    }
    const latest = events[events.length - 1];
    return c.json(latest.data);
  });

  // 13. PUT /api/config — update config
  app.put("/api/config", async (c) => {
    try {
      const body = await c.req.json();
      // Return the merged config (actual file write deferred to executor)
      return c.json({ status: "accepted", config: body });
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
  });

  // 14. POST /api/prescriptions/:id/apply — apply prescription (placeholder)
  app.post("/api/prescriptions/:id/apply", (c) => {
    const id = c.req.param("id");
    return c.json({
      status: "not_implemented",
      message: `Prescription ${id} apply will be implemented in Task 10 (executor)`,
    }, 501);
  });

  // 15. POST /api/prescriptions/:id/rollback — rollback prescription (placeholder)
  app.post("/api/prescriptions/:id/rollback", (c) => {
    const id = c.req.param("id");
    return c.json({
      status: "not_implemented",
      message: `Prescription ${id} rollback will be implemented in Task 10 (executor)`,
    }, 501);
  });

  // ─── SPA fallback ───

  app.get("/", (c) => {
    const html = loadSpaHtml(authToken);
    return c.html(html);
  });

  app.get("/*", (c) => {
    const html = loadSpaHtml(authToken);
    return c.html(html);
  });

  return app;
}

// --- Start server ---

export async function startDashboard(
  opts: DashboardOptions & { port: number },
): Promise<void> {
  const app = createDashboardApp(opts);
  serve({
    fetch: app.fetch,
    port: opts.port,
    hostname: "127.0.0.1",
  });
}
