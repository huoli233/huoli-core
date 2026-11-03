---
description: "管自己此刻的状态：心情、精力、无聊、想说话，加上跟谁熟不熟，每轮写进提示词。"
kind: "package-reference"
---

# qq-subject

## Summary

自己的状态：心情、精力、无聊、想说话，加上跟谁熟不熟。每轮写成一小段话放进提示词，最多三百字。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

提示词里多一段 `{{qq_self}}`，写清心情、精力、无聊、想说话，以及跟当前这个人的熟悉度。

#### Token effect

固定占一小段，最多三百字，不随聊天变长。

#### KV Cache effect

这段内容每轮都可能变，会让前缀缓存失效。

## Known Limitations and Deferred Work

- 提示词那边拿不到当前会话，只能按“最近说话的那个群”来写。
- 状态改变只有粗粒度加减，没有按事件类型细分。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：状态文件位置、主目录覆盖、一段最多多少字、每个群的名字；状态默认落在主目录的 data 下（`data/qq-subject.json`），提示词里的占位名是 `qq_self`，取值时机就是每轮拼提示词的时候。
