---
description: "记下这段聊天的收尾与回想：收在哪、下次怎么接、事后觉得聊得怎么样。"
kind: "package-reference"
---

# qq-continuity

## Summary

收尾与回想：这段收在哪、下次怎么接、事后觉得聊得怎么样。收尾不是潜水，被叫到还会醒。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

一个工具 `note_reflection`。提示词层另可取 `renderContinuityFacts` 渲染出的中文事实段：把上次收尾、这段对话的成色与事后回想并列写出；`closeFacts` 可不建运行件直接截出一条收尾事实。

##### Reply continuity

```markdown
普通轮次的摘要由双方这次实际来往组成，不再只记对方最后一句。发送工具同一次调用里的 `mind.next` 会进入下次可接的话头，`mind.inner` 只作为“上一轮心里”留在上下文里，不混进收尾摘要，也不会当成消息发出去。
```

#### Token effect

每次最多读回几条回想，每条三百字以内。

#### KV Cache effect

回想进提示词的话会让前缀变化。

## Known Limitations and Deferred Work

- 收尾只留一句话，不留整段摘要。
- 事后的回想还没有喂回提示词。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`，只有收尾文件的位置与主目录覆盖；默认落在主目录的 data 下（`data/qq-continuity.json`），按群各存一条收尾，回想整份文件最多留两百条。
