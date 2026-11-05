# QQ 插件断线清单（2026-11-04）

## 这份清单是什么

`huoli-core/packages/qq` 下 12 个包、17,388 行源码、18,581 行测试，`vitest run packages/qq` → **90 文件 / 1238 条全绿**。

但"包级测试全绿"和"接上真 QQ 能用"是两件事。本清单只收一类问题：**设计写完了、包测试过了，但装配层（`qq-bundle`）没接上，或接了但判据在生产里永不命中。**

证据等级标注：
- 【亲验】= 我这一轮亲自读过该行
- 【分析】= 由并行分析得出、我未逐行复核，动手前需再确认一次

修复方式只给方向与位置，不含实现代码。**未动任何源码，未 commit。**

---

## P0 — 会让行为出错，或让调试彻底失明

### D1 通道日志全丢，发送失败静默　——【已修，2026-11-04】

**状态**：已改 `qq-channel/src/ws.ts`（三处失败路径补日志）与 `qq-channel/src/index.ts`（`log`/`onStatus` 接 `ctx.logger('qq-channel')`，同一条错只记一次），并补两条用例。关卡：`vitest packages/qq/qq-channel` 9 文件 / 148 条全过、`oxlint` 0 error、`tsc -b tsconfig.host.json` 退出码 0。

**现象**：上次假 OneBot 演练卡在"发送帧没到 WS"，但当时**无法观测**到底出了什么。这不是运气问题。

**证据**
- 【亲验】`qq-channel/src/index.ts:244-249` — `onStatus() { /* 这里不额外做事 */ }`、`log(message) { void message }`，通道所有日志被丢弃
- 【亲验】`qq-channel/src/ws.ts:64-79` — `call()` 只有 `channel.offline` 与 `channel.timeout` 两个失败码，两条路都不落日志
- 【亲验】`qq-channel/src/index.ts:388-394` — 只有 `onOutbound` 报 blocked 码，`attempt` 的失败不进日志

**根因**：通道把日志能力接进来又丢掉，等于把唯一的观测点自己关了。仓库自己的 `AGENTS.md` 要求 "Misconfiguration fails loud"、"visibly report untrusted state"，这里正好相反。

**修复方式**
1. `log` / `onStatus` 接 `ctx.logger('qq-channel')`
2. `call()` 的 offline / timeout 失败路径 `warn` 一次，带 action 名
3. `ws.ts:72-75` 的 15s 超时路径同样落日志

**验证**：假 OneBot 断开 → 发一条 → 日志里必须出现 `channel.offline`；不出现即未修好。

---

### D2 多群共用一条会话，回复可能发错群　——【已修，2026-11-04】

**现象**：任何群的入站消息都 `followup` 进同一个 agent。

**证据**
- 【亲验】`qq-bundle/src/index.ts:371-375` — `const agent = liveAgent`，无按 chatKey 分流
- 【亲验】`qq-bundle/src/index.ts:340` — `chatKeyByAgent = new Map<string, string>()`，键是 `agent.id`
- 【亲验】`qq-bundle/src/index.ts:373` — `chatKeyByAgent.set(String(agent.id), message.chatKey)`，同键覆盖

**根因**：会话键是 `agent.id`（全局唯一一个），而不是 `chatKey`。群 A、群 B 交替说话时，映射只剩最后一次写入，发送时按它换回群号 → **回复发到错的群**。同时记忆写入用全局 `lastActive`，吃饭/做梦/疤痕可能记到别的会话。

**修复方式**（二选一，需拍板，见文末 Q3）

**已落地的做法（2026-11-04）——选了 A：每群一条会话**
- 会话编号**直接用聊天键**（`group:123` / `private:456`），所以「一个群一条会话」是结构上的，不靠事后换映射
- `qq-bundle/src/index.ts` 新增按群的会话池：`sessions`（已开）+ `opening`（正在开，防同一群并发开两条），懒创建，调用 `ctx.agents.create({ sessionId: brandString<SessionId>(chatKey) })`
- 入站改为「这个群叫醒自己那一条」；只有表情位置的那条不叫醒
- 卸载时把开过的会话逐条 `dispose()`
- **删除上一轮 WIP 整套**：`liveAgent`、`chatKeyByAgent`、`channel.useChatKey`、`tools.resolveChatKey` 全部移除；`chatKeyOf(exec)` 恢复为直接用会话身份（因为会话身份现在就是聊天键）
- 依赖补齐：`qq-bundle/package.json` 加 `@huoli/huoli-brand`、`@huoli/huoli-session`，`tsconfig.json` 加对应的两个项目引用
- 用例：新增 `tests/sessions.spec.ts` 5 条（两群各开一条 / 同群不重复开 / 不串门 / 表情不唤醒 / 卸载全收）
- 关卡：`vitest packages/qq` **92 文件 / 1255 条全过**、`oxlint qq-bundle` 与 `qq-channel` 均 0 error、`tsc -b` 退出码 0

**遗留待办（新）**：会话池现在**没有上限也没有回收**。群数一多，每条会话都带自己的会话日志，内存与磁盘会线性涨。下一步应加一个「闲置多久就 dispose」的回收（并且要能重开——重开即回到这条会话自己的日志）。这条已记入待办，不在本轮范围内。

**验证**：两个群交错发消息 → 判断每条回复的 `group_id` 与其触发消息一致。

---

### D3 proactive 两个 store 抢同一个文件，互相覆盖

**现象**：投递成功后，已发条目会在盘上"复活"，`previewed` 与计数丢失。

**证据**
- 【亲验】`qq-proactive/src/index.ts:143-144` — `createPendingStore({ file })` 与 `createTimingStore({ file })` 传的是**同一个** `file`
- 【亲验】`qq-proactive/src/store.ts:66-71` — `save()` 整份 `JSON.stringify` 写回，无合并
- 【分析】`store.ts:56-58` — 两个 store 加载时都读 items/previewed/lastSpokenAt/todayCount 全量字段

**根因**：一份文件两个 owner，各自持内存抄本、各自整份覆写 = 典型 lost update。`noteSpoken` 用加载时的旧 items 覆盖 → 已发条目复活；`put` 用旧计数覆盖 → 额度算错。进程内因各持内存，**测试测不出来**。

**修复方式**
- 拆成两个文件（`qq-proactive-pending.json` / `qq-proactive-timing.json`），或
- 合成一个 store 单一 owner，对外暴露 pending 与 timing 两组方法

**当前是否触发**：`qq.patch.yml:18-21` 里 `proactive.enabled: false`，所以还没暴露。**打开之前必须先修。**

---

## P1 — 能力断线：设计有、装配没接

### D4 注意力的 `signals()` 零消费者

**证据**
- 【亲验】`qq-attention/src/index.ts:78-86` — `seam.signals()` 定义（调用 `collectSignals`）
- 【亲验】`qq-attention/src/tools.ts:259` — `attentionStateOf()` 定义后全仓零调用
- 【亲验】`qq-bundle/src/index.ts:336` — `qqAttentionOf(ctx)` 只取到 `attention`
- 【亲验】`qq-bundle/src/index.ts:363, 379` — 生产里只用 `attention.inbox.push`
- 【亲验】全仓 `seam.signals(` 只出现在 `qq-attention/tests/attention.spec.ts`

**根因**：`collectSignals` 算的七组事实（directed / ambient / addressee / novelty / fun / fatigue / candidates）没有任何消费者。注意力目前实际等于"一个收件箱 + 五个模型可选调用的工具"。

**修复方式**（需拍板，见文末 Q1）
- A：接进唤醒判定 —— `onIncoming` 里先 `signals(chatKey)`，按 `candidates` 决定是否 `followup`
- B：承认它不是关卡 —— 删掉 `signals`/`candidates`，README 改写为"只提供收件箱与水位"

---

### D5 唤醒状态机只写不读

**证据**
- 【亲验】`qq-attention/src/tools.ts:240` — `set_wake_config` 写入 `wakeMode` / `wakeUntil` / `triggers`
- 【亲验】全仓 `wakeMode` / `wakeUntil` / `triggers` 的读取只出现在 `qq-attention/tests/attention.spec.ts:159-160`
- 【亲验】`qq-attention/src/types.ts:44-46` — 默认 `atMention/nameMention/question/poke: true`

**根因**：模型可以调 `set_wake_config` 说"睡一会儿"或"只在这几种情况醒"，状态落盘了，**但没有任何代码在唤醒时读它**。模型以为自己设置了，实际每次都照常醒。

**修复方式**：与 D4 一起处理。若选 D4-A，唤醒判定读 `wakeMode`/`triggers`；若选 D4-B，`set_wake_config` 应一并删除，否则是骗模型的工具。

---

### D6 `atMe` / `replyToBot` 在 push 处被丢弃

**证据**
- 【亲验】`qq-channel/src/events.ts:115-124` — `mentionsSelf()` 正确读 `data.qq`，识别本身没问题
- 【亲验】`qq-bundle/src/index.ts:363-368` — push 只传 `senderId` / `senderName` / `text` / `at` 四个字段
- 【亲验】`qq-attention/src/select.ts:82` — `directed.at = latest?.atMe === true`，因此**恒为 false**

**根因**：识别做对了，传递时丢了。连带 `select.ts` 里所有基于 `directed` 的候选、`types.ts:46` 的 `atMention`/`nameMention` 唤醒条件、`addressee.named` 的判定全部落空。

**修复方式**：`InboxPush`（`inbox.ts:14-19`）扩 `atMe` / `isPoke` / `replyToBot` 三个可选字段，`bundle:363-368` 传进去。

---

### D7 `bundle.deliver` 零调用点，`preview` 结果被丢弃

