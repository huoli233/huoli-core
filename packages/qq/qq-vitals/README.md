---
description: "生命状态：自己独占的一份身体状态、一条心跳，加上每轮写进提示词的一小段形容词。"
kind: "package-reference"
---

# qq-vitals

## Summary

她自己的生理状态：递质、体液、代谢、睡眠压力。时间让它漂移，互动改它，每轮再把它写成一小段只有形容词的话放进提示词。状态文件由这一包独占，别的包只读不算。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

提示词里多一段 `{{qq_vitals}}`，写的是此刻身体的形容词：饿不饿、渴不渴、身上松不松、这一轮怎么说话。不给数字，也不提激素名。

#### Token effect

固定一小段，最多三百字，不随聊天变长。

#### KV Cache effect

这段每轮都可能变，会让前缀缓存失效。

## Known Limitations and Deferred Work

- 十二套子系统只落了递质回归、HPA 轴、交感副交感、奖赏、依恋、昼夜、饥饿、水循环、血糖、睡眠压力这几条，愤怒、恐惧、月经、死亡威胁没做。
- 互动只认喝水、被夸、被凶三条；这三条由装配层的 `QqVitalsSeam.react` 收消息时写回。
- 时段判断只用本地小时，没处理跨时区与夏令时。

<a id="dev-note"></a>
### Dev Note

默认参数集中在 `src/defaults.ts` 的 `DEFAULTS`，`Config.tuning` 可以逐项覆盖；状态默认落在数据根目录的 `data/qq-vitals.json`，可用 `Config.file` 改。各段公式的位置：漂移在 `src/drift.ts`，写回在 `src/react.ts`，派生量与标签在 `src/derive.ts`，提示词在 `src/render.ts`，原子写盘与备份在 `src/store.ts`，时段判断在 `src/clock.ts`，词表在 `src/words.ts`。`react` 是纯函数，装配层把它包成 `seam.react(text, at)`：先按消息时间结算漂移，再写回并立即落盘；冷却窗口由 `drinkCooldownMs`、`reactCooldownMs` 管，同一条消息重放不会重复扣。
