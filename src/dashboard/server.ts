// ===================================================
//  Dashboard Server
//  Hono app with 15 API routes + SPA shell
//  Design spec: Phase 2, Task 5
// ===================================================

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import type { ClawDoctorConfig } from "../types/config.js";
import type { EventType } from "../types/events.js";
import { loadConfig } from "../config/loader.js";
import { createEventStore } from "../store/event-store.js";
import { createDiagnosisStore } from "../store/diagnosis-store.js";
import { createScoreStore } from "../store/score-store.js";
import { aggregateMetrics } from "../analysis/metric-aggregator.js";
import type { Department, DiseaseInstance } from "../types/domain.js";
import { scoreToGrade } from "../types/scoring.js";
import { generateBadge } from "../badge/badge-generator.js";
import { runCheckup } from "../analysis/analysis-pipeline.js";
import { getDiseaseRegistry } from "../diseases/registry.js";
import { generatePrescription } from "../prescription/prescription-generator.js";
import { resolveLLMProvider, readOpenClawModelConfig } from "../llm/provider.js";
import { createPrescriptionStore } from "../store/prescription-store.js";

// --- Types ---

export interface DashboardOptions {
  db: Database.Database;
  config: ClawDoctorConfig;
  authToken?: string;
  stateDir?: string;
  workspaceDir?: string;
  dbPath?: string;
}

// --- SPA HTML loader ---

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPA_PATH = resolve(__dirname, "public", "index.html");

function loadSpaHtml(token?: string, locale?: string): string {
  const lang = locale ?? "en";
  let html: string;
  try {
    html = readFileSync(SPA_PATH, "utf-8");
  } catch {
    html = `<!DOCTYPE html><html lang="${lang}"><body><h1>ClawDoctor Dashboard</h1><p>SPA not found.</p></body></html>`;
  }
  // Set the lang attribute on the <html> tag
  html = html.replace(/<html([^>]*)\slang="[^"]*"/, `<html$1 lang="${lang}"`);
  if (!/<html[^>]*\slang=/.test(html)) {
    html = html.replace(/<html/, `<html lang="${lang}"`);
  }
  // Inject locale and token scripts
  const scripts: string[] = [];
  scripts.push(`window.__CLAWDOCTOR_LOCALE__="${lang}";`);
  if (token) {
    scripts.push(`window.__CLAWDOCTOR_TOKEN__="${token}";`);
  }
  html = html.replace(
    "</head>",
    `<script>${scripts.join("")}</script></head>`,
  );
  return html;
}

// --- Config persistence utility ---

