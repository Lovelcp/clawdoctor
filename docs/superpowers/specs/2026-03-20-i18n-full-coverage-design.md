# ClawDoctor Full i18n Coverage Design

**Date:** 2026-03-20
**Status:** Approved
**Scope:** Dashboard SPA + CLI command output + report-builder + terminal-report summary strings

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
- Terminal-report hardcoded labels in `terminal-report.ts` ("Agent:", quick action labels)
- Department runner `dept-runner.ts` hardcodes locale to `"en"`
- `rx-cmd.ts` accesses `I18nString` objects via `.en` directly instead of `t()`

**Locale fallback:** If `config.locale` is set to an unsupported value (e.g., `"ja"`), all `t()` calls fall back to English. This is inherent in the existing `t()` function and requires no additional handling.

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
  2. Updates `document.documentElement.lang` for accessibility (screen readers, CJK font selection)
  3. Re-renders the current page (calls `onHashChange()`)
  4. Persists to config via `PUT /api/config` — **requires upgrading the current stub** (see Section 4.5)
  5. Next CLI execution and dashboard load will use the new locale

### 2.3 Server-Side Locale Injection

`loadSpaHtml()` in `src/dashboard/server.ts` already injects the auth token into the HTML. It will also inject the locale.

**Implementation note:** Currently `loadSpaHtml()` is defined outside `createDashboardApp()` and has no access to `config`. The function signature must be extended to accept locale, and the SPA fallback routes (lines 561-568) must pass `config.locale` through. Concretely: move `loadSpaHtml` inside the factory closure, or add a `locale` parameter and pass it from the route handlers which have access to the `opts.config` reference.

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
| Internal log messages (`[clawdoctor] xxx failed:`) | Debug purpose, prefixed with `[clawdoctor]` |
| Date/time formatting (ISO 8601) | Defer localized date formats (e.g., `2026年3月20日`) to a future enhancement |

### 2.5 I18nString Direct Access Pattern

Throughout `rx-cmd.ts` and other files, `I18nString` objects are accessed via `.en` (e.g., `preview.diagnosisName.en`, `action.description.en`). All such direct accesses must be replaced with `t(obj, locale)` to respect the configured locale.

## 3. CLI i18n — UI_STRINGS Extension

### 3.1 New Keys in `src/i18n/locales.ts`

Add the following keys to `UI_STRINGS`:

**report-builder.ts summary lines:**
- `report.insufficientData`: `"Insufficient data for scoring ({coverage}% coverage)"` / `"数据不足，无法评分（{coverage}% 覆盖率）"`
- `report.scoreSummary`: `"Score: {score} | {count} active issue(s) [{critical} critical, {warning} warning]"` / `"得分: {score} | {count} 个活跃问题 [{critical} 严重, {warning} 警告]"`
- `report.deptChecksSkipped`: `"{count} checks skipped (need plugin for full {dept} analysis)"` / `"{count} 项检查已跳过（需要插件完成完整 {dept} 分析）"`

> **Note:** The existing `UI_STRINGS.checksSkipped` key (`"checks skipped due to limited data"`) is used in `terminal-report.ts` for the overall footer summary. The new `report.deptChecksSkipped` is a different, per-department format with `{count}` and `{dept}` placeholders. Both coexist — the old key for the footer, the new key for per-department summaries.

