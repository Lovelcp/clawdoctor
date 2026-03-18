# CI Setup Guide

ClawDoc integrates with any CI system that can run Node.js. Use `--fail-on` to gate your pipeline on agent health.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed (or no issues above the threshold) |
| `1` | One or more issues at or above the `--fail-on` severity |

## Severity Levels

`info` < `warning` < `critical`

Use `--fail-on critical` to only block on critical issues, or `--fail-on warning` for a stricter pipeline.

## Flags for CI

| Flag | Description |
|------|-------------|
| `--fail-on <severity>` | Exit 1 if any issue at this severity or above is found (`info`, `warning`, or `critical`) |
| `--no-llm` | Skip LLM-powered analysis (faster, no API key required) |
| `--json` | Output structured JSON for downstream processing |
| `--dept <name>` | Only run a specific department |

---

## GitHub Actions

### Basic Health Gate

```yaml
name: Agent Health Check

on:
  push:
    branches: [main]
  pull_request:

jobs:
  clawdoc:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Run ClawDoc health check
        run: npx clawdoc checkup --fail-on critical --no-llm
```

### With LLM Analysis

```yaml
      - name: Run ClawDoc health check (with LLM)
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: npx clawdoc checkup --fail-on critical
```

### With JSON Report as Artifact

```yaml
      - name: Run ClawDoc and save report
        run: npx clawdoc checkup --fail-on critical --no-llm --json > clawdoc-report.json || true

      - name: Upload ClawDoc report
        uses: actions/upload-artifact@v4
        with:
          name: clawdoc-report
          path: clawdoc-report.json

      - name: Fail on critical issues
        run: npx clawdoc checkup --fail-on critical --no-llm
```

### Per-Department Checks

```yaml
      - name: Security audit
        run: npx clawdoc checkup --dept security --fail-on warning --no-llm

      - name: Memory health
        run: npx clawdoc checkup --dept memory --fail-on warning --no-llm
```

---

## GitLab CI

```yaml
clawdoc:
  image: node:22
  stage: test
  script:
    - npx clawdoc checkup --fail-on critical --no-llm
  artifacts:
    when: always
    paths:
      - clawdoc-report.json
    expire_in: 7 days
  before_script:
    - npx clawdoc checkup --fail-on critical --no-llm --json > clawdoc-report.json || true
```

### With LLM and Secret Variable

```yaml
clawdoc-full:
  image: node:22
  stage: test
  variables:
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
  script:
    - npx clawdoc checkup --fail-on critical
  only:
    - main
```

---

## CircleCI

```yaml
version: 2.1

jobs:
  clawdoc:
    docker:
      - image: cimg/node:22.0
    steps:
      - checkout
      - run:
          name: Agent Health Check
          command: npx clawdoc checkup --fail-on critical --no-llm

workflows:
  main:
    jobs:
      - clawdoc
```

### Storing Report as Artifact

```yaml
      - run:
          name: Run ClawDoc (JSON output)
          command: |
            npx clawdoc checkup --fail-on critical --no-llm --json > clawdoc-report.json
      - store_artifacts:
          path: clawdoc-report.json
          destination: clawdoc
```

---

## Jenkins

```groovy
pipeline {
    agent any
    stages {
        stage('Agent Health Check') {
            steps {
                sh 'npx clawdoc checkup --fail-on critical --no-llm'
            }
            post {
                always {
                    sh 'npx clawdoc checkup --fail-on critical --no-llm --json > clawdoc-report.json || true'
                    archiveArtifacts artifacts: 'clawdoc-report.json', allowEmptyArchive: true
                }
            }
        }
    }
}
```

---

## Tips

- **Use `--no-llm` in CI** unless you have an API key configured — LLM analysis is optional and adds latency.
- **Cache the npx download** using your CI's node_modules cache to speed up runs.
- **Set `--fail-on warning`** for stricter pipelines where you want to catch all non-info issues.
- **Run ClawDoc on a schedule** (e.g., nightly) in addition to per-commit checks to catch drift in long-running agents.
