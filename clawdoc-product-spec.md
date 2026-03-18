# ClawDoc — Your OpenClaw Doctor

> 自顶向下产品设计 v1.0 | 2026-03-16

---

## 一、顶层愿景

### 一句话

**ClawDoc 是你的龙虾的私人医生——全方位诊断 Agent 系统的健康状况，找出病因，开出药方，跟踪康复。**

### 类比

就像人去做体检：

```
人的体检                              龙虾的体检 (ClawDoc)
────────                              ──────────────────
血常规 → 基础指标                      System Vitals → 基础运行指标
心电图 → 心脏功能                      Skill Health → 技能质量
CT/MRI → 深层结构                      Agent Behavior → 行为模式
血糖血脂 → 代谢水平                    Cost Metabolism → 成本代谢
免疫检查 → 防御能力                    Security Immunity → 安全免疫
脑功能 → 认知能力                      Memory Cognition → 记忆认知
体检报告 → 综合评估                    Health Report → 综合体检报告
医嘱 → 改善建议                        Prescription → 自动改进方案
复查 → 跟踪效果                        Follow-up → 持续监测
```

---

## 二、顶层架构：六大诊断科室

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║                    ClawDoc — 龙虾体检中心                         ║
║                                                                  ║
║  ┌──────────────────────────────────────────────────────────┐    ║
║  │                   🏥 Health Report                       │    ║
║  │              综合体检报告 + 健康评分                       │    ║
║  └──────────────────────┬───────────────────────────────────┘    ║
║                         │                                        ║
║    ┌────────────────────┼────────────────────┐                   ║
║    │    Diagnosis Engine │  Prescription Engine│                   ║
║    │    诊断引擎（找病因）│  处方引擎（开药方） │                   ║
║    └────────────────────┼────────────────────┘                   ║
║                         │                                        ║
║  ┌──────┬──────┬────────┴───┬──────┬──────┐                     ║
║  │  💊  │  🧠  │     🎯     │  💰  │  🛡️  │                     ║
║  │Skill │Memory│   Agent    │ Cost │Secur-│                     ║
║  │Health│Cogni-│  Behavior  │Metab-│ity   │                     ║
║  │      │tion  │            │olism │Immun-│                     ║
║  │技能  │记忆  │   行为     │ 成本  │ity   │                     ║
║  │健康  │认知  │   模式     │ 代谢  │安全  │                     ║
║  │      │      │            │      │免疫  │                     ║
║  └──────┴──────┴────────────┴──────┴──────┘                     ║
║                         │                                        ║
║  ┌──────────────────────┴───────────────────────────────────┐   ║
║  │              📊 Data Collection Layer                     │   ║
║  │         日志 / Session / OTel / 文件系统                   │   ║
║  └──────────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 三、六大科室详细设计

### 3.1 💊 Skill Health（技能健康科）— Phase 1 重点

> "你装的技能到底有没有用？哪些在拖后腿？怎么治？"

**检查项目：**

| 检查项 | 指标 | 健康标准 | 亚健康 | 不健康 |
|--------|------|---------|--------|--------|
| 成功率 | success_rate | > 75% | 50-75% | < 50% |
| Token 效率 | tokens_per_invocation | < P50 同类 | P50-P80 | > P80 |
| 触发精准度 | relevant_trigger_rate | > 80% | 60-80% | < 60% |
| 场景覆盖 | input_type_diversity | > 5 种 | 3-5 种 | < 3 种 |
| 错误恢复 | retry_success_rate | > 60% | 30-60% | < 30% |
| 指令密度 | effective_lines / total_lines | > 70% | 50-70% | < 50% |

**病症库（Skill 常见病）：**