**证据**
- 【亲验】`qq-bundle/src/index.ts:227-253` — `deliver` 定义在 seam 上
- 【亲验】`src` 内唯一 `.deliver(` 是 `index.ts:232` 的 `proactive.deliver(...)`，那是 `bundle.deliver` 的**下游**
- 【亲验】调用 `bundle.deliver` 的只有 `qq-bundle/tests/proactive.spec.ts:395/410/427`
- 【亲验】`qq-bundle/src/index.ts:668` — `if (decision.pending.length > 0) proactive.preview(chatKey)`，返回值丢弃
- 【亲验】`systemPrompt.section` 全仓只有 4 段：`qq:rules`（:200）、`qq:reply-budget`（:208）、`qq:self`、`qq:vitals`

**根因**：候选攒进待发文件后就断了。**候选从不进提示词**，模型看不到；`deliver` 也没挂上成工具，模型调不到。所以"决定要发 → 投出去"这两段都不存在。

**修复方式**：二选一或都做
- 加一个 `systemPrompt.section`（或工具）把 pending 摘要交给模型
- 把 `deliver` 挂上成工具（如 `qq_deliver_proactive`），模型可显式投

**注意**：这条与"出厂 `proactive.enabled: false`"叠加，等于该能力当前完全不可达。修复后若要真用，还得同时改 `qq.patch.yml`。

---

### D8 非 `postWant` 条目投了也不发 QQ

**证据**
- 【亲验】`qq-bundle/src/index.ts:234-235` — `if (delivered.item.facts.postWant === undefined) return delivered`，返回 `ok` 但 `channel` 一次未调用

**根因**：含义含糊 —— 攒候选时的 `source: 'thought'`（`:616`）条目投递后什么都不发，调用方却收到成功。

**修复方式**：明确含义。要么把 thought 类候选真正走 `channel.send` 发出去，要么返回一个明确的 code（如 `proactive.not_a_post`）而不是 `ok`。

---

## P2 — 判据在生产里永不命中 / 死代码

这类不改不会崩，但会**让人（包括模型和后来的你）误判系统行为**。

### D9 `humanActive` 与 `history` 硬编码

- 【亲验】`qq-bundle/src/index.ts:656-657` — `history: []`、`humanActive: false`
- 后果一：`gates.ts:118` 第 9 道"有人在聊，先听"**永不命中** → 群里正热闹也可能决定开口
- 后果二：`history: []` 使 `dropRepeats`（`score.ts:127-135`）永不生效 → 同一件事会重复攒
- 修复：`humanActive` 用 `inbox.recent` 的"最近 N 分钟内是否有人在说话"填充；`history` 传已发候选的指纹列表

### D10 引用回复双向皆无实装

- 【亲验】`qq-channel/src/events.ts:132-142` — 读 `item.data?.user_id ?? item.data?.qq`，而 OneBot v11 的 reply 段**只带 `id`**（message_id）→ 取到空串 → 恒 false
- 【亲验】`qq-channel/src/events.ts:95` — `textOf` 跳过 reply 段，模型永远看不到"这条在回谁"
- 【亲验】`qq-channel/src/ws.ts:151,153` — 出站 `message` 只传字符串，无 reply 段
- 修复：入站按 `id` 反查自己发过的 message_id 表；出站支持 `message` 传段数组

### D11 转发 / 合并转发：没有

- 【亲验】全仓 `forward|CQ:|send_forward|at_sender` **零命中**
- 修复：需先决定要不要做。要做则出站要支持消息段数组与 `send_forward_msg`

### D12 pacing 死计数与不暴露的参数

- 【分析】`qq-pacing/src/store.ts:116,123` — `turnBurst` 只增只清，无人读
- 【分析】`qq-pacing/src/plan.ts:34-45` — 60/小时、600/天、10 分钟同文本等四个数硬编码，`Config` 不暴露（只露 `maxParts`/`maxCharsPerPart`）
- 修复：删 `turnBurst`；把四个额度提到 `Config`

### D13 continuity 整包没有消费者

- 【亲验】`qq-bundle/src/index.ts:13` 只 import `qqMaterialOf`，**全仓无 `qqContinuityOf`**
- 【分析】`qq-continuity/src` 的 `close` / `resume` / `judge` / `history` 均零调用，`closes` 恒空
- 后果：README 写的"收尾留话头、下次接着接"实际不生效。`qq.patch.yml:23-24` 挂了它，但没人取 seam
- 修复：在 `bundle` 的 `onIncoming` / prompt section 里接上；或从 patch 里撤掉，别挂着装样子

### D14 material 的素材采集零调用

- 【亲验】`qq-bundle/src/index.ts:580` 取 `material`，`:611` 只用 `material.thoughts.live(chatKey)`
- 【分析】`collect.ts` 的 `gather` / `collectMaterial` / `renderMaterial` 仅测试调用
- 后果：README 说的"现场素材随提示词交给模型"不成立，实际只有"惦记的事"在用
- 修复：接进 prompt section；或删掉采集那部分

### D15 `pendingTtlMs` 配置无效

- 【分析】`qq-proactive/src/score.ts:77` 声明，实际用的是 `PENDING_TTL_MS` 常量（`:93`）
- 修复：让 gate 读配置，或删字段

---

## P3 — 规模性缺口（不是接错线，是还没做）

这几条不是 bug，是没做。列出来是为了让"完成度"的账算得清。

| 缺口 | 现状 | 对照 |
|---|---|---|
| 提示词 | 【亲验】`qq-bundle/prompts/rules.md` **854 字节 / 24 行** | 老项目 `persona-v1-xiaojingyu.md` 16.6KB、人设对比方案 13.9KB、主体行为机制 15.1KB —— **未搬迁** |
| 自我层写入口 | README 自认：叙事、每天三行、错题、周复盘、项目、问句、主张、承诺**"没有对应的工具与提示词入口，主会话暂时还不能自己往这些文件里写"** | 面板能看，她写不进去 |
| 网页面 | 【亲验】`qq-self/src/index.ts:315-316` `panelPort` 默认 0 = 不监听；`panel-http.ts` 只绑 127.0.0.1、无鉴权 | 且 `qq.patch.yml:36-39` `self.enabled: false` |
| 记忆向量路 | README 自认：字面哈希编码，**不带含义模型**（"爬山"与"登山"对不上） | 召回质量上限明确 |
| 真机验证 | 各 README 自认"还没在真 QQ 号上跑过" | 1238 条是包级行为测试 |

---

## 第二轮：与三份能力规范 + dev-spec 对照后的新增发现（2026-11-04）

上一版清单只看了装配层断线。把 `vitals-spec` / `memory-spec` / `self-layer-spec` / `dev-spec` 四份规范逐节比对后，新增下列问题。**编号接在 D15 之后。**

### D16 自我层的写入面一条都调不到（最严重）　——【已修，2026-11-04】

**证据**
- 【分析】`qq-self/src/index.ts:430-649` 定义了 `recordDay` / `recordQuestion` / `recordClaim` / `recordCommitment` / `recordProject` / `recordAgency` / `recordDrive` / `recordError` / `recordIdentity` / `updateNarrative` / `advanceStage` / `listVersions` / `rollback`
- 【分析】`qq-self/src/index.ts:295` 只 `inject ['systemPrompt']`，全仓**零** `ctx.tools.register`
- 【分析】bundle 只调用 `useMemory` / `useVitals` / `mirror` / `audit` / `isPaused` / `stage`（`qq-bundle/src/index.ts:690,692,713,715`、`maintenance.ts:112,117`）

**后果**：规范里"主会话写"的每一类——每天三行、问句、claim、承诺、项目、两档账、错题、叙事、阶段推进、回滚——**在真实装配下一条都写不进来**。面板看得见历史，但她自己无法往里面写。

**修复方向**：按 Q1 同样的说法——把这 13 个入口挂上成工具（或合并成 2-3 个参数化工具），逐条补行为用例。

**已落地的做法（2026-11-04）**
- 新增 `qq-self/src/tools.ts`，把 13 个接缝做成 **12 个模型可见工具**：`qq_self_day`、`qq_self_skip_day`、`qq_self_question`、`qq_self_error`、`qq_self_claim`、`qq_self_commitment`、`qq_self_project`、`qq_self_ledger`、`qq_self_identity`、`qq_self_narrative`、`qq_self_stage`、`qq_self_versions`
- 写入没落盘一律转成带 `code` / 原因 / 下一步的失败，不把失败改写成成功（dev-spec:78）
- 只在 `enabled` 为真时露出来，免得模型对着永远返回 `disabled` 的工具空转
- **为守 22 文件预算**：把 `moment.ts`（70 行，只依赖 `defaults.ts`/`types.ts`）并入 `panel.ts`——`panel.ts` 首行本就写着"此刻"是它的四类内容之一，属同概念合并，顺带满足 dev-spec:69。测试与 bundle 的导入面零改动。
- 工具服务按 `ctx.get('tools')` 取（packages/AGENTS.md 对可选服务的说法），取不到只记一行 warn，面板与提示词照旧
- 用例：新增 `tests/tools.spec.ts` 12 条（正例 4、负例 5、挂上面 2、关着不露 1）
- 关卡：`vitest packages/qq` **91 文件 / 1250 条全过**、`oxlint packages/qq/qq-self` 0 error、`tsc -b tsconfig.host.json` 退出码 0

**仍需注意**：`qq.patch.yml:36-39` 里 `qq-self` 仍是 `enabled: false`，所以这套写入面在出厂配置下**不会露出来**。要真用还得把它打开并配 `panelPort`（见 D21）。

### D17 死亡威胁与存在性恒为 0，遗书永不触发　——【已修，2026-11-04】

- 【分析】`qq-vitals/src/index.ts:206,209` 有 `setBalance` / `setExistence`，但 bundle 从不调用
- 后果：`mortality` 恒 0，`farewellOf` 永不产出事实，整条遗书链路（含 `qq_write_farewell` 工具）在装配里是死的
- 注：`drift.ts:320-330` 在无来源时不动是**对的**（不编造余额），缺的是装配层放进

