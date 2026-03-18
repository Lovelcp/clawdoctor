# ClawDoctor Phase 3 Implementation Plan — Community Virality Edition

> **For agentic workers:** Use superpowers:subagent-driven-development for parallel execution.

**Goal:** Deliver 5 high-virality features: Skill Quality Badge, CI integration, community disease plugins, auto-prescription, and npm publish with docs. Transform ClawDoctor from "a tool" into "a platform with a viral loop."

**Architecture:** Builds on Phase 2 (563 tests, LLM analyzer, prescription engine, dashboard, plugin). Badge system generates SVG badges from health scores. CI integration adds exit codes to the existing checkup command. Community plugins are npm packages loaded at runtime. Auto-prescription extends the prescription executor with `--auto-fix`.

**Tech Stack:** Phase 2 stack + SVG badge generation (inline, no deps), dynamic `import()` for plugin loading.

**Spec:** `docs/2026-03-17-clawdoctor-design.md`

---

## Key Architecture Decisions

### 1. Badge System

Badges are SVG images generated from the latest HealthScore. Two delivery modes:
- **CLI:** `clawdoctor badge` outputs SVG to stdout or file
- **Dashboard API:** `GET /api/badge` returns SVG with correct Content-Type
- **Static hosting:** User copies SVG to their repo, links in README

Badge format: `ClawDoctor | A 95` with grade-colored right half (green A, amber C, red F).

No external badge service dependency — badges are self-generated SVGs.

### 2. CI Integration

`clawdoctor checkup --fail-on <severity>` sets process.exitCode based on findings:
- `--fail-on critical`: exit 1 if any critical disease found
- `--fail-on warning`: exit 1 if any warning or critical found
- Default (no flag): exit 0 always (informational)

GitHub Actions example in docs.

### 3. Community Disease Plugins

Convention: npm packages named `clawdoctor-plugin-*` or `@scope/clawdoctor-plugin-*`.

Plugin API:
```typescript
// What a community plugin exports:
export default {
  diseases: DiseaseDefinition[],         // custom disease definitions
  rules?: Record<string, RuleEvaluator>, // custom rule evaluation functions
};
```

Loading: `clawdoctor checkup --plugins clawdoctor-plugin-security-extra` or `config.plugins: ["clawdoctor-plugin-security-extra"]`.

At startup, ClawDoctor `import()`s each plugin, merges its diseases into the registry, and registers custom rule evaluators.

### 4. Auto-Prescription

`clawdoctor checkup --auto-fix` automatically applies all `guided` prescriptions with `risk: "low"`.

Safety: only applies prescriptions where:
- `level === "guided"` (not manual)
- `risk === "low"`
- All actions are `file_edit` or `file_delete` (no config changes, no commands)

Shows a summary of what was auto-applied after the checkup report.

### 5. npm Publish + Docs

- Complete `package.json` (keywords, homepage, repository, files)
- Comprehensive README.md with: quick start, all commands, badge setup, CI setup, plugin authoring guide
- `CONTRIBUTING.md` for community disease plugin development

---

## Dependency Graph

```
Round 1 (4-way parallel — no shared files):
  Task 1: Badge System (src/badge/, dashboard API extension)
  Task 2: CI Integration (modify checkup command)
  Task 3: Community Plugin Loader (src/plugins/)
  Task 4: npm publish prep (package.json, README, docs)

Round 2 (sequential):
  Task 5: Auto-Prescription (modify checkup + prescription executor)

Round 3 (sequential):
  Task 6: E2E Tests + Final Polish
```

---

## Task 1: Badge System

**Files:**
- Create: `src/badge/badge-generator.ts`
- Create: `src/badge/badge-generator.test.ts`
- Create: `src/commands/badge-cmd.ts`
- Modify: `src/dashboard/server.ts` (add GET /api/badge)
- Modify: `src/bin.ts` (register badge command)

- [ ] **Step 1: Write failing test for badge generator**

