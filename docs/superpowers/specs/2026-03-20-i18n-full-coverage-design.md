# ClawDoctor Full i18n Coverage Design

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Dashboard SPA + CLI command output + report-builder summary strings

---

## 1. Context

ClawDoctor already has a partial i18n system:
- `I18nString` type (`{ en: string; zh: string; [locale: string]: string }`) in `src/types/domain.ts`
- `t(str, locale)` translation function in `src/i18n/i18n.ts`
- `UI_STRINGS` centralized dictionary in `src/i18n/locales.ts` (~27 strings)
- All 43 disease definitions have en/zh translations
- Terminal report renderer uses `t()` with locale parameter
- `config.locale` in `~/.clawdoctor/config.json` (default: `"en"`)

**What is NOT internationalized:**
- Dashboard SPA (`src/dashboard/public/index.html`) — 1,675 lines, all hardcoded English
- CLI command output strings in `checkup.ts`, `rx-cmd.ts`, `config-cmd.ts`, `dashboard-cmd.ts`, `badge-cmd.ts`
- Report-builder summary lines in `report-builder.ts` ("Insufficient data...", "Score: X | N active issue(s)...", "N checks skipped...")

## 2. Design Decisions

### 2.1 Two Separate Dictionaries

CLI and SPA run in different environments (Node vs Browser). They maintain separate dictionaries:

- **CLI dictionary:** `src/i18n/locales.ts` → `UI_STRINGS` object (existing, to be extended)
- **SPA dictionary:** `src/dashboard/public/index.html` → `LOCALE_DICT` object (new, embedded in JS)

No sharing needed — each dictionary contains only strings relevant to its context.

### 2.2 Language Switching

- **CLI:** Reads `config.locale` at command execution time. No interactive switching.
- **Dashboard:** Settings page includes a language dropdown (`English` / `中文`). Selecting a language:
  1. Updates `window.__CLAWDOCTOR_LOCALE__` in memory
  2. Re-renders the current page (calls `onHashChange()`)
  3. Persists to config via `PUT /api/config` with `{ locale: "zh" }` body
  4. Next CLI execution and dashboard load will use the new locale

### 2.3 Server-Side Locale Injection

`loadSpaHtml()` in `src/dashboard/server.ts` already injects the auth token into the HTML. It will also inject the locale:

```html
<script>
  window.__CLAWDOCTOR_TOKEN__ = "xxx";
  window.__CLAWDOCTOR_LOCALE__ = "zh";
</script>
```

### 2.4 What Stays English

| Category | Reason |
|----------|--------|
| Commander `.description()` / `--help` text | Developer tool convention |
| API error responses (`{ error: "..." }`) | Consumed by programs, not users |
| LLM prompts in `prescription-generator.ts` | English yields best LLM results |
| Internal log messages (`[clawdoctor] xxx failed:`) | Debug purpose |

## 3. CLI i18n — UI_STRINGS Extension

### 3.1 New Keys in `src/i18n/locales.ts`

Add the following keys to `UI_STRINGS`:

**report-builder.ts summary lines:**
- `report.insufficientData`: `"Insufficient data for scoring ({coverage}% coverage)"` / `"数据不足，无法评分（{coverage}% 覆盖率）"`
- `report.scoreSummary`: `"Score: {score} | {count} active issue(s) [{critical} critical, {warning} warning]"` / `"得分: {score} | {count} 个活跃问题 [{critical} 严重, {warning} 警告]"`
- `report.checksSkipped`: `"{count} checks skipped (need plugin for full {dept} analysis)"` / `"{count} 项检查已跳过（需要插件完成完整 {dept} 分析）"`

**checkup.ts:**
- `cli.autoApplying`: `"Auto-applying {count} low-risk prescription(s)..."` / `"自动应用 {count} 个低风险处方..."`
- `cli.autoFixSummary`: `"Auto-fix summary: {applied} applied, {failed} failed"` / `"自动修复摘要: {applied} 个已应用, {failed} 个失败"`

