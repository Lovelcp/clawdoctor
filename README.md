# 🦞 ClawDoctor

> Keep your lobster healthy. Health diagnostics for OpenClaw agents.

![ClawDoctor: A](badge-example.svg)

## Quick Start

```bash
npx clawdoctor checkup
```

One command. Zero config. Full health report for your OpenClaw agent.

## Features

- **6 Diagnostic Departments**: System Vitals, Skill & Tool, Memory, Behavior, Cost, Security
- **43 Disease Definitions**: From Token Obesity to Death Loops
- **LLM-Powered Analysis**: Deep diagnosis with causal chain detection
- **Auto-Fix**: `--auto-fix` automatically applies low-risk prescriptions
- **CI Integration**: `--fail-on critical` for your CI pipeline
- **Web Dashboard**: `clawdoctor dashboard` for visual health monitoring
- **Quality Badge**: Show your agent's health score in your README
- **Plugin System**: Write custom disease rules and share them

## Commands

| Command | Description |
|---------|-------------|
| `clawdoctor checkup` | Full health checkup |
| `clawdoctor checkup --fail-on critical` | CI mode — exit 1 on critical issues |
| `clawdoctor checkup --auto-fix` | Auto-apply low-risk prescriptions |
| `clawdoctor rx list` | View pending prescriptions |
| `clawdoctor rx apply <id>` | Apply a prescription |
| `clawdoctor rx rollback <id>` | Rollback an applied prescription |
| `clawdoctor dashboard` | Start web dashboard |
| `clawdoctor badge` | Generate health score badge |
| `clawdoctor config show` | View configuration |

## Badge

Add a health score badge to your README:

```bash
clawdoctor badge --output badge.svg
```

Then in your README:
```markdown
![ClawDoctor Score](./badge.svg)
```

## CI Setup

### GitHub Actions

```yaml
- name: Agent Health Check
  run: npx clawdoctor checkup --fail-on critical --no-llm
```

## Plugins

Create custom disease rules:

```bash
npm init clawdoctor-plugin-my-rules
```

See [Plugin Authoring Guide](docs/plugin-authoring.md).

## Configuration

```bash
clawdoctor config init    # create ~/.clawdoctor/config.json
clawdoctor config show    # view current config
```

## Design

See [Design Specification](docs/2026-03-17-clawdoctor-design.md).

## License

MIT