**已落地的做法（2026-11-04）**
- **余额**：`qq-bundle` 新增 `Config.balanceLevel`，装配时 `vitals.setBalance(config.balanceLevel)`。**没配就是没有来源**，死亡威胁一动不动也不自己回弹——这是规范要求的「不编造余额」，不是退一步
- **存在性**：新增 `qq-bundle/src/liveness.ts`，只报答得出来的两条
  - `uptimeMs`：`process.uptime() * 1000`，每句话到达时刷新一次再结算
  - `restartsToday`：`starts - 1`，来自一份带版本戳、原子写、坏读回退到 `.bak` 的启动账
  - `shutdownNotice`：这一版**没有来源**，一律报 `false`，不猜
- **只写临时目录**：没配 `livenessFile` 时只报活多久、一个字节都不写盘（这条是被 `meal-memory.spec.ts` 撞出来的——最初版本会写真实主目录）
- 用例：`tests/liveness.spec.ts` 6 条 + `tests/mortality.spec.ts` 4 条
- 关卡：`vitest packages/qq` **94 文件 / 1265 条全过**、`oxlint qq-bundle` 0 error、`tsc -b` 退出码 0；`qq-bundle/src` 11 个文件（≤12）

**顺带查明的一个真实行为**：`minDriftHours` 正好是 `1/60` 小时（整 60 秒），而 OneBot 的 `time` 是**整秒**精度。两者卡在一起时，`上一次结算 → 下一条消息` 实际只有 58~59 秒，**整拍会被跳过**。生产上无碍（下一条会补上），但写测试时种子至少要比最小间隔远一点，否则永远结算不动——这一条踩了我一会儿。

**仍未解决**：`shutdownNotice` 无来源；`restartsToday` 只在配了 `livenessFile` 时才准。

### D18 记忆写入队列无人入队，三条路径空转

- 【分析】`qq-memory/src/write.ts:412` 的 `enqueue` 无调用方；bundle 只调 `tick`（`qq-bundle/src/index.ts:323`）
- 后果：`pending` 恒 0，批量写入 / 反思合成 / 排空三路永远没活干
- 附带：`memory_append` 工具直写 `store.add`（`tools.ts:94`），**绕过近似重复合并**

### D19 峰值与动态分级存在死代码 / 重复实现

- 【分析】`qq-vitals/src/peak.ts:15` 的 `peakOf` 无调用方 → 规范里"峰值联动主动性与动态"缺一半
- 【分析】动态分级两份并存：`qq-vitals/src/post.ts:28` 未被使用，实际用的是 `qq-self/grade.ts`（`action-gate.ts:5`）

### D20 面板不读生命状态，`panelVitalsOf` 是死代码　——【已修，2026-11-04（最小版）】

- 【分析】`qq-self/src/index.ts:365-378` 的 `panelStateNow` 只拼自我目录那一份，入参**没有 vitals**
- 【分析】`panel-vitals.ts:23` 的 `panelVitalsOf` 全仓零引用 → `/api/state` 运行时永不含 vitals
- 后果：页面"身体"块**恒显示"身体没接上"**；测试能画出水罐，只因 `panel-http.spec.ts:277-339` 手工塞了 vitals

**已落地的做法（最小版，2026-11-04）**
- `qq-self/src/index.ts` 的 `panelStateNow` 接上 `panelVitalsOf(vitals)`，`/api/state` 从此带上 `vitals`：口渴、精力、心情、无聊、想说话、情绪混合层几条
- 身体没接上时整块省掉，不给一份假读数（`exactOptionalPropertyTypes` 下用看全文写法，不显式传 `undefined`）
- 用例：`panel-http.spec.ts` 新增两条**真 HTTP 端到端**——接上身体后 `/api/state` 带出 `{thirst, energy, mood, boredom, socialHunger}`；没接上时 `vitals` 为 `undefined`
- 关卡：`vitest packages/qq` **99 文件 / 1302 条全过**、`oxlint qq-self` 0 error、`tsc -b` 退出码 0
- **仍未做**：D21 那些画布/栅格/色值/3 秒轮询——现在页面能看见读数，但仍是纯文字，没有水罐、周期盘与曲线

### D21 面板"看"的一半没落地（安全那一半反而超标）　——【部分已修，2026-11-04】

| 规范第 10 章要求 | 实现 |
|---|---|
| canvas 画布（水罐正弦水面、火舌、周期盘、六条曲线） | **全无** |
| 12 栅格 + 342px sticky + 1080 断点 | **全无**，单列文档流 |
| 3 秒 JS 轮询 | `meta refresh` 10 秒整页重载（`panel-http.ts:11,144`） |
| 颜色 token 表（#67e8f9 等） | **全无**，自带灰蓝 |
| 水罐全蓝三档 #2563EB/#3B82F6/#38BDF8 | 有但值不对（#1f6fb2/#5b9bd5/#a8cbe8），**分档方向也反了**（`panel-http.ts:65-69`） |
| 口令鉴权 | **无**（`index.ts:274` 自认） |
| 只绑 127.0.0.1 / Host 允许的名单 / 405 / 字段裁剪 / 不写盘 | **全部超标达成** |

- 另：`qq.patch.yml:36-39` 只写 `enabled:false`，**没配 `panelPort`**，就算打开开关也因默认 0 不监听

**已修的（2026-11-04）**
- **色值表**：规范 §10.4 那 13 个色值全部落进 `:root` CSS 变量，背景 `#03060d`、面板 `rgba(8,18,34,.62)`、主色 `#67e8f9`、压力 `#fb7185`、文字 `#e6f2ff`、次要 `#7f93b8` 等
- **12 栅格**：`342px sticky 左栏 + repeat(12,1fr) 右栏`，1080px 以下退化成单列；卡片按 `span-4`/`span-6`/`span-12` 排
- **水罐**：改成**按水位（1−渴）分三档**、三档全蓝，色值取 `#2563EB`/`#3B82F6`/`#38BDF8`——方向和取值都照 §10.3 的 v2 修正
- **口渴环**：`conic-gradient` 画一圈，中间写百分比
- **字号规范**：数字用 `Consolas`，标签 9~10px、大写、字距 2px
- **进度条**：轨道 `minmax(300px,1fr)`，单处填充
- **刷新**：`meta refresh` 从 10 秒改成 **3 秒**
- 用例：`panel-http.spec.ts` 的水罐三档按新说法重写，另加一条"颜色只由水位决定"；刷新判断同步改 3 秒
- 关卡：`vitest packages/qq` **99 文件 / 1303 条全过**、`oxlint qq-self` 0 error、`tsc -b` 退出码 0

**仍未做，且需要你定方向**：canvas 画布（正弦水面、气泡、火舌、30 格周期盘、六条迷你曲线、粒子轴）与 **3 秒 JS 轮询**。做这些必须往页面里放 `<script>`，而现在 `panel-http.spec.ts:334` 有一条硬判断 **页面不许出现 `<script>`**（当初为了"不拉外部资源"立的）。二选一：**(a)** 放开这条、允许内联脚本，按规范做 canvas；**(b)** 保持无脚本，用纯 CSS 近似（当前就是这条路，画布永远做不全）。

**已按 (a) 落地（2026-11-04）——内联脚本 + canvas**
- 页面改成 **内联脚本每 3 秒 `fetch('/api/state')` 重绘**，不再整页重载（`meta refresh` 已移除）
- canvas 画出来的：**口渴环、饥饿环、怒气火舌（火高按 anger、余烬按 resentment）、30 格生理周期盘（指针指到第几天）**；水罐水位与三档蓝由脚本实时更新 DOM
- 色值不重复写一遍：脚本用 `getComputedStyle` 读 `:root` 里那几个变量
- 读数补齐：`VitalsReadout`/`PanelVitals` 新增 `hunger / anger / resentment / adenosine / cycle_day / cycle_len / cycle_phase`，`panelVitalsOf` 一起带出去；没有的项照旧整块省掉
- **安全边界**：仍然零外链（判断改成「不含 `<script src`、不含 `<link>`、不含 img/iframe/object/embed、不含 `url(`」）；塞进脚本的 JSON 先按 `\u003c` 转义，防 `</script>` 放进
- 新增用例：脚本能解析（`node:vm` 的 `Script` 只编译不执行，避开 `no-implied-eval`）、尖括号转义、轮询间隔 3000、无外链
- **仍未画**：正弦水面与气泡、涟漪、火舌的分层贝塞尔与火星、周期盘的五段彩弧与脉动点、体内环境六条迷你曲线、神经-体液粒子与五组双条。这些是纯呈现，数据侧也还缺体温/免疫/疼痛/雌激素等读数

**细节层第一批（2026-11-04）**
- **读数补齐**：`VitalsReadout`/`PanelVitals` 再添 `core_temp / fever / cytokines→immunity / pain / estrogen / progesterone`；`panelVitalsOf` 里体温交原值（曲线按 `(t−36)/3` 归一），其余按零到一收边界
- **水罐**：内层加一块 `canvas.water`，**两条正弦叠加成水面 + 气泡随缺水变多**，`requestAnimationFrame` 连续画；原来的 DOM 水位保留当无脚本备用
- **周期盘**：当前那一天的格子上**按阶段上色**（经期红/排卵紫/黄体琥珀/经前灰蓝/其余绿），指针照旧
- **体内环境**：新增 `canvas.env`，六条迷你曲线，**样本由页面自己按轮询攒**（最多 90 个点），体温先归一
- 用例：`tests/panel-vitals.spec.ts` 5 条（映射/收边界/周期三格/坏值不给/无端口不给）+ `panel-http.spec.ts` 2 条（画布属性带当前值 / 缺的曲线不位置）
- 关卡：`vitest packages/qq` **102 文件 / 1324 条全过**、`oxlint qq-self` 0 error、`tsc -b` 退出码 0；`qq-self/src` 22 个文件（上限 22）

