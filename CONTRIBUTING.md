# Contributing to ClawDoc

Thank you for your interest in contributing to ClawDoc! This document explains how to contribute bug reports, feature requests, disease plugins, and code changes.

## Table of Contents

- [Bug Reports](#bug-reports)
- [Feature Requests](#feature-requests)
- [Writing Disease Plugins](#writing-disease-plugins)
- [Pull Request Process](#pull-request-process)
- [Development Setup](#development-setup)
- [Code Style](#code-style)

---

## Bug Reports

Before filing a bug report, please check the [existing issues](https://github.com/openclaw/clawdoc/issues) to avoid duplicates.

When filing a bug report, include:

1. **ClawDoc version**: `clawdoc --version`
2. **Node.js version**: `node --version`
3. **Operating system** and version
4. **Steps to reproduce** the issue
5. **Expected behavior** vs **actual behavior**
6. **Full error output** (use `clawdoc checkup --verbose` if applicable)

Use the [Bug Report issue template](https://github.com/openclaw/clawdoc/issues/new?template=bug_report.md) on GitHub.

---

## Feature Requests

Feature requests are welcome! Please open an issue with:

1. A clear description of the problem you want to solve
2. Your proposed solution or approach
3. Any alternatives you have considered

For large features, consider opening a discussion first to get early feedback before writing code.

---

## Writing Disease Plugins

The most impactful way to contribute is by writing new disease definitions. Plugins are standalone npm packages that ClawDoc loads at runtime.

### Plugin Package Naming

Name your plugin `clawdoc-plugin-<name>` so it is discoverable on npm.

### Minimal Plugin Example

```typescript
import type { ClawDocPlugin, DiseaseDefinition } from 'clawdoc/plugin';

const myDisease: DiseaseDefinition = {
  id: 'my-plugin.excessive-retries',
  name: 'Excessive Retry Syndrome',
  department: 'behavior',
  severity: 'warning',
  description: 'Agent retries the same operation more than 5 times in a row.',
  detect(context) {
    const retries = context.events.filter(e => e.type === 'retry');
    if (retries.length > 5) {
      return {
        detected: true,
        evidence: [`${retries.length} retries observed`],
        score: Math.min(100, retries.length * 10),
      };
    }
    return { detected: false };
  },
  prescriptions: [
    {
      id: 'my-plugin.add-retry-limit',
      description: 'Add a retry limit to the agent configuration',
      risk: 'low',
      apply(context) {
        // mutation logic here
      },
    },
  ],
};

const plugin: ClawDocPlugin = {
  name: 'clawdoc-plugin-my-rules',
  version: '1.0.0',
  diseases: [myDisease],
};

export default plugin;
```

See the full [Plugin Authoring Guide](docs/plugin-authoring.md) for the complete `DiseaseDefinition` schema, context API, and testing utilities.

### Submitting a Plugin to the Registry

Once published on npm, open an issue with the label `plugin-submission` and include:

- Package name
- npm URL
- Brief description of the diseases it detects
- Departments covered

---

## Pull Request Process

1. **Fork** the repository and create a branch from `main`.
2. **Install dependencies**: `pnpm install`
3. **Make your changes** with appropriate tests.
4. **Run tests**: `pnpm test`
5. **Run type check**: `pnpm check`
6. **Build**: `pnpm build`
7. **Open a pull request** against `main` with a clear description of what changed and why.

### PR Checklist

- [ ] Tests added or updated for all changed behavior
- [ ] `pnpm test` passes
- [ ] `pnpm check` passes (no TypeScript errors)
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] Documentation updated if public API changed

### Commit Message Format

We follow Conventional Commits:

```
<type>(<scope>): <short summary>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:
- `feat(diseases): add token-obesity detection for behavior department`
- `fix(rx): rollback now restores original config correctly`
- `docs: update plugin authoring guide with context API`

---

## Development Setup

```bash
# Clone the repo
git clone https://github.com/openclaw/clawdoc.git
cd clawdoc

# Install dependencies (requires pnpm)
pnpm install

# Run in dev mode
pnpm dev checkup

# Run tests in watch mode
pnpm test

# Build
pnpm build
```

### Project Structure

```
src/
  bin.ts              # CLI entry point
  commands/           # One file per CLI command
  diseases/           # Built-in disease definitions
  analysis/           # Detection engine
  prescription/       # Rx apply/rollback engine
  store/              # SQLite persistence
  dashboard/          # Hono web server
  badge/              # SVG badge generator
  plugin/             # Plugin loader
  llm/                # LLM integration
  collector/          # Agent data collectors
  report/             # Report formatters
```

---

## Code Style

- **TypeScript strict mode** — all code must pass `tsc --noEmit`
- **No default exports** from command modules (use named exports like `registerXyzCommand`)
- **Vitest** for tests — colocate test files with source files
- **No external formatting config** — keep it simple, readable

---

Questions? Open an issue or start a discussion on GitHub.
