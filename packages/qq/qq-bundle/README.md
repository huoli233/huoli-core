---
description: "把 QQ 机器人的各个零件装成一个可挂载的整体：说话规矩、每天整理、每轮步数上限、每轮决策痕迹、工具白名单、记忆注入、主动开口的接线。"
kind: "package-bundle"
---

# qq-bundle

## Summary

把 QQ 机器人的各个零件装到一起：说话规矩、每天整理、每轮步数上限、每轮决策痕迹、工具白名单、记忆注入、主动开口的接线。挂上这一行，前面那些零件包就都起来了。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

提示词末尾多一段说话规矩；每轮走多少步由 `maxSteps` 管，超了就停。规矩前面还有一段 `qq:reply-budget`（`order` 350），写的是这一轮最多说几条：数字由 `qq-pacing` 的 `replyBudget` 按身体那份状态算出来，只说上限，不说该不该回；这一段末尾还有一句「想发动态时把这条交给发布入口」，只指路，不改人设也不新增段落。用户原话那条消息的尾部会多一小段背景：`agent/pre-step` 里拿这一轮用户的原话去召回，命中就用 `buildInjectBlock` 拼成「你记得的一些事，只作参考」那段，再由 `injectIntoUserText` 接在原话之后，中间隔一个空行；没有命中就不加，一个占位字都不补，这段夹在用户消息里，不进系统提示词，也不进工具结果。

#### Token effect

规矩那段是固定的，几百字；条数那一段只有一句；步数上限防止一路空转。注入那段随命中变化，整串不超过 `memoryInjectMaxChars`（默认与记忆包同一份，1200 字），最多 `memoryInjectMaxItems` 条（默认 3）。

#### KV Cache effect

规矩那段固定在末尾，不影响前面的缓存；条数那一段随身体每轮可能变，注入那段随每轮命中变，两段都在尾部，不动前面已经缓存的前缀。

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
- 提示词里那句「把这条交给发布入口」现在指得到工具：`qq-channel` 注册了 `qq_publish_post`，参数只有正文与级别。级别只报 `routine` 或 `public` 两级，工具不替模型判该不该发。
- 注入只在带用户原话的那一步发生：被主动唤醒、没有用户消息的那一轮不召回，也不补占位文字。
- 去重窗口按轮数记，而且只记在本进程里：进程重启后第一次带原话的那一轮会重新插一次。
- 注入的查询只用这一步的用户原话，不回头读注意力收件箱里更早的入站。
- 决策痕迹只在轮次边界落盘，进程被强杀时手上那一轮会丢。
- 工具白名单只按工具名判，不看参数。
- 主动开口的候选只来自心里惦记着的事，去重靠素材仓自己删，还没拿已经说过的话再筛一遍。
- 主动开口只在轮次收尾与入站之后问，没有独立的定时唤醒：很久没人说话时她不会自己开口。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：规矩文件位置、每天整理的小时、每轮步数上限、入站节流间隔、记忆注入开关与它的三个上限；规矩正文放在 `prompts/rules.md`，组合行写在 `qq.patch.yml`。收消息这条链在 `apply` 里接：通道每送来一条入站，先按编号去重，有正文的交给 `qq-vitals` 的 `react` 改身体，再塞进注意力收件箱、把当前会话记成活跃的那个；卸载时把这两个处理函数注销。

每天那一步也顺带镜像：装配时把 `qq-memory` 接给 `qq-self` 的 `useMemory(port)` 端口，整点检查落在整理那一小时时，先 `promote()`、再 `sweep()`，然后 `mirror()` 把自我层没镜过的三类记录写进记忆库，写入条数大于零就立刻 `ledger('sync')` 入账，免得下一次核对把镜像当成正文被改；自我层默认关着，关着时 `mirror()` 自己回 `disabled`，一条都不写。这一步里任何一处抛错都只记一行告警，不让定时器把进程带走。

条数那一段的接线：`replyFactsOf` 把累（`adenosine`）、烦（`irritability`）、精力、黏、孤独照抄成 `ReplyFacts`，交给 `replyBudget` 取上限；身体没装上时用一份中性事实，上限照样是一个数。发送链路没有改动。

停手那一路的接线：装配时把 `qq-self` 的 `isPaused()` 接到 `qq-channel` 的 `usePause(check)` 端口，摆着停手开关时发布入口只回 `post.paused`，一条动态都不发；自我层没装上也接，接到的是一个恒为假的判断。

决策痕迹在 `src/decisions.ts`：`createDecisionLog` 只追加，写入走同目录临时文件再改名，一行一条；读回来逐行校验，坏行跳过。`apply` 在 `agent/pre-step` 的第 1 步开一轮，把 `qq-channel` 送来的入站记成唤醒事实；`agent/turn-stopping` 收一轮并追加；`qq-channel` 的 `onOutbound` 只报事实（调没调、发了几条、被哪条闸门拦下），正文不落盘。排查入口是 `qqBundleOf(ctx).decisions(sinceAt, limit)`，没有注册成工具，也没挂进提示词。

工具白名单在 `src/tool-whitelist.ts`：名单不空时用 `ctx.tools.guard()` 注册一个单调守卫，名单外的工具名一律拒，理由里带 `qq.tool_not_allowed` 与下一步；名单空着就不注册，只在启动时打印一次。

主动开口的接线在 `apply` 的后半段：装配时取 `qq-proactive` 与 `qq-material` 两个仓，`qq-proactive` 那一行的 `enabled` 为假时一次都不问、也不写盘。开着时两个入口进来——`agent/turn-stopping` 每轮收尾问一次，`qq-channel` 的 `onIncoming` 在入站之后问一次并按 `proactiveThrottleMs` 节流（默认一分钟）。候选来自素材仓里这个会话惦记着的事，只带原话、来源与到达时刻，不带把握、有用程度与风险。攒住以后立刻 `preview(chatKey)` 摆出来，投递只认摆过的编号；每次问都往决策记录追加一行，理由码把闸门码的点换成冒号。

记忆注入的接线在 `apply` 的末尾：`memoryInject` 为真时注册一个 `agent/pre-step` 监听，先 `next()` 拿到这一步要进的消息，被前面那条步数上限拒掉时就原样返回、一次都不召回。拿到以后只挑 `source.kind` 是 `user` 的那几条拼成查询（运行环境那段也挂在 user 上，它的 `source.kind` 不是 `user`，所以不会被当成用户问的话），再用 `shouldInject(turn, 上一次插入的轮, memoryInjectRepeatTurns)` 判这一轮要不要插；要插就把召回结果交给 `buildInjectBlock`，块为空就原样返回，非空才改写最后那条用户消息的正文块，并把这一轮记进去重表。三个上限直接取自配置，默认值表里引用 `qq-memory` 的 `DEFAULTS`，只有一份真相；开关关着时这个监听根本不注册。