function mergeAndPersistConfig(
  config: ClawDoctorConfig,
  partial: Record<string, unknown>,
): void {
  // Read existing persisted config (if any)
  const configDir = join(homedir(), ".clawdoctor");
  const configPath = join(configDir, "config.json");
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    // No existing file or parse error — start fresh
  }

  // Deep merge: for object-valued keys, merge one level; scalars overwrite
  for (const [key, value] of Object.entries(partial)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing[key] !== null &&
      typeof existing[key] === "object" &&
      !Array.isArray(existing[key])
    ) {
      existing[key] = { ...(existing[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      existing[key] = value;
    }
  }

  // Update in-memory config
  Object.assign(config, partial);

  // Write back
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf-8");
}

// --- Valid departments for validation ---

const VALID_DEPARTMENTS = new Set<string>([
  "vitals", "skill", "memory", "behavior", "cost", "security", "infra",
]);

// --- Factory ---

export function createDashboardApp(opts: DashboardOptions): Hono {
  const { db, config, authToken } = opts;

  const app = new Hono();
  const eventStore = createEventStore(db);
  const diagnosisStore = createDiagnosisStore(db);
  const scoreStore = createScoreStore(db);

  // ─── Auth middleware: ALL /api/* require bearer token ───
  // Exception: GET /api/badge is publicly accessible (for README embeds etc.)

  app.use("/api/*", async (c, next) => {
    // Public routes — skip auth
    if (c.req.path === "/api/badge") {
      return next();
    }
    if (!authToken) {
      return next();
    }
    const authHeader = c.req.header("Authorization");
    if (!authHeader || authHeader !== `Bearer ${authToken}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  // ─── API Routes (15 total + 1 public badge) ───

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

  // --- Disease enrichment helper ---
  const registry = getDiseaseRegistry();

  function enrichDiagnosis(d: DiseaseInstance) {
    const def = registry.getById(d.definitionId);
    return {
      ...d,
      definition: def ? {
        name: def.name,
        description: def.description,
        department: def.department,
        category: def.category,
        rootCauses: def.rootCauses,
        defaultSeverity: def.defaultSeverity,
        tags: def.tags,
        relatedDiseases: def.relatedDiseases,
        prescriptionTemplate: {
          level: def.prescriptionTemplate.level,
          risk: def.prescriptionTemplate.risk,
          actionTypes: def.prescriptionTemplate.actionTypes,
          estimatedImprovementTemplate: def.prescriptionTemplate.estimatedImprovementTemplate,
        },
      } : null,
    };
  }

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

    return c.json(results.map(enrichDiagnosis));
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
    return c.json(enrichDiagnosis(found));
  });

  // 3b. POST /api/diseases/:id/prescribe — generate prescription for a disease
  app.post("/api/diseases/:id/prescribe", async (c) => {
    const id = c.req.param("id");
    const agentId = c.req.query("agentId") ?? "default";
    const all = diagnosisStore.queryDiagnoses({ agentId });
    const disease = all.find((d) => d.id === id);
    if (!disease) {
      return c.json({ error: "Diagnosis not found" }, 404);
    }

    const definition = registry.getById(disease.definitionId);
    if (!definition) {
      return c.json({ error: `No definition found for ${disease.definitionId}` }, 404);
    }

    const llmResult = resolveLLMProvider(config);
    if (!llmResult.provider) {
      return c.json({ error: "No LLM provider available. Set ANTHROPIC_API_KEY to generate prescriptions." }, 400);
    }

    try {
      const now = Date.now();
      const timeRange = { from: now - 7 * 24 * 60 * 60 * 1000, to: now };
      const metrics = aggregateMetrics(db, agentId, timeRange);

      const prescription = await generatePrescription(disease, definition, llmResult.provider, { metrics });

      // Persist the prescription
      const prescriptionStore = createPrescriptionStore(db);
      prescriptionStore.insertPrescription(prescription);

      return c.json(prescription);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to generate prescription: ${msg}` }, 500);
    }
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
      const body = await c.req.json() as Record<string, unknown>;
      mergeAndPersistConfig(config, body);
      return c.json({ status: "saved" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to save config: ${msg}` }, 500);
    }
  });

  // ─── LLM Settings endpoints ───

  // GET /api/llm/status — current LLM configuration status
  app.get("/api/llm/status", (c) => {
    const stDir = opts.stateDir ?? process.env.CLAWDOCTOR_STATE_DIR ?? join(homedir(), ".openclaw");
    const openclawModel = readOpenClawModelConfig(stDir);
    const llmResult = resolveLLMProvider(config, stDir);
    const hasEnvKey = !!process.env.ANTHROPIC_API_KEY;
    const hasConfigKey = !!config.llm.apiKey;

    return c.json({
      enabled: config.llm.enabled,
      available: !!llmResult.provider,
      reason: llmResult.provider ? null : (llmResult as { reason: string }).reason,
      config: {
        provider: config.llm.provider ?? "anthropic",
        model: config.llm.model ?? null,
        baseUrl: config.llm.baseUrl ?? null,
        hasApiKey: hasConfigKey,
      },
      envApiKey: hasEnvKey,
      openclaw: openclawModel,
    });
  });

  // PUT /api/llm/config — save LLM settings
  app.put("/api/llm/config", async (c) => {
    try {
      const body = await c.req.json() as Record<string, unknown>;

      // Build the updated llm sub-config
      const llmUpdate = { ...config.llm };
      if (typeof body.enabled === "boolean") llmUpdate.enabled = body.enabled;
      if (typeof body.provider === "string") llmUpdate.provider = body.provider;
      if (typeof body.model === "string") llmUpdate.model = body.model || undefined;
      if (typeof body.apiKey === "string") llmUpdate.apiKey = body.apiKey || undefined;
      if (typeof body.baseUrl === "string") llmUpdate.baseUrl = body.baseUrl || undefined;

      mergeAndPersistConfig(config, { llm: llmUpdate });

      return c.json({ status: "saved" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to save: ${msg}` }, 500);
    }
  });

  // POST /api/llm/test — test LLM connection
  app.post("/api/llm/test", async (c) => {
    const stDir = opts.stateDir ?? process.env.CLAWDOCTOR_STATE_DIR ?? join(homedir(), ".openclaw");
    const llmResult = resolveLLMProvider(config, stDir);
    if (!llmResult.provider) {
      return c.json({ success: false, error: "No LLM provider available: " + (llmResult as { reason: string }).reason });
    }

    try {
      const response = await llmResult.provider.chat(
        "You are a test assistant.",
        "Reply with exactly: OK",
        { maxTokens: 16 },
      );
      if (response.error) {
        return c.json({ success: false, error: response.error });
      }
      return c.json({
        success: true,
        model: (llmResult as { model: string }).model,
        response: response.text.slice(0, 50),
        tokensUsed: response.tokensUsed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: msg });
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

  // 16. GET /api/badge — public SVG badge (NO auth required)
  app.get("/api/badge", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const label = c.req.query("label") ?? "ClawDoctor";
    const latest = scoreStore.queryLatestScore(agentId);

    const score = latest?.overall ?? 0;
    const grade = scoreToGrade(latest?.overall ?? null);

    const svg = generateBadge({ grade, score, label });

    return new Response(svg, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-cache, max-age=0",
      },
    });
  });

  // ─── Checkup endpoints ───

  let checkupState: {
    status: "idle" | "running" | "completed" | "error";
    startedAt?: number;
    completedAt?: number;
    error?: string;
  } = { status: "idle" };

  // POST /api/checkup — trigger a health checkup
  app.post("/api/checkup", async (c) => {
    if (checkupState.status === "running") {
      return c.json({ error: "Checkup already in progress" }, 409);
    }

    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const stDir = opts.stateDir ?? process.env.CLAWDOCTOR_STATE_DIR ?? join(homedir(), ".openclaw");
    const wsDir = opts.workspaceDir ?? process.cwd();
    const agentId = typeof body.agentId === "string" ? body.agentId : "default";
    const noLlm = body.noLlm !== false;

    checkupState = { status: "running", startedAt: Date.now() };

    runCheckup({
      agentId,
      stateDir: stDir,
      workspaceDir: wsDir,
      noLlm,
      dbPath: opts.dbPath,
    }).then(() => {
      checkupState = { status: "completed", completedAt: Date.now() };
      setTimeout(() => { checkupState = { status: "idle" }; }, 60_000);
    }).catch((err) => {
      checkupState = {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      };
      setTimeout(() => { checkupState = { status: "idle" }; }, 60_000);
    });

    return c.json({ status: "started" });
  });

  // GET /api/checkup/status — poll checkup state
  app.get("/api/checkup/status", (c) => {
    return c.json(checkupState);
  });

  // ─── SPA fallback ───

  app.get("/", (c) => {
    const html = loadSpaHtml(authToken, config.locale);
    return c.html(html);
  });

  app.get("/*", (c) => {
    const html = loadSpaHtml(authToken, config.locale);
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