| 病症代号 | 病名 | 症状 | 病因 | 药方 |
|----------|------|------|------|------|
| SK-001 | Token 肥胖症 | 单次调用消耗远超同类 | SKILL.md 过长，未做模块拆分 | 模块瘦身：拆为 core + advanced |
| SK-002 | 场景偏瘫 | 特定输入类型失败率 > 70% | 指令缺少边界条件处理 | 补充 few-shot 示例 |
| SK-003 | 触发失调 | 频繁被误触发或该触发时没触发 | when-to-use 描述模糊 | 重写触发条件 |
| SK-004 | 沉默失败 | 被调用但不产出有效结果 | 错误处理缺失，失败时无反馈 | 添加 guard + fallback |
| SK-005 | 工具链断裂 | tool call 链在固定环节中断 | 工具调用策略不明确 | 显式指定 tool 使用路径 |
| SK-006 | 重复强迫症 | 同 session 内被反复触发 | 缺少完成信号，agent 不知道已完成 | 添加完成确认指令 |
| SK-007 | 僵尸技能 | 安装后长期未被触发 | 触发条件与实际使用场景不匹配 | 重评是否需要 / 调整触发词 |
| SK-008 | 冲突过敏 | 与其他 Skill 同时触发时互相干扰 | 职责边界模糊 | 明确互斥/优先级规则 |
| SK-009 | 上下文溢出 | 加载后占满 context window | 指令过于冗长 | 压缩为关键规则 + 按需引用 |
| SK-010 | 进化停滞 | 反复出现同类错误但从未改善 | 缺少学习反馈机制 | 接入 self-improving 循环 |

**诊疗流程：**

```
体检 (Profile)          诊断 (Diagnose)         治疗 (Evolve)          复查 (Follow-up)
                        
  采集运行数据    →     匹配病症库       →     生成改进方案     →     对比治疗效果
  计算健康指标    →     归因分析         →     展示 Diff       →     更新健康档案
  生成 Skill 档案 →     确定严重等级     →     用户确认应用     →     持续监测
```

---

### 3.2 🧠 Memory Cognition（记忆认知科）— Phase 2

> "你的龙虾记住了什么？忘了什么？记错了什么？"

**检查项目：**

| 检查项 | 描述 |
|--------|------|
| 记忆利用率 | 写入的记忆中，有多少被后续实际检索使用 |
| 记忆新鲜度 | 活跃记忆的平均年龄，是否存在过期未清理的旧记忆 |
| 记忆冲突率 | 不同 session/agent 写入的矛盾信息比例 |
| 记忆召回精度 | 召回的记忆与当前任务的相关性 |
| 记忆膨胀度 | 记忆文件体积增长趋势，是否在不受控增长 |
| 核心文件健康度 | SOUL.md / AGENTS.md / TOOLS.md 的完整性和一致性 |

**典型病症：**
- 记忆失忆症：关键偏好被覆盖或丢失
- 记忆幻觉：记住了从未发生的事情（幻觉内容被写入记忆）
- 记忆肥大：workspace 中积累了大量无用记忆文件
- 记忆分裂：多 Agent 之间记忆不一致

---

### 3.3 🎯 Agent Behavior（行为模式科）— Phase 2

> "你的龙虾做事的方式对不对？有没有坏习惯？"

**检查项目：**

| 检查项 | 描述 |
|--------|------|
| 任务完成率 | 用户下达的任务中，最终成功完成的比例 |
| 平均步骤数 | 完成同类任务所需的 LLM 调用轮次（越少越高效） |
| 工具选择准确率 | 首次选择的 tool 是否正确（vs 需要回退重选） |
| 死循环检测 | 是否存在 agent 反复执行相同动作的循环 |
| Handoff 成功率 | 多 Agent 之间的任务交接是否顺畅 |
| 主动性评分 | Heartbeat/Cron 触发的主动行为的有效率 |

**典型病症：**
- 选择困难症：反复在不同 tool 之间切换，无法决策
- 强迫循环：陷入"执行 → 失败 → 重试 → 失败"的死循环
- 过度服务：用户只需要简单回答，agent 却启动了复杂 workflow
- 交接失忆：sub-agent 接手后丢失关键上下文

---

### 3.4 💰 Cost Metabolism（成本代谢科）— Phase 2

