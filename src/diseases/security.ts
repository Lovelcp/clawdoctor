import type { DiseaseDefinition } from "../types/domain.js";

export const securityDiseases: DiseaseDefinition[] = [
  {
    id: "SEC-001",
    department: "security",
    category: "sandbox",
    name: { en: "Immune Deficiency", zh: "免疫缺陷" },
    description: {
      en: "The sandbox is disabled, leaving the agent without isolation protection and allowing unrestricted system access.",
      zh: "沙箱已禁用，使 Agent 失去隔离保护，允许不受限制的系统访问。",
    },
    rootCauses: [
      {
        en: "Sandbox explicitly disabled in configuration for debugging",
        zh: "为了调试在配置中显式禁用了沙箱",
      },
      {
        en: "Plugin requires privileged access incompatible with sandbox",
        zh: "插件需要与沙箱不兼容的特权访问",
      },
      {
        en: "Sandbox feature not supported in current environment",
        zh: "当前环境不支持沙箱功能",
      },
    ],
    detection: {
      type: "rule",
      metric: "security.unsandboxedPlugins",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 1, critical: 3 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change"],
      promptTemplate:
        "Sandbox disabled for {pluginCount} plugins. Generate sandbox re-enablement configuration and permission scoping recommendations to maintain required functionality within sandbox constraints.",
      estimatedImprovementTemplate: {
        en: "Restores sandbox isolation for {value}% of unsandboxed plugins",
        zh: "为 {value}% 的未沙箱插件恢复沙箱隔离",
      },
      risk: "high",
    },
    relatedDiseases: ["SEC-005", "SEC-006"],
    defaultSeverity: "critical",
    tags: ["security", "sandbox", "critical"],
  },
  {
    id: "SEC-002",
    department: "security",
    category: "credentials",
    name: { en: "Credential Leak", zh: "凭据泄露" },
    description: {
      en: "API keys, tokens, or other credentials have been detected in log files or memory files in plaintext.",
      zh: "在日志文件或记忆文件中检测到明文 API 密钥、令牌或其他凭据。",
    },
    rootCauses: [
      {
        en: "Credentials logged during debugging and not removed",
        zh: "调试期间记录的凭据未被移除",
      },
      {
        en: "Agent stored API keys in memory files as convenient reference",
        zh: "Agent 将 API 密钥存储在记忆文件中作为便捷参考",
      },
      {
        en: "Tool response containing credentials was logged without sanitization",
        zh: "包含凭据的工具响应在未经净化的情况下被记录",
      },
    ],
    detection: {
      type: "rule",
      metric: "security.exposedCredentials",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0, critical: 1 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "command", "manual"],
      promptTemplate:
        "Credential leak detected in {locations}. Generate immediate remediation: rotate affected credentials, purge from logs/memory, and establish credential scanning pre-commit hooks.",
      estimatedImprovementTemplate: {
        en: "Eliminates all detected credential exposures",
        zh: "消除所有检测到的凭据暴露",
      },
      risk: "high",
    },
    relatedDiseases: ["SEC-008"],
    defaultSeverity: "critical",
    tags: ["security", "credentials", "critical", "leak"],
  },
  {
    id: "SEC-003",
    department: "security",
    category: "supply-chain",
    name: { en: "Skill Supply Chain Risk", zh: "技能供应链风险" },
    description: {
      en: "Installed skills originate from non-official sources or are unsigned, creating supply chain security risk.",
      zh: "已安装的技能来自非官方来源或未签名，造成供应链安全风险。",
    },
    rootCauses: [
      {
        en: "Skill installed from third-party registry without security review",
        zh: "从第三方注册表安装技能，未经安全审查",
      },
      {
        en: "Skill signing key not verified during installation",
        zh: "安装期间未验证技能签名密钥",
      },
      {
        en: "Fork of official skill from unknown author installed",
        zh: "安装了未知作者对官方技能的分叉",
      },
    ],
    detection: {
      type: "rule",
      metric: "security.unsignedSkills",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 1, critical: 5 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "manual"],
      promptTemplate:
        "Supply chain risk: {unsignedCount} unsigned or non-official skills detected. Generate review checklist and recommendations for each risky skill: verify source, check code, or replace with official alternative.",
      estimatedImprovementTemplate: {
        en: "Reduces supply chain exposure for {value}% of flagged skills",
        zh: "为 {value}% 的标记技能降低供应链暴露",
      },
      risk: "medium",
    },
    relatedDiseases: ["SEC-004", "SEC-005", "SK-007"],
    defaultSeverity: "warning",
    tags: ["security", "supply-chain", "skills"],
  },
  {
    id: "SEC-004",
    department: "security",
    category: "permissions",
    name: { en: "Skill Permission Overreach", zh: "技能权限越界" },
    description: {
      en: "Skills are requesting significantly more permissions than they actually use in practice, violating the principle of least privilege.",
      zh: "技能请求的权限远超实际使用，违反了最小权限原则。",
    },
    rootCauses: [
      {
        en: "Skill manifest requests broad permissions as a precaution",
        zh: "技能清单出于预防请求了广泛权限",
      },
      {
        en: "Permissions copied from template without tailoring to actual needs",
        zh: "权限从模板复制而未根据实际需求调整",
      },
      {
        en: "Some features requiring permissions are no longer used",
        zh: "某些需要权限的功能已不再使用",
      },
    ],
    detection: {
      type: "rule",
      metric: "security.permissionOverreachCount",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 1, critical: 3 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "config_change"],
      promptTemplate:
        "Permission overreach in {skillCount} skills. Generate minimal permission manifest recommendations based on actual observed usage for each flagged skill.",
      estimatedImprovementTemplate: {
        en: "Reduces permission surface area by {value}%",
        zh: "减少 {value}% 的权限攻击面",
      },
      risk: "medium",
    },
    relatedDiseases: ["SEC-001", "SEC-003"],
    defaultSeverity: "warning",
    tags: ["security", "permissions", "least-privilege"],
  },
  {
    id: "SEC-005",
    department: "security",
    category: "code-security",
    name: { en: "Skill Code Injection Risk", zh: "技能代码注入风险" },
    description: {
      en: "Skill code contains patterns that could enable code injection attacks such as eval, exec, or dynamic code execution.",
      zh: "技能代码包含可能导致代码注入攻击的模式，如 eval、exec 或动态代码执行。",
    },
    rootCauses: [
      {
        en: "Dynamic code evaluation used for flexibility without sanitization",
        zh: "为了灵活性使用动态代码评估但没有净化",
      },
      {
        en: "User-controlled input passed to eval or exec functions",
        zh: "用户控制的输入传递给 eval 或 exec 函数",
      },
      {
        en: "Template engine with unsafe rendering used in skill code",
        zh: "技能代码中使用了不安全渲染的模板引擎",
      },
    ],
    detection: {
      type: "hybrid",
      preFilter: {
        type: "rule",
        metric: "security.unsandboxedPlugins",
        direction: "higher_is_worse",
        defaultThresholds: { warning: 1, critical: 3 },
      },
      deepAnalysis: {
        type: "llm",
        analysisPromptTemplate:
          "Perform a security code review of the following skill code for injection vulnerabilities. Look for eval(), exec(), Function constructor, dynamic require/import, template injection, and similar patterns. For each finding, assess exploitability and severity.",
        inputDataKeys: ["skillSourceCode", "skillManifest", "sandboxConfig"],
        outputSchema: {
          vulnerabilities: [
            {
              type: "string",
              location: "string",
              severity: "string",
              exploitability: "string",
              recommendation: "string",
            },
          ],
          overallRisk: "string",
          confidence: "number",
        },
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "manual"],
      promptTemplate:
        "Code injection risk in {skillName}: {vulnerabilityCount} findings. Generate secure code alternatives for each vulnerable pattern and recommend static analysis tooling.",
      estimatedImprovementTemplate: {
        en: "Eliminates {value}% of identified injection vectors",
        zh: "消除 {value}% 的已识别注入向量",
      },
      risk: "high",
    },
    relatedDiseases: ["SEC-001", "SEC-006"],
    defaultSeverity: "critical",
    tags: ["security", "injection", "code-review", "critical"],
  },
  {
    id: "SEC-006",
    department: "security",
    category: "injection",
    name: { en: "Injection Hit", zh: "注入中招" },
    description: {
      en: "Prompt injection attack patterns have been detected in logs, suggesting the agent may have been manipulated by malicious content.",
      zh: "在日志中检测到提示词注入攻击模式，表明 Agent 可能已被恶意内容操控。",
    },
    rootCauses: [
      {
        en: "Agent processes untrusted external content without sanitization",
        zh: "Agent 未经净化处理不受信任的外部内容",
      },
      {
        en: "Tool outputs are directly inserted into agent context without filtering",
        zh: "工具输出未经过滤直接插入 Agent 上下文",
      },
      {
        en: "Web content or file content injected instruction override attempts",
        zh: "网络内容或文件内容注入了指令覆盖尝试",
      },
    ],
    detection: {
      type: "rule",
      metric: "security.injectionPatternCount",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0, critical: 1 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change", "file_edit", "manual"],
      promptTemplate:
        "Prompt injection detected in {sessionCount} sessions. Generate input sanitization middleware, trust boundary configuration, and agent instruction hardening recommendations.",
      estimatedImprovementTemplate: {
        en: "Blocks {value}% of detected injection patterns",
        zh: "阻止 {value}% 的检测到的注入模式",
      },
      risk: "high",
    },
    relatedDiseases: ["SEC-001", "SEC-005"],
    defaultSeverity: "critical",
    tags: ["security", "injection", "prompt-injection", "critical"],
  },
  {
    id: "SEC-007",
    department: "security",
    category: "access-control",
    name: { en: "Open DM Policy", zh: "DM 策略开放" },
    description: {
      en: "One or more channels are configured without an allowList, allowing any user to interact with the agent without access control.",
      zh: "一个或多个频道未配置 allowList，允许任何用户与 Agent 交互而无需访问控制。",
    },
    rootCauses: [
      {
        en: "Channel created without specifying allowList for open testing",
        zh: "频道为了开放测试而创建时未指定 allowList",
      },
      {
        en: "allowList accidentally removed during configuration migration",
        zh: "allowList 在配置迁移期间意外被移除",
      },
      {
        en: "Agent intended for internal use deployed without access restrictions",
        zh: "面向内部使用的 Agent 在没有访问限制的情况下部署",
      },
    ],
    detection: {
      type: "rule",
      metric: "security.openDmChannels",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 1, critical: 3 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change"],
      promptTemplate:
        "Open DM policy on {channelCount} channels. Generate allowList configuration for each open channel based on intended user groups.",
      estimatedImprovementTemplate: {
        en: "Restricts access on {value}% of unprotected channels",
        zh: "限制 {value}% 未受保护频道的访问",
      },
      risk: "medium",
    },
    relatedDiseases: ["SEC-001"],
    defaultSeverity: "warning",
    tags: ["security", "access-control", "dm-policy"],
  },
  {
    id: "SEC-008",
    department: "security",
    category: "credentials",
    name: { en: "Stale Credentials", zh: "凭据过期" },
    description: {
      en: "OAuth tokens or other time-limited credentials are expired or near expiration, risking service disruptions.",
      zh: "OAuth 令牌或其他时限凭据已过期或即将过期，有服务中断的风险。",
    },
    rootCauses: [
      {
        en: "Token refresh mechanism not configured or failing silently",
        zh: "令牌刷新机制未配置或静默失败",
      },
      {
        en: "Long-lived refresh token itself has expired",
        zh: "长期刷新令牌本身已过期",
      },
      {
        en: "Service provider changed token expiry policy without notice",
        zh: "服务提供商在未通知的情况下更改了令牌过期策略",
      },
    ],
    detection: {
      type: "rule",
      metric: "security.staleCredentials",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 1, critical: 3 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "manual"],
      promptTemplate:
        "Stale credentials detected for {serviceCount} services. Generate re-authentication instructions and token refresh configuration for each affected service.",
      estimatedImprovementTemplate: {
        en: "Restores authenticated access for {value}% of affected services",
        zh: "为 {value}% 受影响的服务恢复认证访问",
      },
      risk: "medium",
    },
    relatedDiseases: ["SEC-002", "VIT-001"],
    defaultSeverity: "warning",
    tags: ["security", "credentials", "oauth", "expiry"],
  },
];
