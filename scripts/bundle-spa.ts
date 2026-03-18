// ===================================================
//  Bundle SPA Script (stub)
//  Reads index.html and prepares for production build.
//  Full implementation deferred: will inline CDN scripts.
// ===================================================

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPA_INPUT = resolve(__dirname, "..", "src", "dashboard", "public", "index.html");
const SPA_OUTPUT = resolve(__dirname, "..", "dist", "dashboard", "public", "index.html");

/**
 * Bundle the SPA for production.
 *
 * Future implementation will:
 * 1. Read index.html
 * 2. Fetch CDN URLs (e.g., Chart.js from cdn.jsdelivr.net)
 * 3. Inline the fetched content as <script> blocks
 * 4. Write the self-contained HTML to dist/
 *
 * For now, this simply copies the file as-is.
 */
async function bundleSpa(): Promise<void> {
  const html = readFileSync(SPA_INPUT, "utf-8");

  // TODO: Replace CDN URLs with inline content
  // const chartJsUrl = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
  // const chartJsContent = await fetch(chartJsUrl).then(r => r.text());
  // html = html.replace(/<script src="[^"]*chart[^"]*"><\/script>/, `<script>${chartJsContent}</script>`);

  // Ensure output directory exists
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dirname(SPA_OUTPUT), { recursive: true });

  writeFileSync(SPA_OUTPUT, html, "utf-8");

  console.log(`[bundle-spa] Copied SPA to ${SPA_OUTPUT}`);
  console.log("[bundle-spa] CDN inlining is stubbed — will be implemented in a future task.");
}

bundleSpa().catch((err) => {
  console.error("[bundle-spa] Error:", err);
  process.exit(1);
});