**terminal-report.ts hardcoded labels:**
- `report.agentLabel`: `"Agent:"` / `"Agent:"`
- `report.quickAction.applyRx`: `"Apply all guided Rx"` / `"应用所有引导处方"`
- `report.quickAction.checkRx`: `"Check previous Rx results"` / `"查看之前的处方结果"`
- `report.quickAction.openDashboard`: `"Open detailed dashboard"` / `"打开详细仪表盘"`

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
- `rx.labelApplied`: `"Applied:"` / `"已应用:"`
- `rx.labelRolledBack`: `"Rolled back:"` / `"已回滚:"`
- `rx.applyingPrescription`: `"Applying prescription: {id}"` / `"应用处方: {id}"`
- `rx.success`: `"Success:"` / `"成功:"`
- `rx.verification`: `"Verification:"` / `"验证:"`
- `rx.rollingBack`: `"Rolling back prescription: {id}"` / `"回滚处方: {id}"`
- `rx.restoredFiles`: `"Restored files:"` / `"已恢复文件:"`
- `rx.skippedFiles`: `"Skipped files:"` / `"跳过文件:"`
- `rx.conflicts`: `"Conflicts:"` / `"冲突:"`
- `rx.runningFollowUp`: `"Running follow-up for prescription: {id}"` / `"运行处方复查: {id}"`
- `rx.followUpCheckpoint`: `"Follow-up for prescription: {id} ({checkpoint})"` / `"处方复查: {id}（{checkpoint}）"`
- `rx.verdict`: `"Verdict:"` / `"结论:"`
- `rx.metricChanges`: `"Metric changes:"` / `"指标变化:"`
- `rx.timeSinceApplied`: `"Time since applied: {seconds}s"` / `"应用后耗时: {seconds}秒"`
- `rx.noDueFollowups`: `"No due follow-ups found."` / `"没有待执行的复查。"`
- `rx.dueFollowups`: `"Found {count} due follow-up(s)."` / `"发现 {count} 个待执行复查。"`
- `rx.noHistory`: `"No prescription history found."` / `"未找到处方历史。"`
- `rx.historyCount`: `"Prescription History ({count}):"` / `"处方历史（{count}）:"`
- `rx.preview`: `"Preview: {id}"` / `"预览: {id}"`
- `rx.previewDryRun`: `"[dry-run] Preview: {id}"` / `"[试运行] 预览: {id}"`
- `rx.diagnosis`: `"Diagnosis:"` / `"诊断:"`
- `rx.estimatedImprovement`: `"Estimated improvement:"` / `"预估改善:"`
- `rx.rollbackAvailable`: `"Rollback available:"` / `"可回滚:"`
- `rx.noPendingGuided`: `"No pending guided prescriptions found."` / `"未找到待处理的引导处方。"`
- `rx.pendingGuidedCount`: `"Found {count} pending guided prescription(s)."` / `"发现 {count} 个待处理引导处方。"`
- `rx.error`: `"Error: {message}"` / `"错误: {message}"`
- `rx.failed`: `"Failed: {message}"` / `"失败: {message}"`
- `rx.labelType`: `"Type:"` / `"类型:"`
- `rx.labelDiff`: `"Diff:"` / `"差异:"`
- `rx.labelCommand`: `"Command:"` / `"命令:"`
- `rx.actionsCount`: `"Actions ({count}):"` / `"操作（{count}）:"`
- `rx.provideIdOrAll`: `"Provide a prescription <id> or use --all to apply all pending guided prescriptions."` / `"请提供处方 <id> 或使用 --all 应用所有待处理的引导处方。"`
- `rx.actionStatus`: `"- {type}: {status}"` / `"- {type}: {status}"`

**config-cmd.ts:**
- `config.initialized`: `"Config initialized at {path}"` / `"配置已初始化: {path}"`
- `config.alreadyExists`: `"Config already exists at {path}"` / `"配置已存在: {path}"`
- `config.setValue`: `"Set {key} = {value}"` / `"设置 {key} = {value}"`

**dashboard-cmd.ts:**
- `dashboard.runningCheckup`: `"Running fresh checkup to populate dashboard data..."` / `"正在运行体检以填充仪表盘数据..."`

**badge-cmd.ts:**
- `badge.saved`: `"Badge saved to {path}"` / `"徽章已保存到 {path}"`

### 3.2 Template Interpolation

For strings with dynamic values, use a simple interpolation helper:

```typescript
// in src/i18n/i18n.ts
export function tf(str: I18nString, locale: string, vars: Record<string, string | number>): string {
  let result = t(str, locale);
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, String(val));
  }
  return result;
}
```

> **Note:** Uses `replaceAll()` (not `replace()`) to handle cases where a placeholder appears more than once in a translation string.

Usage:
```typescript
tf(UI_STRINGS["report.scoreSummary"], locale, { score: 85, count: 3, critical: 1, warning: 2 })
```

### 3.3 Locale Access Pattern

**Not all command files load config today.** The following need `loadConfig()` added:

