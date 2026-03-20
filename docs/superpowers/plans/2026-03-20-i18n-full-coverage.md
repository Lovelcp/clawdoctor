# i18n Full Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full Chinese/English i18n coverage to ClawDoctor's CLI output, Dashboard SPA, and terminal report — all user-visible strings localized via config.locale.

**Architecture:** Extend existing `t()` + `UI_STRINGS` system for CLI; embed `LOCALE_DICT` + `t()`/`tObj()` in SPA for static strings and server-returned I18nString objects. Unified config persistence via `mergeAndPersistConfig()`. Language switcher in Dashboard Settings page.

**Tech Stack:** TypeScript (ESM), Hono server, single-file SPA (vanilla JS), vitest

**Spec:** `docs/superpowers/specs/2026-03-20-i18n-full-coverage-design.md`

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/i18n/i18n.ts` | Translation functions | Add `tf()` |
| `src/i18n/locales.ts` | CLI string dictionary | Add ~50 keys |
| `src/i18n/i18n.test.ts` | Translation function tests | Modify (exists) — add `tf()` tests |
| `src/i18n/locales.test.ts` | Dictionary validation tests | **CREATE** |
| `src/dashboard/server.ts` | Hono API server | Update `loadSpaHtml()`, config persistence |
| `src/dashboard/public/index.html` | SPA frontend | Add `LOCALE_DICT`, `t()`, `tObj()`, language switcher, replace strings |
| `src/dashboard/server.test.ts` | Server tests | Add locale + config tests |
| `src/dashboard/spa.test.ts` | SPA validation tests | Add LOCALE_DICT tests |
| `src/commands/report-builder.ts` | Report view model | Replace 3 summary strings |
| `src/report/terminal-report.ts` | Terminal renderer | Replace hardcoded labels |
| `src/commands/checkup.ts` | Checkup CLI | Replace auto-fix strings |
| `src/commands/rx-cmd.ts` | Prescription CLI | Replace ~36 strings, fix `.en` access |
| `src/commands/config-cmd.ts` | Config CLI | Replace 3 strings |
| `src/commands/dashboard-cmd.ts` | Dashboard CLI | Replace 1 string |
| `src/commands/badge-cmd.ts` | Badge CLI | Add `loadConfig()`, replace 1 string |
| `src/commands/dept-runner.ts` | Department runner | Add `loadConfig()`, pass locale |

---

### Task 1: Add `tf()` template interpolation to i18n module

**Files:**
- Modify: `src/i18n/i18n.ts`
- Modify: `src/i18n/i18n.test.ts`

- [ ] **Step 1: Write failing tests for `tf()`**

Add to `src/i18n/i18n.test.ts`:

```typescript
import { t, tf } from "./i18n.js";