**rx-cmd.ts:**
- `rx.noPrescriptions`: `"No prescriptions found."` / `"未找到处方。"`
- `rx.prescriptionCount`: `"Prescriptions ({count}):"` / `"处方（{count}）:"`
- `rx.labelId`: `"ID:"` / `"编号:"`
- `rx.labelLevel`: `"Level:"` / `"级别:"`
- `rx.labelRisk`: `"Risk:"` / `"风险:"`
- `rx.labelStatus`: `"Status:"` / `"状态:"`
- `rx.labelActions`: `"Actions:"` / `"操作:"`
- `rx.applying`: `"Applying: {id}"` / `"应用中: {id}"`
- `rx.success`: `"Success:"` / `"成功:"`
- `rx.verification`: `"Verification:"` / `"验证:"`
- `rx.rollingBack`: `"Rolling back prescription: {id}"` / `"回滚处方: {id}"`
- `rx.restoredFiles`: `"Restored files:"` / `"已恢复文件:"`
- `rx.skippedFiles`: `"Skipped files:"` / `"跳过文件:"`
- `rx.conflicts`: `"Conflicts:"` / `"冲突:"`
- `rx.runningFollowUp`: `"Running follow-up for prescription: {id}"` / `"运行处方复查: {id}"`
- `rx.verdict`: `"Verdict:"` / `"结论:"`
- `rx.noDueFollowups`: `"No due follow-ups found."` / `"没有待执行的复查。"`
- `rx.dueFollowups`: `"Found {count} due follow-up(s)."` / `"发现 {count} 个待执行复查。"`
- `rx.noHistory`: `"No prescription history found."` / `"未找到处方历史。"`
- `rx.historyCount`: `"Prescription History ({count}):"` / `"处方历史（{count}）:"`
- `rx.preview`: `"Preview: {id}"` / `"预览: {id}"`
- `rx.diagnosis`: `"Diagnosis:"` / `"诊断:"`
- `rx.estimatedImprovement`: `"Estimated improvement:"` / `"预估改善:"`
- `rx.rollbackAvailable`: `"Rollback available:"` / `"可回滚:"`

**config-cmd.ts:**
- `config.initialized`: `"Config initialized at {path}"` / `"配置已初始化: {path}"`
- `config.alreadyExists`: `"Config already exists at {path}"` / `"配置已存在: {path}"`
- `config.setValue`: `"Set {key} = {value}"` / `"设置 {key} = {value}"`

**dashboard-cmd.ts:**
- `dashboard.runningCheckup`: `"Running fresh checkup to populate dashboard data..."` / `"正在运行体检以填充仪表盘数据..."`

### 3.2 Template Interpolation

For strings with dynamic values, use a simple interpolation helper:

```typescript
// in src/i18n/i18n.ts
export function tf(str: I18nString, locale: string, vars: Record<string, string | number>): string {
  let result = t(str, locale);
  for (const [key, val] of Object.entries(vars)) {
    result = result.replace(`{${key}}`, String(val));
  }
  return result;
}
```

Usage:
```typescript
tf(UI_STRINGS["report.scoreSummary"], locale, { score: 85, count: 3, critical: 1, warning: 2 })
```

### 3.3 Locale Access Pattern

Each command file already calls `loadConfig()`. Extract locale from config:

```typescript
const config = loadConfig(configFilePath);
const locale = config.locale ?? "en";
```

## 4. Dashboard SPA i18n

### 4.1 LOCALE_DICT Structure

Embedded in `index.html` JS section, approximately 80-100 keys:

