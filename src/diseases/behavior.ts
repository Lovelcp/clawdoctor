import type { DiseaseDefinition } from "../types/domain.js";

export const behaviorDiseases: DiseaseDefinition[] = [
  {
    id: "BHV-001",
    department: "behavior",
    category: "efficiency",
    name: { en: "Decision Paralysis", zh: "选择困难症" },
    description: {
      en: "The agent excessively switches between tools and approaches without making forward progress, indicating inability to commit to a strategy.",
      zh: "Agent 在工具和方法之间过度切换而没有取得进展，表明无法确定策略。",
    },
    rootCauses: [
      {
        en: "Agent prompt provides conflicting or ambiguous task objectives",
        zh: "Agent 提示词提供了相互冲突或模糊的任务目标",
      },
      {
        en: "Too many tools available without clear selection criteria",
        zh: "可用工具过多但没有明确的选择标准",
      },
      {
        en: "Agent lacks confidence threshold for action commitment",
        zh: "Agent 缺乏行动承诺的置信度阈值",
      },
    ],
    detection: {
      type: "llm",
      analysisPromptTemplate:
        "Analyze tool switching patterns for decision paralysis. Review the following session tool call log and identify patterns where the agent repeatedly switches between tools without completing tasks. Measure oscillation frequency and identify the specific decision points causing paralysis.",
      inputDataKeys: [
        "sessionToolCallLog",
        "taskObjectives",
        "completedSubtasks",
      ],
      outputSchema: {
        paralysisEpisodes: [
          {
            session: "string",
            switchCount: "number",
            involvedTools: ["string"],
            taskStage: "string",
          },
        ],
        avgOscillationFrequency: "number",
        confidence: "number",
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "config_change"],
      promptTemplate:
        "Decision paralysis detected: {paralysisCount} episodes with {avgSwitches} tool switches per episode. Generate prompt improvements to provide clearer tool selection criteria and decision commitment strategies.",
      estimatedImprovementTemplate: {
        en: "Reduces tool switching oscillations by {value}%",
        zh: "减少 {value}% 的工具切换振荡",
      },
      risk: "low",
    },
    relatedDiseases: ["SK-003", "BHV-006"],
    defaultSeverity: "warning",
    tags: ["behavior", "decision", "efficiency"],
  },
  {
    id: "BHV-002",
    department: "behavior",
    category: "reliability",
    name: { en: "Death Loop", zh: "死循环" },
    description: {
      en: "The agent enters an infinite loop of repeated actions, unable to exit even when the repeated action consistently fails or produces no progress.",
      zh: "Agent 进入重复动作的无限循环，即使重复动作持续失败或没有进展也无法退出。",
    },
    rootCauses: [
      {
        en: "No termination condition defined for retry logic",
        zh: "重试逻辑未定义终止条件",
      },
      {
        en: "Agent misinterprets failure signals as requiring retry",
        zh: "Agent 将失败信号误解为需要重试",
      },
      {
        en: "Circular dependency between tools each waiting for the other",
        zh: "工具之间存在循环依赖，相互等待",
      },
    ],
    detection: {
      type: "hybrid",
      preFilter: {
        type: "rule",
        metric: "behavior.loopDetectionThreshold",
        direction: "higher_is_worse",
        defaultThresholds: { warning: 3, critical: 5 },
      },
      deepAnalysis: {
        type: "llm",
        analysisPromptTemplate:
          "Confirm death loop behavior from the following repeated action sequence. Analyze whether the agent is making any meaningful progress between iterations or is stuck in a true loop. Identify the specific loop trigger and what should break the cycle.",
        inputDataKeys: [
          "repeatedActionSequence",
          "taskObjective",
          "sessionContext",
        ],
        outputSchema: {
          isDeathLoop: "boolean",
          loopTrigger: "string",
          iterationCount: "number",
          breakCondition: "string",
          confidence: "number",
        },
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change", "file_edit"],
      promptTemplate:
        "Death loop detected: agent repeated {action} {count} times in session {sessionId}. Generate loop prevention logic, max-retry configurations, and escape hatch procedures.",
      estimatedImprovementTemplate: {
        en: "Eliminates infinite loops and reduces wasted iterations",
        zh: "消除无限循环并减少无效迭代",
      },
      risk: "high",
    },
    relatedDiseases: ["SK-006", "SK-005", "CST-001"],
    defaultSeverity: "critical",
    tags: ["behavior", "loop", "critical"],
  },
  {
    id: "BHV-003",
    department: "behavior",
    category: "efficiency",
    name: { en: "Over-Service", zh: "过度服务" },
    description: {
      en: "The agent triggers unnecessarily complex, multi-step workflows in response to simple questions or requests.",
      zh: "Agent 对简单问题或请求触发了不必要的复杂多步骤工作流。",
    },
    rootCauses: [
      {
        en: "Agent default to maximum thoroughness regardless of task complexity",
        zh: "Agent 无论任务复杂度如何都默认最大彻底性",
      },
      {
        en: "Prompt instructs agent to always verify, research, and document",
        zh: "提示词指示 Agent 总是要验证、研究和记录",
      },
      {
        en: "No task complexity classification in the agent workflow",
        zh: "Agent 工作流中没有任务复杂度分类",
      },
    ],
    detection: {
      type: "llm",
      analysisPromptTemplate:
        "Analyze agent responses for over-service patterns. Review the following session logs and identify cases where a simple user request (answerable in 1-2 steps) triggered a complex multi-tool workflow. Rate the mismatch between request complexity and response complexity.",
      inputDataKeys: ["sessionLogs", "userRequests", "agentResponses"],
      outputSchema: {
        overServiceInstances: [
          {
            session: "string",
            userRequest: "string",
            responseComplexity: "number",
            expectedComplexity: "number",
          },
        ],
        avgComplexityMismatch: "number",
        confidence: "number",
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit"],
      promptTemplate:
        "Over-service detected: {instanceCount} cases of complexity mismatch. Generate prompt rules for proportional response calibration and task complexity classification.",
      estimatedImprovementTemplate: {
        en: "Reduces unnecessary tool calls by {value}% for simple requests",
        zh: "对简单请求减少 {value}% 的不必要工具调用",
      },
      risk: "low",
    },
    relatedDiseases: ["CST-001", "BHV-001"],
    defaultSeverity: "info",
    tags: ["behavior", "efficiency", "over-engineering"],
  },
  {
    id: "BHV-004",
    department: "behavior",
    category: "reliability",
    name: { en: "Handoff Amnesia", zh: "交接失忆" },
    description: {
      en: "Sub-agents lose critical context when being handed off tasks from the orchestrator agent, causing repeated work and missed requirements.",
      zh: "子 Agent 在从编排 Agent 接收任务时丢失了关键上下文，导致重复工作和遗漏需求。",
    },
    rootCauses: [
      {
        en: "Handoff prompt does not include sufficient context from parent session",
        zh: "交接提示词未包含来自父会话的足够上下文",
      },
      {
        en: "Sub-agent context window too small to receive full handoff package",
        zh: "子 Agent 上下文窗口太小，无法接收完整的交接包",
      },
      {
        en: "Critical decisions made verbally not captured in structured handoff",
        zh: "口头做出的关键决定未在结构化交接中捕获",
      },
    ],
    detection: {
      type: "llm",
      analysisPromptTemplate:
        "Analyze sub-agent handoff quality by comparing parent context with sub-agent behavior. Review the following parent agent session and sub-agent session pairs. Identify cases where the sub-agent missed, ignored, or contradicted critical information from the parent context.",
      inputDataKeys: [
        "parentSessionContext",
        "subAgentSessionLogs",
        "handoffPrompts",
      ],
      outputSchema: {
        amnesiaInstances: [
          {
            subAgentId: "string",
            missedContext: "string",
            impact: "string",
          },
        ],
        handoffQualityScore: "number",
        confidence: "number",
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "config_change"],
      promptTemplate:
        "Handoff amnesia in {subAgentCount} sub-agents: {missedContextItems} critical items lost. Generate improved handoff prompt templates and context packaging strategies.",
      estimatedImprovementTemplate: {
        en: "Improves sub-agent context retention by {value}%",
        zh: "提高子 Agent 上下文保留率 {value}%",
      },
      risk: "medium",
    },
    relatedDiseases: ["MEM-001", "BHV-002"],
    defaultSeverity: "warning",
    tags: ["behavior", "subagent", "handoff", "context"],
  },
  {
    id: "BHV-005",
    department: "behavior",
    category: "reliability",
    name: { en: "Premature Abort", zh: "过早放弃" },
    description: {
      en: "The agent frequently terminates tasks before completion, reporting failure even for tasks that could have been resolved with additional effort.",
      zh: "Agent 频繁在完成前终止任务，即使对于多付出一些努力就能解决的任务也报告失败。",
    },
    rootCauses: [
      {
        en: "Agent confidence threshold for giving up set too low",
        zh: "Agent 放弃的置信度阈值设置过低",
      },
      {
        en: "Prompt instructs agent to abort on first ambiguity",
        zh: "提示词指示 Agent 在第一次模糊时放弃",
      },
      {
        en: "No retry or alternative approach strategy in the agent workflow",
        zh: "Agent 工作流中没有重试或替代方法策略",
      },
    ],
    detection: {
      type: "rule",
      metric: "behavior.abortRate",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0.3, critical: 0.5 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "config_change"],
      promptTemplate:
        "Premature abort rate at {abortRate}% across {sessionCount} sessions. Generate persistence improvement prompts, retry strategies, and fallback approach templates.",
      estimatedImprovementTemplate: {
        en: "Reduces premature abort rate by {value}%",
        zh: "降低 {value}% 的过早放弃率",
      },
      risk: "low",
    },
    relatedDiseases: ["BHV-001", "SK-005"],
    defaultSeverity: "warning",
    tags: ["behavior", "reliability", "persistence"],
  },
  {
    id: "BHV-006",
    department: "behavior",
    category: "efficiency",
    name: { en: "Tool Misselection", zh: "工具误选" },
    description: {
      en: "The agent consistently selects suboptimal or incorrect tools as its first choice, requiring corrections and retry cycles.",
      zh: "Agent 持续选择次优或错误的工具作为第一选择，需要纠正和重试循环。",
    },
    rootCauses: [
      {
        en: "Tool descriptions overlap or are too similar to distinguish",
        zh: "工具描述重叠或过于相似，难以区分",
      },
      {
        en: "Agent training biases toward familiar tools regardless of suitability",
        zh: "Agent 无论适用性如何都偏向于熟悉的工具",
      },
      {
        en: "No capability matrix provided for tool selection guidance",
        zh: "没有为工具选择指导提供能力矩阵",
      },
    ],
    detection: {
      type: "llm",
      analysisPromptTemplate:
        "Analyze first tool selection accuracy. Review the following session tool call logs and identify cases where the agent's first tool selection was suboptimal — i.e., it later switched to a different tool to accomplish the same task. Calculate first-choice accuracy and identify which tools are most commonly misselected.",
      inputDataKeys: [
        "sessionToolCallLog",
        "taskDescriptions",
        "toolDescriptions",
      ],
      outputSchema: {
        misselectionInstances: [
          {
            session: "string",
            chosenTool: "string",
            correctTool: "string",
            task: "string",
          },
        ],
        firstChoiceAccuracy: "number",
        mostMisselectedTools: ["string"],
        confidence: "number",
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit"],
      promptTemplate:
        "Tool misselection rate at {misselectionRate}%: most commonly confused: {confusedTools}. Generate improved tool descriptions and a tool selection guide for the agent system prompt.",
      estimatedImprovementTemplate: {
        en: "Improves first-tool-choice accuracy by {value}%",
        zh: "提高第一次工具选择准确率 {value}%",
      },
      risk: "low",
    },
    relatedDiseases: ["BHV-001", "SK-003"],
    defaultSeverity: "warning",
    tags: ["behavior", "tool-selection", "efficiency"],
  },
  {
    id: "BHV-007",
    department: "behavior",
    category: "efficiency",
    name: { en: "Verbose Waste", zh: "冗余浪费" },
    description: {
      en: "The agent produces excessive conversation turns relative to the effective output generated, indicating inefficient communication patterns.",
      zh: "Agent 相对于有效输出产生了过多的对话轮次，表明通信模式低效。",
    },
    rootCauses: [
      {
        en: "Agent over-explains its reasoning in every step",
        zh: "Agent 在每个步骤都过度解释其推理",
      },
      {
        en: "Unnecessary confirmation requests before each action",
        zh: "每次操作前不必要的确认请求",
      },
      {
        en: "Progress updates too frequent relative to actual work being done",
        zh: "进度更新相对于实际完成的工作过于频繁",
      },
    ],
    detection: {
      type: "rule",
      metric: "behavior.verboseRatio",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 3.0, critical: 5.0 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit"],
      promptTemplate:
        "Verbose waste detected: conversation turn/output ratio at {verboseRatio}. Generate concise communication guidelines and reduce unnecessary confirmation and explanation patterns.",
      estimatedImprovementTemplate: {
        en: "Reduces conversation overhead by {value}%",
        zh: "减少 {value}% 的对话开销",
      },
      risk: "low",
    },
    relatedDiseases: ["CST-001", "BHV-003"],
    defaultSeverity: "info",
    tags: ["behavior", "verbosity", "efficiency"],
  },
];
