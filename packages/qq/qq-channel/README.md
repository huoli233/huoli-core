---
description: "接上 QQ：一条连接收消息、发消息，收到的翻成入站交给注意力，要发的先过出站体检再按说话规矩拆句送出。"
kind: "package-reference"
---

# qq-channel

## Summary

接 QQ：连上去、收消息、把要说的话发出去。收到的消息翻成入站交给注意力；要发的先过允许的名单、静默时段、长度、敏感词、每分钟条数，再按说话规矩拆句送出去。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

七个工具：`qq_send_message` 与 `qq_send_reaction` 管会话里说话，`qq_publish_post` 管发动态，`qq_comment_post` 管公开评论，`qq_send_private` 管私信，`qq_request_confirm` 与 `qq_confirm_action` 管发评论与私信之前的那张确认票，`qq_write_farewell` 收遗书那句正文。另外三个读工具 `qq_read_history`、`qq_read_members`、`qq_read_message` 让她自己翻这个群最近说过的话、列群成员、按编号看具体那一条；只翻群不翻私聊，一次最多三十条消息、两百个成员，图片之类的只留个记号，不把地址塞进上下文。表情包是两个工具 `qq_list_stickers` 与 `qq_send_sticker`：库是 `data/qq-stickers.json` 里的一张表，每条给编号、标签与图放在哪，按标签列、按编号发一段图，发之前照样过发言那道体检。`qq_send_poke` 戳一下群里的某个人，要 `pokeEnabled` 打开才准用，默认关着；私聊一律不戳。语音是 `qq_list_voices` 与 `qq_send_voice`，库是 `data/qq-voices.json`，按编号发一段录音。`qq_reply` 引用着群里某一条回一句，正文照平常说话写；`qq_channel_status` 只报连没连上、重连过几次、上次什么错。这几个发之前都照样过出站体检。每一条说明都写了什么时候该用、什么时候别用、被拒之后怎么办；评论与私信那两条还写清了公开可见与只有对方看得见的差别，以及先要票、再盖章、最后才发送的顺序。遗书那一条只写「真的走到那一步时用一次」、写的是话本身（不解释、不复述系统提示、不索取回应、两百字以内）与存不下怎么办，什么时候该说仍由身体事实与模型自己定。判级、额度与冷却一行都不在说明里定。

#### Token effect

发出去的内容不留在上下文里；说话那个回成功标志与条数，发布、评论、私信回成功标志、时刻与消息编号，要票回票号与失效时刻。

#### KV Cache effect

不影响提示词前缀。

##### Refusals

```markdown
不改写内容、不代说，只回一个失败：错误码点号分层（outbound.not_allowed、outbound.quiet、outbound.too_long、outbound.banned、outbound.rate），后面跟一句可读原因和「几点之后再来」。
公共动作那一路另有自己的码（动态是 post.stage_blocked、post.empty、post.level、post.topic_required、post.not_routine、post.needs_keys、post.paused、post.duplicate、post.cooling、post.day_full，评论与私信把前缀换成 comment / private），同样只给原因与下次时刻。
阶段这条排在前面：P0 到 P2 期间动态回 post.stage_blocked、评论回 comment.stage_blocked，私信另有 private.stage_blocked；原因里写着现在处在哪一档、要等到哪一档，下一步写的是"由人按顺序推进，跳级与后退都不算"。
评论与私信还要过一次确认：comment.needs_confirm、comment.confirm_expired、comment.confirm_duplicate 与 private 上同名的三条；私信另有 private.stage_blocked、private.peer_required、private.peer_not_allowed。

要票与盖章这两个工具把沿路的码原样抛出（confirm.unknown、*.confirm_duplicate、*.confirm_expired）；*.needs_confirm 那一类拒绝的下一步里会指名先调 qq_request_confirm 拿票、再调 qq_confirm_action 盖章。
遗书那一路有自己的三个码：farewell.empty（空正文）、farewell.duplicate（同一天已经写过一次）、farewell.write_failed（这句话没存进去），都不重试、不改写正文。
```

## Known Limitations and Deferred Work

