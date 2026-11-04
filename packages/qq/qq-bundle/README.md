---
description: "把 QQ 机器人的各个零件装成一个可挂载的整体：说话规矩、每天整理、每轮步数上限、每轮决策痕迹、工具白名单、主动开口的接线。"
kind: "package-bundle"
---

# qq-bundle

## Summary

把 QQ 机器人的各个零件装到一起：说话规矩、每天整理、每轮步数上限、每轮决策痕迹、工具白名单、主动开口的接线。挂上这一行，前面那些零件包就都起来了。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

提示词末尾多一段说话规矩；每轮走多少步由 `maxSteps` 管，超了就停。规矩前面还有一段 `qq:reply-budget`（`order` 350），写的是这一轮最多说几条：数字由 `qq-pacing` 的 `replyBudget` 按身体那份状态算出来，只说上限，不说该不该回。

#### Token effect

规矩那段是固定的，几百字；条数那一段只有一句；步数上限防止一路空转。

#### KV Cache effect

规矩那段固定在末尾，不影响前面的缓存；条数那一段随身体每轮可能变。

##### Decision trace

```markdown
每轮结束往 data/qq-decisions.jsonl 追加一行：at、chatKey、awake、reason、attempted、sent、blocked。
reason 放唤醒理由码（incoming、poke），blocked 只放闸门码与下次时间；这一行不进提示词、不进记忆，也不含模型原文与用户原文。
主动开口也往同一个文件追加：每问一次要不要开口就落一行，reason 是 proactive:<结果码>；被闸门拦下时 blocked 同时写码与下次时间，awake 恒为 false、sent 恒为 0。
```

## Known Limitations and Deferred Work

- 每天整理是每小时看一眼时间，不是真正的定时器。
- 压缩只调了参数，没有换成聊天口吻的摘要。
- 每个包的数据文件各自一个，还没统一到一处。
- 自己发出去的消息（`message_sent`）也会当入站算一次，装配层这边没有自己的号可以判。
- 步数用满被拒时那一轮的 `blocked.retryAt` 是空的：下一轮由下一次唤醒开，这里给不出时刻。
- 决策痕迹只在轮次边界落盘，进程被强杀时手上那一轮会丢。
- 工具白名单只按工具名判，不看参数。
- 主动开口的候选只来自心里惦记着的事，去重靠素材仓自己删，还没拿已经说过的话再筛一遍。
- 主动开口只在轮次收尾与入站之后问，没有独立的定时唤醒：很久没人说话时她不会自己开口。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：规矩文件位置、每天整理的小时、每轮步数上限、入站节流间隔；规矩正文放在 `prompts/rules.md`，组合行写在 `qq.patch.yml`。收消息这条链在 `apply` 里接：通道每送来一条入站，先按编号去重，有正文的交给 `qq-vitals` 的 `react` 改身体，再塞进注意力收件箱、把当前会话记成活跃的那个；卸载时把这两个处理函数注销。

每天那一步也顺带镜像：装配时把 `qq-memory` 接给 `qq-self` 的 `useMemory(port)` 端口，整点检查落在整理那一小时时，先 `promote()`、再 `sweep()`，然后 `mirror()` 把自我层没镜过的三类记录写进记忆库，写入条数大于零就立刻 `ledger('sync')` 入账，免得下一次核对把镜像当成正文被改；自我层默认关着，关着时 `mirror()` 自己回 `disabled`，一条都不写。这一步里任何一处抛错都只记一行告警，不让定时器把进程带走。

条数那一段的接线：`replyFactsOf` 把累（`adenosine`）、烦（`irritability`）、精力、黏、孤独照抄成 `ReplyFacts`，交给 `replyBudget` 取上限；身体没装上时用一份中性事实，上限照样是一个数。发送链路没有改动。

决策痕迹在 `src/decisions.ts`：`createDecisionLog` 只追加，写入走同目录临时文件再改名，一行一条；读回来逐行校验，坏行跳过。`apply` 在 `agent/pre-step` 的第 1 步开一轮，把 `qq-channel` 送来的入站记成唤醒事实；`agent/turn-stopping` 收一轮并追加；`qq-channel` 的 `onOutbound` 只报事实（调没调、发了几条、被哪条闸门拦下），正文不落盘。排查入口是 `qqBundleOf(ctx).decisions(sinceAt, limit)`，没有注册成工具，也没挂进提示词。

工具白名单在 `src/tool-whitelist.ts`：名单不空时用 `ctx.tools.guard()` 注册一个单调守卫，名单外的工具名一律拒，理由里带 `qq.tool_not_allowed` 与下一步；名单空着就不注册，只在启动时打印一次。

主动开口的接线在 `apply` 的后半段：装配时取 `qq-proactive` 与 `qq-material` 两个仓，`qq-proactive` 那一行的 `enabled` 为假时一次都不问、也不写盘。开着时两个入口进来——`agent/turn-stopping` 每轮收尾问一次，`qq-channel` 的 `onIncoming` 在入站之后问一次并按 `proactiveThrottleMs` 节流（默认一分钟）。候选来自素材仓里这个会话惦记着的事，只带原话、来源与到达时刻，不带把握、有用程度与风险。攒住以后立刻 `preview(chatKey)` 摆出来，投递只认摆过的编号；每次问都往决策记录追加一行，理由码把闸门码的点换成冒号。
