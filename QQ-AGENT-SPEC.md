# QQ 机器人在 huoli-core 上的实现规范

> 状态：施工依据。所有条目都能被代码或命令复核；不可复核的条款不写进来。
> 底座：`huoli-core`（自有内核，386 个包，可编译可启动）。
> 本文取代此前所有"按文件名归类"的重构设想。

---

## 0. 这份文档解决什么

一句话：**把"要不要说"从 6 处代码判断收成 1 次模型判断，把状态从内存搬进事件日志。**

三条硬约束贯穿全文：

1. 模型是唯一裁决者。代码只给事实、只做否决。
2. 模型可见的必须落日志。进程内变量不算状态。
3. 一个概念一处定义。同一个"该不该说"不许有两个实现。

---

## 1. 四层职责

| 层 | 归谁 | 只做 | 绝不做 |
|---|---|---|---|
| 记录 | 内核 session | 追加事件、可回放 | 判断、衰减 |
| 压缩 | 内核 compaction | 腾地方、摘要 | 遗忘（它只是遮蔽） |
| 大脑 | 内核 agent-loop + system-prompt | 驱动步循环、组装提示词 | 决定说不说 |
| 身体 | 我们的 qq 包 | 看/等/划走/收尾/唤醒、发消息、记账 | 打分、投票 |

**判据**：任何一行代码，若它的返回值形如 `shouldSpeak`、`probability`、`score >= threshold`，就属于越界。

---

## 2. 注意力机制

### 2.1 现状：一次入站要过 7 层

旧实现（`composition-root.js` 的 `ingestMessage`）的真实链路：

| 层 | 位置 | 拦什么 | 定向能否绕过 |
|---|---|---|---|
| ① 去重与黑名单 | `4635`、`4650-4660` | 重复 mid、全局/群黑名单 | 否 |
| ② 召唤分级 | `4748-4762`、`4841-4850` | `atMe`、`classifySummon` 三级 | — |
| ③ 机会裁决 | `4884` `modeService.opportunity` | ordinary 打分＋滞回阈值、mentionRule、冷却 | 是 |
| ④ 入场闸 | `4898-4927` `ingressGateway.submit` | 合并窗口、环境配额、全局预算 | 是 |
| ⑤ 自身状态闸 | `4991`、`5005`、`5067` | selfQuiet、自述睡眠、coreStateGate | 部分 |
| ⑥ 串行锁 | `5085-5104` | 同发送者处理中 | 否 |
| ⑦ 内核判决 | `5200` → `5237` | `shouldCallModel` | 否 |

### 2.2 问题：同一个判断有 6 个实现

| 判断点 | 文件 | 输出 |
|---|---|---|
| 召唤分级 | `summon-signal.js` | hard / weak / none |
| 上下文档位 | `prompt.js:790` | tier + `shouldRespond` 布尔 |
| 机会裁决 | `modes/decision.js:45` | 打分＋阈值布尔 |
| 入场闸 | `ingress/actor.js` + `gateway.js` | admit 布尔 |
| 群情门 | `proactive-grounding.js:26` | allow 布尔 |
| 主动现场 | `speech-occasion.js` | `canSpeak` 布尔 |

其中打分公式（`modes/decision.js:121-131`）是纯代码替模型做决定的实体：

```
composite = (admission×w + context×w + relational×w + drive×w + quota×0.06) × energyFactor
allowed   = composite >= threshold（滞回 0.52 / 0.42）
```

**这条公式必须消失**：它把"这条消息值不值得回"压成一个数，而那个判断本应由模型看着上下文做。

### 2.3 目标：收成三个文件

| 文件 | 职责 | 对外 |
|---|---|---|
| `attention/state.ts` | 注意力事实 | `readAttention` / `applyRead` / `applyClose` / `applyWake` / `noteFocus` |
| `attention/select.ts` | 只产事实与候选 | `collectSignals()` → 事实对象，**永不返回布尔** |
| `attention/tools.ts` | 五个动作 | 五个 `defineTool` |

`collectSignals` 的形状（不给结论，只给事实）：

```ts
{
  directed: { at: boolean; poke: boolean; isPrivate: boolean; replyToBot: boolean },
  ambient: { humanCount: number; lastHumanAgeMs: number | null; speakingRate: number },
  addressee: { named: boolean; confidence: number; evidence: string[] },
  novelty: { newTopic: boolean; repeated: boolean },
  fun: { score: number; evidence: string },
  fatigue: { level: number; reason: string },
  candidates: [{ kind: 'reply' | 'join' | 'observe' | 'wait' | 'close', why: string, weight: number }]
}
```

