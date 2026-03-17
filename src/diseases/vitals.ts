import type { DiseaseDefinition } from "../types/domain.js";

export const vitalsDiseasess: DiseaseDefinition[] = [
  {
    id: "VIT-001",
    department: "vitals",
    category: "connectivity",
    name: { en: "Gateway Offline", zh: "网关离线" },
    description: {
      en: "The OpenClaw gateway is unreachable, preventing all agent operations.",
      zh: "OpenClaw 网关无法访问，导致所有 Agent 操作中断。",
    },
    rootCauses: [
      {
        en: "Gateway process crashed or was not started",
        zh: "网关进程崩溃或未启动",
      },
      {
        en: "Network firewall blocking the gateway port",
        zh: "网络防火墙阻止了网关端口",
      },
      {
        en: "Gateway configuration points to wrong host/port",
        zh: "网关配置指向了错误的主机/端口",
      },
    ],
    detection: {
      type: "rule",
      metric: "vitals.gatewayUnreachable",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0, critical: 1 },
    },
    prescriptionTemplate: {
      level: "manual",
      actionTypes: ["manual"],
      promptTemplate:
        "The OpenClaw gateway is offline. Provide step-by-step instructions to restart the gateway, verify connectivity, and confirm recovery.",
      estimatedImprovementTemplate: {
        en: "Restores full agent functionality",
        zh: "恢复所有 Agent 功能",
      },
      risk: "low",
    },
    relatedDiseases: ["VIT-002", "VIT-004"],
    defaultSeverity: "critical",
    tags: ["connectivity", "gateway", "critical"],
  },
  {
    id: "VIT-002",
    department: "vitals",
    category: "config",
    name: { en: "Config Corruption", zh: "配置损坏" },
    description: {
      en: "The openclaw.json configuration file cannot be parsed due to syntax errors or corruption.",
      zh: "openclaw.json 配置文件因语法错误或损坏而无法解析。",
    },
    rootCauses: [
      {
        en: "Manual edits introduced invalid JSON syntax",
        zh: "手动编辑引入了无效的 JSON 语法",
      },
      {
        en: "Concurrent write caused file corruption",
        zh: "并发写入导致文件损坏",
      },
      {
        en: "Incomplete migration left orphaned keys",
        zh: "不完整的迁移留下了孤立的键",
      },
    ],
    detection: {
      type: "rule",
      metric: "vitals.configParseFailure",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0, critical: 1 },
    },
    prescriptionTemplate: {
      level: "manual",
      actionTypes: ["file_edit", "command"],
      promptTemplate:
        "The openclaw.json config file is corrupted. Generate instructions to back up the current file, restore from backup or recreate the minimum valid config, and run `openclaw doctor` to verify.",
      estimatedImprovementTemplate: {
        en: "Restores config parsing and agent startup",
        zh: "恢复配置解析和 Agent 启动",
      },
      risk: "medium",
    },
    relatedDiseases: ["VIT-001"],
    defaultSeverity: "critical",
    tags: ["config", "parse", "critical"],
  },
  {
    id: "VIT-003",
    department: "vitals",
    category: "version",
    name: { en: "Stale Gateway Version", zh: "网关版本过旧" },
    description: {
      en: "The installed gateway version is significantly behind the latest release, missing bug fixes and features.",
      zh: "已安装的网关版本明显落后于最新版本，缺少错误修复和新功能。",
    },
    rootCauses: [
      {
        en: "Auto-update is disabled or failing",
        zh: "自动更新已禁用或失败",
      },
      {
        en: "Pinned to old version by project config",
        zh: "项目配置固定了旧版本",
      },
    ],
    detection: {
      type: "rule",
      metric: "vitals.gatewayVersionDelta",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 1, critical: 5 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command"],
      promptTemplate:
        "The gateway version is outdated by {versionDelta} versions. Generate update instructions tailored to the user's OS and install method.",
      estimatedImprovementTemplate: {
        en: "Access to latest features and bug fixes",
        zh: "获得最新功能和错误修复",
      },
      risk: "low",
    },
    relatedDiseases: [],
    defaultSeverity: "info",
    tags: ["version", "update", "gateway"],
  },
  {
    id: "VIT-004",
    department: "vitals",
    category: "plugins",
    name: { en: "Plugin Load Failure", zh: "插件加载失败" },
    description: {
      en: "One or more plugins failed to load at startup, reducing agent capabilities.",
      zh: "一个或多个插件在启动时加载失败，降低了 Agent 能力。",
    },
    rootCauses: [
      {
        en: "Plugin dependencies missing or incompatible",
        zh: "插件依赖缺失或不兼容",
      },
      {
        en: "Plugin manifest schema violation",
        zh: "插件清单违反了 schema 规范",
      },
      {
        en: "Permission denied reading plugin directory",
        zh: "读取插件目录时权限被拒绝",
      },
    ],
    detection: {
      type: "rule",
      metric: "vitals.pluginLoadErrors",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 1, critical: 5 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "manual"],
      promptTemplate:
        "Plugin load failures detected: {pluginNames}. Generate diagnosis steps and fix instructions for each failing plugin.",
      estimatedImprovementTemplate: {
        en: "Restores {count} plugin(s) to operational state",
        zh: "恢复 {count} 个插件到正常运行状态",
      },
      risk: "low",
    },
    relatedDiseases: ["VIT-001"],
    defaultSeverity: "warning",
    tags: ["plugin", "load", "startup"],
  },
  {
    id: "VIT-005",
    department: "vitals",
    category: "storage",
    name: { en: "Storage Pressure", zh: "存储空间不足" },
    description: {
      en: "The agent state directory is consuming excessive disk space, risking write failures.",
      zh: "Agent 状态目录占用了过多磁盘空间，有写入失败的风险。",
    },
    rootCauses: [
      { en: "Accumulated session JSONL logs", zh: "累积的会话 JSONL 日志" },
      { en: "Uncompacted memory files", zh: "未压缩的记忆文件" },
      { en: "Excessive plugin cache", zh: "过多的插件缓存" },
    ],
    detection: {
      type: "rule",
      metric: "vitals.diskUsageMB",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 500, critical: 1000 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "file_delete"],
      promptTemplate:
        "Storage pressure at {diskUsageMB}MB. Generate cleanup instructions: prune old sessions older than {retentionDays} days, compact memory, and clear plugin caches.",
      estimatedImprovementTemplate: {
        en: "Frees approximately {estimatedSavingsMB}MB of disk space",
        zh: "释放约 {estimatedSavingsMB}MB 磁盘空间",
      },
      risk: "medium",
    },
    relatedDiseases: ["MEM-003"],
    defaultSeverity: "warning",
    tags: ["storage", "disk", "cleanup"],
  },
];