> "你的龙虾一天烧多少钱？钱花在哪了？怎么省？"

**检查项目：**

| 检查项 | 描述 |
|--------|------|
| 日均 Token 消耗 | 按天统计的 token 使用量和趋势 |
| 成本归因（per Skill） | 哪些 Skill 是"烧钱大户" |
| 成本归因（per 任务类型） | 哪类任务花费最高 |
| 缓存命中率 | Prompt caching 的实际利用率 |
| 模型选择合理性 | 简单任务是否被路由到了昂贵模型 |
| 成本异常检测 | 突发的 token 消耗峰值 |

**典型病症：**
- 代谢亢进：token 消耗远超同类配置的 agent
- 奢侈调用：简单任务使用了旗舰模型
- 缓存失效：相似请求反复计算，未利用 caching
- 沉没成本：大量 token 花在了最终失败的任务上

---

### 3.5 🛡️ Security Immunity（安全免疫科）— Phase 2

> "你的龙虾有没有被感染？防御能力怎么样？"

**检查项目：**

| 检查项 | 描述 |
|--------|------|
| 已安装 Skill 安全扫描 | 比对已知恶意 Skill 数据库 |
| 权限暴露面 | Agent 实际拥有的系统权限范围 |
| Sandbox 状态 | 沙箱是否正确配置和生效 |
| 凭据暴露检测 | API key、token 是否出现在日志/记忆中 |
| 网络请求审计 | Agent 发起的外部请求是否都在预期范围内 |
| Prompt Injection 检测 | 输入中是否包含注入攻击痕迹 |

**典型病症：**
- 免疫缺陷：未配置沙箱，权限完全开放
- 寄生感染：安装了恶意 Skill 且已执行
- 凭据泄露：API key 明文出现在日志中
- 注入中招：曾成功被 prompt injection 攻击

---

## 四、横切架构：诊断引擎 + 处方引擎

### 4.1 诊断引擎（Diagnosis Engine）

所有科室共享同一个诊断引擎，统一范式：

```typescript
// 统一诊断接口
interface Diagnosis {
  id: string;                    // "SK-001"
  department: Department;        // "skill" | "memory" | "behavior" | "cost" | "security"
  severity: Severity;            // "critical" | "warning" | "info"
  name: string;                  // "Token 肥胖症"
  symptom: string;               // 症状描述
  evidence: Evidence[];          // 支撑数据（来自 trace/log/file）
  rootCause: string;             // 根因分析
  prescription: Prescription;    // 处方
  relatedDiagnoses: string[];    // 关联病症（跨科室）
}

// 统一证据接口
interface Evidence {
  source: "log" | "session" | "otel" | "file" | "config";
  data: any;
  timestamp: Date;
  confidence: number;            // 0-1 置信度
}

// 统一处方接口
interface Prescription {
  type: "auto" | "guided" | "manual";
  actions: PrescriptionAction[];
  estimatedImprovement: string;   // "预计成功率提升 20-30%"
  risk: "low" | "medium" | "high";
}
```

**跨科室关联诊断（ClawDoc 的独特价值）：**

真实世界中，问题往往跨越多个维度。ClawDoc 的核心能力是把不同科室的发现关联起来：

```
示例：用户反馈"我的龙虾最近变笨了"

Skill Health 发现:
  → web-search-skill 成功率从 80% 降到 45%（SK-002）

Memory Cognition 发现:
  → 3 天前写入了一条错误记忆："优先使用 browser 工具而非 web_search"

Agent Behavior 发现:
  → 同期 browser tool 调用量增加 300%，但超时率 60%

Cost Metabolism 发现:
  → 日均 token 消耗增加 2.3x

ClawDoc 关联诊断:
  ┌────────────────────────────────────────────────────┐
  │ 🏥 综合诊断报告                                     │
  │                                                    │
  │ 病因链: 错误记忆写入 → 工具选择偏移 →               │
  │         Skill 成功率下降 → token 浪费增加           │
  │                                                    │
  │ 根因: Memory 中的一条错误偏好                        │
  │ 处方: 删除该记忆条目 + 在 SOUL.md 中明确             │
  │       工具选择策略                                   │
  │ 预后: 预计 24h 内恢复正常指标                        │
  └────────────────────────────────────────────────────┘
```