**`candidates` 是给模型看的建议，不是决定。** 代码不许因为它为空就拦下。

### 2.4 五工具契约

| 工具 | 参数 | 返回 | 不变量 |
|---|---|---|---|
| `read_messages` | `afterSeq?` `limit?` | `messages[]` `readThroughSeq` `partial` | 水位是**读到的最后一条**，不是总数 |
| `wait_for_messages` | `purpose` `timeoutMs?` `quietMs?` | `newMessages[]` `quietReached` `timedOut` | 超时不是错误；取消与超时必须可区分 |
| `mark_read` | `throughSeq` | `readThroughSeq` | 必须显式传水位；水位只前进；不传不许自标最新 |
| `close_conversation` | `summary?` `nextOpening?` `throughSeq?` | `closedAt` `closeSummary` | 两个字段都空则拒绝；对方在提问时拒绝收尾 |
| `set_wake_config` | `infinite?` `sleepMs?` `triggers?` `throughSeq?` | `wakeMode` `wakeUntil` `triggers` | 先校验参数再改状态；校验失败不许留半截 |

触发器字段名固定为：`atMention` `nameMention` `question` `poke` `anyMessage` `probability` `speakerIds`。

### 2.5 状态必须落事件

**禁止**用进程内 `Map` 存注意力状态。重启即丢，且违反"模型可见必落日志"。

正确做法：定义会话事件，用投影折叠出状态。

```ts
declare module '@huoli/huoli-session/types' {
  interface SessionEventMap {
    'qq/attention-read': { chatKey: string; throughSeq: number }
    'qq/attention-close': { chatKey: string; summary: string; nextOpening: string }
    'qq/attention-wake': { chatKey: string; mode: 'infinite' | 'timed'; until: number | null; triggers: WakeTriggers }
  }
}
```

投影单元契约（内核 `session-projection` 的注册面）：

```ts
ctx.sessionProjections.register({
  key: 'qq-attention',
  stateSchema,      // 校验折叠结果
  stateVersion: 1,
  init: () => initialAttention(),
  apply(state, event) => nextState,   // 纯函数，无关事件返回同一个引用
})
```

**投影是只读的**：要改状态，发事件，不要改投影的内存对象。

### 2.6 禁止事项

1. 不许在工具里再判一次"该不该说"（`ctx.speakTier` 这类反模式）。
2. 不许用 `[SILENT]` 文本约定表达沉默——沉默就是不调发送工具。
3. 不许把 `readThroughSeq` 当总数用（旧实现踩过：一次 `mark_read` 吞掉未返回的消息）。
4. 不许在 `wait` 里用"当前长度"做起算点（旧实现踩过：read 与 wait 之间到达的消息丢失）。

---

## 3. 决策权威

### 3.1 代码可以决定的四类

只有四类，且都必须可枚举、可测试：

| 类 | 例子 | 返回形状 |
|---|---|---|
| 白名单与权限 | 群/人清单、越权工具 | `{ ok:false, code, hint }` |
| 频控与额度 | 每分钟条数、每日成本 | 同上，必须带 `retryAt` |
| 内容合规 | 敏感词、长度上限 | 同上 |
| 安全时段 | 静默窗口、自述睡眠 | 同上，带"下次何时" |

### 3.2 代码不许决定的一件事

**"这条消息值不值得回"。** 它不是一个阈值问题，是模型看着上下文做的判断。

### 3.3 要删的遗留打分器

| 文件 | 行 | 处置 |
|---|---:|---|
| `behavior/modes/decision.js` `evaluateOrdinaryDecision` | 154 | 删。它的输出改为 `collectSignals` 的事实字段 |
| `behavior/decision/heartbeat-decider.js` | 161 | 删。心跳改为"定期把事实塞给模型" |
| `behavior/decision/worth-replying.js` | 73 | 删 |
| `behavior/decision/reply-likelihood.js` | 51 | 删 |
| `behavior/decision/fun-score.js` | 71 | 降级为 `fun.evidence` 事实 |
| `behavior/decision/speech-occasion.js` | 193 | 拆：现场事实进 `collectSignals`，结论删 |
| `behavior/decision/attention-budget.js` | 149 | **保留但改名改义**：它只管"该不该抬眼/判情绪"，不参与回复裁决 |

