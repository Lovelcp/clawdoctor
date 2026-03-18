# Plugin Authoring Guide

ClawDoc's plugin system lets you write custom disease definitions, register them with the engine, and share them on npm.

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

A ClawDoc plugin is an npm package that exports a `ClawDocPlugin` object as its default export. The plugin object contains an array of `DiseaseDefinition` objects — each one describes a condition to detect, how to detect it, and optional prescriptions (auto-fixes).

---

## Plugin Package Setup

### 1. Initialize the package

```bash
mkdir clawdoc-plugin-my-rules
cd clawdoc-plugin-my-rules
npm init -y
npm install --save-dev typescript clawdoc
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
  "name": "clawdoc-plugin-my-rules",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js"
  },
  "files": ["dist/"],
  "keywords": ["clawdoc-plugin"]
}
```

Tag your package with `clawdoc-plugin` so it is discoverable on npm.

---

## DiseaseDefinition Schema

```typescript
import type { DiseaseDefinition } from 'clawdoc/plugin';

const myDisease: DiseaseDefinition = {
  // Unique ID — use `<plugin-name>.<disease-slug>` to avoid collisions
  id: 'my-rules.excessive-retries',

  // Human-readable name shown in reports
  name: 'Excessive Retry Syndrome',

  // One of: 'vitals' | 'skill' | 'memory' | 'behavior' | 'cost' | 'security'
  department: 'behavior',

  // One of: 'info' | 'warning' | 'error' | 'critical'
  severity: 'warning',

  // Short description shown in the report summary
  description: 'Agent retries the same operation more than 5 times in a row.',

  // Optional: longer explanation with markdown support
  details: `
    Repeated retries without backoff can indicate a stuck loop or a misunderstanding
    of tool error semantics. Investigate the tool that is being retried.
  `,

  // Optional: tags for filtering and grouping
  tags: ['loop', 'retry', 'stability'],

  // The detection function — see Detection Context API below
  detect(context) {
    const retries = context.events.filter(e => e.type === 'retry');
    if (retries.length > 5) {
      return {
        detected: true,
        evidence: [`${retries.length} retries observed in session`],
        // Health score contribution: 0 (healthy) to 100 (critically ill)
        score: Math.min(100, retries.length * 8),
      };
    }
    return { detected: false };
  },

  // Optional: list of prescriptions (fixes)
  prescriptions: [],
};
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Globally unique disease ID |
| `name` | `string` | Display name |
| `department` | `Department` | Which department owns this disease |
| `severity` | `Severity` | Default severity level |
| `description` | `string` | One-sentence summary |
| `detect` | `DetectFn` | Detection function |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `details` | `string` | Markdown explanation |
| `tags` | `string[]` | Tags for filtering |
| `prescriptions` | `Prescription[]` | Auto-fix definitions |

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

  // Loaded memory files (CLAUDE.md, .clawdoc/memory.json, etc.)
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
import type { Prescription } from 'clawdoc/plugin';

const myPrescription: Prescription = {
  // Unique ID within the disease
  id: 'my-rules.add-retry-limit',

  // Human-readable description
  description: 'Set maxRetries: 3 in the agent config',

  // Risk level — ClawDoc only auto-applies 'low' risk prescriptions with --auto-fix
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

Use ClawDoc's test utilities to unit-test your disease definitions without a real agent session:

```typescript
import { describe, it, expect } from 'vitest';
import { createTestContext } from 'clawdoc/plugin/testing';
import myDisease from '../src/index.js';

describe('excessive-retries', () => {
  it('detects when retry count exceeds threshold', () => {
    const ctx = createTestContext({
      events: Array.from({ length: 7 }, (_, i) => ({
        id: `evt-${i}`,
        type: 'retry',
        timestamp: Date.now() + i * 1000,
        data: { toolName: 'bash' },
      })),
    });

    const result = myDisease.diseases[0].detect(ctx);
    expect(result.detected).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('does not detect when retry count is within threshold', () => {
    const ctx = createTestContext({
      events: Array.from({ length: 3 }, (_, i) => ({
        id: `evt-${i}`,
        type: 'retry',
        timestamp: Date.now() + i * 1000,
        data: { toolName: 'bash' },
      })),
    });

    const result = myDisease.diseases[0].detect(ctx);
    expect(result.detected).toBe(false);
  });
});
```

### createTestContext Options

```typescript
createTestContext({
  events?: AgentEvent[];
  metrics?: Partial<Metrics>;
  memory?: Partial<MemoryContext>;
  skills?: Partial<SkillContext>;
  config?: Record<string, unknown>;
})
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

Make sure your package includes the `clawdoc-plugin` keyword so users can find it with:

```bash
npm search clawdoc-plugin
```

---

## Loading Plugins

Users add your plugin to their ClawDoc config:

```json
// ~/.clawdoc/config.json
{
  "plugins": [
    "clawdoc-plugin-my-rules"
  ]
}
```

ClawDoc resolves plugins from `node_modules` in the current working directory or globally installed packages.

---

## Plugin Checklist

- [ ] Package named `clawdoc-plugin-<name>`
- [ ] `clawdoc-plugin` keyword in `package.json`
- [ ] All disease IDs prefixed with plugin name
- [ ] All diseases have tests
- [ ] Prescriptions marked with correct risk level
- [ ] `reversible: true` prescriptions have a `rollback` function
- [ ] TypeScript strict mode enabled
