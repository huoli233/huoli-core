---
description: "群里的聊天机器人：注意力、状态、记忆、节奏、主动开口、收发消息，一整套装在一起。"
kind: "package-group"
---

# qq/ — 一个住在群里的机器人

## Summary

这一组包把"住在群里说话"拆成十件事：谁在看消息、自己现在什么状态、记得住谁、说话怎么排队、拿什么当话题、什么时候自己开口、什么时候收尾、怎么收发消息、参数表放在哪里、最后谁把它们装到一起。

## Table of Contents

- [包里有什么](#包里有什么)
- [从哪读起](#从哪读起)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## 包里有什么

| 包 | 管什么 |
|---|---|
| [`qq-policy`](qq-policy/README.md) | 全仓唯一的一张淡忘表 |
| [`qq-attention`](qq-attention/README.md) | 五个动作：看、等、划走、收尾、设唤醒 |
| [`qq-subject`](qq-subject/README.md) | 自己的状态，写成一段话进提示词 |
| [`qq-memory`](qq-memory/README.md) | 四层记忆，会慢慢变淡 |
| [`qq-pacing`](qq-pacing/README.md) | 拆句、间隔、额度 |
| [`qq-material`](qq-material/README.md) | 现场素材与惦记的事 |
| [`qq-proactive`](qq-proactive/README.md) | 攒理由、过闸门、先看后发 |
| [`qq-continuity`](qq-continuity/README.md) | 收尾留话头、事后回想 |
| [`qq-self`](qq-self/README.md) | 自我层：只读面板、两档账、两把钥匙 |
| [`qq-channel`](qq-channel/README.md) | 接 QQ、收发消息 |
| [`qq-bundle`](qq-bundle/README.md) | 把上面九个装到一起，并挂上手写规矩 |

## 从哪读起

先看 [`qq-policy`](qq-policy/README.md)（所有数字都在那里），再看 [`qq-attention`](qq-attention/README.md)（五个动作的入口），最后看 [`qq-bundle`](qq-bundle/README.md)（怎么被装进运行环境）。

## Known Limitations and Deferred Work

- 整套还没在真 QQ 号上跑过。
- 数据文件每个包一个，还没统一。
- 压缩只调了参数，没换成聊天口吻的摘要。

## Dev Note

中文比英文占 token 多，因此压缩阈值提前压了一点；群聊需要保留更多最近的原话，所以保留比例比默认值高。
