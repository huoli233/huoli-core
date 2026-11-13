---
kind: upgrade-guide
description: "QQ configuration must remove retired proactive timing keys and use the per-chat hourly send quota."
---

# QQ proactive settings use a per-chat hourly quota

English | [中文](guide.zh.md)

## Change

The QQ bundle no longer accepts `probabilityReplyChance`, `groupReplyCooldownMs`, or the old `qq-proactive` private daily and gap settings. Interactive modes now change prompt emphasis while every admitted message still reaches the model, and the shipped profile uses `autonomous`. Proactive sends are counted per chat for the last hour at the WebSocket send boundary. `proactivePerHour` sets the initial limit, `proactivePerHourMax` sets the panel maximum, and an existing `limitsFile` remains the runtime source after the panel saves it.

## Migration

1. Remove `probabilityReplyChance`, `groupReplyCooldownMs`, and `qq-proactive` keys such as `privateDailyMax`, `privateDailyFloor`, `privateGapMinMs`, and `privateGapMaxMs` from QQ patches and overlays.
2. Add `proactivePerHour` and optional `proactivePerHourMax` under the `qq-bundle` config. The defaults are 3 and 30. Keep the existing `limitsFile`; version 1 files are read into the version 2 state automatically.
3. Start the QQ profile and confirm template expansion accepts the config and the panel reports the active mode, hourly limit, and proactive switch.
4. Exercise one autonomous send and confirm `limitsFile` records one timestamp for that chat only. Confirm an inbound reply in the same chat does not consume this proactive quota.
