# 🦞 ClawDoctor

**The doctor your agent deserves.** Full-spectrum health diagnostics for [OpenClaw](https://github.com/openclaw/openclaw) agents.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

---

## What is ClawDoctor?

ClawDoctor diagnoses your OpenClaw agent like a doctor examines a patient — checking vitals, analyzing behavior, finding root causes, prescribing fixes, and tracking recovery.

```bash
npx clawdoctor checkup
```

One command. Zero config. Full health report.

```
  🦞 ClawDoctor Health Report
  Agent: main | Data: 2026-03-11 ~ 2026-03-18
  Mode: snapshot | Coverage: 44% (8/18)

  Overall Health: 67/100  Grade C ◇ Fair  ━━━━━━━━━━━━━───────

  System Vitals          100  A  ━━━━━━━━━━━━  [1/4]
  Memory Cognition       100  A  ━━━━━━━━━━━━  [3/3]
  Agent Behavior          50  C  ━━━━━━──────  [2/3]
    ● BHV-005 Premature Abort — task completion rate below threshold
  Security Immunity       50  C  ━━━━━━──────  [2/2]
    ▲ SEC-001 Immune Deficiency — sandbox disabled
```

## Features

| Feature | Description |
|---------|-------------|
| **6 Diagnostic Departments** | System Vitals, Skill & Tool, Memory Cognition, Agent Behavior, Cost Metabolism, Security Immunity |
| **43 Disease Definitions** | From Token Obesity to Death Loops, each with severity, evidence, and root cause analysis |
| **LLM-Powered Deep Analysis** | 3-round diagnosis: quick scan → deep root cause → cross-department causal chain detection |
| **Prescription System** | Generate fixes, preview diffs, one-click apply, rollback if things go wrong, follow-up to verify improvement |
| **Auto-Fix** | `--auto-fix` automatically applies low-risk prescriptions (guided level, file edits only) |
| **CI Integration** | `--fail-on critical` exits with code 1 — add agent health gates to your CI pipeline |
| **Web Dashboard** | 9-page SPA with health score trends, department details, prescription management, event timeline |
| **Quality Badge** | Generate shields.io-style SVG badges showing your agent's health grade |
| **Plugin System** | Write custom disease rules as npm packages, share with the community |
| **Privacy-First** | Raw data never persisted — only redacted summaries stored in SQLite |

## Installation

```bash
# Run directly (no install needed)
npx clawdoctor checkup

# Or install globally
npm install -g clawdoctor

# Or as a project dependency
npm install clawdoctor
```

**Requirements:** Node.js 22+

## Commands

### Core

```bash
clawdoctor checkup                        # Full health checkup (all 6 departments)
clawdoctor checkup --agent <id>           # Check a specific agent
clawdoctor checkup --dept skill,memory    # Focus on specific departments
clawdoctor checkup --since 30d            # Custom time range
clawdoctor checkup --no-llm              # Rules only (fast, no API key needed)
clawdoctor checkup --json                 # Structured JSON output
clawdoctor checkup --fail-on critical     # CI mode: exit 1 on critical issues
clawdoctor checkup --auto-fix             # Auto-apply low-risk prescriptions
```

### Prescriptions

```bash
clawdoctor rx list                         # View all prescriptions
clawdoctor rx preview <id>                 # Preview changes before applying
clawdoctor rx apply <id>                   # Apply a prescription
clawdoctor rx apply --all                  # Apply all guided prescriptions
clawdoctor rx rollback <id>                # Undo an applied prescription
clawdoctor rx followup [id]                # Check if the fix worked
clawdoctor rx history                      # View prescription history
```

### Explore

```bash
clawdoctor skill list                      # Skill & Tool health overview
clawdoctor memory scan                     # Memory file health scan
clawdoctor cost report                     # Token cost analysis
clawdoctor behavior report                 # Agent behavior analysis
clawdoctor security audit                  # Security posture check
```

### Dashboard & Badge

```bash
clawdoctor dashboard                       # Start web dashboard (http://127.0.0.1:9800)
clawdoctor dashboard --port 3000           # Custom port
clawdoctor badge                           # Output SVG badge to stdout
clawdoctor badge --output badge.svg        # Save badge to file
clawdoctor badge --format markdown         # Output markdown image link
```

### Configuration

```bash
clawdoctor config init                     # Create config with defaults
clawdoctor config show                     # View current configuration
clawdoctor config set <key> <value>        # Update a config value
```

## Health Score Badge

Show your agent's health score in your README:

```bash
clawdoctor badge --output badge.svg
```

```markdown
![ClawDoctor](./badge.svg)
```

The badge shows the overall grade (A-F) and numeric score, color-coded:

| Grade | Score | Color |
|-------|-------|-------|
| A | 90-100 | Green |
| B | 70-89 | Light green |
| C | 50-69 | Yellow |
| D | 25-49 | Orange |
| F | 0-24 | Red |

## CI Integration

Add agent health checks to your CI pipeline:

### GitHub Actions

```yaml
name: Agent Health Check
on: [push, pull_request]
jobs:
  clawdoctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Run ClawDoctor
        run: npx clawdoctor checkup --fail-on critical --no-llm
```

See [CI Setup Guide](docs/ci-setup.md) for GitLab CI, CircleCI, and Jenkins examples.

## Community Plugins

Extend ClawDoctor with custom disease rules:

```bash
# Install a community plugin
npm install clawdoctor-plugin-security-extra

# Use it
clawdoctor checkup --plugins clawdoctor-plugin-security-extra
```

Or add to your config:

```json
{
  "plugins": ["clawdoctor-plugin-security-extra"]
}
```

### Write Your Own Plugin

```typescript
// clawdoctor-plugin-my-rules/src/index.ts
const plugin = {
  name: 'clawdoctor-plugin-my-rules',
  diseases: [{
    id: 'CUSTOM-001',
    department: 'behavior',
    category: 'reliability',
    name: { en: 'Excessive Retry', zh: '过度重试' },
    description: { en: 'Agent retries same operation 5+ times', zh: 'Agent 重试同一操作超过5次' },
    detection: {
      type: 'rule',
      metric: 'behavior.loopDetectionThreshold',
      direction: 'higher_is_worse',
      defaultThresholds: { warning: 3, critical: 5 },
    },
    // ... full DiseaseDefinition
  }],
};
export default plugin;
```

See the [Plugin Authoring Guide](docs/plugin-authoring.md) for the complete schema and examples.

## Architecture

ClawDoctor uses a **dual-mode architecture**:

- **CLI Mode** (`npx clawdoctor checkup`): Reads OpenClaw files on disk (sessions, config, memory). Zero setup.
- **Plugin Mode**: Runs inside OpenClaw gateway, collecting real-time events via hooks for richer analysis.

```
  🦞 ClawDoctor
  ├── Snapshot Collector (reads files)
  ├── Stream Collector (plugin hooks)
  ├── Rule Engine (27 rule-based diseases)
  ├── LLM Analyzer (16 LLM/hybrid diseases, 3-round analysis)
  ├── Causal Chain Linker (cross-department root cause inference)
  ├── Prescription Engine (generate → apply → verify → rollback)
  ├── Health Scorer (Apdex + AHP weights + CVSS for security)
  ├── Terminal Report (ANSI colored, i18n)
  └── Web Dashboard (Hono + SPA, 15 API endpoints)
```

See the full [Design Specification](docs/2026-03-17-clawdoctor-design.md) for detailed architecture documentation.

## Configuration

Config file location: `~/.clawdoctor/config.json`

```json
{
  "locale": "en",
  "thresholds": {
    "skill.successRate": { "warning": 0.75, "critical": 0.50 },
    "cost.dailyTokens": { "warning": 100000, "critical": 500000 }
  },
  "weights": {
    "vitals": 0.08, "skill": 0.26, "memory": 0.14,
    "behavior": 0.26, "cost": 0.11, "security": 0.15
  },
  "llm": { "enabled": true },
  "plugins": []
}
```

All thresholds are configurable. Department weights use AHP (Analytic Hierarchy Process) defaults.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

The most impactful way to contribute is by writing [disease plugins](docs/plugin-authoring.md).

## License

[Apache License 2.0](LICENSE)

Copyright 2026 ClawDoctor Contributors
