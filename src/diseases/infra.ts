import type { DiseaseDefinition } from "../types/domain.js";

export const infraDiseases: DiseaseDefinition[] = [
  {
    id: "INFRA-001",
    department: "infra",
    category: "connectivity",
    name: { en: "Gateway Cardiac Arrest", zh: "网关心脏骤停" },
    description: {
      en: "The OpenClaw gateway process is not running, preventing all agent operations.",
      zh: "OpenClaw 网关进程未运行，导致所有 Agent 操作中断。",
    },
    rootCauses: [
      {
        en: "Gateway process crashed or was killed by OOM",
        zh: "网关进程崩溃或被 OOM 终止",
      },
      {
        en: "Gateway was not started after system reboot",
        zh: "系统重启后网关未启动",
      },
      {
        en: "Port conflict preventing gateway from binding",
        zh: "端口冲突导致网关无法绑定",
      },
    ],
    detection: {
      type: "rule",
      metric: "infra.gatewayProcessDown",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0, critical: 1 },
    },
    prescriptionTemplate: {
      level: "manual",
      actionTypes: ["command"],
      promptTemplate:
        "The OpenClaw gateway process is not running. Provide step-by-step instructions to diagnose why the process stopped, restart it, and verify it is healthy.",
      estimatedImprovementTemplate: {
        en: "Restores full agent functionality",
        zh: "恢复所有 Agent 功能",
      },
      risk: "low",
    },
    relatedDiseases: ["VIT-001", "INFRA-002"],
    defaultSeverity: "critical",
    tags: ["infra", "gateway", "process", "critical"],
  },
  {
    id: "INFRA-002",
    department: "infra",
    category: "scheduling",
    name: { en: "Cron Arrhythmia", zh: "定时任务心律不齐" },
    description: {
      en: "Three or more consecutive cron job executions have failed, indicating a systemic scheduling issue.",
      zh: "连续三次或更多次定时任务执行失败，表明存在系统性调度问题。",
    },
    rootCauses: [
      {
        en: "Cron job target script has a persistent error",
        zh: "定时任务目标脚本存在持续性错误",
      },
      {
        en: "Environment variables not available in cron context",
        zh: "环境变量在 cron 上下文中不可用",
      },
      {
        en: "Dependency service unavailable during scheduled run",
        zh: "计划运行期间依赖服务不可用",
      },
    ],
    detection: {
      type: "rule",
      metric: "infra.cronConsecutiveFailures",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 3, critical: 5 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "manual"],
      promptTemplate:
        "Cron arrhythmia detected: {failureCount} consecutive failures for job {jobName}. Diagnose the root cause from recent cron logs and generate fix instructions.",
      estimatedImprovementTemplate: {
        en: "Restores cron job reliability",
        zh: "恢复定时任务可靠性",
      },
      risk: "low",
    },
    relatedDiseases: ["INFRA-003", "INFRA-006"],
    defaultSeverity: "warning",
    tags: ["infra", "cron", "scheduling", "reliability"],
  },
  {
    id: "INFRA-003",
    department: "infra",
    category: "scheduling",
    name: { en: "Cron Arrest", zh: "定时任务停搏" },
    description: {
      en: "A cron job is overdue beyond its schedule plus grace window, indicating the job may have stopped running entirely.",
      zh: "定时任务超过其计划时间加宽限期仍未执行，表明该任务可能已完全停止运行。",
    },
    rootCauses: [
      {
        en: "Cron daemon was stopped or restarted without reloading job definitions",
        zh: "Cron 守护进程被停止或重启但未重新加载任务定义",
      },
      {
        en: "Job was accidentally removed from crontab",
        zh: "任务被意外从 crontab 中删除",
      },
      {
        en: "System clock skew causing schedule misalignment",
        zh: "系统时钟偏差导致调度错位",
      },
    ],
    detection: {
      type: "rule",
      metric: "infra.cronOverdueMinutes",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 30, critical: 120 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "manual"],
      promptTemplate:
        "Cron arrest: job {jobName} is {overdueMinutes} minutes overdue. Verify cron daemon status, check crontab entries, and confirm system clock accuracy.",
      estimatedImprovementTemplate: {
        en: "Restores scheduled job execution",
        zh: "恢复定时任务执行",
      },
      risk: "low",
    },
    relatedDiseases: ["INFRA-002", "INFRA-006"],
    defaultSeverity: "warning",
    tags: ["infra", "cron", "scheduling", "overdue"],
  },
  {
    id: "INFRA-004",
    department: "infra",
    category: "authentication",
    name: { en: "Auth Immune Rejection", zh: "认证免疫排斥" },
    description: {
      en: "Authentication failures detected (401/403 responses or expired tokens), preventing agent access to required services.",
      zh: "检测到认证失败（401/403 响应或过期令牌），阻止 Agent 访问所需服务。",
    },
    rootCauses: [
      {
        en: "API key or token has expired and was not rotated",
        zh: "API 密钥或令牌已过期且未轮换",
      },
      {
        en: "Service permissions were revoked or changed",
        zh: "服务权限被撤销或更改",
      },
      {
        en: "Token refresh mechanism is broken or misconfigured",
        zh: "令牌刷新机制损坏或配置错误",
      },
    ],
    detection: {
      type: "rule",
      metric: "infra.authFailureCount",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 3, critical: 10 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "config_change"],
      promptTemplate:
        "Auth immune rejection: {failureCount} authentication failures detected. Check token expiry, verify API key validity, and regenerate credentials if needed.",
      estimatedImprovementTemplate: {
        en: "Restores authenticated access to services",
        zh: "恢复对服务的认证访问",
      },
      risk: "medium",
    },
    relatedDiseases: ["SEC-001"],
    defaultSeverity: "warning",
    tags: ["infra", "auth", "token", "security"],
  },
  {
    id: "INFRA-005",
    department: "infra",
    category: "budget",
    name: { en: "Budget Hemorrhage", zh: "预算大出血" },
    description: {
      en: "Daily API spend has exceeded the configured budget limit, indicating runaway costs that require immediate attention.",
      zh: "每日 API 支出已超过配置的预算限制，表明成本失控需要立即关注。",
    },
    rootCauses: [
      {
        en: "Uncontrolled batch processing consuming API credits rapidly",
        zh: "不受控的批处理快速消耗 API 额度",
      },
      {
        en: "Death loop or infinite retry driving up API costs",
        zh: "死循环或无限重试推高 API 成本",
      },
      {
        en: "Budget limit set too low for normal operational volume",
        zh: "预算限制相对于正常运营量设置过低",
      },
    ],
    detection: {
      type: "rule",
      metric: "infra.dailySpendOverBudget",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0.8, critical: 1.0 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "config_change"],
      promptTemplate:
        "Budget hemorrhage: daily spend at {spendRatio}x of budget limit ({dailySpend}/{budgetLimit}). Identify top-spending sessions and generate cost containment recommendations.",
      estimatedImprovementTemplate: {
        en: "Prevents further budget overrun",
        zh: "防止进一步的预算超支",
      },
      risk: "high",
    },
    relatedDiseases: ["CST-001", "CST-005", "CST-010"],
    defaultSeverity: "critical",
    tags: ["infra", "budget", "cost", "critical"],
  },
  {
    id: "INFRA-006",
    department: "infra",
    category: "delivery",
    name: { en: "Delivery Failure", zh: "投递衰竭" },
    description: {
      en: "Cron job delivery failures detected, where jobs execute but fail to deliver results to the expected destination.",
      zh: "检测到定时任务投递失败，任务执行但未能将结果传递到预期目的地。",
    },
    rootCauses: [
      {
        en: "Output destination (file, API, queue) is unreachable",
        zh: "输出目的地（文件、API、队列）不可达",
      },
      {
        en: "Permission denied writing to delivery target",
        zh: "写入投递目标时权限被拒绝",
      },
      {
        en: "Delivery format mismatch or serialization error",
        zh: "投递格式不匹配或序列化错误",
      },
    ],
    detection: {
      type: "rule",
      metric: "infra.deliveryFailureCount",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 1, critical: 5 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "manual"],
      promptTemplate:
        "Delivery failure: {failureCount} cron job delivery failures. Check output destination accessibility, permissions, and format compatibility.",
      estimatedImprovementTemplate: {
        en: "Restores cron job result delivery",
        zh: "恢复定时任务结果投递",
      },
      risk: "low",
    },
    relatedDiseases: ["INFRA-002", "INFRA-003"],
    defaultSeverity: "info",
    tags: ["infra", "cron", "delivery", "output"],
  },
];
