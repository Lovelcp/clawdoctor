import type { DiseaseDefinition } from "../types/domain.js";

export const memoryDiseases: DiseaseDefinition[] = [
  {
    id: "MEM-001",
    department: "memory",
    category: "retention",
    name: { en: "Memory Amnesia", zh: "记忆失忆症" },
    description: {
      en: "The agent consistently ignores previously stored key preferences and instructions, behaving as if they never existed.",
      zh: "Agent 持续忽略之前存储的关键偏好和指令，表现得好像它们从未存在。",
    },
    rootCauses: [
      {
        en: "Memory files are not being read at session start",
        zh: "会话开始时未读取记忆文件",
      },
      {
        en: "Agent context window is too full to include memory content",
        zh: "Agent 上下文窗口太满，无法包含记忆内容",
      },
      {
        en: "Memory format is incompatible with the agent's parsing logic",
        zh: "记忆格式与 Agent 的解析逻辑不兼容",
      },
    ],
    detection: {
      type: "llm",
      analysisPromptTemplate:
        "Analyze session logs to detect memory amnesia. Compare stored memory preferences against actual agent behavior in recent sessions. Identify cases where the agent ignored or contradicted clearly stored preferences. List specific preference violations with session references.",
      inputDataKeys: [
        "memoryFiles",
        "recentSessionLogs",
        "agentConfiguration",
      ],
      outputSchema: {
        violations: [
          {
            preference: "string",
            session: "string",
            ignoredBehavior: "string",
          },
        ],
        amnesiaSeverity: "string",
        confidence: "number",
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["config_change", "file_edit"],
      promptTemplate:
        "Memory amnesia detected: {violationCount} preference violations in recent sessions. Generate fixes for memory loading configuration and suggest memory restructuring for better recall.",
      estimatedImprovementTemplate: {
        en: "Restores preference adherence to {value}%",
        zh: "将偏好遵从率恢复到 {value}%",
      },
      risk: "low",
    },
    relatedDiseases: ["MEM-005", "MEM-007"],
    defaultSeverity: "warning",
    tags: ["memory", "preferences", "recall"],
  },
  {
    id: "MEM-002",
    department: "memory",
    category: "accuracy",
    name: { en: "Memory Hallucination", zh: "记忆幻觉" },
    description: {
      en: "Memory files contain factually incorrect information that the agent treats as ground truth, causing systematic errors.",
      zh: "记忆文件包含事实错误的信息，Agent 将其视为基本事实，导致系统性错误。",
    },
    rootCauses: [
      {
        en: "LLM generated incorrect facts during memory consolidation",
        zh: "LLM 在记忆巩固期间生成了错误事实",
      },
      {
        en: "Outdated memory persisted beyond its validity period",
        zh: "过时的记忆超过了有效期仍在持久化",
      },
      {
        en: "Memory was created from a hallucinated conversation",
        zh: "记忆是从虚构的对话中创建的",
      },
    ],
    detection: {
      type: "llm",
      analysisPromptTemplate:
        "Analyze memory file contents for hallucinations and factual errors. Review the following memory files and identify claims that are verifiably false, internally inconsistent, or suspiciously specific without basis. Flag each issue with confidence level.",
      inputDataKeys: ["memoryFiles", "groundTruthSources", "sessionContext"],
      outputSchema: {
        hallucinations: [
          {
            file: "string",
            claim: "string",
            issue: "string",
            confidence: "number",
          },
        ],
        totalIssues: "number",
        severity: "string",
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "manual"],
      promptTemplate:
        "Memory hallucination detected in {fileCount} files with {issueCount} issues. Generate corrected memory content and establish fact-checking procedures for future memory writes.",
      estimatedImprovementTemplate: {
        en: "Eliminates {value}% of fact-based errors",
        zh: "消除 {value}% 的事实性错误",
      },
      risk: "high",
    },
    relatedDiseases: ["MEM-004", "MEM-007"],
    defaultSeverity: "critical",
    tags: ["memory", "hallucination", "accuracy"],
  },
  {
    id: "MEM-003",
    department: "memory",
    category: "hygiene",
    name: { en: "Memory Bloat", zh: "记忆肥大" },
    description: {
      en: "The total number or size of memory files has grown beyond healthy limits, slowing down memory retrieval and consuming storage.",
      zh: "记忆文件的总数或大小超过了健康限制，减慢了记忆检索速度并消耗了存储空间。",
    },
    rootCauses: [
      {
        en: "Memory is appended but never pruned or compacted",
        zh: "记忆被持续追加但从未修剪或压缩",
      },
      {
        en: "Every session creates new memory fragments without merging",
        zh: "每个会话都创建新的记忆碎片而不合并",
      },
      {
        en: "Large binary or log data accidentally written to memory",
        zh: "大型二进制或日志数据意外写入了记忆",
      },
    ],
    detection: {
      type: "rule",
      metric: "memory.totalFiles",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 50, critical: 200 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["command", "file_delete"],
      promptTemplate:
        "Memory bloat detected: {fileCount} files totaling {totalSizeKB}KB. Generate memory compaction script and cleanup recommendations prioritized by file age and redundancy.",
      estimatedImprovementTemplate: {
        en: "Reduces memory file count by {value}%",
        zh: "减少 {value}% 的记忆文件数量",
      },
      risk: "medium",
    },
    relatedDiseases: ["VIT-005", "MEM-006"],
    defaultSeverity: "warning",
    tags: ["memory", "storage", "cleanup"],
  },
  {
    id: "MEM-004",
    department: "memory",
    category: "consistency",
    name: { en: "Memory Conflict", zh: "记忆冲突" },
    description: {
      en: "Contradictory information exists across multiple memory files, causing the agent to behave inconsistently.",
      zh: "多个记忆文件中存在相互矛盾的信息，导致 Agent 行为不一致。",
    },
    rootCauses: [
      {
        en: "Preferences updated in one file but not synchronized across others",
        zh: "偏好在一个文件中更新但未同步到其他文件",
      },
      {
        en: "Different sessions wrote conflicting information about the same topic",
        zh: "不同会话对同一主题写入了相互矛盾的信息",
      },
      {
        en: "Memory from project context conflicts with global preferences",
        zh: "项目上下文的记忆与全局偏好冲突",
      },
    ],
    detection: {
      type: "llm",
      analysisPromptTemplate:
        "Analyze memory files for contradictory information. Review all provided memory file contents and identify pairs of statements that directly contradict each other. Group contradictions by topic and assess which version is more likely current/correct.",
      inputDataKeys: ["memoryFiles", "fileTimestamps"],
      outputSchema: {
        conflicts: [
          {
            topic: "string",
            statement1: { file: "string", content: "string" },
            statement2: { file: "string", content: "string" },
            recommendation: "string",
          },
        ],
        totalConflicts: "number",
        confidence: "number",
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit"],
      promptTemplate:
        "Memory conflicts detected: {conflictCount} contradictions across {fileCount} files. Generate resolved memory content that reconciles contradictions, preferring more recent or specific information.",
      estimatedImprovementTemplate: {
        en: "Resolves {value}% of behavioral inconsistencies",
        zh: "解决 {value}% 的行为不一致性",
      },
      risk: "medium",
    },
    relatedDiseases: ["MEM-002", "MEM-007"],
    defaultSeverity: "warning",
    tags: ["memory", "conflict", "consistency"],
  },
  {
    id: "MEM-005",
    department: "memory",
    category: "freshness",
    name: { en: "Stale Memory", zh: "记忆过期" },
    description: {
      en: "Memory files have not been updated for an extended period and may contain outdated information no longer relevant to current context.",
      zh: "记忆文件长时间未更新，可能包含不再与当前上下文相关的过时信息。",
    },
    rootCauses: [
      {
        en: "Memory update mechanism not triggered after significant context changes",
        zh: "重大上下文变化后未触发记忆更新机制",
      },
      {
        en: "Agent operates in read-only memory mode",
        zh: "Agent 以只读记忆模式运行",
      },
      {
        en: "Memory files belong to an old project phase that was never archived",
        zh: "记忆文件属于从未归档的旧项目阶段",
      },
    ],
    detection: {
      type: "rule",
      metric: "memory.staleAgeDays",
      direction: "higher_is_worse",
      defaultThresholds: { warning: 30, critical: 90 },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "manual"],
      promptTemplate:
        "Stale memory files detected: {fileCount} files not updated in over {days} days. Generate a memory review and update prompt, and suggest archiving procedures for obsolete memory.",
      estimatedImprovementTemplate: {
        en: "Improves response relevance by refreshing {value}% of stale content",
        zh: "通过刷新 {value}% 的过期内容提高响应相关性",
      },
      risk: "low",
    },
    relatedDiseases: ["MEM-001", "MEM-007"],
    defaultSeverity: "info",
    tags: ["memory", "freshness", "stale"],
  },
  {
    id: "MEM-006",
    department: "memory",
    category: "hygiene",
    name: { en: "Memory Fragmentation", zh: "记忆碎片化" },
    description: {
      en: "Memory is spread across many small files, causing inefficient retrieval and difficulty maintaining coherent context.",
      zh: "记忆分散在许多小文件中，导致检索效率低下，难以维持连贯的上下文。",
    },
    rootCauses: [
      {
        en: "Each conversation creates a separate memory snippet file",
        zh: "每次对话都创建一个单独的记忆片段文件",
      },
      {
        en: "No periodic consolidation task is configured",
        zh: "未配置定期合并任务",
      },
      {
        en: "Memory sharding by topic created too-granular files",
        zh: "按主题分片的记忆创建了过于细粒度的文件",
      },
    ],
    detection: {
      type: "hybrid",
      preFilter: {
        type: "rule",
        metric: "memory.totalFiles",
        direction: "higher_is_worse",
        defaultThresholds: { warning: 50, critical: 200 },
      },
      deepAnalysis: {
        type: "llm",
        analysisPromptTemplate:
          "Analyze memory file structure for fragmentation. Review the list of memory files with their sizes and topics. Identify groups of files that cover overlapping topics and could be merged. Suggest a consolidated file structure.",
        inputDataKeys: ["memoryFileList", "memoryFileContents"],
        outputSchema: {
          mergeGroups: [
            {
              targetFile: "string",
              sourceFiles: ["string"],
              topic: "string",
            },
          ],
          fragmentationScore: "number",
          estimatedReduction: "number",
        },
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit", "file_delete"],
      promptTemplate:
        "Memory fragmentation: {fragmentCount} small files detected. Generate merge plan and consolidated memory file content organized by topic.",
      estimatedImprovementTemplate: {
        en: "Consolidates {value}% of files into coherent topic files",
        zh: "将 {value}% 的文件合并为连贯的主题文件",
      },
      risk: "medium",
    },
    relatedDiseases: ["MEM-003", "MEM-004"],
    defaultSeverity: "info",
    tags: ["memory", "fragmentation", "hygiene"],
  },
  {
    id: "MEM-007",
    department: "memory",
    category: "consistency",
    name: { en: "Config Drift", zh: "配置漂移" },
    description: {
      en: "CLAUDE.md or AGENTS.md configuration files have drifted from the agent's actual behavior patterns, creating a disconnect between documented and real behavior.",
      zh: "CLAUDE.md 或 AGENTS.md 配置文件与 Agent 实际行为模式产生了偏差，导致文档化行为与真实行为之间存在脱节。",
    },
    rootCauses: [
      {
        en: "Configuration written early in project has not been updated as practices evolved",
        zh: "项目早期编写的配置随着实践演进未被更新",
      },
      {
        en: "Agent adopted new patterns through conversations not captured in config files",
        zh: "Agent 通过对话采用了新模式但未在配置文件中捕获",
      },
      {
        en: "Config file was copied from template and never customized",
        zh: "配置文件从模板复制后从未定制",
      },
    ],
    detection: {
      type: "hybrid",
      preFilter: {
        type: "rule",
        metric: "memory.staleAgeDays",
        direction: "higher_is_worse",
        defaultThresholds: { warning: 30, critical: 90 },
      },
      deepAnalysis: {
        type: "llm",
        analysisPromptTemplate:
          "Compare CLAUDE.md/AGENTS.md configuration content against recent agent behavior patterns. Identify discrepancies between documented behavior rules and actual observed behavior in sessions. Flag outdated instructions and missing rules for newly adopted behaviors.",
        inputDataKeys: [
          "configFileContent",
          "recentSessionBehavior",
          "configFileAge",
        ],
        outputSchema: {
          outdatedRules: [
            {
              rule: "string",
              actualBehavior: "string",
            },
          ],
          missingRules: ["string"],
          driftScore: "number",
          confidence: "number",
        },
      },
    },
    prescriptionTemplate: {
      level: "guided",
      actionTypes: ["file_edit"],
      promptTemplate:
        "Config drift detected: {driftScore}/10 drift score. Generate updated CLAUDE.md/AGENTS.md content that accurately reflects current agent behavior and adds missing behavioral rules.",
      estimatedImprovementTemplate: {
        en: "Aligns config with behavior, reducing confusion by {value}%",
        zh: "将配置与行为对齐，减少 {value}% 的困惑",
      },
      risk: "low",
    },
    relatedDiseases: ["MEM-001", "MEM-002", "MEM-005"],
    defaultSeverity: "warning",
    tags: ["config", "drift", "consistency"],
  },
];
