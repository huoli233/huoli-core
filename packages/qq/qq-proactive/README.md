---
description: "管主动开口：攒理由、过关卡，先给人看，说不说由模型定，默认关着。"
kind: "package-reference"
---

# qq-proactive

## Summary

主动开口：先攒理由、再过关卡，最后先给人看。每一条待发都带着自己的理由与原始事实，说不说、说哪条由模型定。默认是关的。开了以后夜里也不吵人，冷却与每天额度都按身体给的劲头缩放；身体的睡眠事实也进关卡——睡着时一条候选都不攒，刚被吵醒先按配置延后一段。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

这一行不挂上工具；候选用 `preview` 先看：每条带一句 `text`、自己的 `why`，以及原样的 `facts`（种类、把握、有用程度、风险、想发动态的读数、来源、到达时刻），不做任何合成。`preview` 同时把这批待发记成"看过"，`deliver(chatKey, id)` 只投递看过的那一条。`consider` 的结果里还带一项 `facts.proactive_bias`，是身体那边算好的想开口的劲，零到一；这个数只影响冷却与每天额度，不进候选、不参与排序，攒住哪几条、先看哪一条都与它无关；没接上身体时是 `null`，不会自己编一个数。别处攒出来的候选从 `consider` 的可选入参 `external` 递进来，比如身体那边"想发一条动态"：它跟自己攒的并成一张表，先后只看到达时刻，不评分、不重排、也不决定发不发；带 `postWant` 的那条把读数原样留在 `facts` 里，不传 `external` 时行为与从前一模一样。这类候选可以没有正文（想发动态那条只有由头与读数），`deliver` 照样只判它有没有先摆出来看过。

#### Token effect

每条待发只说一句，带上一份事实，条数受关卡与去重限制。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 待发只按到达时间排队，哪条更值得说交给模型判断。
- 冷却取区间的中点再除以劲头，不随对方活跃程度变化。
- 身体给的是零到一的读数，中性的 1.0 倍率折出来约 0.35，所以默认间隔约为区间中点的近三倍；要更快就把 `gapMinMs`、`gapMaxMs` 调小。
- 每天额度按劲头缩到下限 `dailyFloor` 为止，劲头很低时一天仍然留一次。
- 先看再投是硬状态：没 `preview` 过的编号 `deliver` 一律拒，返回 `proactive.not_previewed`。
- 「刚被吵醒」只认睡眠三态里的 `waking` 那一态：被消息吵醒但还没醒透的时候仍按睡着算，走 `proactive.asleep`。
- 外部候选与本地候选共用同一份冷却与每天额度：想发动态那条投出去也算一次开口，额度用掉一次。
- 还没接真 QQ 试过。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：开关、每天开口上限与下限、安静时段起止、冷却区间上下限、劲头下限、刚被吵醒的延后时长、主目录覆盖，待发的与记录共用一个文件，默认落在主目录的 data 下（`data/qq-proactive.json`）。默认值在 `src/score.ts` 的 `PROACTIVE_DEFAULTS`；关卡判定与两套缩放算法在 `src/gates.ts`：`cooldownMs` 取区间中点再除以夹进 `biasFloor~1` 的劲头，`dailyCapOf` 取 `dailyMax × 劲头` 向下取整且不低于 `dailyFloor`，同样的输入永远得到同一个下次时刻，没有随机。

睡眠那三项事实由调用方在 `ConsiderInput` 里给：`asleep` 是现在睡着，`wakeAfter` 是身体排的醒点，`waking` 是刚被吵醒还没缓过来；三项都可以缺，缺了按醒着处理。`runGates` 先看 `asleep`：为真就回 `proactive.asleep`，`retryAt` 直接取 `wakeAfter`，没排醒点就不给时刻；再看 `waking`：为真就回 `proactive.waking`，`retryAt` 取 `now + wakingDelayMs`（默认十分钟）。这两条都走关卡失败的同一条路，一条候选都不攒，待发文件一个字节都不写。

先看再投的状态在 `src/store.ts`：待发文件版本 2，`previewed` 记着看过哪些编号，投递或过期就一起删掉；`put` 重复放同一条是覆盖，看过的记录保留。`deliver` 的三条路是 `proactive.unknown_item`（这个会话里没有这一条）、`proactive.not_previewed`（还没摆出来看过）、成功时返回那一条并把说话时刻记进账。

`external` 与自己攒的候选在 `src/index.ts` 的 `gatheredCandidates` 里并成一张表，后面统一走 `orderByArrival` 与 `dropRepeats`，因此外部候选过的关卡、去的重与本地候选完全同一套；带 `postWant` 的读数是候选自己带上来的事实，只在 `facts` 里原样存住，本包不做阈值判断，也不把它折成分数。
