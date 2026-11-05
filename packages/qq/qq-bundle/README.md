---
description: "把 QQ 机器人的各个零件装成一个可挂载的整体：说话规矩、每天整理、队列节拍、每轮步数上限、每轮决策痕迹、工具允许的名单、记忆放进、主动开口、想发动态与进食记忆的接线。"
kind: "package-bundle"
---

# qq-bundle

## Summary

把 QQ 机器人的各个零件装到一起：说话规矩、每天整理、队列节拍、每轮步数上限、每轮决策痕迹、工具允许的名单、记忆放进、主动开口的接线，把身体那股想发动态的劲交给她，再把吃过的每一顿写成一条记忆。挂上这一行，前面那些零件包就都起来了。

## Table of Contents

- [怎么挂进启动面](#怎么挂进启动面)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 怎么挂进启动面

这一行不是随发行版启动的默认组合，要由 profile 点名才会挂上。清单里已经声明 `huoli.bundle.patch` 指向 `qq.patch.yml`，所以装法与内核其它组合包一样：先把本包链接到运行环境，再把包名写进该 profile 的 `huoli.profile.bundles`，顺序排在 `@huoli/huoli-base` 之后。

```json
{
  "huoli": {
    "profile": {
      "bundles": ["@huoli/huoli-base", "@huoli/huoli-qq-bundle"]
    }
  }
}
```

连 OneBot 那头的三个值由环境变量给：`QQ_ONEBOT_URL`（默认 `ws://127.0.0.1:6700`）、`QQ_SELF_ID`、`QQ_ACCESS_TOKEN`。`QQ_SELF_ID` 要填机器人自己的号，入站才能认出自己发出去的消息，不当成别人说话再叫醒自己。出厂配置里 `qq-proactive` 与 `qq-self` 都是 `enabled: false`，主动开口与自我层（含只读面板）默认不露出来；要用时在该 profile 的 `cordis.patch.yml` 里按 id 覆盖这两行，并给 `qq-self` 配 `panelPort`（默认 0 为不监听）。

`tests/mount.spec.ts` 用装载器同一套 `entryListSchema` 与 `applyEntryPatches` 证明：清单声明的 patch 解得开、十一个零件行都插进基线、装配行排在最后、压缩那一行被覆盖；没把本包列进 profile 时一条 QQ 行都没有。

## Model Experience

### Prompt content

#### What the model sees

提示词末尾多一段说话规矩；每轮走多少步由 `maxSteps` 管，超了就停。离上限还差 `wrapUpSteps`（默认 8）步时会插一句「该收尾了」：要说就调 `qq_send_message`，不说就把这一轮结束，别继续调工具——没有这一句，模型可以一路调工具到顶，整轮连同「本来想说什么」一起被丢掉。规矩前面还有一段 `qq:reply-budget`（`order` 350），写的是这一轮最多说几条：数字由 `qq-pacing` 的 `replyBudget` 按身体那份状态算出来，只说上限，不说该不该回；这一段末尾还有一句「想发动态时把这条交给发布入口」，只指路，不改人设也不新增段落。另有四段只陈述事实的短段，接不接、说不说都由模型自己定：`qq:proactive-pending`（`order` 360）列出攒着的由头与编号、`qq:attention`（340）写谁在叫她、现场多热以及她给自己设的唤醒偏好、`qq:material`（330）写现场素材、`qq:continuity`（320）写上次收尾的话头与事后回想；四段都没有内容时整段不出现，一个位置字都不留。用户原话那条消息的尾部会多一小段背景：`agent/pre-step` 里拿这一轮用户的原话去召回，命中就用 `buildInjectBlock` 拼成「你记得的一些事，只作参考」那段，再由 `injectIntoUserText` 接在原话之后，中间隔一个空行；没有命中就不加，一个位置字都不补，这段夹在用户消息里，不进系统提示词，也不进工具结果。投递这一头多一个模型可见工具 `qq_deliver_proactive`，参数是候选编号与可选的改写正文。

#### Token effect

规矩那段是固定的，几百字；条数那一段只有一句；步数上限防止一路空转。放进那段随命中变化，整串不超过 `memoryInjectMaxChars`（默认与记忆包同一份，1200 字），最多 `memoryInjectMaxItems` 条（默认 3）。

#### KV Cache effect

规矩那段固定在末尾，不影响前面的缓存；条数那一段随身体每轮可能变，放进那段随每轮命中变，两段都在尾部，不动前面已经缓存的前缀。

##### Decision trace

```markdown
每轮结束往 data/qq-decisions.jsonl 追加一行：at、chatKey、awake、reason、attempted、sent、blocked。
reason 放唤醒理由码（incoming、poke），blocked 只放关卡码与下次时间；这一行不进提示词、不进记忆，也不含模型原文与用户原文。
主动开口也往同一个文件追加：每问一次要不要开口就落一行，reason 是 proactive:<结果码>；被关卡拦下时 blocked 同时写码与下次时间，awake 恒为 false、sent 恒为 0。睡着与被吵醒两种情形各有自己的码：`proactive:asleep` 的 `blocked.retryAt` 取身体排的醒点，`proactive:waking` 取延后到的时刻。
```

## Known Limitations and Deferred Work

- 每天整理是每分钟看一眼时间，到点那一次只做一遍，不是独立的定时器。
- 压缩只调了参数，没有换成聊天口吻的摘要。
- 每个包的数据文件各自一个，还没统一到一处。
- 步数用满被拒时那一轮的 `blocked.retryAt` 是空的：下一轮由下一次唤醒开，这里给不出时刻。
- 收尾提醒只在第 `maxSteps - wrapUpSteps` 步插一次，插完模型要是不听，还是会一路走到上限被拒；提醒管不了不听话，只能把两条路写清楚。
- 决策记录里的 `kind`、`steps`、`wrapped` 与 `lastTool` 是新加的几栏：老日志没有这几项，读回来不会凭空补 `0` 与 `false`。`kind` 取 `round`（跑完的一轮）或 `considered`（主动开口的一次考虑），有了它才分得清 `awake: false` 是“没被叫醒”还是“这一行本来就不是一轮”；`lastTool` 记这一轮最后一个 `tool/call` 的工具名，用来定位空转。
- 提示词里那句「把这条交给发布入口」现在指得到工具：`qq-channel` 挂上了 `qq_publish_post`，参数只有正文与级别。级别只报 `routine` 或 `public` 两级，工具不替模型判该不该发。
- 放进只在带用户原话的那一步发生：被主动唤醒、没有用户消息的那一轮不召回，也不补位置文字。
- 去重窗口按轮数记，而且只记在本进程里：进程重启后第一次带原话的那一轮会重新插一次。
- 放进的查询只用这一步的用户原话，不回头读注意力收件箱里更早的入站。
- 决策痕迹只在轮次边界落盘，进程被强杀时手上那一轮会丢。
- 工具允许的名单只按工具名判，不看参数。
- 主动开口的候选来自心里惦记着的事与身体那股想发动态的劲；已发正文只在本进程里留最近二十条给去重，重启后从头记。
- 主动开口只在轮次收尾与入站之后问，没有独立的定时唤醒：很久没人说话时她不会自己开口。
- 动态候选只有由头与读数，没有正文：正文要在投递时给，没给就回 `bundle.no_body`，不拿由头当正文发出去。
- 投递被发布入口拒了，待发里那一条已经划掉，冷却与今天那一次开口额度也算用掉。
- 「今天攒过动态候选」只记在本进程里：进程重启后同一天会再攒一次。
- 每日维护那一次看的是当前活跃会话，一次活跃会话都没有时这条路径不攒候选。
- 进食记忆写在当前活跃会话里：一次活跃会话都没有时这一顿记不下来，只留一行告警。
- 进食记忆同一时段只写一条：同一天同一个时段里的第二顿不再写，换时段或换一天才写新的。
- 维护日志一行只记前后两次核对的条数与判据三、四的违规：镜像这次拆开了几行、几条因证据查不到而跳过没有进日志，只留在 `mirror()` 的返回值里。
- 判据三、四只在维护日志里留痕，不拦新项目，也不改已有行的 `outcome`。
- 遗书正文由模型自己写的那一半只看同一天：模型早一天写过、到线那天没再写，就按备用那句记，前一天那句不会补上去。
- 遗书那句记下来之后暂存槽不清空，同一天再问也只是回 `farewell.duplicate`；跨天由身体那边自己重新产事实。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：规矩文件位置、每天整理的小时、每轮步数上限、入站节流间隔、记忆放进开关与它的三个上限、想发动态的两项（阈值 `addPostWantFrom` 与同一天最多攒几条 `postCandidateDailyMax`）、每日维护日志的位置 `maintenanceLogFile`，进食记忆的开关与它的重要度，以及遗书记忆的开关、重要度、`farewellText`（模型没写过时用的那句）与暂存槽位置 `farewellFile`；规矩正文放在 `prompts/rules.md`，组合行写在 `qq.patch.yml`。收消息这条链在 `apply` 里接：通道每送来一条入站，先按编号去重，有正文的交给 `qq-vitals` 的 `react` 改身体，再塞进注意力收件箱、把当前会话记成活跃的那个；卸载时把这两个处理函数撤掉。

每天那一步的接线在 `src/maintenance.ts`：装配时把 `qq-memory` 按镜像那一面要的三件事（已经镜过的来源键、记忆库现役的编号、写一条）包一层交给 `qq-self` 的 `useMemory(port)`，整点检查落在整理那一小时时走一次 `runMaintenance`：先用 `ledger('verify')` 核一遍镜像前的账，再 `maintain(now)` 走完当天的掉分、变淡、退役与补账并写一行健康记录，接着 `mirror(now)` 把自我层没镜过的三类记录写进记忆库，写入条数大于零就立刻 `ledger('sync')` 记进记录表，最后再 `verify` 一次，两次条数连同 `qq-self` 的 `audit(now)` 查出的判据三、四违规拼成一行写进维护日志（`[maintenance] <日期> 镜像前 N 条一致 / 镜像后 M 条一致；…`，默认落在 `data/qq-maintenance.log`）。自我层默认关着，关着时 `mirror()` 自己回 `disabled`，一条都不写；记忆仓没装上时整步不做，也不写日志。这一步里任何一处抛错都只记一行告警，不让定时器把进程带走。每天这一次也算一次例行时刻：读完这一份身体，想发动态的劲高过阈值就在这里攒一条候选交给主动性，当前没有活跃会话时不问。

维护日志的每一行都记死这次维护的两个时刻：`镜像前` 是 `maintain` 之前的核对，`镜像后` 是镜像记进记录表之后的核对，两边各带对得上的条数与三类差异（丢了几条、正文被改几条、还没进记录表几条）；判据三、四一条违规都没有时写「判据三、四都没违规」，有就按条把整句接在后头。

队列节拍的接线：`agent/turn-stopping` 每轮先落一行轮次记录，再调一次 `memory.tick(Date.now())` 推进待写队列（每 4 轮排空、每 10 轮反思）。这一步失手只记一行告警、不拦这一轮，也不回滚已经落下的那一行；每日维护仍走 `maintain`，它内部已经排过空，`tick` 到点那一轮见队列空着就不再排一遍。

队列的入队那头：一轮真把话发出去（`sent > 0`）时，收尾会把她让我发的那句 `enqueue` 进记忆队列，参数是 `layer: 'episodic'`、`source: 'chat'`、`at` 取这一轮开始时刻。要发的话从 `session/event` 里的 `tool/call` 取：只有 `qq_send_message` 的参数 `text` 算数，取不到就当这一轮没说话。入队沿用记忆包自己的门槛——短过 `minTextChars`（默认 4 字）、长过 `maxTextChars`、重要度低于 `writeMinImportance` 的那几种会被拒，拒了不报错，只在记忆包的 `droppedLow` 与队列文件里计数。

想发动态的接线：`postWantCandidateOf` 从 `qq-vitals` 的 seam 读 `post_want`，高过 `addPostWantFrom`（默认 0.30，可被 `Config` 覆盖）就攒一条候选——`kind` 取 `share`、`why` 写清由这股劲与眼下状态、`postWant` 带上读数、正文留白——再从 `consider` 的可选入参 `external` 递进去，只走关卡，不评分、不排序、不决定发不发。同一天同一个会话最多攒 `postCandidateDailyMax`（默认 1）条，而且只有攒成（关卡放行）才算数，被关卡拦下时同一天还有机会。主动性关着时既不读也不写。投递走 `qqBundleOf(ctx)` 的 `deliver(chatKey, id, 正文)`：先由主动性判它有没有先 `preview` 过；想发动态的那一条交给 `qq-channel` 的 `publish('post', 正文, { chatKey, level })`，级别取 `postLevel`（默认 `public`）；不是动态的那一条（例如心里惦记着的事）走同一条链上的 `send(正文, chatKey)`，只过出站体检、频控与切分，公开动态那套级别与钥匙一条都不碰。

条数那一段的接线：`replyFactsOf` 把累（`adenosine`）、烦（`irritability`）、精力、黏、孤独照抄成 `ReplyFacts`，交给 `replyBudget` 取上限；身体没装上时用一份中性事实，上限照样是一个数。同一个数既渲染成提示词里那句「这一轮最多说几条」，也经 `qq-channel` 的 `useReplyCap(provide)` 交给发送路径，两处读的是同一个函数，不会对不上。

停手那一路的接线：装配时把 `qq-self` 的 `isPaused()` 接到 `qq-channel` 的 `usePause(check)` 端口，摆着停手开关时发布入口只回 `post.paused`，一条动态都不发；自我层没装上也接，接到的是一个恒为假的判断。

决策痕迹在 `src/decisions.ts`：`createDecisionLog` 只追加，写入走同目录临时文件再改名，一行一条；读回来逐行校验，坏行跳过。`apply` 在 `agent/pre-step` 的第 1 步开一轮，把 `qq-channel` 送来的入站记成唤醒事实；`agent/turn-stopping` 收一轮并追加；`qq-channel` 的 `onOutbound` 只报事实（调没调、发了几条、被哪条关卡拦下），正文不落盘。排查入口是 `qqBundleOf(ctx).decisions(sinceAt, limit)`，没有挂上成工具，也没挂进提示词。

工具允许的名单在 `src/tool-whitelist.ts`：名单不空时用 `ctx.tools.guard()` 挂上一个单调守卫，名单外的工具名一律拒，理由里带 `qq.tool_not_allowed` 与下一步；名单空着就不挂上，只在启动时打印一次。

主动开口的接线在 `apply` 的后半段：装配时取 `qq-proactive` 与 `qq-material` 两个仓，`qq-proactive` 那一行的 `enabled` 为假时一次都不问、也不写盘。开着时两个入口进来——`agent/turn-stopping` 每轮收尾问一次，`qq-channel` 的 `onIncoming` 在入站之后问一次并按 `proactiveThrottleMs` 节流（默认一分钟）。候选来自素材仓里这个会话惦记着的事，只带原话、来源与到达时刻，不带把握、有用程度与风险。攒住以后立刻 `preview(chatKey)` 摆出来，投递只认摆过的编号；每次问都往决策记录追加一行，理由码把关卡码的点换成冒号。问之前先从 `qq-vitals` 的 seam 读一次身体，把睡眠三项事实照抄进 `consider`：`asleep` 取 `asleep`、`wakeAfter` 取 `wake_after`、`waking` 取 `sleep_state === 'waking'`；身体没装上时这三项一个都不传，按醒着算。

记忆放进的接线在 `apply` 的末尾：`memoryInject` 为真时挂上一个 `agent/pre-step` 监听，先 `next()` 拿到这一步要进的消息，被前面那条步数上限拒掉时就原样返回、一次都不召回。拿到以后只挑 `source.kind` 是 `user` 的那几条拼成查询（运行环境那段也挂在 user 上，它的 `source.kind` 不是 `user`，所以不会被当成用户问的话），再用 `shouldInject(turn, 上一次插入的轮, memoryInjectRepeatTurns)` 判这一轮要不要插；要插就把召回结果交给 `buildInjectBlock`，块为空就原样返回，非空才改写最后那条用户消息的正文块，并把这一轮记进去重表。三个上限直接取自配置，默认值表里引用 `qq-memory` 的 `DEFAULTS`，只有一份真相；开关关着时这个监听根本不挂上。

进食记忆的接线：`mealMemory` 为真且身体接上时，装配阶段就 `onMeal` 挂上一次，一顿饭真写回的那次才进来；挂上用一个 `ctx.effect` 备用，卸载时撤掉。正文由 `src/meal.ts` 的 `mealText` 拼成「时段词 + 吃了 + 吃的东西」，时段词按这一顿的本地时分落在早上、中午、下午、晚上、夜里五档，没认出食物名就说吃了饭；`mealMetadata` 带上 `kind`、`at`、`name`，`layer` 取 `episodic`、`source` 取 `chat`、重要度取 `mealMemoryImportance`（默认 30，可被 `Config` 覆盖），会话取 `qq-subject` 记的当前活跃会话。去重只读记忆本身：`mealWritten` 在同一会话里找 `metadata.kind` 是 `meal`、本地日期与时段词都相同的那一条，有就跳过，不另建去重文件。写入那条路任何异常都只记一行告警，被叫到时做的事照常返回，身体那条路与别的挂上去的那些都不受影响。

遗书记忆的接线：`farewellMemory` 为真且身体接上时，装配阶段就 `onFarewell` 挂上一次，`qq-vitals` 在那一拍产出一条事实才进来，挂上同样用一个 `ctx.effect` 备用、卸载时撤掉。正文先看模型自己写过没有：读 `qq-channel` 那份暂存槽（`farewellFile`，默认与通道同一处 `data/qq-farewell.json`），槽里那句话与到线那天是同一个本地日才算数，`farewellTextAt` 判这一条；写过就用它，没写才走 `farewellText`——`farewellText` 这个配置给了模型文本就用它，没给就写那句中性的「有些话想留给她」，这一包不编造具体内容。`farewellMetadata` 带上 `kind: 'farewell'`、`at`、`mortality` 与 `authoredBy`（模型写的是 `model`，走的备用是 `fallback`），`layer` 取 `semantic`、`source` 取 `chat`、重要度取 `farewellMemoryImportance`（默认 95，压在保护线以上，可被 `Config` 覆盖），会话取当前活跃会话。去重只读记忆本身：`farewellWritten` 在同一会话里找 `metadata.kind` 是 `farewell`、本地日期相同的那一条，有就跳过。暂存槽文件在却读不动时只记一行告警、接着按没写过办，写入失败同样只记一行告警，被叫到时做的事照常返回，消息那条路与别的挂上去的那些都不受影响；开关关着时一个挂上都不挂上。