| File | Current state | Change needed |
|------|--------------|---------------|
| `checkup.ts` | Already loads config (line 86) | Extract `config.locale` — already done |
| `rx-cmd.ts` `preview/apply/rollback/followup` | Already loads config | Extract `config.locale` |
| `rx-cmd.ts` `list` | Does NOT load config | Add `loadConfig()` call |
| `rx-cmd.ts` `history` | Does NOT load config | Add `loadConfig()` call |
| `dashboard-cmd.ts` | Already loads config (line 32) | Extract `config.locale` |
| `config-cmd.ts` `show` | Already loads config (line 96) | Extract `config.locale` |
| `config-cmd.ts` `init/set` | Does NOT load config | Use default `"en"` (config may not exist yet for `init`) |
| `dept-runner.ts` | Does NOT load config | Add `import { loadConfig }` and `loadConfig()` call |
| `badge-cmd.ts` | Does NOT load config | Add `import { loadConfig }` and `loadConfig()` call |

**Pattern for commands that need config added:**

```typescript
// In dept-runner.ts, badge-cmd.ts:
import { loadConfig } from "../config/loader.js";

const configFilePath = join(homedir(), ".clawdoctor", "config.json");
const config = loadConfig(configFilePath);
const locale = config.locale ?? "en";
```

**Pattern for commands that already load config:**
```typescript
const locale = config.locale ?? "en";
```

**For `config init` and `config set`:** Use `"en"` directly since config file may not exist yet, and these are administrative commands where locale matters least.

## 4. Dashboard SPA i18n

### 4.1 LOCALE_DICT Structure

Embedded in `index.html` JS section. **Implementation approach:** Audit all rendering functions in the SPA, extract every user-visible string literal, and create a corresponding key. The complete list below covers all currently known strings; implementers should grep for remaining string literals in rendering functions and add any that are missing.

