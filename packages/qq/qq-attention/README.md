---
description: "管一个群的注意力：看消息、等消息、划走、收尾、设唤醒，状态落盘，重启后接着用。"
kind: "package-reference"
---

# qq-attention

## Summary

一个群里的注意力：看消息、等消息、划走、收尾、设唤醒，五个动作。状态存在自己的文件里，重启不丢。工具只读事实、只发事件，不替模型决定要不要说话；采集到的候选只有种类与理由，不带权重，也不参与排序与阈值。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

五个工具 `read_messages`、`wait_for_messages`、`mark_read`、`close_conversation`、`set_wake_config` 的名称与参数；工具返回的消息列表、读水位、等待结果、收尾确认。提示词层另可取 `renderAttentionFacts` 渲染出的中文事实段：把 `signals()` 采到的现场事实、话痨倾向、最近一次成功发言时间、自己连续说了几条、此刻的情绪档位与 `set_wake_config` 写下的唤醒偏好并列写出，只陈述事实，不决定是否行动。现场同时给真人发言条数、不同发言人数、并行接话和消息密度，模型据此自己判断是一个人刷屏还是多人正在接话；`renderSpeakFacts` 与 `renderStopFacts` 也只把插话和收尾现场写成事实。成功发送时间和连续条数由 `qq-bundle` 在出站回执确认后写入注意力状态；真人再次发言会把连续条数清零。

##### Room reading and self-stop

```markdown
`applyAttention` 自己维护话痨倾向：成功发出一个或多个人工气泡时，`self_spoke` 会把 `talkativeness` 往 `0.2` 一侧拉，发得越多拉得越明显；真人再开口会把连续自说清零，并只把话痨度缓慢拉回中点，不会瞬间恢复成“很活跃”。`renderAttentionFacts` 把低于 `0.35` 的倾向写成“收着说”，高值只说明偏活跃，不命令模型开口；刚连发两个以上气泡时，私聊提示只接当前最新一句、别继续追加，群聊则明确先停一轮。多人并行和高消息密度会另写“先读完、别把普通陈述当攻击”，模型仍按现场决定，但“现在可以先停”已经成为可见事实。
```

##### Emotion tier line

```markdown
`AttentionFactsInput` 多一个可选入参 `emotion`（`{ tier, label }`），给了就在事实段里补一行「你现在的情绪：有点上火（偏重）」。它只是把调用方算好的档位换成一句事实，不进 `collectSignals`、不进候选、也不带任何权重，所以候选的种类、理由与先后次序一个字都不动；档位怎么算、什么时候不给，由调用方（`qq-bundle` 的 `emotion-tier`）决定。不给这一项时整行不出现，与没有这一层时逐字相同。
```

##### Autonomous wake

```markdown
`shouldWake` 只执行模型通过 `set_wake_config` 留下的定时休息、收尾与唤醒偏好；名字、问句、现场活跃度、候选动作都不做代码判定，由提示词事实交给模型。完整自主模式打开 `ambientAll` 时，普通群消息直接进入同一会话，收尾过的会话也会重新打开；模型明确收紧唤醒条件时仍按它的设置执行。睡眠、急停和发送限制仍按各自规则执行。

`set_wake_config` 的定时安静是真实休息：结束时刻之前，普通群消息不会叫醒模型；群聊中明确点名、引用回复或戳一戳仍可直接叫醒，好友私聊是否放行由组合配置决定。到点后继续遵守模型同时选过的唤醒条件，不会擅自恢复成每条都醒。它和身体自己的睡眠状态是两层独立限制。
```

#### Token effect

每次调用只把要看的那些消息带进上下文，条数有上限；等待结果只带回新到的消息。情绪档位那一行只在真有情绪时出现，一行中文，不超过二十个字。

#### KV Cache effect

不影响提示词前缀，工具调用与结果是追加的。

## Known Limitations and Deferred Work

- 状态存在自己的文件里，还没接进会话日志。
- 消息缓冲只在内存里，重启后要从会话记录重新灌。
- 发言倾向会按模型本轮选择渐进调整：观察、等待、安静或休息会收一点，主动插话或起头会轻微调高；调整后按半小时半衰期回到基准，不会一次调低或调高后永久保持。真人上一次开口后自己连续说了两条，暂停下一次自主补充判断，真人再次发言后恢复。
- 还没在真 QQ 号上跑过。
- 情绪档位只是一句事实，没有接进候选打分：心情差不会自动让「回复」候选排前面，怎么解读那句话仍由模型定。档位由 `qq-bundle` 算好传进来，本包不读身体、也不自己存情绪。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`，状态文件位置、主目录覆盖与机器人自己的称呼三项；状态默认落在主目录的 data 下（`data/qq-attention.json`），每次变化整体原子写回，卸载时再落一次盘。唤醒条件是布尔开关与发言人允许的名单，没有概率；有趣的判断只报勾到了哪些事实（`src/select.ts` 的 `fun.evidence` 与 `fun.signals`）。收件箱的 `InboxPush` 可带平台消息编号、`atMe`、`isPoke`、`replyToBot` 四个可选字段；编号用于撤回时找回刚看到的原话，其余三项由 `select.ts` 读成 `directed` 事实。