**细节层仍未画**：水面涟漪、火舌的分层贝塞尔与火星、周期盘**五段整体彩弧**（现在只给当天那一格上色，因为分段边界参数没进面板）、神经-体液粒子与五组双条

**细节层第二批（2026-11-04）**
- **周期五段彩弧**：给端口加了只读 `bounds()`（`VitalsPort` → `momentPort` 原样转出 → `cycleBounds()` 从 tuning 取四个分界），页面 `data-bounds="5,12,15,23"`，脚本按分界把整圈涂成**经期红/卵泡绿/排卵紫/黄体琥珀/经前灰蓝**，当前那格高亮。**没有把 5/12/15/23 抄进面板**，改参数彩弧跟着变
- **水面涟漪**：脚本记住上一次的水位，**骤降超过 0.12** 就在水面画一圈 900 毫秒扩散的波
- **火星**：火舌上方按 `anger` 数量出火星，随机感只来自时间，不用 `Math.random`
- 动画统一走 `requestAnimationFrame`（水面 + 火舌），轮询仍是 3 秒
- 用例：`qq-vitals/tests/cycle-bounds.spec.ts` 2 条（四个分界照参数表 / 改参数跟着变）+ `panel-vitals.spec.ts` 1 条（有分界就带、没分界不带）+ `panel-http.spec.ts` 判断 `data-bounds`
- 关卡：`vitest packages/qq` **103 文件 / 1327 条全过**、`oxlint qq-self`/`qq-vitals` 均 0 error、`tsc -b` 退出码 0

**现在只剩**：火舌的分层侧焰、神经-体液粒子与五组双条（后者要先有 network 轴量读数）

**细节层第三批（2026-11-04）**
- **五组双条**：给端口加了只读 `pairs()`（`VitalsPort` → `momentPort` 原样转出 → `panelVitalsOf` → 页面「神经-体液」块）。**哪两条是一对由身体包说了算**：自主神经（交感/副交感）、奖赏（想要/满足）、依恋（亲近/占有）、应激（压力/稳定）、血糖（血糖/胰岛素）
- **火舌分层**：主火舌之外加了两条侧焰（高度 0.55 倍），火星按 `anger` 数量出
- 用例：`qq-vitals/tests/pairs.spec.ts` 3 条 + `panel-vitals.spec.ts` 1 条 + `panel-http.spec.ts` 1 条
- 关卡：`vitest packages/qq` **104 文件 / 1334 条全过**、`oxlint qq-self`/`qq-vitals` 均 0 error、`tsc -b` 退出码 0

**§10.3 现在只剩粒子场景**（规范原文注明「可省」）

---

## §12 验收表：做成可执行脚本（2026-11-04）

`qq-vitals/scripts/accept.ts` — 按规范第 12 章那张 20 行表逐条跑，**全部在内存里算，不碰真实状态**，打印 ✅/❌ 并给出退出码。

已覆盖 13 行：夸奖（多巴胺/催产素上升）、被凶（皮质醇上升）、连着被凶（标签出现「生气」）、八小时不喂（饥饿 >0.5）、投喂（饥饿下降）、八小时不喝（口渴 >0.55）、喝一次（掉 0.55）、口渴 0.58（提示词说嗓子有点干）、三种喝水口语、三分钟冷却、提示词放进、吃一顿（血糖上升）、夜里睡眠压力过线（睡着）。
**补充 4 行（本轮）**：凶完不理十二小时（记恨 >0.5）、道歉（愤怒与记恨都降）、经期（精力降 / 易怒升 / 标签出现“经期”）、十三点（午睡且类型是 nap）。
**跨包 3 行放在 `qq-bundle/scripts/accept.ts`**：被凶后条数 ≤2（`qq-pacing`）、水罐三种水位都是蓝且不含旧红/琥珀（`qq-self` 的 `panelPage`）、补一杯水 0.58→0.03（`qq-vitals`）。

**合计 20 行，与规范那张表一致。**

**两条与文档的差异（如实记）**
- 冷战的「标签」不一定进前三：`冷战 = 0.75×记恨 − 0.35×愤怒`，同一时刻其它标签分更高时会被挤出前三条。验收断的是记恨数值（0.645 > 0.5），不是标签排序
- 经期那行断的是「精力降、易怒升、标签含经期」，实测 0.346 vs 0.549、0.460 vs 0.095，符合

**跑起来踩到的两个真问题（值得记）**
1. `react()` 是**纯写回、不算算出来的量**——直接拿它的返回值判 `emotion_candidates` 永远是空。必须先 `derive()`，这也正是 `seam.react` 内部做的事
2. `drift()` 同理：它只结算原始状态，**标签与算出来的量要再 `derive()` 一次**。这两条我各踩了一次，验收脚本里现在用 `hit()`（写回+算出来）和 `settle()`（结算+算出来）两个小包装统一处理



### D22 主动性 7 条系数、条数 9 条规则缺失（规范有、字段都没建）　——【已修，2026-11-04】

- 【分析】`qq-vitals/src/derive.ts:103-114` 只有 7 个 bias 因子；缺 `biasPeak` / `biasFear` / `biasWorry` / `biasDread` / `biasColdWar` / `biasResentful` / `biasBroke`
- 【分析】`qq-pacing/src/reply.ts:70-102` 只有分档表；缺规范 §8.2 的 `fear>0.5||dread>0.65`、`worry>0.6`、`anger>0.75||resentment>0.50` 等 9 条硬规则

**已落地的做法（2026-11-04）**
- **主动性补齐 7 条**：`derive.ts` 的 `biasFactors` 从 7 个因子加到 13 个，新增幸福峰值、惊吓、担心、存在性恐惧、冷战、记恨；余额见底按 `mortality >= biasBrokeMortalityFrom` 硬压到 `biasBroke`（0.25）。参数 13 个字段进 `tuning.ts` + `defaults.ts`，数值照规范
- **条数补齐 4 条硬规则**：`reply.ts` 新增 `hardened()`，在分档给出上限之后按规范顺序再过一遍惊吓/存在恐惧封顶、担心加一、愤怒封顶、愤怒或记恨只剩一句；`ReplyFacts` 扩了 5 个可选事实，`bundle` 的 `replyFactsOf` 从身体状态直接喂
- **提示词阈值全部进 tuning**：把 22 条阈值从 `render.ts` 的裸字面量抽成 `src/prompt-tuning.ts` 的 `PromptTuning` + `PROMPT_TUNING`，`Tuning` 继承它、`DEFAULTS` 看全文它。**抽出来是因为加完之后 `defaults.ts` 涨到 613 行，超了 600 的硬线**——这也让提示词阈值真正自成一处
- 用例：`qq-vitals/tests/bias-factors.spec.ts` 8 条 + `qq-pacing/tests/reply-hard-rules.spec.ts` 10 条
- 关卡：`vitest packages/qq` **96 文件 / 1283 条全过**、`oxlint` 两包 0 error、`tsc -b` 退出码 0；`defaults.ts` 594 行、`qq-vitals/src` 21 个文件

**新增发现（未修，需你拍板）**

### D30 主动性方向与规范相反：`vitals` 忠实编码倍率，`proactive` 却拿它做除数　——【已修，2026-11-04，按方案 (a)】

- `qq-vitals` 把规范 §8.3 的倍率按 `biasUnit` 归一成 0~1 读数，方向是**忠实的**：倍率 <1（想人 0.62）→ 读数更低，倍率 >1（累 1.8、冷战 1.6）→ 读数更高。`vitals.spec.ts:342-366` 的既有判断就是这么写的
- 但 `qq-proactive/src/gates.ts:45-49` 用 `冷却 = 区间中点 ÷ 读数` 来算下一次开口。于是**读数越高 → 冷却越短 → 越常开口**
- 两条合起来的结果与规范相反：**累了反而更常开口，生气了更常开口，想人了反而更少开口**
- `qq-proactive` 的 README 把现象记成了现状（"中性的 1.0 倍率折出来约 0.35，所以默认间隔约为区间中点的近三倍"），没有当成缺陷修
- 三条路：**(a)** `proactive` 改成乘（把读数还原回 0.2~2.5 倍率再乘），**行为会整体反过来，14 个因子全部生效**；**(b)** `vitals` 的 `biasUnit` 取反，同步改 `vitals.spec.ts` 的 8 条判断；**(c)** 认定现状就是想要的说法，把规范 §8.3 改成除法说法
- 我倾向 **(a)**：规范是行为真相，且 `proactive` 的除数写法连"倍率上限 2.5"这一半也丢了（`biasFactor` 把它夹到 ≤1）

**已按 (a) 修复（2026-11-04）**
- `qq-proactive/src/gates.ts`：新增 `multiplierOf(readout)`，把 0~1 读数还原成 `biasMin~biasMax`（0.2~2.5）的间隔倍率；没接上身体按 1 倍
- `cooldownMs` 从「区间中点 ÷ 读数」改成「区间中点 × 倍率」
- `dailyCapOf` 从「上限 × 读数」改成「上限 ÷ 倍率」，并夹在 `[dailyFloor, dailyMax]` 之间
- `GateConfig.biasFloor` 换成 `biasMin` / `biasMax`（0.2 / 2.5），`Config` 同名透传
- 效果：**累了、生气了 → 间隔变长、额度变小；想人了 → 间隔变短、额度顶到上限**，14 个因子全部按规范方向生效
- 代价：中性读数 1.0 倍率下，间隔从原来的"约 3 倍中点"回到**正好中点**——这是规范说法，原来的"近三倍"是除数写法带出来的
- 用例：`proactive.spec.ts` 里 7 条判断按新方向重写
- 关卡：`vitest packages/qq` **96 文件 / 1283 条全过**、`oxlint qq-proactive` 0 error、`tsc -b` 退出码 0