```javascript
const LOCALE_DICT = {
  // Brand
  "brand.name": { en: "ClawDoctor", zh: "ClawDoctor" },
  "brand.tagline": { en: "Agent Health Diagnostics", zh: "Agent 健康诊断" },
  "brand.version": { en: "ClawDoctor v0.1.0", zh: "ClawDoctor v0.1.0" },

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
  "action.prescribe": { en: "Generate Prescription", zh: "生成处方" },

  // Page titles
  "page.healthOverview": { en: "Health Overview", zh: "健康总览" },
  "page.eventTimeline": { en: "Event Timeline", zh: "事件时间线" },
  "page.settings.title": { en: "Settings", zh: "设置" },
  "page.settings.subtitle": { en: "LLM provider and ClawDoctor configuration", zh: "LLM 提供商与 ClawDoctor 配置" },

  // Health score
  "health.grade": { en: "Grade", zh: "评级" },
  "health.coverage": { en: "Coverage", zh: "覆盖率" },
  "health.overallHealth": { en: "Overall Health", zh: "整体健康" },
  "health.score": { en: "Score", zh: "分数" },

  // Grade labels (mirror CLI UI_STRINGS)
  "grade.A": { en: "Excellent", zh: "优秀" },
  "grade.B": { en: "Good", zh: "良好" },
  "grade.C": { en: "Fair", zh: "一般" },
  "grade.D": { en: "Poor", zh: "较差" },
  "grade.F": { en: "Critical", zh: "危险" },
  "grade.NA": { en: "N/A", zh: "N/A" },

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
  "table.actions": { en: "Actions", zh: "操作" },

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
  "settings.llmAvailable": { en: "LLM Available", zh: "LLM 可用" },
  "settings.provider": { en: "Provider", zh: "提供商" },
  "settings.providerAnthropic": { en: "Anthropic (Claude)", zh: "Anthropic (Claude)" },
  "settings.providerOpenAI": { en: "OpenAI Compatible (Moonshot, DeepSeek, etc.)", zh: "OpenAI 兼容（Moonshot、DeepSeek 等）" },
  "settings.model": { en: "Model", zh: "模型" },
  "settings.apiKey": { en: "API Key", zh: "API 密钥" },
  "settings.baseUrl": { en: "Base URL", zh: "Base URL" },
  "settings.openclawDetected": { en: "OpenClaw detected:", zh: "检测到 OpenClaw:" },
  "settings.openclawHint": { en: "You can use this model by selecting OpenAI Compatible provider and entering your API key.", zh: "你可以选择 OpenAI 兼容提供商并输入 API 密钥来使用此模型。" },

  // Checkup overlay
  "checkup.running": { en: "Running health checkup", zh: "正在运行健康体检" },
  "checkup.analyzing": { en: "Analyzing your agent's health...", zh: "正在分析 Agent 健康状况..." },
  "checkup.completed": { en: "Checkup completed!", zh: "体检完成！" },

  // Prescriptions page
  "rx.title": { en: "Prescriptions", zh: "处方" },
  "rx.count": { en: "{count} prescriptions", zh: "{count} 个处方" },
  "rx.noPrescriptions": { en: "No prescriptions", zh: "暂无处方" },

  // Disease detail
  "disease.requiresLlm": { en: "Requires LLM analysis", zh: "需要 LLM 分析" },
  "disease.rootCauses": { en: "Root Causes", zh: "根本原因" },
  "disease.evidence": { en: "Evidence", zh: "证据" },

  // Page subtitles
  "page.overview.subtitle": { en: "Agent diagnostics summary", zh: "Agent 诊断摘要" },
  "page.vitals": { en: "System Vitals", zh: "基础体征" },
  "page.skills": { en: "Skills & Tools", zh: "技能与工具" },
  "page.skills.subtitle": { en: "{count} plugins registered", zh: "{count} 个插件已注册" },
  "page.memory": { en: "Memory Cognition", zh: "记忆认知" },
  "page.memory.subtitle": { en: "{count} files tracked", zh: "正在跟踪 {count} 个文件" },
  "page.behavior": { en: "Agent Behavior", zh: "Agent 行为" },
  "page.cost": { en: "Cost Metabolism", zh: "成本代谢" },
  "page.security": { en: "Security Immunity", zh: "安全免疫" },
  "page.prescriptions.subtitle": { en: "{count} prescriptions", zh: "{count} 个处方" },
  "page.timeline.subtitle": { en: "{total} events recorded", zh: "已记录 {total} 个事件" },
  "page.deptDiagnosis": { en: "{count} diagnosis results", zh: "{count} 个诊断结果" },

  // Section cards
  "card.activeIssues": { en: "Active Issues", zh: "活跃问题" },
  "card.healthTrend": { en: "Health Trend", zh: "健康趋势" },
  "card.keyMetrics": { en: "Key Metrics", zh: "关键指标" },
  "card.diagnoses": { en: "Diagnoses", zh: "诊断结果" },
  "card.plugins": { en: "Plugins", zh: "插件" },
  "card.summary": { en: "Summary", zh: "摘要" },
  "card.files": { en: "Files", zh: "文件" },
  "card.prescriptionList": { en: "Prescription List", zh: "处方列表" },
  "card.causalChains": { en: "Causal Chains", zh: "因果链" },
  "card.rawConfig": { en: "Raw Configuration", zh: "原始配置" },

  // Empty states
  "empty.noHealth": { en: "No health data yet. Run a checkup to get started.", zh: "暂无健康数据。运行体检开始。" },
  "empty.noIssues": { en: "No issues detected", zh: "未检测到问题" },
  "empty.noPlugins": { en: "No plugin data", zh: "没有插件数据" },
  "empty.noPrescriptions": { en: "No prescriptions generated yet", zh: "尚未生成处方" },
  "empty.noEvents": { en: "No events recorded", zh: "未记录事件" },

  // Additional table headers
  "table.id": { en: "ID", zh: "编号" },
  "table.diagnosis": { en: "Diagnosis", zh: "诊断" },
  "table.period": { en: "Period", zh: "周期" },
  "table.level": { en: "Level", zh: "级别" },
  "table.plugin": { en: "Plugin", zh: "插件" },
  "table.source": { en: "Source", zh: "来源" },
  "table.tools": { en: "Tools", zh: "工具" },
  "table.version": { en: "Version", zh: "版本" },
  "table.time": { en: "Time", zh: "时间" },
  "table.session": { en: "Session", zh: "会话" },
  "table.details": { en: "Details", zh: "详情" },

  // Metric labels
  "metric.toolCalls": { en: "Tool Calls", zh: "工具调用" },
  "metric.successRate": { en: "Success Rate", zh: "成功率" },
  "metric.errorRate": { en: "Error Rate", zh: "错误率" },
  "metric.avgDuration": { en: "Avg Duration", zh: "平均耗时" },
  "metric.totalFiles": { en: "Total Files", zh: "总文件数" },
  "metric.totalSize": { en: "Total Size", zh: "总大小" },
  "metric.avgAge": { en: "Avg Age", zh: "平均年龄" },

  // Disease detail panel
  "disease.description": { en: "Description", zh: "描述" },
  "disease.possibleRootCauses": { en: "Possible Root Causes", zh: "可能的根本原因" },
  "disease.metadata": { en: "Metadata", zh: "元数据" },
  "disease.dataPeriod": { en: "Data period", zh: "数据周期" },
  "disease.detected": { en: "Detected", zh: "检测于" },
  "disease.lastSeen": { en: "Last seen", zh: "最后看到" },

  // Button states
  "button.generating": { en: "Generating…", zh: "生成中…" },
  "button.generated": { en: "Generated", zh: "已生成" },
  "button.saving": { en: "Saving…", zh: "保存中…" },
  "button.testing": { en: "Testing…", zh: "测试中…" },
  "button.running": { en: "Running…", zh: "运行中…" },
  "button.apply": { en: "Apply", zh: "应用" },
  "button.rollback": { en: "Rollback", zh: "回滚" },
  "button.useOpenclawConfig": { en: "Use OpenClaw Config", zh: "使用 OpenClaw 配置" },

  // LLM settings detail
  "llm.configuration": { en: "LLM Configuration", zh: "LLM 配置" },
  "llm.saved": { en: "LLM settings saved", zh: "LLM 设置已保存" },
  "llm.testSuccess": { en: "LLM connection successful", zh: "LLM 连接成功" },
  "llm.testFailed": { en: "Connection failed: {error}", zh: "连接失败: {error}" },
  "llm.usingEnv": { en: "(using ANTHROPIC_API_KEY env)", zh: "（使用 ANTHROPIC_API_KEY 环境变量）" },
  "llm.baseUrl.hint": { en: "Required for OpenAI-compatible providers.", zh: "OpenAI 兼容提供商需要。" },
  "llm.model.hint": { en: "Leave empty for provider default", zh: "留空使用提供商默认值" },
  "llm.apiKey.hint": { en: "Stored locally in ~/.clawdoctor/config.json", zh: "本地存储在 ~/.clawdoctor/config.json" },

  // Department card labels
  "dept.activeIssue": { en: "active issue", zh: "个活跃问题" },
  "dept.checked": { en: "checked", zh: "已检查" },

  // Error messages (client-side)
  "error.checkupInProgress": { en: "Checkup already in progress", zh: "体检已在进行中" },
  "error.failedLoad": { en: "Failed to load: {error}", zh: "加载失败: {error}" },

  // Chart
  "chart.overall": { en: "Overall", zh: "总体" },

  // Common
  "common.loading": { en: "Loading", zh: "加载中" },
  "common.error": { en: "Error", zh: "错误" },
  "common.noData": { en: "No data available", zh: "暂无数据" },
  "common.page": { en: "Page {current} of {total}", zh: "第 {current} 页 / 共 {total} 页" },
};
```