```typescript
import { describe, it, expect } from "vitest";
import { generateBadge } from "./badge-generator.js";

describe("BadgeGenerator", () => {
  it("generates valid SVG for grade A", () => {
    const svg = generateBadge({ grade: "A", score: 95, label: "ClawDoctor" });
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("A");
    expect(svg).toContain("95");
    expect(svg).toContain("ClawDoctor");
  });

  it("uses green color for grade A", () => {
    const svg = generateBadge({ grade: "A", score: 95, label: "ClawDoctor" });
    expect(svg).toContain("#4c1"); // shields.io green
  });

  it("uses red color for grade F", () => {
    const svg = generateBadge({ grade: "F", score: 15, label: "ClawDoctor" });
    expect(svg).toContain("#e05d44"); // shields.io red
  });

  it("uses gray for N/A", () => {
    const svg = generateBadge({ grade: "N/A", score: 0, label: "ClawDoctor" });
    expect(svg).toContain("#9f9f9f");
  });

  it("produces valid XML", () => {
    const svg = generateBadge({ grade: "B", score: 78, label: "ClawDoctor" });
    expect(svg).toMatch(/^<svg xmlns/);
  });
});
```

- [ ] **Step 2: Implement badge-generator.ts**

Generate shields.io-style SVG badges inline (no external deps). Template:

```typescript
export function generateBadge(opts: { grade: string; score: number; label: string }): string {
  const colors: Record<string, string> = {
    A: "#4c1",      // bright green
    B: "#97CA00",   // green
    C: "#dfb317",   // yellow
    D: "#fe7d37",   // orange
    F: "#e05d44",   // red
    "N/A": "#9f9f9f", // gray
  };
  const color = colors[opts.grade] ?? "#9f9f9f";
  const rightText = `${opts.grade} ${opts.score}`;
  // Return shields.io-compatible SVG with rounded rect, label on left, grade+score on right
  return `<svg xmlns="http://www.w3.org/2000/svg" ...>...</svg>`;
}
```

- [ ] **Step 3: Implement badge-cmd.ts**

```bash
clawdoctor badge                        # print SVG to stdout
clawdoctor badge --output badge.svg     # save to file
clawdoctor badge --format markdown      # output markdown image link
```

- [ ] **Step 4: Add GET /api/badge to dashboard server**

Returns SVG with `Content-Type: image/svg+xml`. No auth required (public badge).

- [ ] **Step 5: Run tests, commit**

```bash
git add src/badge/ src/commands/badge-cmd.ts src/dashboard/server.ts src/bin.ts
git commit -m "feat: add Skill Quality Badge system with SVG generation and dashboard API"
```

---

## Task 2: CI Integration

