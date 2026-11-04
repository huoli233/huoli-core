---
description: "接上 QQ：一条连接收消息、发消息，收到的翻成入站交给注意力，要发的先过出站体检再按说话规矩拆句送出。"
kind: "package-reference"
---

# qq-channel

## Summary

接 QQ：连上去、收消息、把要说的话发出去。收到的消息翻成入站交给注意力；要发的先过白名单、静默时段、长度、敏感词、每分钟条数，再按说话规矩拆句送出去。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

三个工具：`qq_send_message` 与 `qq_send_reaction` 管会话里说话，`qq_publish_post` 管发动态。前两个的说明里讲了长话会被拆开、说完就结束这一轮；发布那个只收正文与级别（`routine` 或 `public`），说明里写了什么时候该用、什么时候别用、被拒之后怎么办，判级与额度一行都不在说明里定。

#### Token effect

发出去的内容不留在上下文里；工具只回一个成功标志和条数。

#### KV Cache effect

不影响提示词前缀。

##### Refusals

```markdown
不改写内容、不代说，只回一个失败：错误码点号分层（outbound.not_allowed、outbound.quiet、outbound.too_long、outbound.banned、outbound.rate），后面跟一句可读原因和「几点之后再来」。
动态那一路另有自己的码（post.level、post.needs_keys、post.not_routine、post.paused、post.duplicate、post.cooling、post.day_full、post.empty），同样只给原因与下次时刻。
```

## Known Limitations and Deferred Work

- 只用一种连法，没做反向连接。
- 图片、语音这些只翻成占位文字，没有真的处理。
- 还没在真 QQ 号上跑过。
- 表情回应不过体检：它不带正文，也就不判长度与敏感词。
- 白名单与敏感词只在装配时读一次，改配置要重新挂载。
- 动态的级别只由模型声明，这一层不回头查正文有没有夸大；预授权话题清单只约束自己报了话题的调用方，工具只报级别。
- 停手开关由装配层接进来，本包自己不判 `PAUSE` 文件。
- 状态是读一次写一次，两个调用方同时发时以最后写进去的那一份为准。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`，连接地址与机器人自己的号必填，口令与重连间隔可选；连接本身不落盘，重连状态跟着进程走，只有动态那一份状态写盘。来消息时先翻成入站，`onIncoming` / `onPoke` 收的处理函数返回注销函数；只有图片表情占位的消息由 `hasWords` 判出，交给装配层决定要不要算一句话。

出站体检在 `src/outbound.ts`：默认值表是 `OUTBOUND_DEFAULTS`（`allowGroups`、`allowPeople`、`maxChars` 300、`perMinute` 6、`windowMs` 60000、`quietStart` `23:30`、`quietEnd` `07:30`、`banned`、`retryMs` 60000），每一项都能被 `Config` 覆盖。`createOutboundCheck` 按顺序过五道闸：群与人的名单、静默时段、长度上限、敏感词、每分钟条数；每道闸都给码、可读原因与下次时间。敏感词只用来拦，不产出该不该说。静默时段复用 `qq-proactive` 的 `inQuietHours` / `endOfQuiet`，同一套时段只有一份实现。

动态的发布入口在 `src/post.ts`，默认值表是 `POST_DEFAULTS`（`coolDownMs` 30 分钟、`repeatWindowMs` 30 分钟、`dailyMax` 3、`fingerprintMax` 64、`routineTopics` 日常与吃喝），每一项都能被 `Config` 的 `postCoolDownMs` / `postRepeatWindowMs` / `postDailyMax` / `postFingerprintMax` / `routineTopics` 覆盖。`publishPost` 按顺序过：级别与钥匙（交给 `qq-self` 的 `judgePostLevel`，只认 `routine` 与 `public`）、例行话题、停手开关、出站体检、同文去重、冷却、每日额度，最后才发。例行话题这一道只查自报了 `topic` 的调用方：报了就必须落在 `routineTopics` 里，没报就按级别本身判，免得只报级别的工具被这道闸永久拦死。冷却的公式是「上一次发出时刻 + `coolDownMs`」，额度用满给的是次日零点，去重给的是「那一段正文首次发出的时刻 + `repeatWindowMs`」；三个时刻都只由盘上的时刻算出来，同样输入两次得到同一个数。

发布工具 `qq_publish_post` 在 `src/tools.ts`，参数只有 `text` 与 `kind`（`enum` 取自 `qq-self` 的 `POST_LEVELS`）。`execute` 只做一件事：把正文与级别交给装配时传进来的 `publish`，那条一路调到 `publishPost`；结果不是 `ok` 就按「码: 原因｜下一步: 提示」抛错，下一次可以再试的时刻一并写进提示。工具自己不判级别、不查额度、不读停手开关，这些都在下游。

状态在 `src/post-store.ts`：`data/qq-posts.json` 只存 `version`、`dayStart`、`dayCount`、`lastPostedAt` 与正文的 sha256 指纹表，正文不落盘；写盘先写同目录临时文件再改名，并先把上一份留成 `.bak`，正式文件读不出时按备份、再按默认值逐级回退。

接线在 `apply` 里：发送工具真正发之前调 `inspect`，每发出一条调 `account` 把这一刻记进分钟窗口；拒了就抛错，让内核统一包装成失败结果。发送这一路的 `attempt` / `sent` / `blocked` 由 `seam.onOutbound` 报给装配层，只带码、条数与时刻，不带正文；动态那一路也走同一个出口，所以发布工具一次调用照样先报 `attempt`，发出去报 `sent`，被闸门拦下报 `blocked`，工具自己不再补一遍。名单空着等于不限制，装配时各打印一次提示。
