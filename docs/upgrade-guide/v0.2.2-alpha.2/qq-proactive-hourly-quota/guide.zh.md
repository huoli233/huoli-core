---
kind: upgrade-guide
description: "QQ 配置须移除已停用的主动时机参数，改用按会话的每小时发送额度。"
---

# QQ 主动开口改用按会话小时额度

[English](guide.md) | 中文

## 变更

QQ 组合包不再接受 `probabilityReplyChance`、`groupReplyCooldownMs`，也不再接受 `qq-proactive` 旧的私聊每日上限与间隔参数。互动模式现在只改变提示侧重点，所有通过硬边界的入站消息仍会进入模型；默认配置使用 `autonomous`。主动发送在 WebSocket 真正发出时按会话统计最近一小时，`proactivePerHour` 设置首次上限，`proactivePerHourMax` 设置面板可调到多大；面板保存后，已有 `limitsFile` 仍是运行时依据。

## 迁移

1. 从 QQ patch 和 overlay 中删除 `probabilityReplyChance`、`groupReplyCooldownMs`，以及 `qq-proactive` 下的 `privateDailyMax`、`privateDailyFloor`、`privateGapMinMs`、`privateGapMaxMs` 等旧键。
2. 在 `qq-bundle` 配置下增加 `proactivePerHour`，需要时再增加 `proactivePerHourMax`。默认值分别是 3 和 30。保留原 `limitsFile`，版本 1 文件会自动读成版本 2 状态。
3. 启动 QQ profile，确认配置展开不再报未知键，面板能显示当前模式、每小时上限和主动开关。
4. 触发一次自主发送，确认 `limitsFile` 只为该会话记录一条时刻；再在同一会话回复一次入站消息，确认不占这份主动额度。