- 只用一种连法，没做反向连接。
- 图片、语音这些只翻成位置文字，没有真的处理。
- 还没在真 QQ 号上跑过。
- 表情回应不过体检：它不带正文，也就不判长度与敏感词。
- 允许的名单与敏感词只在装配时读一次，改配置要重新挂载。
- 动态的级别只由模型声明，这一层不回头查正文有没有夸大；预授权话题清单只约束自己报了话题的调用方，工具只报级别。
- 停手开关由装配层接进来，本包自己不判 `PAUSE` 文件。
- 条数上限也由装配层每轮接进来，没接上就只发一条，本包自己不算这一轮能说几句。
- 阶段由装配层接进来，没接上就按自我层默认值表里最保守的一档（`P0`）判，三类公共动作一条都不发；下限 `publicMinStage` 与 `privateMinStage` 可以从这里覆盖，默认值仍在自我层的默认值表里。
- 每条只过一遍体检，切出来的几条共用装配前那一次判定。
- 状态是读一次写一次，两个调用方同时发时以最后写进去的那一份为准。
- 待确认项要在状态文件里留到有人点头，正文因此跟着待确认项短存一段；放行、丢掉或过期之后只剩指纹。
- 评论与私信的两把钥匙由工具在发起时声明（用户那把由这张确认票背书、她自己那把由这次调用背书），判级、查名单与阶段仍由发布入口做，工具自己不判。
- 票只认品类与正文指纹，不绑话题与对象，话题与对象要在发送那一步重新报，报得不一致就按发布入口给的码拒。
- 遗书正文的暂存槽一天只收一句，判据是本地日：同一天第二次被拒，隔一天才又收；槽里不留旧句子，也不清空，读过之后仍在盘上。
- 遗书那个工具只负责把模型给的这句话存下来，不判该不该写，也不写记忆；写成记忆由装配层在到线那一刻做。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`，连接地址与机器人自己的号必填，口令与重连间隔可选；连接本身不落盘，重连状态跟着进程走，只有三类公共动作那一份状态写盘。来消息时先翻成入站，`onIncoming` / `onPoke` 收的处理函数返回撤掉函数；只有图片表情位置的消息由 `hasWords` 判出，交给装配层决定要不要算一句话。

出站体检在 `src/outbound.ts`：默认值表是 `OUTBOUND_DEFAULTS`（`allowGroups`、`allowPeople`、`maxChars` 300、`perMinute` 6、`windowMs` 60000、`quietStart` `23:30`、`quietEnd` `07:30`、`banned`、`retryMs` 60000），每一项都能被 `Config` 覆盖。`createOutboundCheck` 按顺序过五道闸：群与人的名单、静默时段、长度上限、敏感词、每分钟条数；每道闸都给码、可读原因与下次时间。敏感词只用来拦，不产出该不该说。静默时段复用 `qq-proactive` 的 `inQuietHours` / `endOfQuiet`，同一套时段只有一份实现。

三类公共动作的参数在 `src/actions.ts` 的 `ACTION_DEFAULTS`：`post`、`comment`、`private` 各一套 `coolDownMs` 30 分钟、`repeatWindowMs` 30 分钟、`dailyMax` 3、`fingerprintMax` 64，`comment` 与 `private` 的 `confirmRequired` 为真、`post` 为假；每一项都能被 `Config` 的 `postCoolDownMs` 一类同名前缀字段覆盖，待确认项的有效期在 `CONFIRM_DEFAULTS`（30 分钟），预授权话题与私信允许名单在 `POLICY_DEFAULTS`（话题是日常与吃喝，允许名单空着等于谁都不行）。

入口在 `src/action-gate.ts` 的 `createActionGate`，`publish(kind, text, facts)` 按顺序过：分级（先判阶段，再交给 `qq-self` 的 `judgePostLevel` / `judgeComment` / `judgePrivate`）、停手开关、出站体检、确认票、同文去重、冷却、每日额度，最后才发。阶段由 `stage` 那一句函数给，取不到就按自我层默认值表的 `P0` 算；动态与评论用 `publicMinStage`（默认 `P3`）、私信用 `privateMinStage`（默认 `P3`），两个下限都能从 `Config` 覆盖。三类动作的判断只看各自的格子：发满动态不影响评论的额度，一条动态的冷却也不拦评论。冷却的公式是「上一次做成的时刻 + `coolDownMs`」，额度用满给的是次日零点，去重给的是「那一段正文首次做成的时刻 + `repeatWindowMs`」；三个时刻都只由盘上的时刻算出来，同样输入两次得到同一个数。

一次确认在同一条路上：`requestConfirm(kind, text, at)` 把正文放进待确认队列并回 `confirmId`（编号是品类加提出时刻加正文指纹前十二位，同一段正文重复进队列回 `confirm_duplicate`），`confirm(confirmId, at)` 才给这张票盖章，`reject(confirmId)` 直接丢掉；`publish` 只认同一段正文下盖过章的票，发出去就把票用掉，一张票只用一次。待确认项过了 `confirmTtlMs` 自动失效：`confirm` 回 `confirm_expired` 并给下次时刻，`publish` 回 `needs_confirm`。

发布工具 `qq_publish_post` 在 `src/tools.ts`，参数只有 `text` 与 `kind`（`enum` 取自 `qq-self` 的 `POST_LEVELS`）。`execute` 只做一件事：把正文与级别交给装配时传进来的 `publish`，那条一路调到 `publish('post', …)`；结果不是 `ok` 就按「码: 原因｜下一步: 提示」抛错，下一次可以再试的时刻一并写进提示。工具自己不判级别、不查额度、不读停手开关，这些都在下游。

状态在 `src/action-store.ts`：`data/qq-actions.json` 里 `version` 是 2，`kinds` 分 `post` / `comment` / `private` 三格，各存 `dayStart`、`dayCount`、`lastAt` 与正文的 sha256 指纹表，`pending` 是等着点头的那几条（编号、品类、指纹、正文、提出时刻、失效时刻与点头时刻）；做过的正文不落盘，只有待确认项短存正文。写盘先写同目录临时文件再改名，并先把上一份留成 `.bak`，正式文件读不出时按备份、再按默认值逐级回退。

接线在 `apply` 里：发送工具真正发之前调 `inspect`，每发出一条调 `account` 把这一刻记进分钟窗口；拒了就抛错，让内核统一包装成失败结果。发送这一路的 `attempt` / `sent` / `blocked` 由 `seam.onOutbound` 报给装配层，只带码、条数与时刻，不带正文；三类动作都走同一个出口，所以发布工具一次调用照样先报 `attempt`，发出去报 `sent`，被关卡拦下报 `blocked`，工具自己不再补一遍。名单空着等于不限制，装配时各打印一次提示。停手开关、条数上限、自我层的阶段分别由 `seam.usePause` / `useReplyCap` / `useStage` 接进来。

评论、私信与确认票这三个工具也在 `src/tools.ts`：`qq_comment_post` 只把正文、话题与当前会话键交给 `publish('comment', …)`；`qq_send_private` 把对象拼成 `private:编号` 当会话键交给 `publish('private', …)`，没报对象就带一个空号，让发布入口按缺对象拒；`qq_request_confirm` 与 `qq_confirm_action` 分别调 `requestConfirm(kind, text, at)` 与 `confirm(confirmId, at)`。四个工具都不判该不该发，拒绝原样抛出，只把 `*.needs_confirm` 那一条的下一步改写为「先调 qq_request_confirm 再调 qq_confirm_action」；要票的品类清单 `CONFIRM_KINDS` 从 `ACTION_DEFAULTS` 里 `confirmRequired` 为真的那几项取，别处不写第二份。

分条发在 `src/tools.ts` 里：体检与额度这两道先过，再用这一轮的条数上限调 `qq-pacing` 的 `splitByBudget`，条与条之间按 `speechGaps` 给的间隔停一下再发下一条。上限由装配层通过 `seam.useReplyCap(provide)` 接进来，读的是组合包每轮算出的那个数；没接上就按 `REPLY_DEFAULTS.minCap` 发一条。单条的字数说法与长度那道闸是同一个 `maxChars`，切出来的每条都过得了它。中途某条没发出去就停在那儿：已经发出去的不撤也不再重发，抛出的失败里写明已发几条、卡在第几条，发送这一路先报已发的条数再报 `blocked`。

遗书那个工具在 `src/tools.ts` 的末尾，参数只有 `text`，`execute` 把正文交给装配时传进来的 `stageFarewell(text, Date.now())`，拒了就把码、原因与下一步原样抛出，不改写正文、不重试、不写记忆。它自己不判该不该写：什么时候该说仍由身体事实与模型自己定。

暂存槽在 `src/farewell-slot.ts`：`data/qq-farewell.json` 里一个 `version`、写下时刻 `at`、那一刻的本地零点 `dayStart` 与正文 `text`，一天只留一句，同一天第二次回 `farewell.duplicate`，空正文回 `farewell.empty`，写不进去回 `farewell.write_failed`。同一天的判据只看 `dayStart`，不另记日期串；写盘复用 `action-store.ts` 的 `writeAtomic`（先临时文件再改名）。读的入口是 `readFarewellSlot(file)` 与 `farewellTextAt(slot, at)`：文件不在或内容对不上都算没写过，文件在却读不动时抛给调用方决定要不要记一行。槽的位置由 `farewellFile` 配置，默认 `defaultFarewellSlotFile()`（`<HUOLI_HOME>/data/qq-farewell.json`）；组合包读的是同一个文件，所以两边不填就落在同一处。
