---
description: "管主动开口：攒理由、过关卡，先给人看，说不说由模型定，默认关着。"
kind: "package-reference"
---

# qq-proactive

## Summary

主动开口：先攒理由、再过关卡，最后先给人看。每一条待发都带着自己的理由与原始事实，说不说、说哪条由模型定。默认是关的。关卡只执行明确的安静、睡眠、休息、忙碌与连接状态约束；社交时机由模型判断。实际发送次数由组合包按会话、按小时预留和记录，身体想开口的读数只作为模型可见事实。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

这一行不挂上工具；候选用 `preview` 先看：每条带一句 `text`、自己的 `why`，以及原样的 `facts`（种类、把握、有用程度、风险、想发动态的读数、来源、到达时刻），不做任何合成。`preview` 同时把这批待发记成"看过"，`deliver(chatKey, id)` 只投递看过的那一条。`consider` 的结果里还带一项 `facts.proactive_bias`，是身体那边算好的想开口的劲，零到一；它只作为事实交给模型，不进候选、不参与排序，也不换算冷却或额度；没接上身体时是 `null`。别处攒出来的候选从 `consider` 的可选入参 `external` 递进来，比如身体那边"想发一条动态"：它跟自己攒的并成一张表，先后只看到达时刻，不评分、不重排、也不决定发不发；带 `postWant` 的那条把读数原样留在 `facts` 里，不传 `external` 时行为与从前一样。这类候选可以没有正文，组合包的投递工具会叫醒同一会话请模型补写正文后重新投，不给正文时释放占位，不静默丢弃。`qq:tone-facts` 用的候选表把 `facts` 里的种类、来源、把握、有用程度、风险和想发动态读数一起摆给模型。

#### Token effect

每条待发只说一句，带上一份事实，条数受关卡与去重限制。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 待发只按到达时间排队，哪条更值得说交给模型判断。
- 本包不再按概率、冷却或日额度阻止模型看见现场；身体读数只作为事实。
- 先看再投是硬状态：没 `preview` 过的编号 `deliver` 一律拒，返回 `proactive.not_previewed`。
- 睡着时通过 `asleep` 与 `wakeAfter` 阻止攒候选；调用方没有给这两项时按醒着处理。
- 组合包发送前重新检查急停、主动开关、安静、睡眠、休息、用量和每会话小时额度，再占住候选；实际网络发送成功后移除候选并消耗额度，失败则保留候选、不消耗额度。
- 还没接真 QQ 试过。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：开关、安静时段起止、忙碌与休息后的重试间隔、候选有效期、文件位置与主目录覆盖。待发与成功记录共用一个文件，默认落在主目录的 `data/qq-proactive.json`。默认值在 `src/score.ts` 的 `PROACTIVE_DEFAULTS`；关卡判定在 `src/gates.ts`，只检查显式开关、睡眠、休息、连接、忙碌与安静时段。

睡眠事实由调用方在 `ConsiderInput` 里给：`asleep` 是现在睡着，`wakeAfter` 是身体排的醒点；`resting` 表示身体已经该休息。三项都可以缺，缺了按醒着且不需要休息处理。`runGates` 为真时直接拒绝，一条候选都不攒，待发文件一个字节都不写。

先看再投的状态在 `src/store.ts`：待发文件版本 2，`previewed` 记着看过哪些编号，完成发送或过期就一起删掉；`put` 重复放同一条是覆盖，看过的记录保留。`claim` 先检查候选存在且已预览，再按当前时间重过主动开关、安静时段和运行状态，随后暂时占住编号；`settle(chatKey, id, sent)` 按发送结果结算。成功时删除候选并记录开口时间与次数，供其他出口观察；失败时只释放占用，候选仍能重试且不占额度。`deliver` 保留给没有独立网络发送步骤的调用方使用，直接完成已预览的候选。

`external` 与自己攒的候选在 `src/index.ts` 的 `gatheredCandidates` 里并成一张表，后面统一走 `orderByArrival` 与 `dropRepeats`，因此外部候选过的关卡、去的重与本地候选完全同一套；带 `postWant` 的读数是候选自己带上来的事实，只在 `facts` 里原样存住，本包不做阈值判断，也不把它折成分数。
