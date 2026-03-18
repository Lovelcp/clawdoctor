# 🦞 ClawInsight

> Keep your lobster healthy. Health diagnostics for OpenClaw agents.

![ClawInsight: A](badge-example.svg)

## Quick Start

```bash
npx clawinsight checkup
```

One command. Zero config. Full health report for your OpenClaw agent.

## Features

- **6 Diagnostic Departments**: System Vitals, Skill & Tool, Memory, Behavior, Cost, Security
- **43 Disease Definitions**: From Token Obesity to Death Loops
- **LLM-Powered Analysis**: Deep diagnosis with causal chain detection
- **Auto-Fix**: `--auto-fix` automatically applies low-risk prescriptions
- **CI Integration**: `--fail-on critical` for your CI pipeline
- **Web Dashboard**: `clawinsight dashboard` for visual health monitoring
- **Quality Badge**: Show your agent's health score in your README
- **Plugin System**: Write custom disease rules and share them

## Commands

| Command | Description |
|---------|-------------|
| `clawinsight checkup` | Full health checkup |
| `clawinsight checkup --fail-on critical` | CI mode — exit 1 on critical issues |
| `clawinsight checkup --auto-fix` | Auto-apply low-risk prescriptions |
| `clawinsight rx list` | View pending prescriptions |
| `clawinsight rx apply <id>` | Apply a prescription |
| `clawinsight rx rollback <id>` | Rollback an applied prescription |
| `clawinsight dashboard` | Start web dashboard |
| `clawinsight badge` | Generate health score badge |
| `clawinsight config show` | View configuration |

## Badge

Add a health score badge to your README:

```bash
clawinsight badge --output badge.svg
```

Then in your README:
```markdown
![ClawInsight Score](./badge.svg)
```

## CI Setup

### GitHub Actions

```yaml
- name: Agent Health Check
  run: npx clawinsight checkup --fail-on critical --no-llm
```

## Plugins

Create custom disease rules:

```bash
npm init clawinsight-plugin-my-rules
```

See [Plugin Authoring Guide](docs/plugin-authoring.md).

## Configuration

```bash
clawinsight config init    # create ~/.clawinsight/config.json
clawinsight config show    # view current config
```

## Design

See [Design Specification](docs/2026-03-17-clawinsight-design.md).

## License

MIT
