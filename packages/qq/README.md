---

## Summary

description: "群里的聊天机器人：注意力、状态、记忆、节奏、主动开口、收发消息，一整套装在一起。"
kind: "package-group"
---
# packages/qq
## 这一组是干什么的
一个住在群里的聊天机器人。它看消息、记得住人、有自己的状态、说话有分寸、能自己开口，也接得住话。
十个包各管一件事，最后由 `qq-bundle` 装到一起。
## 包里都有什么
| 包 | 管什么 |
|---|---|
| `qq-policy` | 全仓唯一的一张淡忘表 |
| `qq-attention` | 五个动作：看、等、划走、收尾、设唤醒 |
| `qq-subject` | 自己的状态，写成一段话进提示词 |
| `qq-memory` | 四层记忆，会慢慢变淡 |
| `qq-pacing` | 拆句、间隔、额度 |
| `qq-material` | 现场素材与惦记的事 |
| `qq-proactive` | 攒理由、过闸门、先看后发 |
| `qq-continuity` | 收尾留话头、事后回想 |
| `qq-channel` | 接 QQ、收发消息 |
| `qq-bundle` | 把上面九个装到一起 |

## Known Limitations and Deferred Work

- 整套还没在真 QQ 号上跑过。
- 数据文件每个包一个，还没统一。
- 压缩只调了参数，没换成聊天口吻的摘要。
