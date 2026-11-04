---
description: "生命状态：自己独占的一份身体状态、一条心跳，加上每轮写进提示词的一小段形容词。"
kind: "package-reference"
---

# qq-vitals

## Summary

她自己的生理状态：递质、体液、代谢、睡眠压力、睡眠三态与周期相位。时间让它漂移，互动改它，每轮再把它写成一小段只有形容词的话放进提示词。状态文件由这一包独占，别的包只读不算。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

提示词里多一段 `{{qq_vitals}}`，写的是此刻身体的形容词：饿不饿、渴不渴、身上松不松、这一轮怎么说话。睡着、刚被吵醒、经期、经前、生病、太困这六件事各自成立时才多一句，都不成立就整行不出现。不给数字，也不提激素名。

#### Token effect

固定一小段，最多三百字，不随聊天变长。

#### KV Cache effect

这段每轮都可能变，会让前缀缓存失效。

## Known Limitations and Deferred Work

- 十二套子系统落了递质回归、HPA 轴、交感副交感、奖赏、依恋、昼夜、饥饿、水循环、血糖、睡眠压力、月经周期、睡眠与午睡；愤怒、恐惧、死亡威胁没做。
- 互动只认喝水、被夸、被凶三条；睡着时只记一笔被吵醒，三条都不写。这几条由装配层的 `QqVitalsSeam.react` 收消息时写回。
- 开经当天写一条记忆这段没做，等记忆写入接口接上。
- 睡眠期间不主动打扰要主动性出口读 `asleep` 与 `wake_after` 把下一次消息推后，那一段在主动性包里，本包只出这两个事实。
- 时段判断只用本地小时，没处理跨时区与夏令时。
- 想开口的倍率只接了没力气、犯困、想有人陪、有火、缺水、生病、睡不够这七条；幸福峰值、害怕、担心、存在恐惧、冷战、记恨、余额见底要等对应状态字段落地。
- 想发动态只接了有火往下压、孤独往上抬两条；害怕、担心两条同理等字段。

<a id="dev-note"></a>
### Dev Note

默认参数集中在 `src/defaults.ts` 的 `DEFAULTS`，`Config.tuning` 可以逐项覆盖；状态默认落在数据根目录的 `data/qq-vitals.json`，可用 `Config.file` 改。各段公式的位置：漂移、睡眠三态与周期结算在 `src/drift.ts`，时钟与日期判断在 `src/clock.ts`，写回在 `src/react.ts`，派生量与标签在 `src/derive.ts`，提示词在 `src/render.ts`，社交动态分级在 `src/post.ts`，原子写盘与备份在 `src/store.ts`，词表在 `src/words.ts`。`react` 是纯函数，装配层把它包成 `seam.react(text, at)`：先按消息时间结算漂移，再写回并立即落盘；冷却窗口由 `drinkCooldownMs`、`reactCooldownMs` 管，同一条消息重放不会重复扣。

睡眠走 `awake | sleeping | waking` 三态：夜里且睡眠压力过 `sleepAdenosineFrom` 就睡，醒来看“到点、白天里睡眠压力回到低位、白天最晚”三条，午睡只认到点这一条，两套规则不共用，一觉睡着期间不会起第二觉；醒后留一段迷糊窗口，窗口走完回到醒着。睡着期间腺苷按 `sleepAdenosineDrop` 或 `napAdenosineDrop` 往下掉，别的子系统照常结算；`asleep` 是睡着这一态的布尔投影，写的地方只有一处，读回来也按三态重算，不会两边对不上。午睡一天一次，靠 `nap_at` 落在同一个本地零点判断。`drift` 的第四个参数是零到一的随机源，入睡时刻的抖动与午睡概率都走它，测试给一个定值就完全可复现。

周期按真实日期差算：锚点取每月 `cycleDom` 号，今天早于它就取上月这一天，`cycle_day` 从锚点起算，`cycle_len` 取到下一个锚点（28~31 天），相位按 `cycleMenstrualEnd` 等四个边界切分，雌激素、孕激素、痛经三段曲线跟着相位写回。相位作为事实进状态，`energy`、`valence`、`irritability` 各按 `valenceMenstrualPenalty` 一类的系数加减对应项。

派生量里的 `proactive_bias` 与 `post_want` 都是零到一的事实：前者从 `proactiveBiasStart` 起逐条乘系数，夹到 `biasMin` 与 `biasMax` 之间，再由 `biasUnit` 折算成零到一，所以状态文件里存的是读数而不是原始倍率；后者从 `postStart` 起乘系数后直接夹到零到一。两个数都不产出“发不发”的结论。`postLevel(facts)` 是纯函数，默认 `none`，例行与高峰同时成立给 `routine`，`public` 还要两把钥匙同时在；这一包不发任何内容。