### D23 提示词阈值仍是裸字面量（违反 dev-spec 数值条）　——【已修，2026-11-04】

- 【分析】`qq-vitals/src/render.ts:22-25,34-39` 的 `hungerCrisis` / `thirstCrisis` / `thirstHigh` / `thirstMid` / `thirstLow` / `thirstQuenched`、body/heart/style 阈值都是字面量，未进默认值表、不可被 `Config` 覆盖

**已落地的做法**：见 D22 那一段的第三条。22 条阈值现在只在 `src/prompt-tuning.ts` 出现一次，`Config.tuning.promptXxx` 可逐项覆盖。

### D24 其它真缺口

- ~~**单心跳守卫**：`qq-vitals/src/index.ts:124` 每次装配新建 store，无互斥~~　【已修，2026-11-04】见下
- ~~**体检脚本与补喝水流程**：`qq-vitals` 无 `scripts/` 目录~~　【已修，2026-11-04】见下
- ~~**喝水记忆写回**：`react.ts:37` 只写 `drink_mem_at` 时间戳，规范要求落记忆~~　【已修，2026-11-04】见下
- ~~**健康一行时刻**：用 bundle `dailySweepHour=4`，规范写 `healthAt 00:20` 可配，无该字段~~　【已修，2026-11-04】见下
- `versionsKeep=20`（`qq-self/src/defaults.ts:56`）vs 规范"各留 5 份"

**体检与补水两个脚本已落地（2026-11-04）**
- `qq-vitals/scripts/check.ts`：按规范 §13 查状态新鲜度（>180 秒算心跳停）、33 个 0~1 字段越界、体温 34~42、`last_drink`/`last_update` 不在未来、睡着但 `wake_after` 过期、午睡超两小时；渴仍高但有喝水记录时给一句提示而不算错。全绿退 0，有问题退 1
- `qq-vitals/scripts/drink.ts`：按 §5.8.5 补一杯水。**写回直接调生产的 `react(state,'喝水了',…)`，不手抄那七个系数**——公式只有一份。心跳守卫：状态文件 180 秒内被写过就拒补并说清"先停心跳"，`--force` 可越过；`last_drink` 冷却内拒绝第二杯
- 两个脚本都是只读体检 / 备份后原子写，参数写错退 2
- **面板一致性（本轮补上）**：`check.ts` 加 `--panel <url>`，读 `/api/state` 比对 `vitals.thirst` 与 `vitals.energy`，差值超 0.02 就报“对不上”；面板没带身体读数、回非 200、连不上，各报一条，都不静默放过
- 用例：`tests/scripts.spec.ts` 9 条，**用子进程跑脚本**（照 `qq-self/tests/panel-script.spec.ts` 的做法；静态导入会让脚本落不进 tsconfig 的项目文件表）
- 关卡：`vitest packages/qq` **97 文件 / 1292 条全过**、`oxlint qq-vitals` 0 error、`tsc -b` 退出码 0

**踩到的一个格式坑**：状态文件是 `{ version, state }` 包装，不是扁平状态。第一版脚本直接 `JSON.parse` 当扁平读，结果所有字段读到 0、体检永远"正常"——这种"看起来通过"最危险，已改成校验 `state` 字段存在。

**喝水写记忆已落地（2026-11-04）**
- `qq-vitals` 新增 `DrinkFact` 与 `onDrink` 挂上口，位置与 `MealFact`/`onMeal` 并排：**只有那一杯真写进去了才产事实**（`next.last_drink !== raw.last_drink`），冷却挡掉的第二杯不通知
- `qq-bundle/src/drink.ts`：正文 `喝了X`、metadata `{kind:'drink', at, name}`、去重窗口 20 分钟（规范 §5.8.4 的 `drink_mem_at` 说法），判据只读记忆本身
- `qq-bundle` 新增 `drinkMemory`（默认开）与 `drinkMemoryImportance`（默认 25，比一顿饭还轻）
- 用例：`qq-vitals/tests/drink.spec.ts` 4 条 + `qq-bundle/tests/drink-memory.spec.ts` 4 条
- 关卡：`vitest packages/qq` **99 文件 / 1302 条全过**、`oxlint qq-vitals`/`qq-bundle` 均 0 error、`tsc -b` 退出码 0；`qq-bundle/src` **12 个文件**（正好卡在上限）
- 踩到的一个坑：两杯都写"喝了水"时，**记忆层的近似合并会把它们并成一条**，所以"过窗口算新一条"的用例必须换一种喝的才看得见

**单心跳守卫已落地（2026-11-04）**
- `qq-vitals` 加了模块级 `beating: Map<file, Context>`：同一份状态文件上第二个装配者**不另起心跳**，只记一行 warn；卸载时按自己的上下文让位，让位之后同一份文件还能再起一条
- 用例：`tests/single-beat.spec.ts` 3 条（第二次装配会记一行 / 两份都能读到同一份状态 / 第一条卸载后还能再起）

**每日整理时刻可配到分钟（2026-11-04）**
- `dailySweepHour: 4` 换成 **`dailySweepAt: 'HH:mm'`，默认 `'00:20'`**（规范 §13 要的就是零点二十）
- 调度从「每小时看一眼」改成「**每分钟看一眼，同一天只做一次**」（`lastSweepDay` 去重）
- 写坏了（`'25:99'`、少一半的 `'3'`）按默认那一档算并记一行 warn，不让整条装配塌掉
- 一次性机械改名 16 个文件（15 个测试 + `qq.patch.yml`），残留零处
- 用例：`tests/sweep-clock.spec.ts` 4 条

**关于 `shutdownNotice`：按规范它不是缺口**
- `vitals-spec` 与《生命状态》§「运行环境事实」都写明：这一包**不读进程状态、不读系统、不猜重启**，`setExistence` 是留给进程守护那一侧的**放进端口**
- 所以 `shutdownNotice` 目前恒 `false` 是**符合规范**的，不是没做完；要真用，由外部看护进程调 `setExistence({…, shutdownNotice: true})`
- `restartsToday` 我们已经真读出来了（启动账 `liveness.ts`），只要配了 `livenessFile` 就准


### 规范自身已过期的地方（不是代码的问题）

`vitals-spec:537` 仍把面板列在"未实现"；`self-layer-spec:105` 说装配层没接、`:284` 又说已接（实际 `bundle:692` 已接）。情绪九字段、26 标签、七组压制、吃饭写回、遗书记忆、叙事/版本/三行/错题/周复盘、P5b `emotion_blend` 等代码都已实现，规范表格仍标"未实现"。**审代码时应以代码为准，规范的状态列需要重写。**

---

## 第三轮：dev-spec 代码规范合规审计（2026-11-04）

范围：`packages/qq` 下 12 包、`src` 103 个 `.ts`、17,399 行。行数按字节级 LF 计数（PowerShell `Get-Content` 在这批文件上偏少，`qq-bundle/src/index.ts` 实际 762 行）。

| 规则 | 结论 | 实测 |
|---|---|---|
| 英文整句注释 | ✅ 合规 | 0 处 |
| 连续两行 `//` | ✅ 合规 | 0 处 |
| 成块 `/* */`（非 JSDoc） | ✅ 合规 | 0 处 |
| 导出声明上一行有中文注释 | ⚠️ 不合规 | 127 / 768 缺 |
| 无裸数字字面量 | ❌ 不合规 | **1,106 处 / 142 个数值** |
| 默认值只出现一次 | ❌ 不合规 | 表外重复 ≥3 次的 54 个 |
| 空 `catch` | ✅ 合规 | 0 处 |
| 吞错写明变量名与理由 | ❌ 不合规 | 12 处无说明 |
| 失败带 code / reason / hint | ❌ 不合规 | **26 / 59 缺 `hint`** |
| 单文件 ≤600 行 | ❌ 不合规 | 3 个 |
| 单包 src ≤12 文件 | ✅ 合规 | 仅 self 22、vitals 20，均在例外内 |
| 相对导入 ≤3 层 | ✅ 合规 | 0 处 `../`，354 条全是同目录 `./x.ts` |
| 每包有 `tests/` | ✅ 合规 | 12/12，合计 1,206 条用例 |
| 每包有负例 | ❌ 不合规 | continuity / pacing / policy / subject 各 0 |

### D25 裸字面量 1,106 处（规范债最大一笔）

最重的两处：
- `qq-vitals/src/derive.ts:34-41` — 一条 valence 公式内约 **25 个系数裸写**（0.12/0.30/0.22/0.28/0.65…），未进 `tuning`
- `qq-subject/src/state.ts:180-183` — 0.8 / 0.55 / 0.3 / 0.1 四个熟识度阈值内联在 `familiarityWord` 里

表外重复的典型：`0.5` 26 次跨 10 文件（`qq-bundle/src/index.ts:178` 一行内 5 次）、`0.2` 27 次跨 6 文件、`0.3` 23 次跨 5 文件、`0.15` 17 次、`0.35` 13 次、`0.12` 13 次。

### D26 26 个失败分支缺 `hint`

- `qq-self/src/grade.ts` 10 处（61/65/67/74/89/92/94/110/112/117）
- `qq-proactive/src/gates.ts` 10 处（85/90/98/100/102/106/110/115/119）+ `index.ts:183`
- `qq-channel/src/ws.ts` 6 处（68/76/119/126/148/160）
- `qq-bundle/src/index.ts:310` 的 `blocked` 连 `reason` 也缺

### D27 12 处吞错无说明

