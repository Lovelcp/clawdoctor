# ClawDoc

> Health diagnostics for OpenClaw agents. Keep your lobster healthy.

## Quick Start

```bash
npx clawdoc checkup
```

## Commands

- `clawdoc checkup` — Full health checkup (all 6 departments)
- `clawdoc checkup --dept skill` — Focus on specific department
- `clawdoc checkup --json` — JSON output for CI integration
- `clawdoc skill list` — Skill & Tool health overview
- `clawdoc memory scan` — Memory file health scan
- `clawdoc cost report` — Token cost analysis
- `clawdoc behavior report` — Agent behavior analysis
- `clawdoc security audit` — Security posture check
- `clawdoc config show` — View current configuration
- `clawdoc config init` — Initialize config with defaults

## Configuration

Config file: `~/.clawdoc/config.json`

All thresholds are configurable. Run `clawdoc config init` to create a config file with defaults, then edit as needed.

## Design

See [Design Specification](docs/2026-03-17-clawdoc-design.md) for the full architecture.