**Files:**
- Modify: `src/commands/checkup.ts` (add --fail-on flag)
- Create: `src/commands/checkup-ci.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { determineExitCode } from "../commands/checkup.js";

describe("CI Integration", () => {
  it("returns 0 when no --fail-on flag", () => {
    expect(determineExitCode([], undefined)).toBe(0);
  });

  it("returns 1 when --fail-on critical and critical disease exists", () => {
    const diseases = [{ severity: "critical" }];
    expect(determineExitCode(diseases, "critical")).toBe(1);
  });

  it("returns 0 when --fail-on critical but only warnings", () => {
    const diseases = [{ severity: "warning" }];
    expect(determineExitCode(diseases, "critical")).toBe(0);
  });

  it("returns 1 when --fail-on warning and warning exists", () => {
    const diseases = [{ severity: "warning" }];
    expect(determineExitCode(diseases, "warning")).toBe(1);
  });

  it("returns 0 when no diseases", () => {
    expect(determineExitCode([], "critical")).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

Add `--fail-on <severity>` option to checkup command. Export `determineExitCode()` for testing.

After rendering the report:
```typescript
if (opts.failOn) {
  process.exitCode = determineExitCode(result.diseases, opts.failOn);
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git add src/commands/checkup.ts src/commands/checkup-ci.test.ts
git commit -m "feat: add CI integration with --fail-on exit code support"
```

---

## Task 3: Community Disease Plugin Loader

**Files:**
- Create: `src/plugins/plugin-loader.ts`
- Create: `src/plugins/plugin-loader.test.ts`
- Create: `src/plugins/plugin-types.ts`
- Modify: `src/diseases/registry.ts` (support merging external diseases)
- Modify: `src/types/config.ts` (add plugins field)
- Modify: `src/commands/checkup.ts` (load plugins before checkup)
- Modify: `src/bin.ts` (add plugin command)

- [ ] **Step 1: Define plugin API types**

```typescript
// src/plugins/plugin-types.ts
import type { DiseaseDefinition } from "../types/domain.js";
import type { MetricSet } from "../analysis/metric-aggregator.js";
import type { ClawDoctorConfig } from "../types/config.js";

export interface ClawDoctorPlugin {
  name: string;
  version?: string;
  diseases?: DiseaseDefinition[];
  rules?: Record<string, CustomRuleEvaluator>;
}

export type CustomRuleEvaluator = (
  metrics: MetricSet,
  config: ClawDoctorConfig,
) => import("../analysis/rule-engine.js").RuleResult | null;
```

- [ ] **Step 2: Implement plugin loader**

```typescript
// src/plugins/plugin-loader.ts
export async function loadPlugins(pluginNames: string[]): Promise<ClawDoctorPlugin[]> {
  const plugins: ClawDoctorPlugin[] = [];
  for (const name of pluginNames) {
    try {
      const mod = await import(name);
      const plugin = mod.default ?? mod;
      if (plugin.diseases || plugin.rules) {
        plugins.push(plugin);
      }
    } catch (err) {
      console.warn(`Failed to load plugin "${name}": ${err}`);
    }
  }
  return plugins;
}
```

- [ ] **Step 3: Extend disease registry to accept external diseases**

Add `mergeExternalDiseases(diseases: DiseaseDefinition[])` to registry.

- [ ] **Step 4: Add plugins config field**

```typescript
// In ClawDoctorConfig:
plugins?: string[];  // e.g. ["clawdoctor-plugin-security-extra"]
```

- [ ] **Step 5: Wire into checkup command**

Load plugins from config + `--plugins` CLI flag, merge into registry before analysis.

- [ ] **Step 6: Write tests with mock plugin**

Test: load plugin → diseases merged into registry → custom rules evaluated.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/ src/diseases/registry.ts src/types/config.ts src/commands/checkup.ts src/bin.ts
git commit -m "feat: add community disease plugin system with dynamic loading"
```

---

## Task 4: npm Publish Prep + Documentation

**Files:**
- Modify: `package.json` (complete metadata)
- Rewrite: `README.md` (comprehensive)
- Create: `CONTRIBUTING.md`
- Create: `docs/ci-setup.md`
- Create: `docs/plugin-authoring.md`

- [ ] **Step 1: Complete package.json**

```json
{
  "keywords": ["openclaw", "diagnostics", "health", "agent", "ai", "lobster", "clawdoctor"],
  "homepage": "https://github.com/openclaw/clawdoctor",
  "repository": { "type": "git", "url": "https://github.com/openclaw/clawdoctor.git" },
  "bugs": { "url": "https://github.com/openclaw/clawdoctor/issues" },
  "files": ["dist/", "README.md", "LICENSE"]
}
```

- [ ] **Step 2: Rewrite README.md**

Sections: hero banner concept, one-liner quick start, badge showcase, all CLI commands, CI setup snippet, plugin authoring teaser, configuration reference, design spec link, contributing link.

The README should be optimized for GitHub discovery — keywords in headings, GIF/screenshot of terminal report.

- [ ] **Step 3: Create CONTRIBUTING.md**

How to write a ClawDoctor disease plugin: plugin API, DiseaseDefinition format, publishing to npm.

- [ ] **Step 4: Create docs/ci-setup.md**

GitHub Actions, GitLab CI, CircleCI examples.

- [ ] **Step 5: Create docs/plugin-authoring.md**

Step-by-step guide to creating a `clawdoctor-plugin-*` package.

- [ ] **Step 6: Commit**

```bash
git add package.json README.md CONTRIBUTING.md docs/
git commit -m "docs: comprehensive README, CI setup guide, and plugin authoring guide"
```

---

## Task 5: Auto-Prescription

**Files:**
- Modify: `src/commands/checkup.ts` (add --auto-fix flag)
- Modify: `src/analysis/analysis-pipeline.ts` (auto-apply after generation)
- Create: `src/prescription/auto-apply.ts`
- Create: `src/prescription/auto-apply.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { filterAutoApplicable } from "./auto-apply.js";

describe("AutoApply", () => {
  it("includes guided + low-risk prescriptions", () => {
    const rx = [
      { id: "1", level: "guided", risk: "low", actions: [{ type: "file_edit" }] },
      { id: "2", level: "guided", risk: "medium", actions: [{ type: "file_edit" }] },
      { id: "3", level: "manual", risk: "low", actions: [{ type: "manual" }] },
    ];
    const result = filterAutoApplicable(rx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("excludes prescriptions with config_change actions", () => {
    const rx = [
      { id: "1", level: "guided", risk: "low", actions: [{ type: "config_change" }] },
    ];
    expect(filterAutoApplicable(rx)).toHaveLength(0);
  });

  it("excludes prescriptions with command actions", () => {
    const rx = [
      { id: "1", level: "guided", risk: "low", actions: [{ type: "command" }] },
    ];
    expect(filterAutoApplicable(rx)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement auto-apply.ts**

```typescript
export function filterAutoApplicable(prescriptions: Prescription[]): Prescription[] {
  return prescriptions.filter(rx =>
    rx.level === "guided" &&
    rx.risk === "low" &&
    rx.actions.every(a => a.type === "file_edit" || a.type === "file_delete")
  );
}

export async function autoApplyPrescriptions(
  applicable: Prescription[],
  executor: PrescriptionExecutor,
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];
  for (const rx of applicable) {
    const result = await executor.execute(rx.id);
    results.push(result);
  }
  return results;
}
```

- [ ] **Step 3: Wire into checkup command**

Add `--auto-fix` flag. When set:
1. Run normal checkup
2. Filter auto-applicable prescriptions
3. Apply each
4. Show summary: "Auto-applied N prescriptions"

- [ ] **Step 4: Run tests, commit**

```bash
git add src/prescription/auto-apply.ts src/prescription/auto-apply.test.ts src/commands/checkup.ts src/analysis/analysis-pipeline.ts
git commit -m "feat: add auto-prescription with --auto-fix for low-risk guided prescriptions"
```

---

## Task 6: E2E Tests + Final Polish

**Files:**
- Modify: `src/e2e.test.ts`

- [ ] **Step 1: Add Phase 3 E2E tests**

```typescript
describe("E2E Phase 3", () => {
  it("clawdoctor badge outputs valid SVG", () => {
    const output = run("badge");
    expect(output).toContain("<svg");
    expect(output).toContain("ClawDoctor");
  });

  it("clawdoctor checkup --fail-on critical exits 0 with no critical diseases", () => {
    // This should not throw (exit code 0)
    run("checkup --fail-on critical --json --agent default", fixtureEnv);
  });

  it("clawdoctor checkup --auto-fix does not crash", () => {
    run("checkup --auto-fix --agent default --no-llm", fixtureEnv);
  });
});
```

- [ ] **Step 2: Run full test suite, verify build**

```bash
pnpm test
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/e2e.test.ts
git commit -m "feat: add Phase 3 E2E tests for badge, CI, and auto-fix"
```

---

## Summary

| Task | Description | Dependencies | Parallel With |
|------|-------------|-------------|--------------|
| 1 | Badge System | — | 2, 3, 4 |
| 2 | CI Integration | — | 1, 3, 4 |
| 3 | Community Plugin Loader | — | 1, 2, 4 |
| 4 | npm Publish + Docs | — | 1, 2, 3 |
| 5 | Auto-Prescription | — | — |
| 6 | E2E + Polish | 1-5 | — |

**Optimal agent team allocation:**

```
Round 1: Task 1 | Task 2 | Task 3 | Task 4 — 4-way parallel
Round 2: Task 5 — sequential
Round 3: Task 6 — sequential
```