```javascript
const LOCALE_DICT = {
  // Navigation
  "nav.dashboard": { en: "Dashboard", zh: "仪表盘" },
  "nav.overview": { en: "Overview", zh: "总览" },
  "nav.vitals": { en: "System Vitals", zh: "基础体征" },
  "nav.skill": { en: "Skills & Tools", zh: "技能与工具" },
  "nav.memory": { en: "Memory", zh: "记忆" },
  "nav.behavior": { en: "Behavior", zh: "行为" },
  "nav.cost": { en: "Cost", zh: "成本" },
  "nav.security": { en: "Security", zh: "安全" },
  "nav.prescriptions": { en: "Prescriptions", zh: "处方" },
  "nav.timeline": { en: "Timeline", zh: "时间线" },
  "nav.settings": { en: "Settings", zh: "设置" },
  "nav.departments": { en: "Departments", zh: "科室" },
  "nav.tools": { en: "Tools", zh: "工具" },

  // Actions
  "action.runCheckup": { en: "Run Checkup", zh: "运行体检" },
  "action.save": { en: "Save", zh: "保存" },
  "action.testConnection": { en: "Test Connection", zh: "测试连接" },
  "action.prev": { en: "Prev", zh: "上一页" },
  "action.next": { en: "Next", zh: "下一页" },

  // Page titles
  "page.healthOverview": { en: "Health Overview", zh: "健康总览" },
  "page.eventTimeline": { en: "Event Timeline", zh: "事件时间线" },
  "page.settings.title": { en: "Settings", zh: "设置" },
  "page.settings.subtitle": { en: "LLM provider and ClawDoctor configuration", zh: "LLM 提供商与 ClawDoctor 配置" },

  // Health score
  "health.grade": { en: "Grade", zh: "评级" },
  "health.coverage": { en: "Coverage", zh: "覆盖率" },
  "health.overallHealth": { en: "Overall Health", zh: "整体健康" },

  // Table headers
  "table.disease": { en: "Disease", zh: "病症" },
  "table.severity": { en: "Severity", zh: "严重程度" },
  "table.department": { en: "Department", zh: "科室" },
  "table.status": { en: "Status", zh: "状态" },
  "table.detectedAt": { en: "Detected At", zh: "检测时间" },
  "table.occurredAt": { en: "Occurred At", zh: "发生时间" },
  "table.type": { en: "Type", zh: "类型" },
  "table.timestamp": { en: "Timestamp", zh: "时间戳" },
  "table.data": { en: "Data", zh: "数据" },

  // Severity labels
  "severity.critical": { en: "Critical", zh: "严重" },
  "severity.warning": { en: "Warning", zh: "警告" },
  "severity.info": { en: "Info", zh: "信息" },

  // Status labels
  "status.active": { en: "Active", zh: "活跃" },
  "status.recovering": { en: "Recovering", zh: "恢复中" },
  "status.resolved": { en: "Resolved", zh: "已解决" },

  // Settings page
  "settings.language": { en: "Language", zh: "语言" },
  "settings.llmStatus": { en: "LLM Status", zh: "LLM 状态" },
  "settings.llmUnavailable": { en: "LLM Unavailable — API key required.", zh: "LLM 不可用 — 需要 API 密钥。" },
  "settings.provider": { en: "Provider", zh: "提供商" },
  "settings.model": { en: "Model", zh: "模型" },
  "settings.apiKey": { en: "API Key", zh: "API 密钥" },
  "settings.openclawDetected": { en: "OpenClaw detected:", zh: "检测到 OpenClaw:" },

  // Checkup overlay
  "checkup.running": { en: "Running health checkup", zh: "正在运行健康体检" },
  "checkup.analyzing": { en: "Analyzing your agent's health...", zh: "正在分析 Agent 健康状况..." },
  "checkup.completed": { en: "Checkup completed!", zh: "体检完成！" },

  // Prescriptions page
  "rx.title": { en: "Prescriptions", zh: "处方" },
  "rx.count": { en: "{count} prescriptions", zh: "{count} 个处方" },
  "rx.noPrescriptions": { en: "No prescriptions", zh: "暂无处方" },

  // Common
  "common.loading": { en: "Loading", zh: "加载中" },
  "common.error": { en: "Error", zh: "错误" },
  "common.noData": { en: "No data available", zh: "暂无数据" },
  // ... remaining keys (~30 more)
};
```

### 4.2 SPA t() Function

```javascript
let currentLocale = window.__CLAWDOCTOR_LOCALE__ || 'en';

function t(key, vars) {
  const entry = LOCALE_DICT[key];
  if (!entry) return key;
  let result = entry[currentLocale] || entry.en;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      result = result.replace(`{${k}}`, v);
    }
  }
  return result;
}
```

### 4.3 Language Switcher in Settings Page

Added at the top of the Settings page renderer:

```javascript
// Language selector
html += `<div class="settings-section">`;
html += `<h3>${t('settings.language')}</h3>`;
html += `<select id="locale-select" onchange="switchLocale(this.value)">`;
html += `<option value="en" ${currentLocale === 'en' ? 'selected' : ''}>English</option>`;
html += `<option value="zh" ${currentLocale === 'zh' ? 'selected' : ''}>中文</option>`;
html += `</select>`;
html += `</div>`;
```

