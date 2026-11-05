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

五个工具 `read_messages`、`wait_for_messages`、`mark_read`、`close_conversation`、`set_wake_config` 的名称与参数；工具返回的消息列表、读水位、等待结果、收尾确认。提示词层另可取 `renderAttentionFacts` 渲染出的中文事实段：把 `signals()` 采到的现场事实与 `set_wake_config` 写下的唤醒偏好并列写出，只说「这几条在叫你」「你设了只在这几种情况醒」这类事实，不决定是否行动。

#### Token effect

每次调用只把要看的那些消息带进上下文，条数有上限；等待结果只带回新到的消息。

#### KV Cache effect

不影响提示词前缀，工具调用与结果是追加的。

## Known Limitations and Deferred Work

- 状态存在自己的文件里，还没接进会话日志。
- 消息缓冲只在内存里，重启后要从会话记录重新灌。
- 还没在真 QQ 号上跑过。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`，状态文件位置、主目录覆盖与机器人自己的称呼三项；状态默认落在主目录的 data 下（`data/qq-attention.json`），每次变化整体原子写回，卸载时再落一次盘。唤醒条件是布尔开关与发言人允许的名单，没有概率；有趣的判断只报勾到了哪些事实（`src/select.ts` 的 `fun.evidence` 与 `fun.signals`）。收件箱的 `InboxPush` 可带 `atMe`、`isPoke`、`replyToBot` 三个可选指向字段，推消息时存下并由 `select.ts` 读成 `directed` 事实，不再恒为假。
