# Plugin Authoring Guide

ClawInsight's plugin system lets you write custom disease definitions, register them with the engine, and share them on npm.

## Table of Contents

- [Overview](#overview)
- [Plugin Package Setup](#plugin-package-setup)
- [DiseaseDefinition Schema](#diseasedefinition-schema)
- [Detection Context API](#detection-context-api)
- [Writing Prescriptions](#writing-prescriptions)
- [Testing Your Plugin](#testing-your-plugin)
- [Publishing to npm](#publishing-to-npm)
- [Loading Plugins](#loading-plugins)

---

## Overview

A ClawInsight plugin is an npm package that exports a `ClawInsightPlugin` object as its default export. The plugin object contains an array of `DiseaseDefinition` objects — each one describes a condition to detect, how to detect it, and optional prescriptions (auto-fixes).

---

## Plugin Package Setup

### 1. Initialize the package

```bash
mkdir clawinsight-plugin-my-rules
cd clawinsight-plugin-my-rules
npm init -y
npm install --save-dev typescript clawinsight
```

### 2. Configure TypeScript

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

### 3. Set package.json exports

```json
{
  "name": "clawinsight-plugin-my-rules",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js"
  },
  "files": ["dist/"],
  "keywords": ["clawinsight-plugin"]
}
```

Tag your package with `clawinsight-plugin` so it is discoverable on npm.

---

## DiseaseDefinition Schema

```typescript
import type { DiseaseDefinition } from 'clawinsight';

const myDisease: DiseaseDefinition = {
  // Unique ID — use a prefix to avoid collisions with built-in diseases
  id: 'CUSTOM-001',

  // Department: 'vitals' | 'skill' | 'memory' | 'behavior' | 'cost' | 'security'
  department: 'behavior',

  // Category within department (for grouping)
  category: 'reliability',

  // Multi-language name (en required, others optional)
  name: { en: 'Excessive Retry Syndrome', zh: '过度重试综合症' },

  // Multi-language description
  description: {
    en: 'Agent retries the same operation more than 5 times in a row.',
    zh: 'Agent 对同一操作重试超过5次。',
  },

  // Possible root causes
  rootCauses: [
    { en: 'Missing retry limit in agent config', zh: '缺少重试限制配置' },
    { en: 'Tool error not properly propagated', zh: '工具错误未正确传播' },
  ],

  // Detection strategy: 'rule' (threshold-based), 'llm' (LLM analysis), or 'hybrid'
  detection: {
    type: 'rule',
    metric: 'behavior.loopDetectionThreshold',
    direction: 'higher_is_worse',
    defaultThresholds: { warning: 3, critical: 5 },
  },

  // Prescription template for auto-generating fixes
  prescriptionTemplate: {
    level: 'guided',
    actionTypes: ['file_edit'],
    promptTemplate: 'Suggest adding a retry limit to the agent configuration...',
    estimatedImprovementTemplate: { en: 'Reduce retries by {value}%', zh: '减少 {value}% 重试' },
    risk: 'low',
  },

  // Related disease IDs for cross-referencing
  relatedDiseases: ['BHV-002'],

  // Default severity: 'info' | 'warning' | 'critical'
  defaultSeverity: 'warning',

  // Tags for filtering and grouping
  tags: ['loop', 'retry', 'stability'],
};
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Globally unique disease ID (use prefix to avoid collisions) |
| `department` | `Department` | `"vitals" \| "skill" \| "memory" \| "behavior" \| "cost" \| "security"` |
| `category` | `string` | Grouping within department (e.g., `"reliability"`) |
| `name` | `I18nString` | `{ en: "...", zh: "..." }` — display name |
| `description` | `I18nString` | `{ en: "...", zh: "..." }` — one-sentence summary |
| `rootCauses` | `I18nString[]` | Possible root causes |
| `detection` | `DetectionStrategy` | `{ type: "rule", metric, direction, defaultThresholds }` or `"llm"` / `"hybrid"` |
| `prescriptionTemplate` | `PrescriptionTemplate` | Template for auto-generating fixes |
| `defaultSeverity` | `Severity` | `"info" \| "warning" \| "critical"` |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `relatedDiseases` | `string[]` | IDs of related diseases for cross-referencing |
| `tags` | `string[]` | Tags for filtering and grouping |

---

## Detection Context API

The `detect(context)` function receives a `DetectionContext` object:

```typescript
interface DetectionContext {
  // All agent events in the current session, sorted by timestamp
  events: AgentEvent[];

  // Aggregated metrics computed from events
  metrics: {
    totalTokens: number;
    totalCost: number;         // USD
    sessionDuration: number;  // milliseconds
    toolCallCount: number;
    retryCount: number;
    errorCount: number;
  };

  // Loaded memory files (CLAUDE.md, .clawinsight/memory.json, etc.)
  memory: {
    files: MemoryFile[];
    totalSizeBytes: number;
    largestFileSizeBytes: number;
  };

  // Registered skills and tools
  skills: {
    registered: SkillInfo[];
    recentlyUsed: string[];   // skill IDs
  };

  // Raw config for the current agent session
  config: Record<string, unknown>;

  // Helper: get events of a specific type
  eventsOfType(type: string): AgentEvent[];

  // Helper: get the N most recent events
  recentEvents(n: number): AgentEvent[];
}
```

### AgentEvent Shape

```typescript
interface AgentEvent {
  id: string;
  type: string;           // 'tool_call' | 'retry' | 'error' | 'llm_request' | ...
  timestamp: number;      // Unix ms
  data: Record<string, unknown>;
  durationMs?: number;
  tokenCount?: number;
  cost?: number;
}
```

### DetectResult

Your `detect` function must return a `DetectResult`:

```typescript
// Disease not found
return { detected: false };

// Disease found
return {
  detected: true,
  evidence: ['string descriptions of what was found'],
  score: 0–100,           // health impact score
  metadata?: Record<string, unknown>,  // extra data for the report
};
```

---

## Writing Prescriptions

Prescriptions are optional auto-fixes attached to a disease. Each prescription has a risk level and an `apply` function.

```typescript
import type { Prescription } from 'clawinsight/plugin';

const myPrescription: Prescription = {
  // Unique ID within the disease
  id: 'my-rules.add-retry-limit',

  // Human-readable description
  description: 'Set maxRetries: 3 in the agent config',

  // Risk level — ClawInsight only auto-applies 'low' risk prescriptions with --auto-fix
  // One of: 'low' | 'medium' | 'high'
  risk: 'low',

  // Whether this prescription can be automatically undone
  reversible: true,

  // The apply function receives a mutable prescription context
  apply(ctx) {
    const config = ctx.readConfig();
    config.maxRetries = 3;
    ctx.writeConfig(config);
    ctx.log('Set maxRetries to 3');
  },

  // Optional: undo function (required if reversible: true)
  rollback(ctx) {
    const config = ctx.readConfig();
    delete config.maxRetries;
    ctx.writeConfig(config);
    ctx.log('Removed maxRetries');
  },
};
```

### PrescriptionContext API

```typescript
interface PrescriptionContext {
  // Read/write the agent config file
  readConfig(): Record<string, unknown>;
  writeConfig(config: Record<string, unknown>): void;

  // Read/write arbitrary files in the agent project
  readFile(path: string): string;
  writeFile(path: string, content: string): void;

  // Log a message shown to the user
  log(message: string): void;

  // Abort the prescription with an error message
  abort(reason: string): never;
}
```

---

## Testing Your Plugin

Test your plugin by importing the disease definitions and verifying their structure:

```typescript
import { describe, it, expect } from 'vitest';
import plugin from '../src/index.js';

describe('my-plugin', () => {
  it('exports valid disease definitions', () => {
    expect(plugin.diseases).toBeDefined();
    expect(plugin.diseases.length).toBeGreaterThan(0);

    for (const disease of plugin.diseases) {
      expect(disease.id).toBeTruthy();
      expect(disease.department).toBeTruthy();
      expect(disease.name.en).toBeTruthy();
      expect(disease.detection).toBeDefined();
      expect(disease.detection.type).toMatch(/^(rule|llm|hybrid)$/);
    }
  });

  it('rule-based diseases have valid thresholds', () => {
    const ruleDiseases = plugin.diseases.filter(d => d.detection.type === 'rule');
    for (const disease of ruleDiseases) {
      expect(disease.detection.defaultThresholds).toBeDefined();
      expect(typeof disease.detection.defaultThresholds.warning).toBe('number');
      expect(typeof disease.detection.defaultThresholds.critical).toBe('number');
    }
  });
});
```

---

## Publishing to npm

```bash
# Build
npm run build

# Verify package contents
npm pack --dry-run

# Publish
npm publish --access public
```

Make sure your package includes the `clawinsight-plugin` keyword so users can find it with:

```bash
npm search clawinsight-plugin
```

---

## Loading Plugins

Users add your plugin to their ClawInsight config:

```json
// ~/.clawinsight/config.json
{
  "plugins": [
    "clawinsight-plugin-my-rules"
  ]
}
```

ClawInsight resolves plugins from `node_modules` in the current working directory or globally installed packages.

---

## Plugin Checklist

- [ ] Package named `clawinsight-plugin-<name>`
- [ ] `clawinsight-plugin` keyword in `package.json`
- [ ] All disease IDs prefixed with plugin name
- [ ] All diseases have tests
- [ ] Prescriptions marked with correct risk level
- [ ] `reversible: true` prescriptions have a `rollback` function
- [ ] TypeScript strict mode enabled