---

### 4.2 处方引擎（Prescription Engine）

三级处方体系：

| 级别 | 类型 | 描述 | 用户参与 |
|------|------|------|---------|
| Lv.1 | Auto 自动 | 低风险改进，直接执行 | 事后通知 |
| Lv.2 | Guided 引导 | 中等风险，生成 diff 供确认 | 确认后执行 |
| Lv.3 | Manual 建议 | 高风险/复杂问题，给出建议和方向 | 用户自行操作 |

**处方执行范围：**

| 可改动目标 | 自动(Lv.1) | 引导(Lv.2) | 建议(Lv.3) |
|-----------|------------|------------|------------|
| SKILL.md 指令优化 | — | ✅ | — |
| 模块拆分/合并 | — | ✅ | — |
| 触发条件重写 | — | ✅ | — |
| 记忆条目修正 | — | ✅ | — |
| SOUL.md / AGENTS.md | — | — | ✅ |
| 模型配置调整 | — | — | ✅ |
| Sandbox / 权限配置 | — | — | ✅ |
| 已安装 Skill 的卸载 | — | — | ✅ |

---

## 五、数据层：统一采集框架

```typescript
// 所有科室共享的数据采集层
interface DataCollector {
  // 被动采集（读取已有数据）
  parseLogs(path: string): AgentEvent[];
  parseSessions(path: string): Session[];
  parseSkills(path: string): SkillManifest[];
  parseMemory(path: string): MemoryEntry[];
  parseConfig(path: string): OpenClawConfig;

  // 主动采集（OTel 集成，可选）
  consumeTraces?(endpoint: string): TraceSpan[];
}

// 统一事件模型
interface AgentEvent {
  timestamp: Date;
  agentId: string;
  sessionId: string;
  eventType: EventType;

  // Skill 相关
  skillId?: string;
  skillTriggerReason?: string;

  // Tool 相关
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  toolDuration?: number;

  // LLM 相关
  model?: string;
  inputTokens?: number;
  outputTokens?: number;

  // 结果
  success: boolean;
  errorMessage?: string;
}
```

**数据源优先级：**

```
优先级 1: 本地日志文件（零配置，最低门槛）
  ~/.openclaw/logs/gateway.log
  ~/.openclaw/sessions/*

优先级 2: OpenClaw 内置 OTel（需用户开启 diagnostics.otel）
  更丰富的 span 数据，包含 tool call 细节

优先级 3: ClawDoc 专属采集（未来可选）
  更精细的 Skill 级别埋点
```

---

## 六、用户交互设计

### 6.1 CLI 命令体系

```bash
# ══════════════════════════════════
#  全科体检（一键全量）
# ══════════════════════════════════
clawdoc checkup                    # 全科体检，输出综合健康报告
clawdoc checkup --focus skill      # 聚焦某个科室
clawdoc checkup --since 7d         # 指定时间范围

# ══════════════════════════════════
#  分科检查
# ══════════════════════════════════
clawdoc skill list                 # 列出所有已安装 Skill 的健康状态
clawdoc skill profile <name>       # 单个 Skill 的详细档案
clawdoc skill diagnose <name>      # 诊断单个 Skill
clawdoc skill evolve <name>        # 为 Skill 生成改进方案
clawdoc skill compare <v1> <v2>    # A/B 对比两个版本

clawdoc memory scan                # 记忆健康扫描
clawdoc agent analyze              # Agent 行为分析
clawdoc cost report                # 成本报告
clawdoc security audit             # 安全审计

# ══════════════════════════════════
#  处方管理
# ══════════════════════════════════
clawdoc prescriptions              # 查看所有待处理处方
clawdoc prescriptions apply <id>   # 应用某条处方
clawdoc prescriptions rollback <id># 回滚某条已应用的处方
clawdoc prescriptions history      # 处方执行历史

# ══════════════════════════════════
#  持续监测
# ══════════════════════════════════
clawdoc monitor                    # 后台常驻，持续监测健康指标
clawdoc monitor --alert telegram   # 异常时推送告警
clawdoc dashboard                  # 启动本地 Web Dashboard
```