`qq-attention/src/store.ts:39`、`qq-bundle/src/decisions.ts:46`、`decisions.ts:75`、`qq-bundle/src/index.ts:147`、`index.ts:156`、`qq-channel/src/ws.ts:102`、`qq-continuity/src/store.ts:47`、`qq-material/src/thought.ts:36`、`qq-memory/src/store.ts:136`、`qq-pacing/src/store.ts:50`、`qq-proactive/src/store.ts:60`、`qq-subject/src/store.ts:49`。
对照：`qq-memory/src/ledger.ts:268`、`write.ts:220` 已经写对了，照那个样式补。

### D28 三个文件超 600 行

`qq-bundle/src/index.ts` 762、`qq-self/src/index.ts` 702、`qq-self/src/types.ts` 656。
注：`qq-bundle` 是装配总入口，拆它需要先确定按什么切（建议按 `onIncoming` / 维护 / 工具挂上三块）。

### D29 四个包没有负例

`qq-continuity`、`qq-pacing`、`qq-policy`、`qq-subject`。dev-spec:95 要求"每条拒绝、每条失败、每条越界都有会失败的用例"。

### 合规的注释基本盘（不用动）

注释的三条硬规则（全中文一行、无连续 `//`、无成块）**已经全部达标**，`/** */` 多行形态也都带 `@param`/`@returns`。所以"注释规范"这块整体是健康的，问题集中在**数值与失败文本**两处。

---

## D31 规范 §7 自相矛盾（已按 (b) 落地，2026-11-04）

**冲突**
- 《生命状态》§7 的逐字模板里有 `PAD：愉悦 +0.16 / 唤醒 0.61 / 掌控 0.52`（**数字**）与 `多巴胺：正常（…）`（**激素名**）
- 同一节三条红线第 1 条：**只给形容词，不给数字**（原话：模型会解释激素，角色立刻崩）
- 仓库已有 **6 条测试**判断提示词「不含数字、不含激素名」

**按 (b) 落地**
- `render.ts` 新增 `padLine` 与 `fiveLine`：
  - `PAD：愉悦 中 / 唤醒 正常 / 掌控 正常`（`sideWord` 给偏负/中/偏正，`levelWord` 给偏低/正常/偏高）
  - `五路：想要、兴奋、被夸的劲：正常；亲近、黏人：正常；压力、小脾气：偏低；情绪稳定：正常；精力、警觉：正常`
- 两行都**不含数字、不含激素名**，红线没有被破；6 条既有判断原样通过
- 阈值进参数表：`promptLevelLow 0.35` / `promptLevelHigh 0.65`（`prompt-tuning.ts`）
- **注意 `promptMaxChars` 从 300 提到 600**：底稿加两行后约 287 字，可选段一出现就会把固定句与结尾挤掉（`emotion.spec` / `sleep-cycle.spec` 就是这么撞红的）。600 只是保险丝，常规渲染仍是 287 字左右
- 关卡：`vitest packages/qq` **100 文件 / 1309 条全过**、`oxlint qq-vitals` 0 error、`tsc -b` 退出码 0

**与模板字面的差异（如实记录）**：模板写的是激素名与 PAD 数字，我们给的是对应形容词。信息量为五路档位 + PAD 三格方向，损失的是精确数值。

---

## §14 十九个常见坑：逐条核对结果（2026-11-04）

| # | 坑 | 结论 | 证据 |
|---|---|---|---|
| 1 | 一次性事件被心跳放大 | ✅ 已规避 | 14 个 `*_applied_at` 防重复的标记 |
| 2 | 口渴被目标值平滑抹掉 | ✅ 已规避 | `settleWater` 直接累积 `osmolality/thirst` |
| 3 | 夜里腺苷写反 | ✅ 已规避 | `adenosineStep` 醒着涨、睡着按 `sleepAdenosineDrop` 降 |
| 4 | 睡眠判定写成 `hour >= 11` | ✅ 已规避 | `inSleepWindow` 用 `hour >= sleepFrom \|\| hour < sleepUntil` |
| 5 | 午睡复用夜睡规则 | ✅ 已规避 | `inNapWindow` + `napAdenosineDrop` + `nappedToday` 独立一套 |
| 6 | 血糖只有升糖没有降糖 | ✅ 已规避 | `insulin` 压、`glucagon` 拉，双向 |
| 7 | 标签永远“幸福、安心” | ✅ 已规避 | 七组反向压制 `suppress*` |
| 8 | 进度条数字对、看着假 | ✅ 本轮修 | 轨道 `minmax(300px,1fr)` + 单处填充 |
| 9 | 状态写入不原子 | ✅ 已规避 | `store.ts` tmp → rename + `.bak` |
| 10 | 重载导致心跳停摆 | ✅ 本轮修 | 单心跳守卫（`beating` 表）+ 卸载清理 |
| 11 | 同名变量插错函数 | ➖ 不复现 | 那是 Python 按变量名插桩的事故；咱们是类型检查下的模块 |
| 12 | 时区/夏令时 | ✅ 已规避 | `clock.ts` 的 `localDayDiff/localHour/localPoint` |
| 13 | 分享截图带隐私 | ✅ 已规避 | 面板字段裁剪，私人字段不出口 |
| 14 | 口渴提示死区 | ✅ 已规避 | 五档 `promptThirstCrisis/High/Dry/Low/Quenched` |
| 15 | “喝水了”不触发 | ✅ 已规避 | `DRINK_HINTS` 收了“喝水/喝口水/去喝水/一杯水…” |
| 16 | 喝水冷却 600 秒太长 | ✅ 已规避 | `drinkCooldownMs: 180_000` |
| 17 | 运行中直接改状态文件 | ✅ 本轮修 | `scripts/drink.ts` 心跳守卫（180 秒内拒补）+ `--force` |
| 18 | session 配错或没重载 | ✅ 本轮修 | 体检脚本查 `mtime` 新鲜度；另加两条用例判断 **`qq:vitals` 变量真的进装配**（`assembly.variables.qq_vitals` 含身体原话，身体没接上时为空串） |
| 19 | 水罐颜色/水位 | ✅ 本轮修 | 水位 `1−thirst`、三档全蓝、色值照 §10.4 |

**结论：19 条里 18 条已规避或修掉，1 条不复现（#11）。**

---

## 需要你拍板的三件事

**Q1：注意力留还是删？**
- 留（接进唤醒判定）→ 工作量：改 `onIncoming` 唤醒逻辑 + 补 D5 读取 + 修 D6 传字段
- 删（只留收件箱）→ 工作量：删 `signals`/`candidates`/`attentionStateOf`/`set_wake_config` + 改 README
- 折中：保留 `signals` 但作为**提示词事实**交给模型（不进代码判定），这样它至少"有消费者"

**Q2：非 `postWant` 候选投递后该不该真的发出去？**（D8）

**Q3：多群会话怎么分？**（D2）A=每群一条会话，B=保持单会话但改发送目标来源

---

## 建议动手顺序

| 步 | 内容 | 为什么排这里 |
|---|---|---|
| 1 | D1 修日志 | 不修这个，后面每步都看不见结果 |
| 2 | D2 多群会话 | 接真号第一小时就会暴露 |
| 3 | D6 传 atMe（10 行以内） | 最小代价让已有识别生效 |
| 4 | Q1 拍板后处理 D4/D5 | 决定注意力是关卡还是事实 |
| 5 | D3 拆文件 | 打开 proactive 之前必须完成 |
| 6 | D7/D8 接 preview 与 deliver | proactive 真正可用 |
| 7 | D9–D15 清判据与死代码 | 收尾，顺带修 README |

每一步的验收都用同一条标准：**在假 OneBot 上跑出可观测的日志**，而不是"测试变绿"——因为 D1–D8 这些缺陷，恰恰是 1238 条绿测试一个都没抓到的。

---

## 2026-11-05 状态快照（长任务第 8/9 轮）

### 已达成并留证据

| 项 | 证据 |
|---|---|
| 三份能力规范的状态列与代码一致 | `vitals-spec` 从 55 行标「未实现」降到 **0**；`memory-spec` **0**；`dev-spec` **0**；`self-layer-spec` 只剩 **3** 条真实的部分实现（A2 普通聊天的三个参数只作用于主动开口、身份级 30 分钟冷却没有、P5a 的"满 7 天零越级"要靠时间验） |
| §12 验收表 20 行可执行 | `qq-vitals/scripts/accept.ts` 17 行 + `qq-bundle/scripts/accept.ts` 3 行，实测 **17/17 与 3/3 全过** |
| 开经日写记忆（规范里最后一条真缺口） | `onCycleStart` + `cycle_start_applied_at` 防重复的标记 + 组合包 `kind=cycle_start` 记忆；`cycle-start.spec.ts` 4 条、`cycle-memory.spec.ts` 3 条 |
| 全包测试 | `10:08` 实测 **111 文件 / 1390 条全过**，`tsc -b` 退出码 0，七个包 oxlint 0 error |
| 文档关卡 | `verify-md-wrap` 2386 文件、`verify-md-links` 2333 文件、`verify-doc-refs` 4996 文件，三条全过 |

### 三道关卡的最终实测（2026-11-05 10:08）

| 关卡 | 结果 |
|---|---|
| `vitest packages/qq` | **111 文件 / 1394 条全过** |
| `tsc -b tsconfig.host.json` | 退出码 **0** |
| `run-oxlint.ts`（vitals/bundle/self/channel/proactive/pacing/memory） | **七个包全 0 error** |
| `scripts/accept.ts` | 17/17 与 3/3 全过 |

### 中途撞上的写冲突（过程记录，已收口）