> 注：`attention-budget` 的现有消费点只有 `runSemanticLook`（`1880-1882`）与 `queueAffectAppraisal`（`1802-1804`），**从没参与过回复裁决**。重构时要保住这个边界。

---

## 4. 身体：工具面

### 4.1 分层

| 层 | 来源 | 内容 |
|---|---|---|
| 通用手 | 内核已有 | 文件、shell、LSP、终端、子进程、搜索、浏览器、电脑操作、子代理、任务、定时、待办、计划、目标、MCP |
| 注意力 | `qq-attention` | 五个动作 |
| 嘴和耳 | `qq-channel` | `send_message` / `send_reaction` / `send_image` / `recall_message` + 入站 push |
| 记账 | `qq-pacing` | 额度、连发上限、拆句、间隔 |

### 4.2 工具定义规范

- 描述是**行为契约**，写清何时用、何时别用、失败怎么办，**≤200 字**。
- 参数用 JSON Schema，`required` 必须真实。
- `output.schema` 必须带 `additionalProperties`，否则类型不通过。
- 禁止在描述里写"调用成功后请汇报"——模型不该复述动作。

### 4.3 失败码规范

```ts
{ ok: false, code: 'gate.quota', error: '今日额度用完', hint: '明天 08:30 后恢复' }
```

- `code` 点号分层、机器读；`error` 人读；`hint` 下一步。
- **失败必须走内核的工具错误通道**，不能把 `{isError:true}` 当普通返回值——内核会把它当成成功 value 再渲染。

---

## 5. 大脑：loop 与提示词

### 5.1 步循环

```
一轮 = 模型请求 → 流式响应 → 工具执行 → 落历史
组件链：agent-loop → system-prompt → tools → session
扩展点：agent/pre-step（准入）、agent/turn-stopping（收尾）
```

### 5.2 状态进提示词

```ts
ctx.systemPrompt.section({ name: 'qq:self', order: 320, text: '【此刻的我】{{self_snapshot}}' })
ctx.systemPrompt.variable({ name: 'self_snapshot', resolve: () => renderSelfSnapshot(state) })
```

渲染受 `maxChars` 约束（建议 300），禁止把状态对象 JSON 化塞进提示词。

样例：

```
【此刻的我】心情 偏低（28%）｜精力 82%｜无聊 64%｜想说话 71%
对 阿澈：熟人（熟悉度 58%）
心里还惦记着：他说周末要开黑，我还想问是哪个游戏
```

### 5.3 轮次闸：内核的已知缺口

内核 README 明写 **No built-in turn budget**，工具调用能把一轮无限拉长。必须在 `agent/turn-stopping` 自建：

```
maxSteps = 40     超限 → 停轮并记 trace
maxRepeatedErrors = 3   同工具同错误重复 → 停轮
预期拒绝（频控/额度/权限/参数）不计入重复错误
```

---

## 6. 压缩

### 6.1 机制真相

| 事实 | 证据 |
|---|---|
| 压缩**不在内核**，是插件 `compaction-basic` 监听三个扩展点 | `packages/core` 内无 `ctx.compaction` 调用 |
| 阈值只有 token：`min(W×0.8, (W−O)−65536)` | `compaction-basic/src/config.ts:191-194` |
| 压缩只遮蔽，不删除；原文仍在日志 | `surfaceOp: replace` |
| 摘要提示词写死工程口吻且未导出 | `summarizer.ts:32-67` |
| **没有时间语义**：`deriveEventMessage` 丢弃 `event.time` | 压缩层帮不了"记得住 3 天前" |

### 6.2 QQ 场景要改的四项

| 项 | 现状 | 改法 |
|---|---|---|
| 摘要口吻 | coding assistant + 8 段工程模板 | 覆写 `summarize()`，改成"谁说了什么/时间/待办" |
| 保留尾 | 只有 16% 比例 | 群聊需要"最近 N 轮"逐字保留 |
| 中文 token 低估 | 固定 4 字符/token | 调 `thresholdRatio` 补偿 |
| 摘要成本 | 每次一次模型调用 | 路由到便宜小模型 |

### 6.3 正确做法

**不改 `compaction-basic` 的分支**，另写 backend 复用它的 `selectCompactableRange` / `compactSurfaceRegion`。

---

## 7. 记录与记忆

### 7.1 记录不能当记忆