### 6.2 体检报告示例

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🏥 ClawDoc 综合体检报告                                     ║
║   Agent: main | 检查时间: 2026-03-16 14:30                   ║
║                                                              ║
║   综合健康评分: 64/100  ⚠️ 亚健康                             ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║   💊 Skill Health          72/100  ████████░░  良好           ║
║      12 Skills 已安装 | 2 个需要关注                          ║
║      › SK-002 web-search-skill 成功率偏低 (45%)              ║
║      › SK-001 code-review-skill Token 消耗过高               ║
║                                                              ║
║   🧠 Memory Cognition      58/100  ██████░░░░  一般           ║
║      记忆文件 47 个 | 12 个过期 | 2 个冲突                    ║
║      › 发现 1 条可疑错误记忆（与 Skill 失败关联）             ║
║                                                              ║
║   🎯 Agent Behavior        71/100  ████████░░  良好           ║
║      任务完成率 78% | 平均 4.2 步/任务                        ║
║      › 检测到 1 个潜在死循环模式                              ║
║                                                              ║
║   💰 Cost Metabolism        55/100  ██████░░░░  一般           ║
║      7日花费 $18.40 | 日均 ↑23% (vs 上周)                    ║
║      › 67% 花费集中在 2 个 Skill                             ║
║                                                              ║
║   🛡️ Security Immunity     82/100  █████████░  良好           ║
║      Sandbox: ON | 已知漏洞: 0                               ║
║      › 1 个 Skill 请求了不必要的网络权限                      ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║   📋 处方单 (3 条)                                            ║
║                                                              ║
║   [Lv.2] RX-001 修复 web-search-skill 场景偏瘫              ║
║          预计成功率 +25pp | 运行 clawdoc prescriptions        ║
║          apply RX-001                                        ║
║                                                              ║
║   [Lv.2] RX-002 清理 12 条过期记忆                           ║
║          预计释放 context 空间 ~3,200 tokens                  ║
║                                                              ║
║   [Lv.3] RX-003 建议调整模型路由策略                          ║
║          简单任务切换到轻量模型可节省约 40% 成本               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 七、技术架构

