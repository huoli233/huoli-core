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

两个工具 `send_message` 与 `send_reaction`。说明里讲了长话会被拆开、说完就结束这一轮。

#### Token effect

发出去的内容不留在上下文里；工具只回一个成功标志和条数。

#### KV Cache effect

不影响提示词前缀。

##### Refusals

```markdown
不改写内容、不代说，只回一个失败：错误码点号分层（outbound.not_allowed、outbound.quiet、outbound.too_long、outbound.banned、outbound.rate），后面跟一句可读原因和「几点之后再来」。
```

## Known Limitations and Deferred Work

- 只用一种连法，没做反向连接。
- 图片、语音这些只翻成占位文字，没有真的处理。
- 还没在真 QQ 号上跑过。
- 表情回应不过体检：它不带正文，也就不判长度与敏感词。
- 白名单与敏感词只在装配时读一次，改配置要重新挂载。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`，连接地址与机器人自己的号必填，口令与重连间隔可选；这一包只维持连接、不落盘，重连状态跟着进程走。来消息时先翻成入站，`onIncoming` / `onPoke` 收的处理函数返回注销函数；只有图片表情占位的消息由 `hasWords` 判出，交给装配层决定要不要算一句话。

出站体检在 `src/outbound.ts`：默认值表是 `OUTBOUND_DEFAULTS`（`allowGroups`、`allowPeople`、`maxChars` 300、`perMinute` 6、`windowMs` 60000、`quietStart` `23:30`、`quietEnd` `07:30`、`banned`、`retryMs` 60000），每一项都能被 `Config` 覆盖。`createOutboundCheck` 按顺序过五道闸：群与人的名单、静默时段、长度上限、敏感词、每分钟条数；每道闸都给码、可读原因与下次时间。敏感词只用来拦，不产出该不该说。静默时段复用 `qq-proactive` 的 `inQuietHours` / `endOfQuiet`，同一套时段只有一份实现。

接线在 `apply` 里：发送工具真正发之前调 `inspect`，每发出一条调 `account` 把这一刻记进分钟窗口；拒了就抛错，让内核统一包装成失败结果。发送这一路的 `attempt` / `sent` / `blocked` 由 `seam.onOutbound` 报给装配层，只带码、条数与时刻，不带正文。名单空着等于不限制，装配时各打印一次提示。