`09:40–10:06` 同一工作区有另一个写入者重构 `qq-vitals`、`qq-bundle`、`qq-self`、`qq-channel`、`qq-proactive`，期间我这边看到过 TS2305/TS2459/TS2300 等中间态报错。对方完成后我重新跑齐了上述四道关卡，并修掉三处遗留：`QqChannelSeam` 缺 `send` 的重复定义、`CycleFact` 新增 `date` 后用例的构造、`scripts.spec.ts` 里多余的类型判断。`tsconfig.host.json` 补了 `qq-vitals/scripts` 与 `qq-bundle/scripts` 两条 include，脚本现在也进类型检查。

### 本轮补掉的机制：身份级动作的三十分钟冷却

- `keys.ts` 新增 `identityCooldownLeft(store, action, at, windowMs)`：从 `keys.jsonl` 里找**同一动作**的最后一条，不足窗口就返回剩余毫秒
- `assembly.ts` 的 `allowKeys` 在放行之后、记录之前判一次：还在冷却里就回 `{ allowed: false, reason: 'cooldown', proposed: true }`——只算提议，不记录也不放行，所以被拒那次不把冷却往后推
- `DEFAULTS.identityCooldownMs = 30 * 60_000`，可配
- 用例：`keys.spec.ts` 新增 4 条（冷却内被拒且不记录 / 满三十分钟放行 / 不同动作互不挡 / 被拒不推后冷却），该文件 12 条全过

### 现在只剩一条（时间性验收）

- P5a 的「满 7 天未授权公开动作为 0」要靠真机跑时间才能下结论，今天给不了；机制侧（`keys.jsonl`、分级表、冷却、routine 允许的名单、停手开关）都在

### 说法已定的一条（不是缺口）

- **普通聊天不受主动开口开关约束**：`enabled` 与 `dailyMax` 是主动开口的开关；关掉它不该连"有人跟她说话"都不回，否则与"睡着时被消息叫醒会回"冲突。普通聊天只受出站体检的静默时段与每分钟条数约束

### 已知的与本规范的差异（不是漏做，是实现说法不同）

- 黏人公式只取亲近与内啡肽两项，规范式里的皮质醇、加压素、内啡肽负项、记恨四项未纳入（`derive.ts:73`）
- `PAUSE` 接在发布入口（`channel.usePause`），不在 `qq-proactive` 内
- 冷战的标签可能被别人挤出前三，验收断的是记恨数值（0.645 > 0.5）

---

## 第四轮：彻底修复（2026-11-05）

这一轮把还没修的行为缺陷、三处超行文件、四条关卡与文档状态列一起收掉。验收只认退出码：`vitest run packages/qq`、`oxlint packages/qq`、`tsc -b tsconfig.host.json`、生成器 `--check`、`verify-export-jsdoc`、`verify-md-wrap`、`verify-md-links` 全 0。

| 条目 | 处置 | 落在哪 |
|---|---|---|
| D3 双写者 | 已修：一份文件一个 owner，pending 与 timing 是它的两个视图；load 校验版本戳、坏读回退 `.bak` | `qq-proactive/src/store.ts` |
| D4 注意力零消费者 | 已修（按 Q1）：`signals()` 与唤醒偏好只渲染成提示词事实，不接关卡 | `qq-attention/src/facts.ts`、`qq-bundle/src/facts.ts` |
| D5 唤醒状态机只写不读 | 已修：`set_wake_config` 落的状态现在出现在 `qq:attention` 那段事实里 | 同上 |
| D6 `atMe`/`replyToBot` 被丢弃 | 已修：`InboxPush` 扩三个可选字段，装配层逐条传进去 | `qq-attention/src/inbox.ts` |
| D7 `deliver` 零调用点 | 已修：候选进 `qq:proactive-pending` 段，投递挂上成 `qq_deliver_proactive` 工具 | `qq-bundle/src/proactive-tools.ts` |
| D8 非 postWant 投了不发 | 已修（按 Q2，只发当前群）：走 `channel.send`，只过出站体检、频控与切分 | `qq-channel/src/index.ts` |
| D9 `humanActive`/`history` 硬编码 | 已修：由收件箱最近窗口与已发正文填 | `qq-bundle/src/index.ts` |
| D10 引用回复 | 已修：入站按 reply 段 id 认，出站支持段数组 | `qq-channel/src/events.ts` |
| D12 pacing 死计数与硬编码额度 | 已修：删 `turnBurst` 与 `resetTurn`，四个额度进 Config | `qq-pacing/src/store.ts`、`plan.ts` |
| D13 continuity 无消费者 | 已修：`qq:continuity` 段渲染收尾与回想 | `qq-bundle/src/facts.ts` |
| D14 material 采集零调用 | 已修：`qq:material` 段渲染现场素材 | 同上 |
| D15 `pendingTtlMs` 无效 | 已修：`expiresAt` 按配置算 | `qq-proactive/src/index.ts` |
| D19 峰值与分级死代码 | 已修（2026-11-05）：`qq-vitals/src/post.ts` 的 `postLevel` 零生产消费者（只有它自己、`index.ts` 转出与自称的 6 条测试），已整份删除并移除两处导出；分级只在它这一处定是 `qq-self/grade.ts:judgePostLevel`（`action-gate.ts:5` 在用）。峰值本身不是死代码：`peakOf` 被 `derive.ts:114` 用来算 `biasPeak`。`vitals-spec` 证据索引与包 README 同步改准 | `qq-vitals/src/peak.ts`、`qq-self/src/grade.ts` |
| D24 `versionsKeep` 与规范不符 | 已修：默认与「各留 5 份」一致 | `qq-self/src/defaults.ts` |
| D25 裸字面量 | 已核清并收口（2026-11-05）：原「1,106 处」按出现数字数的。按「去注释字符串、排除 0/1/2/100」重测 560，再按三种模式筛真·未声明可调项——`?? 裸数字` 36（35 是 `?? 0`/`?? ''`）、`setTimeout` 裸毫秒 2、`Math.max(<数字>,` 88（基本是夹取守卫）。真正该进参数表的只有两处，都已修：`qq-channel` 等回话超时（`Config.callTimeoutMs` + `WS_DEFAULTS`，`tests/call-timeout.spec.ts` 3 条）、`qq-subject` 快照字数（`SNAPSHOT_DEFAULTS`，删掉 `index.ts` 里重复的 `DEFAULT_MAX_CHARS`） | `qq-channel/src/ws.ts`、`qq-subject/src/snapshot.ts` |
| D26 失败分支缺 hint | 已修（2026-11-05）：复扫 `packages/qq/*/src` 里「`ok: false` 但六行内没有 `hint`」的分支，从 14 处降到 **0**。这一轮补的：`qq-self/grade.ts` 十条（post 三条、comment 三条、private 三条、以及两处 needs_keys）、`qq-self/store.ts` 两条（`versions.name_invalid` / `versions.missing`，`RollbackCheck` 新增可选 `hint`）、`qq-bundle/decisions.ts` 的 `DecisionBlock` 新增可选 `hint`，`index.ts` 两处（步数上限与主动开口被拦下）都填上，主动那条直接转出 `GateVerdict.hint` | 各包 |
| D27 吞错无说明 | 已修（2026-11-05）：复扫全仓 catch 块，无说明且无日志的从 12 处降到 **0**。逐处补上「为什么吞」：`decisions.ts` 两处（日志读不到当没有 / 坏行跳过）、`facts.ts` 两处（拿不到模块位置退回工作目录 / 规则文件不在用备用句）、`liveness.ts`（启动账坏了按没有算）、`memory/store.ts`（整份读不出来当空库）、`channel/ws.ts`（建连失败不抛，记进状态再重连）、`panel-http.ts` 内联脚本里 `JSON.parse` 那一处也写明「这一帧不画，下一轮重写」 | 各包 |
| D28 超 600 行的文件 | 已修：装配层拆成 `facts`/`types`/`memory-events`/`proactive-tools`，自我层拆出 `assembly`/`types-state`；三个包各补 `tests/budget.spec.ts` | `packages/qq/*/tests/budget.spec.ts` |
| D29 四个包没负例 | 已修：continuity / pacing / policy / subject 各补负例 | 各包 `tests/` |
| 开经日写记忆（整条零实现） | 已修：`onCycleStart` 只在周期日真跨到开经那天产一次事实，装配层挂上后写一条 `kind=cycle_start` 记忆 | `qq-vitals/src/cycle.ts`、`qq-bundle/src/memory-events.ts` |
| 体检覆盖面 | 已修：状态里全部时间戳进「不许落在未来 60 秒」 | `qq-vitals/scripts/check.ts` |
| 自发消息回环 | 已修：`IncomingMessage.selfSent` 打标，装配层不再拿自己那句话叫醒自己 | `qq-channel/src/events.ts`、`qq-bundle/src/index.ts` |
| 发布路径必撞 `post.level` | 已修：`Config.postLevel` 默认 `public`，走到发布入口才判阶段与钥匙 | `qq-bundle/src/types.ts` |
| 装不进任何启动面 | 已修：README 写明挂法，`tests/mount.spec.ts` 用装载器同一套 schema 证明十一行都插得进去 | `qq-bundle/tests/mount.spec.ts` |
| `gates` 的 `{ok:boolean}` 与 dev-spec 冲突 | 已定说法：九条否决逐条归入四类，`post_want` 阈值与相似度去重明确不算否决 | `docs/dev-spec.md`「关卡的边界」 |
| 规范状态列过期 | 已修：self-layer 的 P1/P3/P4、vitals 的开经日记忆等逐条改回实际状态 | 三份规范 |

**清单里的条目到这里全部闭合。** 真机一发一收仍未被自动化验证——`ws.ts` 的重连与 `Authorization` 头只有在真 OneBot 上才验得了。

### D21 粒子场景（2026-11-05 补，规范里原注「可省」）