### 4.2 SPA Translation Functions

The SPA needs **two** translation functions:

1. **`t(key, vars)`** — for static dictionary lookups (LOCALE_DICT keys)
2. **`tObj(i18nObj)`** — for server-returned `I18nString` objects (disease names, descriptions, root causes, evidence, etc.)

The API returns `I18nString` objects like `{ en: "Token Obesity", zh: "Token 肥胖症" }`. These cannot go through the dictionary — they need locale-aware property access.

```javascript
let currentLocale = window.__CLAWDOCTOR_LOCALE__ || 'en';

// Static dictionary lookup
function t(key, vars) {
  const entry = LOCALE_DICT[key];
  if (!entry) return key;
  let result = entry[currentLocale] || entry.en;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      result = result.replaceAll(`{${k}}`, String(v));
    }
  }
  return result;
}

// Server-returned I18nString object resolution
function tObj(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj;
  return obj[currentLocale] || obj.en || '';
}
```

**Usage in rendering:**
```javascript
// Static labels from LOCALE_DICT:
html += `<th>${t('table.disease')}</th>`;

// Server-returned I18nString objects from API:
html += `<td>${tObj(disease.definition?.name)}</td>`;
html += `<td>${tObj(disease.definition?.description)}</td>`;
for (const cause of disease.definition?.rootCauses || []) {
  html += `<li>${tObj(cause)}</li>`;
}
```

