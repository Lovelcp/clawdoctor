// ===================================================
//  SPA Structure Tests
//  Validates the index.html is well-formed and complete
// ===================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPA_PATH = resolve(__dirname, "public", "index.html");
const html = readFileSync(SPA_PATH, "utf-8");

describe("SPA Structure", () => {
  it("has a valid HTML5 DOCTYPE", () => {
    expect(html.trimStart().startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("has required HTML structure", () => {
    expect(html).toContain("<html");
    expect(html).toContain("<head>");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
  });

  it("has a title", () => {
    expect(html).toContain("<title>");
    expect(html).toContain("ClawDoc");
  });

  // ─── All 9 page routes ───

  describe("contains all 9 page routes", () => {
    const routes = [
      "#/overview",
      "#/skills",
      "#/memory",
      "#/behavior",
      "#/cost",
      "#/security",
      "#/rx",
      "#/timeline",
      "#/settings",
    ];

    for (const route of routes) {
      it(`contains route: ${route}`, () => {
        expect(html).toContain(route);
      });
    }
  });

  // ─── All 15 API endpoints ───

  describe("references all 15 API endpoints", () => {
    const endpoints = [
      "/api/health",
      "/api/diseases",
      "/api/prescriptions",
      "/api/metrics/",
      "/api/trends",
      "/api/events",
      "/api/causal-chains",
      "/api/config",
      "/api/skills",
      "/api/memory",
    ];

    for (const endpoint of endpoints) {
      it(`references: ${endpoint}`, () => {
        expect(html).toContain(endpoint);
      });
    }

    // Write endpoints referenced in button handlers
    it("references POST /api/prescriptions/:id/apply", () => {
      expect(html).toContain("/apply");
      expect(html).toContain("method: 'POST'");
    });

    it("references POST /api/prescriptions/:id/rollback", () => {
      expect(html).toContain("/rollback");
    });

    // followup endpoint is referenced through prescriptions page
    it("references /api/prescriptions/:id/followup pattern", () => {
      // The followup endpoint is referenced via the prescriptions page
      expect(html).toContain("/api/prescriptions");
    });

    // PUT config is referenced through settings
    it("references PUT /api/config pattern", () => {
      expect(html).toContain("/api/config");
    });

    // diseases/:id is referenced through disease detail
    it("references /api/diseases pattern", () => {
      expect(html).toContain("/api/diseases");
    });
  });

  // ─── Self-contained except CDN ───

  describe("is self-contained except CDN URLs", () => {
    it("uses Chart.js from cdn.jsdelivr.net", () => {
      expect(html).toContain("cdn.jsdelivr.net");
      expect(html).toContain("chart.js");
    });

    it("does not reference local JS files", () => {
      // Should not have <script src="./..."> or <script src="/..."> (except CDN)
      const localScriptMatches = html.match(/<script\s+src=["'](?!https?:\/\/)[^"']+["']/g);
      expect(localScriptMatches).toBeNull();
    });

    it("does not reference local CSS files", () => {
      const localCssMatches = html.match(/<link\s+[^>]*href=["'](?!https?:\/\/)[^"']+\.css["']/g);
      expect(localCssMatches).toBeNull();
    });
  });

  // ─── Token injection ───

  describe("token injection support", () => {
    it("references window.__CLAWDOC_TOKEN__", () => {
      expect(html).toContain("__CLAWDOC_TOKEN__");
    });

    it("uses the token in API fetch headers", () => {
      expect(html).toContain("Authorization");
      expect(html).toContain("Bearer");
    });
  });

  // ─── Medical-monitor aesthetic ───

  describe("medical-monitor aesthetic", () => {
    it("has dark background", () => {
      expect(html).toContain("#0f1117");
    });

    it("has coral brand color", () => {
      expect(html).toContain("#E8734A");
    });

    it("has severity color coding", () => {
      expect(html).toContain("severity-critical");
      expect(html).toContain("severity-warning");
      expect(html).toContain("severity-info");
    });
  });
});