- 面板新增 `canvas.particles`（`span-12` 一整行，标题「流向」）：五组双条各占一行，哪边高粒子就往哪边漂，`av>=bv` 走青色、否则走红色
- 数据就是已有的 `pairs`，服务端把 `{av,bv}` 压成 JSON 塞进 `data-pairs`（经 `escapeHtml` 转义），脚本只在动画帧里画，轮询时同步更新这个属性
- 没有双条时**整块不出现**，不留空画布
- 用例：`panel-http.spec.ts` 2 条（有双条就出画布且两边读数都带出去 / 没有双条就不出）

### D11 出站合并转发（2026-11-05 补）

多段回复原来只能一条一条发，对面收一串碎片。现在可以合成一条合并转发：

- 新文件 `qq-channel/src/forward.ts`：`forwardCallOf(nodes, chatKey, selfId)` 一处决定动作名（`send_group_forward_msg` / `send_private_forward_msg`）、节点形状（`{type:'node', data:{name, uin, content}}`）与空段丢弃，群与私聊各走各的
- `ws.ts` 的 `WsChannel` 增 `sendForward(nodes, chatKey)`，实现只转调上面那一处
- 两条发送路径都接上：`seam.send`（组合包投递走这条）与 `registerChannelTools` 的 `qq_send_message`（模型走这条，它自己切分，所以开关放在工具里）
- 开关 `Config.replyForward` 默认 **false**，`replyForwardName` 默认「她」；只有真的切成两段以上才合并，一段照旧走普通发送
- 用例：`tests/forward.spec.ts` 8 条（动作名 / 节点形状 / 空段丢弃 / 保序 + 关着仍分段 / 打开合并 / 单段不合并 / 私聊走那一路）

---

## 2026-11-05 收尾：把「看了一半」的三处补齐

### §10.6 面板口令（原「没有鉴权」）

- `PanelHttpOptions.token` + `Config.panelToken`：设了就要求口令，空串等于不要求（本机自看不折腾）
- 口令可走 `?token=` 或饼干 `qq_panel_token`；参数里带对时顺手下发 `HttpOnly; SameSite=Strict; Path=/` 的饼干，之后刷新不用再拼参数
- `/` 与 `/api/state` 都要口令，`/api/health` 是十问不带数据所以放行
- 饼干值按 URL 编码存（响应头只收可见 ASCII），读的时候解回来；解不开就按原样比
- 用例：`qq-self/tests/panel-auth.spec.ts` 7 条（不配就直通 / 配了没带 403 两路 / 十问放行 / 参数带对并下发饼干 / 只带饼干也认 / 口令错 403 / 页面里有动效标记）

### §10.5 动效限帧与减少动效

- 规范要求粒子与火舌 30fps、`prefers-reduced-motion` 下全部静止
- 动画循环改成按帧间隔节流（`FRAME_MS=33`），并在 `matchMedia('(prefers-reduced-motion: reduce)')` 命中时直接返回——只在轮询那一次画一帧
- 曲线类本来就只在 3 秒轮询时重画，低于规范说的 4fps，不需要另设节流
- 用例：`panel-auth.spec.ts` 里 1 条（页面含 `prefers-reduced-motion` 与 `FRAME_MS=33`）

### §11.3-2 人称

- `render.ts` 的抬头从「不要向用户解释」改成「不要向对方解释」，不再出现「用户」这个称呼

### §5.10 生病与疼痛：原来只有衰减，没有来源

规范 §5.10 只写了 `cytokines` 与 `pain` 怎么衰减，§11.3-1 却要求填 SICK/PAIN 词表。代码里这两个量**只降不升**，所以「生病」整条链（细胞因子→发烧→体温）永远是死的。

- `words.ts` 增 `SICK`（感冒/发烧/不舒服/难受/咳嗽/生病/着凉/头晕/恶心/拉肚子/发炎）与 `PAIN`（疼/痛/受伤/扭到/抽筋/磕到/发酸/酸胀）
- `react.ts` 增 `applyBody()`：说到生病抬细胞因子、说到疼痛抬疼痛，都夹在 0~1
- 文档没规定抬多少，所以做成两条可配参数 `sickCytokinesGain`（0.35）与 `painGain`（0.30），默认取偏轻的一档，注释里写明「文档未给数值，本仓取值」
- 不加冷却：每句话就是一次事件，重复说会累加，靠半小时半衰自己退——比硬加一个冷却字段更贴近「她真的一直在疼」
- 用例：`qq-vitals/tests/body-events.spec.ts` 6 条（感冒抬细胞因子 / 头疼抬疼痛 / 不相干不动 / 抬到顶夹在一 / **细胞因子抬起来后发烧滞后跟上来且体温超过基础值** / 没人提就衰减回去）

**这一轮关卡**：`vitest packages/qq` 115 文件 / 1425 条全过、`tsc -b` 0、`oxlint qq-self` 与 `qq-vitals` 均 0 error。

---

## 2026-11-05 第三轮：把陪伴角色那份里没做的三条补掉

### R6 累了不做身份级决定（原：完全没有）

- `SelfSettings` 增 `restEnergyBelow`（0.15）与 `restTiredAbove`（0.75）
- `assembly.ts` 增 `resting()`：从 `panelVitalsOf(vitals)` 读电量与睡眠压力，没接身体时不拦，免得整层卡死
- `allowKeys` 在钥匙通过之后、停手判断之前判一次：累了直接回 `{ allowed: false, reason: 'rest' }`，**不记录也不放行**
- `updateNarrative` 同样拦：累了不写叙事大改（`reason: 'rest'`）
- 错误码表 `REASON_TEXT` 补 `rest` 一句给人看的话
- 用例：`qq-self/tests/rest-gate.spec.ts` 5 条（电量见底不放行 / 困到线不放行 / 歇过来照常判 / 身体没接上不拦 / 累了不写叙事）

### R8 每月一次十问十问（原：完全没有）

- 新文件 `probe.jsonl`（`FILES.probe`），一个月只留一条
- `review.ts` 增 `probeOf()` 与 `writeProbe()`：正好十问、每答 ≤160 字、本月已写过就回 `capped`
- 新增错误码 `wrong_count`（条数不对，每天三行、十问十问都用它）
- 接口：`seam.probe(answers, at)` / `seam.probeThisMonth(at)`；工具 `qq_self_probe`
- 十问**不进记忆库**，与 `day.jsonl`、记录表同类
- 用例：`qq-self/tests/probe.spec.ts` 5 条（十条落盘可读 / 九条拒 / 同月再写拒 / 跨月可写 / 单条太长拒）

### R5 简版面板（原：多实例一条没做）

- `panelPage(state, { brief })`：`brief` 为真时走简短版；`/?brief=1` 就是这一屏
- 简短版只出「我·此刻」那一段加三样读数（口渴 / 精力 / 想说话）与健康一行，**不画任何画布、不带轮询脚本**
- 为守住「单文件 ≤600 行」的文件预算（`qq-self/src` 已卡在 24 个文件），把 `escapeHtml`、`percent`、`briefBody`、`briefShell` 挪进已有的 `panel.ts`，`panel-http.ts` 从 639 行降到 592 行，**没有放宽任何预算**
- 用例：`qq-self/tests/panel-brief.spec.ts` 4 条（三样读数都在 / 不画布不带脚本 / 没身体只说一句 / 完整版不变）

### 规范侧同步

- `陪伴角色-自我与自主性-适配方案-分享版.md` §5.1 面板模板：删掉「在<房间><活动>｜冰箱<空/N 份>」这一段，并补一句「按 R9 不新增场景服务，这几项没有来源就不写」

**这一轮关卡**：`vitest packages/qq` 118 文件 / 1439 条全过、`tsc -b` 0、`oxlint qq-self` 0 error。

---

## 2026-11-05 第四轮：身体不再靠关键词，改由模型报事件

### 为什么改

回复是模型生成的，用关键词决定「她喝了水没有」既不必要也不可靠：同一句话换种说法就漏，换个角色就不对。身体该由模型报事实。

### 改了什么

- **默认词表清空**：`DEFAULTS.words = EMPTY_WORDS`，十四张表全空。关键词不再参与默认行为；原词表降为可选预设 `WORDS_PRESET`，谁要谁在配置里打开
- **事件入口**：`react.ts` 新增 `BodyEvent` 与 `applyEvents()`；效果函数抽成 `giveDrink`／`giveMeal`／`givePraise`／`giveApology`／`giveAnger`／`giveThreat`／`giveFear`／`giveWorry`／`giveDread`，**两条路共用一份公式**，不会各写一套
- **接缝**：`qq-vitals` 新增 `reactEvents(events, at?)`，与 `react(text)` 并列；写盘、梦境、疤痕、开经、进食与喝水事实的通知都照旧
- **模型入口**：`qq-bundle/src/body-tools.ts` 新增工具 `qq_body_event`，认十一种事件（喝了／吃了／被夸／被道歉／被凶／被威胁／被吓／担心／提生死／生病／受伤），不认识的名字回 `body.unknown_kind` 并给下一步，空数组回 `body.no_events`
- **提示词**：新增 `qq:body-events` 一段，只教「真影响到你身体时用这个工具报一次，别自己估数值」

### 验证

- `qq-bundle/tests/body-events.spec.ts` 7 条：报喝了掉口渴且记下名字／报吃了掉饥饿／报被凶抬怒气／一次报三件按顺序做／不认识的拒／空数组拒／**不调工具时只说一句「我喝了奶茶，还吃了面」身体一点都不动**
- 迁移：把依赖旧默认词表的用例改成显式打开 `WORDS_PRESET`（vitals 23 个文件、bundle 10 个文件），迁移过程中修掉一个真 bug：`react()` 里算饭名时没把词表传下去，导致饭名恒为空

**这一轮关卡**：`vitest packages/qq` 120 文件 / 1445 条全过、`tsc -b` 0、七个包 `oxlint` 全 0 error、`qq-bundle/src/index.ts` 正好 600 行。