| 记忆必需 | 记录系统 |
|---|---|
| 重要度 | 无（schema 无列，全包 grep 零命中） |
| 衰减/遗忘 | 无（compaction 只是遮蔽，无删除 API） |
| 清晰度 | 无（无 embedding、无置信度） |
| 相关度 | 只有 FTS5 确定性排序，无分值 |

### 7.2 事件模型

- 基础事件 14 个，模型可见严格 5 类：`system/message` `developer/message` `user/message` `assistant/message` `tool/result`。
- 自定义事件用 `declare module '@huoli/huoli-session/types'` 合并。
- 追加契约：`seq = log.length`，seed 从 0 连续，禁止重入。

### 7.3 记忆独立域

`qq-memory` 独立成包，不改 session 语义：

```
remember(entry)  → 写入时就算 importance
promote(entry)   → 每轮调用一次，四层真的晋升
recall(query)    → 时间 + 关键词 + 向量
decaySweep(now)  → 每天一次，按 qq-policy 的统一半衰期表
```

清晰度五档：`vivid(≥68)` `clear(≥46)` `fuzzy(≥24)` `trace(≥12)` `forgotten`，**一次只降一档**。

---

## 8. 工程约束

### 8.1 包结构

```
packages/qq/
├── qq-attention/   注意力状态机与五工具
├── qq-pacing/      额度与节奏
├── qq-material/    素材（说什么）
├── qq-subject/     状态（护城河）
├── qq-memory/      四层记忆
├── qq-policy/      唯一衰减表
├── qq-proactive/   主动性
├── qq-continuity/  收尾与复盘
└── qq-channel/     QQ 收发
```

包名规则：目录名 = 包名去掉 `@huoli/huoli-` 前缀（`qq-attention` ↔ `@huoli/huoli-qq-attention`）。

### 8.2 门禁

| 命令 | 要求 |
|---|---|
| `tsc -b tsconfig.host.json` | 退出码 0 |
| `pnpm run build` | 10 个 gate 全 PASS |
| `pnpm run build:check` | 2 个 gate 全 PASS |
| 新增包 | 在 `tsconfig.host.json` 加 reference，跑 `gen-tsconfig-paths` |

### 8.3 提交纪律

- 一个阶段一次提交，提交信息写"做了什么 + 为什么"。
- 工作树必须干净再进入下一阶段。
- 每个阶段留一份回滚说明。

---

## 9. 落地顺序

| 序 | 做什么 | 验收 |
|---|---|---|
| 1 | ✅ `qq-policy`：唯一衰减表 | 已落地：12 类半衰期 + 16 维松弛 + 保留度与五档清晰度，全仓唯一 |
| 2 | ✅ `qq-attention` 重写：状态落盘 + 五工具 + `collectSignals` | 已落地：12 项行为验证全过（水位不吞消息、wait 起点快照、取消与超时分离） |
| 3 | `qq-subject` + `snapshot` 接 system-prompt | 每轮提示词出现"此刻的我"，≤300 字 |
| 4 | `qq-memory` 四层 + 五档 | 能召回 3 天前的事 |
| 5 | `qq-pacing` + `qq-material` | 拆句、间隔、额度生效 |
| 6 | `qq-proactive` + `qq-continuity` | 主动开口带 preview 与理由 |
| 7 | `qq-channel` 接 OneBot | 真机一条消息走通 |
| 8 | 压缩 backend + 轮次闸 | 长会话不被截断、不跑飞 |

**前 3 步做完，"像个人"的地基就有了；第 7 步才接真 QQ。**

---

## 10. 证据索引

| 结论 | 证据 |
|---|---|
| 7 层裁决链 | `composition-root.js:4583-5334` |
| 打分公式 | `behavior/modes/decision.js:121-131` |
| 群情门 | `behavior/decision/proactive-grounding.js:26-60` |
| 注意力预算的真实作用 | `composition-root.js:1802-1804`、`1880-1882` |
| 注意力预算不参与回复裁决 | 全仓 `shouldLook` 只有两处调用，均在模型观察路径 |
| 五工具在旧代码零命中 | `wakeConfig`/`readThroughSeq`/`markWait` 类标识在 `src/` 无定义 |
| 内核无轮次预算 | `packages/core/agent-loop/README.md` Known Limitations |
| 压缩不在内核 | `packages/core` 无 `ctx.compaction` 调用 |
| 记录无重要度/衰减 | `session-*` 包 schema 与 grep |
| 投影契约 | `packages/session/session-projection/src/index.ts:85-130` |