```javascript
async function switchLocale(locale) {
  currentLocale = locale;
  window.__CLAWDOCTOR_LOCALE__ = locale;
  // Persist
  await fetch('/api/config', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${window.__CLAWDOCTOR_TOKEN__}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ locale })
  });
  // Re-render current page
  onHashChange();
}
```

### 4.4 Server-Side Locale Injection

In `src/dashboard/server.ts`, `loadSpaHtml()`:

```typescript
function loadSpaHtml(token?: string, locale?: string): string {
  let html = readFileSync(SPA_PATH, "utf-8");
  const injections = [];
  if (token) injections.push(`window.__CLAWDOCTOR_TOKEN__="${token}"`);
  injections.push(`window.__CLAWDOCTOR_LOCALE__="${locale ?? "en"}"`);
  html = html.replace("</head>", `<script>${injections.join(";")}</script></head>`);
  return html;
}
```

Update all callers of `loadSpaHtml()` to pass `config.locale`.

## 5. String Replacement Strategy

### 5.1 SPA Replacement Pattern

All hardcoded user-visible strings in rendering functions get replaced:

```javascript
// Before:
html += '<h2>Health Overview</h2>';
html += `<span>Grade ${grade}</span>`;
html += '<th>Disease</th><th>Severity</th>';

// After:
html += `<h2>${t('page.healthOverview')}</h2>`;
html += `<span>${t('health.grade')} ${grade}</span>`;
html += `<th>${t('table.disease')}</th><th>${t('table.severity')}</th>`;
```

### 5.2 CLI Replacement Pattern

```typescript
// Before:
console.log(`Auto-applying ${applicable.length} low-risk prescription(s)...`);

// After:
console.log(tf(UI_STRINGS["cli.autoApplying"], locale, { count: applicable.length }));
```

## 6. Testing

### 6.1 Unit Tests

**`src/i18n/locales.test.ts`** (extend existing):
- All `UI_STRINGS` keys have both `en` and `zh` values
- No empty string values
- Template variables (`{xxx}`) are consistent between en and zh translations

**`src/i18n/i18n.test.ts`** (extend existing):
- `tf()` interpolation works correctly
- `tf()` with missing vars leaves placeholder as-is

### 6.2 Dashboard Tests

**`src/dashboard/server.test.ts`**:
- `loadSpaHtml()` injects `__CLAWDOCTOR_LOCALE__` with correct locale value
- `PUT /api/config` with `{ locale: "zh" }` persists correctly

**`src/dashboard/spa.test.ts`**:
- SPA HTML contains `LOCALE_DICT` object
- All `LOCALE_DICT` entries have both `en` and `zh` keys

### 6.3 CLI i18n Tests

**Per-command tests** (existing test files):
- `locale=en` produces English output
- `locale=zh` produces Chinese output
- Verify key output strings contain expected language text

### 6.4 E2E

- Extend existing E2E test to verify both locale=en and locale=zh checkup output
- E2E test should use isolated config (not system `~/.clawdoctor/config.json`) to avoid the fragility issue found in QA

## 7. File Change Summary

| File | Change |
|------|--------|
| `src/i18n/locales.ts` | Add ~30 new UI_STRINGS keys with en/zh |
| `src/i18n/i18n.ts` | Add `tf()` template interpolation function |
| `src/i18n/i18n.test.ts` | Add tests for `tf()` |
| `src/i18n/locales.test.ts` | Add completeness check for all keys |
| `src/dashboard/public/index.html` | Add LOCALE_DICT + t() + language switcher + replace ~80-100 hardcoded strings |
| `src/dashboard/server.ts` | Update `loadSpaHtml()` to inject locale |
| `src/dashboard/server.test.ts` | Add locale injection tests |
| `src/dashboard/spa.test.ts` | Add LOCALE_DICT validation tests |
| `src/commands/checkup.ts` | Replace hardcoded strings with `tf()` calls |
| `src/commands/report-builder.ts` | Replace 3 summary format strings with `tf()` calls |
| `src/commands/rx-cmd.ts` | Replace ~20 hardcoded strings with `t()`/`tf()` calls |
| `src/commands/config-cmd.ts` | Replace 3 hardcoded strings with `tf()` calls |
| `src/commands/dashboard-cmd.ts` | Replace 1 hardcoded string with `t()` call |
