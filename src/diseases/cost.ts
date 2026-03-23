import type { DiseaseDefinition } from "../types/domain.js";

export const costDiseases: DiseaseDefinition[] = [
  {
    id: "CST-001",
    department: "cost",
    category: "consumption",
    name: { en: "Metabolic Overload", zh: "代谢亢进" },
    description: {
      en: "Daily token consumption has exceeded healthy limits, indicating runaway agent activity or inefficient tool usage.",
      zh: "每日 Token 消耗超过了健康限制，表明 Agent 活动失控或工具使用效率低下。",
    },
    rootCauses: [
      {
        en: "Agent performing unbounded background processing",
        zh: "Agent 进行无限制的后台处理",
      },
      {
        en: "Multiple agents sharing the same session consuming tokens redundantly",
        zh: "多个 Agent 共享同一会话冗余消耗 Token",
      },
      { en: "Death loop consuming tokens at high rate", zh: "死循环以高速率消耗 Token" },
    ],
    detection: {
      type: "rule",
      metric: "cost.dailyTokens",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 100_000, critical: 500_000 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change", "command"],
      promptTemplate:
        "Daily token consumption at {dailyTokens} tokens. Identify the top {topN} consuming sessions/tools and generate rate limiting and cost optimization recommendations.",
      estimatedImprovementTemplate: {
        en: "Reduces daily token consumption by {value}%",
        zh: "减少 {value}% 的每日 Token 消耗",
      },
      risk: "medium",
    },
    relatedDiseases: ["BHV-002", "SK-001", "CST-005"],
    defaultSeverity: "warning",
    tags: ["cost", "tokens", "consumption"],
  },
  {
    id: "CST-002",
    department: "cost",
    category: "efficiency",
    name: { en: "Luxury Invocation", zh: "奢侈调用" },
    description: {
      en: "Simple, low-token sessions are being routed to expensive premium models when cheaper alternatives would suffice.",
      zh: "简单的低 Token 会话被路由到昂贵的高端模型，而更便宜的替代方案足以处理。",
    },
    rootCauses: [
      {
        en: "Default model configuration uses the most expensive model for all tasks",
        zh: "默认模型配置对所有任务使用最昂贵的模型",
      },
      {
        en: "No task complexity routing logic to select appropriate model tier",
        zh: "没有任务复杂度路由逻辑来选择适当的模型层级",
      },
      {
        en: "Model selection hardcoded and not configurable per task type",
        zh: "模型选择被硬编码且无法按任务类型配置",
      },
    ],
    detection: {
      type: "rule",
      metric: "cost.luxurySessionTokenCeiling",
      direction: "lower_is_worse",
      defaultThresholds: { warning: 2000, critical: 1000 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change"],
      promptTemplate:
        "Luxury invocation detected: {sessionCount} simple sessions (under {tokenCeiling} tokens) routed to {expensiveModel}. Generate model routing configuration for complexity-based model selection.",
      estimatedImprovementTemplate: {
        en: "Reduces model cost by {value}% through tier-appropriate routing",
        zh: "通过适当层级路由降低 {value}% 的模型成本",
      },
      risk: "low",
    },
    relatedDiseases: ["CST-001", "CST-005"],
    defaultSeverity: "warning",
    tags: ["cost", "model", "routing"],
  },
  {
    id: "CST-003",
    department: "cost",
    category: "efficiency",
    name: { en: "Cache Miss Epidemic", zh: "缓存失效" },
    description: {
      en: "Cache hit rate is critically low, causing the agent to repeatedly compute the same expensive LLM responses instead of reusing cached results.",
      zh: "缓存命中率极低，导致 Agent 重复计算相同的昂贵 LLM 响应而不是重用缓存结果。",
    },
    rootCauses: [
      {
        en: "Cache TTL set too low for the actual request patterns",
        zh: "缓存 TTL 设置对实际请求模式太低",
      },
      {
        en: "Dynamic timestamps or session IDs in prompts prevent cache reuse",
        zh: "提示词中的动态时间戳或会话 ID 阻止了缓存重用",
      },
      {
        en: "Cache storage filled and old entries evicted before reuse",
        zh: "缓存存储已满，旧条目在重用前被驱逐",
      },
    ],
    detection: {
      type: "rule",
      metric: "cost.cacheHitRate",
      direction: "lower_is_worse",
      defaultThresholds: { warning: 0.3, critical: 0.1 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change", "file_edit"],
      promptTemplate:
        "Cache miss epidemic: hit rate at {cacheHitRate}%. Identify cache-busting patterns in prompts and generate recommendations for stable prompt structures and appropriate TTL configuration.",
      estimatedImprovementTemplate: {
        en: "Improves cache hit rate to {value}%, reducing costs proportionally",
        zh: "将缓存命中率提高到 {value}%，按比例降低成本",
      },
      risk: "low",
    },
    relatedDiseases: ["CST-001", "SK-006"],
    defaultSeverity: "warning",
    tags: ["cost", "cache", "efficiency"],
  },
  {
    id: "CST-004",
    department: "cost",
    category: "waste",
    name: { en: "Sunk Cost", zh: "沉没成本" },
    description: {
      en: "A significant portion of token consumption is from failed sessions, representing wasted investment that yielded no productive output.",
      zh: "大量 Token 消耗来自失败的会话，代表了没有产生有效输出的浪费投资。",
    },
    rootCauses: [
      {
        en: "Agent spends many tokens before detecting task impossibility",
        zh: "Agent 在发现任务不可能完成之前花费了大量 Token",
      },
      {
        en: "No early termination when prerequisite conditions are not met",
        zh: "当前置条件不满足时没有提前终止",
      },
      {
        en: "Retry-on-failure logic consumes tokens without limit on failed sessions",
        zh: "失败重试逻辑在失败会话上无限制地消耗 Token",
      },
    ],
    detection: {
      type: "rule",
      metric: "cost.failedSessionTokenRatio",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0.3, critical: 0.5 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change", "file_edit"],
      promptTemplate:
        "Sunk cost ratio at {failedRatio}%: {failedTokens} tokens consumed by failed sessions. Generate early feasibility check prompts and token budget limits for pre-flight validation.",
      estimatedImprovementTemplate: {
        en: "Recovers {value}% of tokens wasted on infeasible tasks",
        zh: "从不可行任务中恢复 {value}% 的浪费 Token",
      },
      risk: "low",
    },
    relatedDiseases: ["BHV-005", "CST-001"],
    defaultSeverity: "warning",
    tags: ["cost", "waste", "failure"],
  },
  {
    id: "CST-005",
    department: "cost",
    category: "anomaly",
    name: { en: "Cost Spike", zh: "成本尖峰" },
    description: {
      en: "Daily token consumption has suddenly spiked far above the rolling 7-day average, indicating an unusual event or runaway process.",
      zh: "每日 Token 消耗突然飙升到滚动 7 日平均值以上，表明出现了异常事件或失控进程。",
    },
    rootCauses: [
      {
        en: "A new feature or task triggered unexpectedly high token consumption",
        zh: "新功能或任务触发了意外的高 Token 消耗",
      },
      {
        en: "Death loop or infinite retry consumed tokens at spike rate",
        zh: "死循环或无限重试以尖峰速率消耗 Token",
      },
      {
        en: "Batch processing job ran during monitoring period",
        zh: "批处理作业在监控期间运行",
      },
    ],
    detection: {
      type: "rule",
      metric: "cost.spikeMultiplier",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 2.0, critical: 5.0 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "config_change"],
      promptTemplate:
        "Cost spike detected: today's usage is {spikeMultiplier}x the 7-day average. Identify the spike source sessions and generate circuit breaker and rate limiting recommendations.",
      estimatedImprovementTemplate: {
        en: "Prevents future spike recurrence with {value}% confidence",
        zh: "以 {value}% 的置信度防止未来尖峰再现",
      },
      risk: "medium",
    },
    relatedDiseases: ["CST-001", "BHV-002", "CST-004"],
    defaultSeverity: "warning",
    tags: ["cost", "spike", "anomaly"],
  },
  {
    id: "CST-006",
    department: "cost",
    category: "efficiency",
    name: { en: "Compaction Drain", zh: "压缩消耗" },
    description: {
      en: "Context compaction is consuming a disproportionate share of total tokens, indicating over-reliance on compaction rather than proactive context management.",
      zh: "上下文压缩消耗了总 Token 中不成比例的份额，表明过度依赖压缩而非主动的上下文管理。",
    },
    rootCauses: [
      {
        en: "Sessions grow too large before compaction is triggered",
        zh: "会话在触发压缩之前增长过大",
      },
      {
        en: "Compaction model is unnecessarily powerful for the content",
        zh: "压缩模型对内容来说不必要地强大",
      },
      {
        en: "Frequent compaction cycles due to low compaction threshold",
        zh: "由于压缩阈值低导致频繁的压缩周期",
      },
    ],
    detection: {
      type: "rule",
      metric: "cost.compactionTokenRatio",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 0.2, critical: 0.4 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change"],
      promptTemplate:
        "Compaction drain at {compactionRatio}% of total tokens. Generate compaction threshold tuning recommendations and context management strategies to reduce compaction frequency.",
      estimatedImprovementTemplate: {
        en: "Reduces compaction overhead by {value}%",
        zh: "减少 {value}% 的压缩开销",
      },
      risk: "low",
    },
    relatedDiseases: ["CST-001", "MEM-006"],
    defaultSeverity: "info",
    tags: ["cost", "compaction", "efficiency"],
  },
  {
    id: "CST-010",
    department: "cost",
    category: "anomaly",
    name: { en: "Cost Spike Fever", zh: "成本飙升热" },
    description: {
      en: "Session cost exceeds Nx the rolling average (N configurable, default 3x), indicating an anomalous cost spike requiring investigation. Requires a minimum of 20 sessions for baseline.",
      zh: "会话成本超过滚动平均值的 N 倍（N 可配置，默认 3 倍），表明出现需要调查的异常成本飙升。需要至少 20 个会话作为基线。",
    },
    rootCauses: [
      {
        en: "A new complex task triggered unexpectedly high token consumption",
        zh: "新的复杂任务触发了意外的高 Token 消耗",
      },
      {
        en: "Death loop or infinite retry within a single session",
        zh: "单个会话内的死循环或无限重试",
      },
      {
        en: "Model upgrade caused higher per-call token usage",
        zh: "模型升级导致每次调用的 Token 使用量增加",
      },
    ],
    detection: {
      type: "rule",
      metric: "cost.sessionSpikeMultiplier",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 2.0, critical: 3.0 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "config_change"],
      promptTemplate:
        "Cost spike fever: session cost is {spikeMultiplier}x the rolling average. Identify the spike source, analyze token consumption breakdown, and generate cost containment recommendations.",
      estimatedImprovementTemplate: {
        en: "Identifies and prevents recurrence of cost spikes",
        zh: "识别并防止成本飙升再次发生",
      },
      risk: "medium",
    },
    relatedDiseases: ["CST-001", "CST-005", "INFRA-005"],
    defaultSeverity: "critical",
    tags: ["cost", "spike", "anomaly", "session"],
  },
];