```
┌────────────────────────────────────────────────────────────────┐
│                      ClawDoc CLI / Dashboard                   │
└───────────────────────────┬────────────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────────────┐
│                      Orchestrator 编排层                        │
│                                                                │
│   checkup() → 按科室并行执行 → 收集结果 → 关联分析 → 报告生成   │
└───────────────────────────┬────────────────────────────────────┘
                            │
        ┌───────┬───────┬───┴───┬───────┬───────┐
        │       │       │       │       │       │
   ┌────▼──┐┌──▼───┐┌──▼───┐┌──▼───┐┌──▼───┐   │
   │ Skill ││Memory││Agent ││ Cost ││Secur-│   │
   │Health ││Cogni-││Behav-││Metab-││ity   │   │
   │Module ││tion  ││ior   ││olism ││Immun-│   │
   │       ││Module││Module││Module││ity   │   │
   └───┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───┘   │
       │       │       │       │       │        │
   ┌───▼───────▼───────▼───────▼───────▼───┐    │
   │         Diagnosis Engine               │    │
   │  rules[] → match → evidence → RCA      │    │
   └───────────────┬───────────────────────┘    │
                   │                             │
   ┌───────────────▼───────────────────────┐    │
   │         Prescription Engine            │    │
   │  diagnoses → plan → diff → apply       │    │
   └───────────────┬───────────────────────┘    │
                   │                             │
   ┌───────────────▼───────────────────────┐    │
   │         Cross-Department Linker        │    │
   │  跨科室关联分析：发现因果链             │    │
   └───────────────────────────────────────┘    │
                            │                    │
┌───────────────────────────▼────────────────────┘
│                    Data Layer                    │
│                                                 │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │  Unified  │ │  SQLite  │ │  Health        │  │
│  │  Collector│ │  Store   │ │  History       │  │
│  │          │ │          │ │                │  │
│  │  Logs    │ │ events   │ │ 每次体检结果   │  │
│  │  Sessions│ │ metrics  │ │ 处方执行记录   │  │
│  │  OTel    │ │ diagnoses│ │ 趋势数据      │  │
│  │  Files   │ │ prescrip.│ │               │  │
│  └──────────┘ └──────────┘ └────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 语言 | TypeScript (Node.js) | 与 OpenClaw 生态一致 |
| 存储 | SQLite (better-sqlite3) | 零依赖，本地优先 |
| CLI | Commander.js + Ink | 丰富的终端 UI |
| Dashboard | 内嵌 Hono server + 静态前端 | 轻量零依赖 |
| LLM 调用 | 复用 OpenClaw 的 model 配置 | 无需额外 key |
| 分发 | `npx clawdoc` | 一行命令即用 |

---

## 八、开发路线图

### Phase 1: Skill Health 做深做透（Week 1-6）

```
Week 1-2: 地基
  ├── 数据采集层（日志解析 + session 解析）
  ├── 统一事件模型 + SQLite schema
  ├── Skill 识别与关联
  └── clawdoc skill list 命令

Week 3-4: 诊断
  ├── Skill Profiler（6 项健康指标计算）
  ├── 10 条 Skill 病症规则实现
  ├── 诊断报告生成
  ├── clawdoc skill profile / diagnose 命令
  └── Quality Score 算法

Week 5-6: 进化 + 发布
  ├── LLM-based Skill 改进生成（3 种策略）
  ├── Diff 展示 + 确认 + 回滚
  ├── 体检报告（Skill 单科版）
  ├── clawdoc checkup --focus skill
  ├── README / 文档 / Demo
  └── npm 发布 + 社区首发
```

### Phase 2: 全科扩展（Month 2-4）

```
Month 2: Memory Cognition + Cost Metabolism
Month 3: Agent Behavior + Security Immunity  
Month 4: Cross-Department Linker + 综合体检报告
```

### Phase 3: 生态化（Month 5-8）

```
Month 5-6: 持续监测 + Web Dashboard
Month 7-8: 社区 Skill Quality Index + Marketplace 集成
```

---

## 九、命名与品牌

### 推荐名称：ClawDoc

| 维度 | 说明 |
|------|------|
| 含义 | Claw (龙虾) + Doc (Doctor / Document) |
| 读音 | /klɔːdɒk/ 简洁好记 |
| 调性 | 专业可信赖，像一个真正的医生 |
| 扩展性 | 不局限于 Skill，天然覆盖"全科诊断"的定位 |
| 生态感 | Claw 前缀与 OpenClaw / ClawHub 同族 |
| CLI | `clawdoc checkup` 读起来很自然 |

### Slogan 候选

- **"Keep your lobster healthy."**
- **"The doctor your agent deserves."**
- **"你的龙虾，该体检了。"**

### Logo 概念

一只龙虾戴着听诊器，或者一个龙虾钳子形状的医疗十字。
简洁、有辨识度、自带传播属性。

---

## 十、成功标准

### Phase 1 发布后 30 天

| 指标 | 目标 |
|------|------|
| GitHub Stars | 500+ |
| npm weekly downloads | 1,000+ |
| 社区 Issue/Discussion | 30+ |
| "clawdoc" 被博客/推文提及 | 5+ |

### 6 个月

| 指标 | 目标 |
|------|------|
| GitHub Stars | 5,000+ |
| 全科体检能力完整上线 | 5/5 科室 |
| 社区贡献的诊断规则 | 20+ |
| 被 OpenClaw 官方/生态项目引用 | ≥ 1 |
