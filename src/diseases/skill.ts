import type { DiseaseDefinition } from "../types/domain.js";

export const skillDiseases: DiseaseDefinition[] = [
  {
    id: "SK-001",
    department: "skill",
    category: "efficiency",
    name: { en: "Token Obesity", zh: "Token 肥胖症" },
    description: {
      en: "A single tool call consumes an excessive number of tokens, inflating cost and risking context exhaustion.",
      zh: "单次工具调用消耗了大量 Token，导致成本膨胀并有耗尽上下文的风险。",
    },
    rootCauses: [
      {
        en: "Prompt template includes unnecessarily large system context",
        zh: "提示模板包含了不必要的大型系统上下文",
      },
      {
        en: "Tool returns raw, unfiltered large payloads",
        zh: "工具返回未经过滤的大型原始数据",
      },
      {
        en: "Recursive sub-agent calls accumulating token overhead",
        zh: "递归子 Agent 调用累积了 Token 开销",
      },
    ],
    detection: {
      type: "rule",
      metric: "skill.singleCallTokens",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 50_000, critical: 200_000 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change", "file_edit"],
      promptTemplate:
        "Tool call token obesity detected on {toolName}: {tokenCount} tokens per call. Suggest prompt trimming, output filtering, and context window strategies.",
      estimatedImprovementTemplate: {
        en: "Reduces per-call tokens by up to {value}%",
        zh: "每次调用 Token 减少最多 {value}%",
      },
      risk: "low",
    },
    relatedDiseases: ["CST-001", "CST-002", "SK-009"],
    defaultSeverity: "warning",
    tags: ["tokens", "cost", "efficiency"],
  },
  {
    id: "SK-002",
    department: "skill",
    category: "reliability",
    name: { en: "Scenario Paralysis", zh: "场景偏瘫" },
    description: {
      en: "A tool consistently fails for specific input scenarios while succeeding for others, indicating incomplete scenario coverage.",
      zh: "某工具在特定输入场景下持续失败，而在其他场景下正常工作，表明场景覆盖不完整。",
    },
    rootCauses: [
      {
        en: "Missing edge case handling in tool implementation",
        zh: "工具实现中缺少边缘情况处理",
      },
      {
        en: "Input validation does not cover all accepted scenarios",
        zh: "输入验证未覆盖所有接受的场景",
      },
      {
        en: "Dependency service behaves differently for certain input patterns",
        zh: "依赖服务对某些输入模式行为不同",
      },
    ],
    detection: {
      type: "hybrid",
      preFilter: {
        type: "rule",
        metric: "skill.errorBurstCount",
        direction: "higher_is_worse",
        defaultThresholds: { warning: 3, critical: 10 },
      },
      deepAnalysis: {
        type: "llm",
        analysisPromptTemplate:
          "Analyze the following tool call error log for {toolName}. Identify which input scenarios cause failures and which succeed. Determine if there are patterns in the failed inputs. Return structured findings with scenario categories.",
        inputDataKeys: ["toolName", "errorLog", "successLog"],
        outputSchema: {
          failingScenarios: ["string"],
          successScenarios: ["string"],
          pattern: "string",
          confidence: "number",
        },
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "manual"],
      promptTemplate:
        "Scenario paralysis found in {toolName}: {failingScenarios}. Generate specific code fixes or configuration changes to handle the identified failing scenarios.",
      estimatedImprovementTemplate: {
        en: "Improves success rate by +{value}% for identified scenarios",
        zh: "识别场景的成功率提升 +{value}%",
      },
      risk: "medium",
    },
    relatedDiseases: ["SK-004", "SK-005"],
    defaultSeverity: "warning",
    tags: ["reliability", "error", "scenario"],
  },
  {
    id: "SK-003",
    department: "skill",
    category: "reliability",
    name: { en: "Trigger Disorder", zh: "触发失调" },
    description: {
      en: "Tools are being invoked at inappropriate times or in incorrect sequences, suggesting misaligned trigger logic.",
      zh: "工具在不恰当的时机或错误的顺序被调用，表明触发逻辑存在错位。",
    },
    rootCauses: [
      {
        en: "Agent prompt does not clearly define when each tool should be used",
        zh: "Agent 提示词未清晰定义每个工具的使用时机",
      },
      {
        en: "Tool descriptions are ambiguous, causing the LLM to misidentify applicable scenarios",
        zh: "工具描述模糊，导致 LLM 错误识别适用场景",
      },
      {
        en: "Missing pre-condition checks before tool invocation",
        zh: "工具调用前缺少前置条件检查",
      },
    ],
    detection: {
      type: "llm",
      analysisPromptTemplate:
        "Analyze tool call sequences for trigger disorder patterns. Review the following session tool call log and identify cases where tools were called in incorrect order, called unnecessarily, or skipped when needed. Provide a confidence score and specific examples.",
      inputDataKeys: ["sessionToolCallLog", "toolDescriptions", "taskGoal"],
      outputSchema: {
        triggerIssues: [
          {
            toolName: "string",
            issue: "string",
            example: "string",
          },
        ],
        confidence: "number",
        severity: "string",
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "manual"],
      promptTemplate:
        "Trigger disorder detected for tools: {affectedTools}. Generate updated tool descriptions and prompt guidance to fix trigger timing and sequence issues.",
      estimatedImprovementTemplate: {
        en: "Reduces unnecessary tool invocations by {value}%",
        zh: "减少 {value}% 的不必要工具调用",
      },
      risk: "low",
    },
    relatedDiseases: ["BHV-001", "BHV-006"],
    defaultSeverity: "warning",
    tags: ["trigger", "sequence", "tool-selection"],
  },
  {
    id: "SK-004",
    department: "skill",
    category: "reliability",
    name: { en: "Silent Failure", zh: "沉默失败" },
    description: {
      en: "A tool returns a success status code but produces empty, null, or semantically invalid output, masking failures.",
      zh: "工具返回成功状态码，但产生了空、null 或语义无效的输出，掩盖了实际失败。",
    },
    rootCauses: [
      {
        en: "Error handling swallows exceptions and returns empty result",
        zh: "错误处理吞掉了异常并返回空结果",
      },
      {
        en: "Downstream service returned empty data without signaling an error",
        zh: "下游服务返回了空数据但未发出错误信号",
      },
      {
        en: "Output validation is missing or too permissive",
        zh: "输出验证缺失或过于宽松",
      },
    ],
    detection: {
      type: "rule",
      metric: "skill.emptyResultRate",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0.1, critical: 0.3 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit"],
      promptTemplate:
        "Silent failure detected in {toolName}: {emptyResultRate}% of calls return empty results despite success status. Suggest output validation improvements and proper error propagation.",
      estimatedImprovementTemplate: {
        en: "Reduces silent failure rate by {value}%",
        zh: "减少 {value}% 的沉默失败率",
      },
      risk: "medium",
    },
    relatedDiseases: ["SK-002", "SK-005"],
    defaultSeverity: "warning",
    tags: ["reliability", "empty-result", "error-handling"],
  },
  {
    id: "SK-005",
    department: "skill",
    category: "reliability",
    name: { en: "Tool Chain Break", zh: "工具链断裂" },
    description: {
      en: "A sequence of dependent tool calls experiences cascading failures, breaking the entire workflow chain.",
      zh: "依赖性工具调用序列出现级联失败，破坏了整个工作流链。",
    },
    rootCauses: [
      {
        en: "First tool in chain fails and no fallback is configured",
        zh: "链中第一个工具失败且未配置回退方案",
      },
      {
        en: "Output schema mismatch between chained tools",
        zh: "链接工具之间的输出 schema 不匹配",
      },
      {
        en: "Timeout in one tool propagates failure to downstream tools",
        zh: "某工具超时将失败传播到下游工具",
      },
    ],
    detection: {
      type: "hybrid",
      preFilter: {
        type: "rule",
        metric: "skill.errorBurstCount",
        direction: "higher_is_worse",
        defaultThresholds: { warning: 3, critical: 10 },
      },
      deepAnalysis: {
        type: "llm",
        analysisPromptTemplate:
          "Analyze the following consecutive tool failure log to identify the root breakpoint in the tool chain. Determine which tool is the original failure source and how the failure propagates. Provide a causal chain diagram in text form.",
        inputDataKeys: ["consecutiveFailureLog", "toolChainDefinition"],
        outputSchema: {
          breakpointTool: "string",
          causalChain: ["string"],
          propagationPattern: "string",
          confidence: "number",
        },
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "config_change"],
      promptTemplate:
        "Tool chain break at {breakpointTool}. Generate retry logic, fallback configurations, and error boundary recommendations for the affected chain.",
      estimatedImprovementTemplate: {
        en: "Restores tool chain reliability to {value}% success rate",
        zh: "将工具链可靠性恢复到 {value}% 成功率",
      },
      risk: "medium",
    },
    relatedDiseases: ["SK-002", "SK-004", "BHV-002"],
    defaultSeverity: "critical",
    tags: ["chain", "cascading-failure", "reliability"],
  },
  {
    id: "SK-006",
    department: "skill",
    category: "efficiency",
    name: { en: "Repetition Compulsion", zh: "重复强迫症" },
    description: {
      en: "The same tool is called with identical or near-identical parameters multiple times within a single session, wasting resources.",
      zh: "在单个会话中，相同工具被以相同或近似参数多次调用，浪费资源。",
    },
    rootCauses: [
      {
        en: "Agent lacks memory of previous tool results in the session",
        zh: "Agent 在会话中缺少对之前工具结果的记忆",
      },
      {
        en: "Caching layer is not configured or not working",
        zh: "缓存层未配置或无法正常工作",
      },
      {
        en: "Agent re-executes completed sub-tasks due to poor task tracking",
        zh: "由于任务跟踪不足，Agent 重新执行了已完成的子任务",
      },
    ],
    detection: {
      type: "rule",
      metric: "skill.repetitionCount",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 3, critical: 5 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change", "file_edit"],
      promptTemplate:
        "Repetition compulsion detected: {toolName} called {count} times with identical params in session {sessionId}. Suggest result caching, deduplication logic, or agent prompt improvements.",
      estimatedImprovementTemplate: {
        en: "Reduces redundant tool calls by {value}%",
        zh: "减少 {value}% 的冗余工具调用",
      },
      risk: "low",
    },
    relatedDiseases: ["CST-001", "BHV-002"],
    defaultSeverity: "warning",
    tags: ["repetition", "efficiency", "caching"],
  },
  {
    id: "SK-007",
    department: "skill",
    category: "hygiene",
    name: { en: "Zombie Skill", zh: "僵尸技能" },
    description: {
      en: "An installed skill has not been called in an extended period, consuming registry space and potentially creating security exposure.",
      zh: "已安装的技能长时间未被调用，占用注册表空间并可能造成安全暴露。",
    },
    rootCauses: [
      {
        en: "Skill was installed for a one-time task and never removed",
        zh: "技能为一次性任务安装后从未移除",
      },
      {
        en: "Skill was superseded by a newer tool but not uninstalled",
        zh: "技能被更新的工具取代但未卸载",
      },
      {
        en: "Skill requires configuration that was never completed",
        zh: "技能需要从未完成的配置",
      },
    ],
    detection: {
      type: "rule",
      metric: "skill.zombieDays",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 14, critical: 30 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "manual"],
      promptTemplate:
        "Zombie skill detected: {skillName} has not been used for {days} days. Recommend uninstallation or provide reactivation guidance.",
      estimatedImprovementTemplate: {
        en: "Reduces attack surface and registry bloat",
        zh: "减少攻击面和注册表膨胀",
      },
      risk: "low",
    },
    relatedDiseases: ["SEC-003", "SEC-004"],
    defaultSeverity: "info",
    tags: ["hygiene", "unused", "cleanup"],
  },
  {
    id: "SK-008",
    department: "skill",
    category: "reliability",
    name: { en: "Conflict Allergy", zh: "冲突过敏" },
    description: {
      en: "Concurrent tool calls interfere with each other, causing unexpected failures or corrupted state due to resource contention.",
      zh: "并发工具调用相互干扰，由于资源争用导致意外失败或状态损坏。",
    },
    rootCauses: [
      {
        en: "Multiple tools writing to shared state without locks",
        zh: "多个工具在没有锁的情况下写入共享状态",
      },
      {
        en: "Tool assumes exclusive access to a shared resource",
        zh: "工具假设对共享资源具有独占访问权",
      },
      {
        en: "Race condition in async tool execution order",
        zh: "异步工具执行顺序中的竞争条件",
      },
    ],
    detection: {
      type: "llm",
      analysisPromptTemplate:
        "Analyze concurrent tool call interference patterns. Review the following parallel tool call log and identify cases where tools accessed shared resources simultaneously causing failures or incorrect results. Identify the specific resource conflicts.",
      inputDataKeys: [
        "parallelToolCallLog",
        "sharedResourceMap",
        "errorMessages",
      ],
      outputSchema: {
        conflicts: [
          {
            tools: ["string"],
            sharedResource: "string",
            conflictType: "string",
          },
        ],
        confidence: "number",
        severity: "string",
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "config_change"],
      promptTemplate:
        "Conflict allergy between {toolA} and {toolB} on resource {resource}. Generate synchronization logic, mutex recommendations, or sequential execution guidance.",
      estimatedImprovementTemplate: {
        en: "Eliminates concurrent conflict failures",
        zh: "消除并发冲突失败",
      },
      risk: "medium",
    },
    relatedDiseases: ["SK-005"],
    defaultSeverity: "warning",
    tags: ["concurrency", "conflict", "reliability"],
  },
  {
    id: "SK-009",
    department: "skill",
    category: "efficiency",
    name: { en: "Context Overflow", zh: "上下文溢出" },
    description: {
      en: "A skill's context token usage exceeds the recommended ratio, risking context window exhaustion and degraded performance.",
      zh: "技能上下文 Token 使用率超过推荐比例，有耗尽上下文窗口和性能下降的风险。",
    },
    rootCauses: [
      {
        en: "Skill accumulates conversation history without summarization",
        zh: "技能在没有摘要的情况下积累对话历史",
      },
      {
        en: "Large file contents included in context unnecessarily",
        zh: "不必要地在上下文中包含大型文件内容",
      },
      {
        en: "Nested sub-agent contexts growing unboundedly",
        zh: "嵌套子 Agent 上下文无限增长",
      },
    ],
    detection: {
      type: "rule",
      metric: "skill.contextTokenRatio",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0.3, critical: 0.5 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change", "file_edit"],
      promptTemplate:
        "Context overflow for {skillName}: context ratio at {ratio}. Suggest context pruning strategies, summarization hooks, and max-context configuration.",
      estimatedImprovementTemplate: {
        en: "Reduces context token ratio by {value}%",
        zh: "上下文 Token 比率降低 {value}%",
      },
      risk: "medium",
    },
    relatedDiseases: ["SK-001", "CST-001", "MEM-003"],
    defaultSeverity: "warning",
    tags: ["context", "tokens", "efficiency"],
  },
  {
    id: "SK-010",
    department: "skill",
    category: "evolution",
    name: { en: "Evolution Stagnation", zh: "进化停滞" },
    description: {
      en: "A skill continues to make the same errors repeatedly without improvement, missing learning opportunities.",
      zh: "技能持续重复相同的错误而没有改善，错失了学习机会。",
    },
    rootCauses: [
      {
        en: "No feedback loop from error outcomes to skill configuration",
        zh: "错误结果到技能配置没有反馈循环",
      },
      {
        en: "Agent prompt does not adapt based on previous failures",
        zh: "Agent 提示词不根据之前的失败进行调整",
      },
      {
        en: "Error patterns not surfaced in monitoring dashboards",
        zh: "错误模式未在监控仪表板中呈现",
      },
    ],
    detection: {
      type: "hybrid",
      preFilter: {
        type: "rule",
        metric: "skill.errorBurstCount",
        direction: "higher_is_worse",
        defaultThresholds: { warning: 3, critical: 10 },
      },
      deepAnalysis: {
        type: "llm",
        analysisPromptTemplate:
          "Analyze repeated error patterns for {skillName} across the last {periodDays} days. Identify recurring error types, determine if errors are worsening or persisting, and identify specific improvement opportunities the skill is missing.",
        inputDataKeys: ["errorHistory", "skillConfiguration", "periodDays"],
        outputSchema: {
          recurringErrors: [
            {
              errorType: "string",
              frequency: "number",
              trend: "string",
            },
          ],
          improvementOpportunities: ["string"],
          confidence: "number",
        },
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "config_change"],
      promptTemplate:
        "Evolution stagnation in {skillName}: {recurringErrors} persisting for {days} days. Generate specific prompt improvements and error handling updates to break the stagnation cycle.",
      estimatedImprovementTemplate: {
        en: "Reduces recurring error rate by {value}%",
        zh: "降低 {value}% 的重复错误率",
      },
      risk: "low",
    },
    relatedDiseases: ["SK-002", "SK-003"],
    defaultSeverity: "info",
    tags: ["evolution", "learning", "error-pattern"],
  },
];