describe("tf()", () => {
  it("interpolates variables into translated string", () => {
    const s: I18nString = { en: "Found {count} issues", zh: "发现 {count} 个问题" };
    expect(tf(s, "en", { count: 3 })).toBe("Found 3 issues");
    expect(tf(s, "zh", { count: 3 })).toBe("发现 3 个问题");
  });

  it("replaces all occurrences of the same placeholder", () => {
    const s: I18nString = { en: "{n} of {n} done", zh: "{n}/{n} 完成" };
    expect(tf(s, "en", { n: 5 })).toBe("5 of 5 done");
  });

  it("leaves unreplaced placeholders as-is", () => {
    const s: I18nString = { en: "Hello {name}, age {age}" };
    expect(tf(s, "en", { name: "Bob" })).toBe("Hello Bob, age {age}");
  });

  it("falls back to en for unknown locale", () => {
    const s: I18nString = { en: "Score: {score}" };
    expect(tf(s, "ja", { score: 85 })).toBe("Score: 85");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/i18n/i18n.test.ts`
Expected: FAIL — `tf` is not exported

- [ ] **Step 3: Implement `tf()` in `src/i18n/i18n.ts`**

```typescript
import type { I18nString } from "../types/domain.js";

export function t(str: I18nString, locale: string): string {
  return str[locale] ?? str.en;
}

export function tf(str: I18nString, locale: string, vars: Record<string, string | number>): string {
  let result = t(str, locale);
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, String(val));
  }
  return result;
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run src/i18n/i18n.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/i18n/i18n.ts src/i18n/i18n.test.ts
git commit -m "feat(i18n): add tf() template interpolation function"
```

---

### Task 2: Extend UI_STRINGS with all CLI keys + create locales.test.ts

**Files:**
- Modify: `src/i18n/locales.ts`
- Create: `src/i18n/locales.test.ts`

- [ ] **Step 1: Write locales validation test**

Create `src/i18n/locales.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { UI_STRINGS } from "./locales.js";

describe("UI_STRINGS completeness", () => {
  const entries = Object.entries(UI_STRINGS);

  it("has at least 50 keys", () => {
    expect(entries.length).toBeGreaterThanOrEqual(50);
  });

  for (const [key, value] of entries) {
    it(`"${key}" has non-empty en and zh`, () => {
      expect(typeof value.en).toBe("string");
      expect(value.en.length).toBeGreaterThan(0);
      expect(typeof value.zh).toBe("string");
      expect(value.zh.length).toBeGreaterThan(0);
    });
  }

  it("template placeholders are consistent between en and zh", () => {
    const placeholderRe = /\{(\w+)\}/g;
    for (const [key, value] of entries) {
      const enPlaceholders = [...value.en.matchAll(placeholderRe)].map((m) => m[1]).sort();
      const zhPlaceholders = [...value.zh.matchAll(placeholderRe)].map((m) => m[1]).sort();
      expect(enPlaceholders, `Placeholder mismatch in "${key}"`).toEqual(zhPlaceholders);
    }
  });
});
```

- [ ] **Step 2: Run test — verify it fails** (not enough keys yet)

Run: `npx vitest run src/i18n/locales.test.ts`
Expected: FAIL — fewer than 50 keys

- [ ] **Step 3: Add all ~50 new keys to `UI_STRINGS` in `src/i18n/locales.ts`**

**Important: Do NOT remove `as const`.** Instead, keep the `as const` assertion and add the new keys inline. The existing `keyof typeof UI_STRINGS` pattern in `report-builder.ts:17` and `terminal-report.ts:33` will automatically pick up new keys. Template placeholders (`{count}` etc.) are plain strings and work fine with `as const`.

Add all keys from spec Section 3.1. The full key list with exact en/zh values is documented in the spec under these headings:
- **report-builder.ts summary lines** (3 keys: `report.insufficientData`, `report.scoreSummary`, `report.deptChecksSkipped`)
- **terminal-report.ts labels** (4 keys: `report.agentLabel`, `report.quickAction.*`)
- **checkup.ts** (2 keys: `cli.autoApplying`, `cli.autoFixSummary`)
- **rx-cmd.ts** (36 keys: `rx.noPrescriptions` through `rx.actionStatus`)
- **config-cmd.ts** (3 keys: `config.initialized`, `config.alreadyExists`, `config.setValue`)
- **dashboard-cmd.ts** (1 key: `dashboard.runningCheckup`)
- **badge-cmd.ts** (1 key: `badge.saved`)

Use bracket notation for keys with dots: `"report.insufficientData": { en: "...", zh: "..." },`

Note: New keys use `"dot.notation"` (bracket access) while existing keys use `camelCase` (dot access). Both work with `as const`. Consumers use bracket access: `UI_STRINGS["report.scoreSummary"]`.

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run src/i18n/locales.test.ts`
Expected: All pass

- [ ] **Step 5: Run full suite to verify no regressions**

Run: `npx vitest run`
Expected: All 619+ tests pass

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales.ts src/i18n/locales.test.ts
git commit -m "feat(i18n): add ~50 CLI i18n keys with en/zh translations"
```

---

### Task 3: Server-side — `loadSpaHtml()` locale injection + unified config persistence

**Files:**
- Modify: `src/dashboard/server.ts`
- Modify: `src/dashboard/server.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/dashboard/server.test.ts`:

```typescript
it("loadSpaHtml injects __CLAWDOCTOR_LOCALE__ into HTML", async () => {
  // Create app with locale "zh"
  const app = createDashboardApp({
    db, config: { ...config, locale: "zh" }, authToken: "test",
  });
  const res = await app.request("/");
  const html = await res.text();
  expect(html).toContain('window.__CLAWDOCTOR_LOCALE__="zh"');
  expect(html).toContain('lang="zh"');
});

it("PUT /api/config persists locale to disk and in-memory", async () => {
  const res = await app.request("/api/config", {
    method: "PUT",
    headers: { "Authorization": "Bearer test", "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "zh" }),
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.status).toBe("saved");
});

it("PUT /api/llm/config does not erase locale", async () => {
  // First set locale
  await app.request("/api/config", {
    method: "PUT",
    headers: { "Authorization": "Bearer test", "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "zh" }),
  });
  // Then save LLM config
  await app.request("/api/llm/config", {
    method: "PUT",
    headers: { "Authorization": "Bearer test", "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, provider: "anthropic" }),
  });
  // Verify locale is still present
  const configRes = await app.request("/api/config", {
    headers: { "Authorization": "Bearer test" },
  });
  const cfg = await configRes.json();
  expect(cfg.locale).toBe("zh");
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/dashboard/server.test.ts`

- [ ] **Step 3: Implement changes in `src/dashboard/server.ts`**

1. Update `loadSpaHtml(token?, locale?)` to accept locale parameter, inject `__CLAWDOCTOR_LOCALE__`, and update `<html lang="">` attribute (see spec Section 4.4).

2. Extract `mergeAndPersistConfig()` utility inside `createDashboardApp()`. **ESM-only — do NOT use `require()`.** The top-level imports at line 9 already have `import { readFileSync } from "node:fs"` — add `writeFileSync` and `mkdirSync` to that existing import statement. The existing `PUT /api/llm/config` at line 422 uses `await import("node:fs")` which is unnecessary — replace with the top-level import. See spec Section 4.5 for the `mergeAndPersistConfig` logic (read existing → deep merge → write back → update in-memory).

3. Update `PUT /api/config` to use `mergeAndPersistConfig()`.

4. Refactor `PUT /api/llm/config` to use `mergeAndPersistConfig()`.

5. Update SPA fallback routes to pass `config.locale`:
   ```typescript
   app.get("/", (c) => c.html(loadSpaHtml(authToken, config.locale)));
   app.get("/*", (c) => c.html(loadSpaHtml(authToken, config.locale)));
   ```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run src/dashboard/server.test.ts`

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/server.test.ts
git commit -m "feat(i18n): locale injection in SPA + unified config persistence"
```

---

### Task 4: CLI commands — report-builder, terminal-report, checkup, dept-runner

**Files:**
- Modify: `src/commands/report-builder.ts:88-103`
- Modify: `src/report/terminal-report.ts` (hardcoded labels)
- Modify: `src/commands/checkup.ts` (auto-fix strings)
- Modify: `src/commands/dept-runner.ts` (add `loadConfig`, pass locale)

- [ ] **Step 1: Update `report-builder.ts` — replace 3 summary strings**

Replace lines 90, 96, 102 with `tf()` calls:
```typescript
import { t, tf } from "../i18n/i18n.js";
// line 90:
summary = tf(UI_STRINGS["report.insufficientData"], locale, { coverage: coveragePct });
// line 96:
summary = tf(UI_STRINGS["report.scoreSummary"], locale, { score: scoreRounded, count: activeDiseases, critical: criticals, warning: warnings });
// line 102:
skippedNote = tf(UI_STRINGS["report.deptChecksSkipped"], locale, { count: skippedDiseases, dept: name });
```

- [ ] **Step 2: Update `terminal-report.ts` — replace 4 hardcoded labels**

Add `import { tf } from "../i18n/i18n.js";` to the existing imports.

Line 54 — replace `"Agent:"` label:
```typescript
// Before:
`  ${color.muted("Agent:")} ${color.white(vm.agentId)}  ...`
// After:
`  ${color.muted(t(UI_STRINGS["report.agentLabel"], locale))} ${color.white(vm.agentId)}  ...`
```

Lines 163, 166, 169 — replace quick action descriptions:
```typescript
// Before (line 163):
`  ${color.accent("clawdoctor rx apply --all")}          ${color.muted("Apply all guided Rx")}`,
// After:
`  ${color.accent("clawdoctor rx apply --all")}          ${color.muted(t(UI_STRINGS["report.quickAction.applyRx"], locale))}`,

// Before (line 166):
`  ${color.accent("clawdoctor rx followup")}             ${color.muted("Check previous Rx results")}`,
// After:
`  ${color.accent("clawdoctor rx followup")}             ${color.muted(t(UI_STRINGS["report.quickAction.checkRx"], locale))}`,

// Before (line 169):
`  ${color.accent("clawdoctor dashboard")}               ${color.muted("Open detailed dashboard")}`,
// After:
`  ${color.accent("clawdoctor dashboard")}               ${color.muted(t(UI_STRINGS["report.quickAction.openDashboard"], locale))}`,
```

- [ ] **Step 3: Update `checkup.ts` — replace auto-fix strings**

Note: `checkup.ts` already extracts `locale` at line 113 (`const locale = config.locale ?? "en"`). Add `tf` to the existing `import` from `"../i18n/i18n.js"`.

Line 131 — replace auto-applying message:
```typescript
// Before:
console.log(`\nAuto-applying ${applicable.length} low-risk prescription(s)...`);
// After:
console.log("\n" + tf(UI_STRINGS["cli.autoApplying"], locale, { count: applicable.length }));
```

Line 139 — replace auto-fix summary:
```typescript
// Before:
console.log(`\nAuto-fix summary: ${autoResult.applied} applied, ${autoResult.failed} failed`);
// After:
console.log("\n" + tf(UI_STRINGS["cli.autoFixSummary"], locale, { applied: autoResult.applied, failed: autoResult.failed }));
```

- [ ] **Step 4: Update `dept-runner.ts` — add `loadConfig` and pass locale**

```typescript
import { loadConfig } from "../config/loader.js";

// Inside runDeptCheckup(), after line 31:
const configFilePath = join(homedir(), ".clawdoctor", "config.json");
const config = loadConfig(configFilePath);
const locale = config.locale ?? "en";

// Pass locale to buildReportViewModel (line 53-58):
const viewModel = buildReportViewModel(result, agentId, dateRange, [department], locale);
// Pass locale to renderReport (line 60):
const report = renderReport(viewModel, locale);
```

- [ ] **Step 5: Build and run full test suite**

Run: `npm run build && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/report-builder.ts src/report/terminal-report.ts src/commands/checkup.ts src/commands/dept-runner.ts
git commit -m "feat(i18n): localize report-builder, terminal-report, checkup, dept-runner"
```

---

### Task 5: CLI commands — rx-cmd, config-cmd, badge-cmd, dashboard-cmd

**Files:**
- Modify: `src/commands/rx-cmd.ts`
- Modify: `src/commands/config-cmd.ts`
- Modify: `src/commands/badge-cmd.ts`
- Modify: `src/commands/dashboard-cmd.ts`

- [ ] **Step 1: Update `rx-cmd.ts`**

1. Add `loadConfig()` to `list` and `history` subcommands (they currently don't load config).
2. In every subcommand, extract `const locale = config.locale ?? "en"`.
3. Replace all ~36 hardcoded strings with `t(UI_STRINGS[...], locale)` or `tf(UI_STRINGS[...], locale, vars)`.
4. Replace all `.en` property accesses on `I18nString` objects with `t(obj, locale)`:
   - `preview.diagnosisName.en` → `t(preview.diagnosisName, locale)`
   - `action.description.en` → `t(action.description, locale)`
   - `result.immediateVerification.note.en` → `t(result.immediateVerification.note, locale)`

- [ ] **Step 2: Update `config-cmd.ts`**

Replace 3 user-facing strings in `init` and `set` subcommands. For `init`/`set`, config may not exist yet, use `"en"` as locale. **Keep the `[clawdoctor]` prefix** outside the translated string — it's a consistent brand prefix, not part of the translated message.

```typescript
import { tf } from "../i18n/i18n.js";
import { UI_STRINGS } from "../i18n/locales.js";

// init — line 30 (source has "[clawdoctor] Config already exists at ..."):
console.log(`[clawdoctor] ${tf(UI_STRINGS["config.alreadyExists"], "en", { path: CONFIG_FILE })}`);
// init — line 39 (source has "[clawdoctor] Config initialized at ..."):
console.log(`[clawdoctor] ${tf(UI_STRINGS["config.initialized"], "en", { path: CONFIG_FILE })}`);
// set — line 82 (source has "[clawdoctor] Set key = value"):
console.log(`[clawdoctor] ${tf(UI_STRINGS["config.setValue"], "en", { key, value: JSON.stringify(parsedValue) })}`);
```

- [ ] **Step 3: Update `badge-cmd.ts`**

Add `loadConfig()` and replace the badge saved message:

```typescript
import { loadConfig } from "../config/loader.js";

// Inside action, after db opens:
const config = loadConfig(join(homedir(), ".clawdoctor", "config.json"));
const locale = config.locale ?? "en";

// line 77:
process.stderr.write(tf(UI_STRINGS["badge.saved"], locale, { path: opts.output }) + "\n");
```

- [ ] **Step 4: Update `dashboard-cmd.ts`**

Replace the "Running fresh checkup..." string. Config is already loaded on line 32.

```typescript
const locale = config.locale ?? "en";
// Replace "Running fresh checkup to populate dashboard data..."
console.log(t(UI_STRINGS["dashboard.runningCheckup"], locale));
```

- [ ] **Step 5: Build and run full test suite**

Run: `npm run build && npx vitest run`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/commands/rx-cmd.ts src/commands/config-cmd.ts src/commands/badge-cmd.ts src/commands/dashboard-cmd.ts
git commit -m "feat(i18n): localize rx-cmd, config-cmd, badge-cmd, dashboard-cmd"
```

---

### Task 6: Dashboard SPA — LOCALE_DICT, t()/tObj(), language switcher

**Files:**
- Modify: `src/dashboard/public/index.html`
- Modify: `src/dashboard/spa.test.ts`

This is the largest task. The SPA is a single 1,675-line HTML file with all JS inline.

- [ ] **Step 1: Write SPA validation tests**

Add to `src/dashboard/spa.test.ts`:

```typescript
it("contains LOCALE_DICT with en and zh for all entries", () => {
  const dictMatch = html.match(/const LOCALE_DICT\s*=\s*(\{[\s\S]*?\n\s*\});/);
  expect(dictMatch).not.toBeNull();
  // Verify at least 100 entries
  const entryCount = (dictMatch![1].match(/"[a-z.]+"\s*:/g) || []).length;
  expect(entryCount).toBeGreaterThanOrEqual(100);
});

it("contains tObj function for server-returned I18nString objects", () => {
  expect(html).toContain("function tObj(");
});

it("contains switchLocale function", () => {
  expect(html).toContain("function switchLocale(");
});

it("contains renderNav function for re-rendering navigation on locale switch", () => {
  expect(html).toContain("function renderNav(");
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/dashboard/spa.test.ts`

- [ ] **Step 3: Add LOCALE_DICT + t() + tObj() + switchLocale() to SPA**

At the top of the `<script>` section in `index.html`, add:

1. `LOCALE_DICT` object with all ~150 keys from spec Section 4.1 (copy the full dictionary from the spec).
2. `currentLocale` variable initialized from `window.__CLAWDOCTOR_LOCALE__`.
3. `t(key, vars)` function for static dictionary lookups.
4. `tObj(obj)` function for server-returned `I18nString` objects.
5. `switchLocale(locale)` function that updates locale, persists via API, and re-renders.

- [ ] **Step 4: Extract `renderNav()` function**

Move the sidebar navigation rendering into a standalone `renderNav()` function so it can be called on locale switch. This function should build the sidebar HTML using `t()` for all nav labels.

- [ ] **Step 5: Add language switcher to Settings page renderer**

In the `renderSettingsPage()` (or equivalent) function, add a language dropdown at the top, before the LLM config section (see spec Section 4.3).

- [ ] **Step 6: Replace all hardcoded strings in rendering functions**

Go through every rendering function in the SPA and replace hardcoded English strings with `t('key')` or `tObj(obj)` calls. This includes:
- Navigation labels
- Page titles and subtitles
- Table headers
- Button labels
- Status/severity labels
- Empty state messages
- Checkup overlay text
- Settings page labels and hints
- Disease detail panel labels
- Error messages (client-side only)
- Grade labels
- Metric labels

For server-returned `I18nString` objects (disease names, descriptions, root causes, evidence), use `tObj()`.

- [ ] **Step 7: Run SPA tests**

Run: `npx vitest run src/dashboard/spa.test.ts`
Expected: All pass

- [ ] **Step 8: Build and run full suite**

Run: `npm run build && npx vitest run`
Expected: All pass

- [ ] **Step 9: Commit**

```bash
git add src/dashboard/public/index.html src/dashboard/spa.test.ts
git commit -m "feat(i18n): full SPA internationalization with LOCALE_DICT and language switcher"
```

---

### Task 7: E2E verification + final regression test

**Manual verification steps** (no test file modifications — the existing E2E test already covers locale=en).

- [ ] **Step 1: Build the project**

Run: `npm run build`

- [ ] **Step 2: Test CLI with locale=zh**

Run: `node dist/bin.js config set locale zh && node dist/bin.js checkup --no-llm 2>&1 | head -5`
Expected: Output contains `"ClawDoctor 健康报告"` (Chinese title)

- [ ] **Step 3: Test CLI with locale=en**

Run: `node dist/bin.js config set locale en && node dist/bin.js checkup --no-llm 2>&1 | head -5`
Expected: Output contains `"ClawDoctor Health Report"` (English title)

- [ ] **Step 4: Test department command locale**

Run: `node dist/bin.js config set locale zh && node dist/bin.js vitals 2>&1 | head -5`
Expected: Output contains Chinese text (not hardcoded English)

Run: `node dist/bin.js config set locale en`  (reset)

- [ ] **Step 5: Test Dashboard startup with locale injection**

```bash
node dist/bin.js config set locale zh
node dist/bin.js dashboard --port 3860 &
sleep 2
curl -s http://localhost:3860/ | grep -o 'CLAWDOCTOR_LOCALE__="[^"]*"'
# Expected: CLAWDOCTOR_LOCALE__="zh"
curl -s http://localhost:3860/ | grep -o 'lang="[^"]*"'
# Expected: lang="zh"
kill %1
node dist/bin.js config set locale en
```

- [ ] **Step 6: Run full test suite one final time**

Run: `npx vitest run`
Expected: All tests pass (619+ original + new tests)

- [ ] **Step 7: Commit if any E2E test changes needed**

```bash
git add -A
git commit -m "test(i18n): E2E verification for locale switching"
```