> Uses `replaceAll()` for consistency with CLI `tf()`.

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
  document.documentElement.lang = locale;  // Accessibility: update HTML lang attr
  // Persist via PUT /api/config
  await fetch('/api/config', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${window.__CLAWDOCTOR_TOKEN__}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ locale })
  });
  // Re-render all navigation + current page
  renderNav();
  onHashChange();
}
```

### 4.4 Server-Side Locale Injection

In `src/dashboard/server.ts`, `loadSpaHtml()` is currently defined outside `createDashboardApp()` and only accepts `token`. It must be updated to accept `locale`:

```typescript
function loadSpaHtml(token?: string, locale?: string): string {
  let html: string;
  try {
    html = readFileSync(SPA_PATH, "utf-8");
  } catch {
    html = "<!DOCTYPE html><html><body><h1>ClawDoctor Dashboard</h1><p>SPA not found.</p></body></html>";
  }
  // Update html lang attribute
  html = html.replace('<html lang="en">', `<html lang="${locale ?? "en"}">`);
  const injections: string[] = [];
  if (token) injections.push(`window.__CLAWDOCTOR_TOKEN__="${token}"`);
  injections.push(`window.__CLAWDOCTOR_LOCALE__="${locale ?? "en"}"`);
  if (injections.length > 0) {
    html = html.replace("</head>", `<script>${injections.join(";")}</script></head>`);
  }
  return html;
}
```

All callers of `loadSpaHtml()` in the SPA fallback routes must pass `config.locale`. Since these routes are inside `createDashboardApp()` which has access to `opts.config`, this is straightforward:

```typescript
// SPA fallback routes
app.get("/", (c) => c.html(loadSpaHtml(authToken, config.locale)));
app.get("/*", (c) => c.html(loadSpaHtml(authToken, config.locale)));
```

### 4.5 Unified Config Persistence

**Problem:** There are currently two independent config writers in `server.ts`:
- `PUT /api/config` (stub, doesn't persist)
- `PUT /api/llm/config` (writes only `{ llm: config.llm }`, erasing any other fields)

If a user saves locale then saves LLM settings, the locale is lost. Both endpoints must use one shared read-merge-write utility.

**Solution:** Extract a `mergeAndPersistConfig()` helper:

```typescript
// Shared config persistence utility — used by all config-writing endpoints
function mergeAndPersistConfig(
  partial: Record<string, unknown>,
  inMemoryConfig: ClawDoctorConfig,
): Record<string, unknown> {
  const { writeFileSync, readFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  const configDir = join(homedir(), ".clawdoctor");
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, "config.json");

  // Read existing config from disk
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch { /* first write */ }

  // Deep merge the partial update
  for (const [key, value] of Object.entries(partial)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      existing[key] = { ...(existing[key] as Record<string, unknown> ?? {}), ...value };
    } else {
      existing[key] = value;
    }
  }

  writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf-8");

  // Update in-memory config
  if (typeof partial.locale === "string") inMemoryConfig.locale = partial.locale;
  if (partial.llm && typeof partial.llm === "object") {
    Object.assign(inMemoryConfig.llm, partial.llm);
  }

  return existing;
}
```

**Updated `PUT /api/config`:**
```typescript
app.put("/api/config", async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const saved = mergeAndPersistConfig(body, config);
    return c.json({ status: "saved", config: saved });
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
});
```

**Updated `PUT /api/llm/config`:** Refactor to use the same utility:
```typescript
app.put("/api/llm/config", async (c) => {
  try {
    const body = await c.req.json() as Record<string, unknown>;
    const llmUpdate: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") llmUpdate.enabled = body.enabled;
    if (typeof body.provider === "string") llmUpdate.provider = body.provider;
    if (typeof body.model === "string") llmUpdate.model = body.model || undefined;
    if (typeof body.apiKey === "string") llmUpdate.apiKey = body.apiKey || undefined;
    if (typeof body.baseUrl === "string") llmUpdate.baseUrl = body.baseUrl || undefined;

    const saved = mergeAndPersistConfig({ llm: llmUpdate }, config);
    return c.json({ status: "saved" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to save: ${msg}` }, 500);
  }
});
```

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

**Navigation must also re-render on locale switch.** The sidebar nav labels are set once at page load; `switchLocale()` must call a `renderNav()` function to update them.

### 5.2 CLI Replacement Pattern

```typescript
// Before:
console.log(`Auto-applying ${applicable.length} low-risk prescription(s)...`);

// After:
console.log(tf(UI_STRINGS["cli.autoApplying"], locale, { count: applicable.length }));
```

### 5.3 I18nString Object Access Pattern

All direct `.en` property accesses on `I18nString` objects must use `t()`:

```typescript
// Before (in rx-cmd.ts):
console.log(`  Diagnosis: ${preview.diagnosisName.en}`);
console.log(`  ${action.description.en}`);

// After:
console.log(`  ${t(UI_STRINGS["rx.diagnosis"], locale)} ${t(preview.diagnosisName, locale)}`);
console.log(`  ${t(action.description, locale)}`);
```

## 6. Testing

### 6.1 Unit Tests

**`src/i18n/locales.test.ts`** (NEW FILE — does not exist yet, must be created):
- All `UI_STRINGS` keys have both `en` and `zh` values
- No empty string values
- Template variables (`{xxx}`) are consistent between en and zh translations (same set of placeholders in both languages)

**`src/i18n/i18n.test.ts`** (extend existing):
- `tf()` interpolation works correctly
- `tf()` with missing vars leaves placeholder as-is
- `tf()` replaces all occurrences of the same placeholder (not just first)

### 6.2 Dashboard Tests

**`src/dashboard/server.test.ts`** (extend existing):
- `loadSpaHtml()` injects `__CLAWDOCTOR_LOCALE__` with correct locale value
- `loadSpaHtml()` updates `<html lang="...">` attribute
- `PUT /api/config` with `{ locale: "zh" }` persists locale to config file AND updates in-memory config
- `PUT /api/llm/config` after `PUT /api/config { locale: "zh" }` does NOT erase the locale (config write race regression test)
- Config persistence round-trip: write locale → write LLM → read config → both fields present

**`src/dashboard/spa.test.ts`** (extend existing):
- SPA HTML contains `LOCALE_DICT` object
- All `LOCALE_DICT` entries have both `en` and `zh` keys
- No empty values in either language
- SPA HTML contains `tObj` function definition (for server-returned I18nString objects)

### 6.3 CLI i18n Tests

**Per-command tests** (existing test files):
- `locale=en` produces English output
- `locale=zh` produces Chinese output
- Verify key output strings contain expected language text
- Verify no raw `.en` property access remains in rx-cmd output (domain objects like disease names, action descriptions use `t()`)

### 6.4 E2E

- Extend existing E2E test to verify both locale=en and locale=zh checkup output
- E2E test should use isolated config (not system `~/.clawdoctor/config.json`) to avoid the fragility issue found in QA
- Dashboard E2E: verify that switching locale in Settings re-renders nav labels and current page content

## 7. File Change Summary

| File | Change |
|------|--------|
| `src/i18n/locales.ts` | Add ~50 new UI_STRINGS keys with en/zh |
| `src/i18n/i18n.ts` | Add `tf()` template interpolation function (using `replaceAll`) |
| `src/i18n/i18n.test.ts` | Add tests for `tf()` including multi-occurrence placeholders |
| `src/i18n/locales.test.ts` | **NEW FILE** — completeness + placeholder consistency check for all keys |
| `src/dashboard/public/index.html` | Add LOCALE_DICT (~150 keys) + `t()` + `tObj()` + language switcher + replace all hardcoded strings |
| `src/dashboard/server.ts` | Update `loadSpaHtml()` to inject locale + HTML lang attr; extract `mergeAndPersistConfig()` utility; upgrade `PUT /api/config` to persist locale; refactor `PUT /api/llm/config` to use shared utility |
| `src/dashboard/server.test.ts` | Add locale injection tests + config persistence race condition regression test |
| `src/dashboard/spa.test.ts` | Add LOCALE_DICT + `tObj` validation tests |
| `src/commands/checkup.ts` | Replace hardcoded strings with `tf()` calls |
| `src/commands/report-builder.ts` | Replace 3 summary format strings with `tf()` calls |
| `src/report/terminal-report.ts` | Replace "Agent:" label and quick action labels with `t()` calls |
| `src/commands/rx-cmd.ts` | Replace ~36 hardcoded strings with `t()`/`tf()` calls; replace all `.en` accesses with `t()`; add `loadConfig()` to `list` and `history` subcommands |
| `src/commands/config-cmd.ts` | Replace 3 hardcoded strings with `tf()` calls |
| `src/commands/dashboard-cmd.ts` | Replace 1 hardcoded string with `t()` call |
| `src/commands/badge-cmd.ts` | Add `loadConfig()` import + call; replace 1 hardcoded string with `tf()` call |
| `src/commands/dept-runner.ts` | Add `loadConfig()` import + call; pass `config.locale` to `buildReportViewModel()` and `renderReport()` instead of hardcoded `"en"` |
