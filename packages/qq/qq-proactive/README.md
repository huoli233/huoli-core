---
description: "管主动开口：攒理由、过闸门，先给人看，说不说由模型定，默认关着。"
kind: "package-reference"
---

# qq-proactive

## Summary

主动开口：先攒理由、再过闸门，最后先给人看。每一条待发都带着自己的理由与原始事实，说不说、说哪条由模型定。默认是关的。开了以后夜里也不吵人，冷却与每天额度都按身体给的劲头缩放。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

这一行不注册工具；候选用 `preview` 先看：每条带一句 `text`、自己的 `why`，以及原样的 `facts`（种类、把握、有用程度、风险、来源、到达时刻），不做任何合成。`preview` 同时把这批待发记成"看过"，`deliver(chatKey, id)` 只投递看过的那一条。`consider` 的结果里还带一项 `facts.proactive_bias`，是身体那边算好的想开口的劲，零到一；这个数只影响冷却与每天额度，不进候选、不参与排序，攒住哪几条、先看哪一条都与它无关；没接上身体时是 `null`，不会自己编一个数。

#### Token effect

每条待发只说一句，带上一份事实，条数受闸门与去重限制。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 待发只按到达时间排队，哪条更值得说交给模型判断。
- 冷却取区间的中点再除以劲头，不随对方活跃程度变化。
- 身体给的是零到一的读数，中性的 1.0 倍率折出来约 0.35，所以默认间隔约为区间中点的近三倍；要更快就把 `gapMinMs`、`gapMaxMs` 调小。
- 每天额度按劲头缩到下限 `dailyFloor` 为止，劲头很低时一天仍然留一次。
- 先看再投是硬状态：没 `preview` 过的编号 `deliver` 一律拒，返回 `proactive.not_previewed`。
- 还没接真 QQ 试过。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：开关、每天开口上限与下限、安静时段起止、冷却区间上下限、劲头下限、主目录覆盖，待发的与记账共用一个文件，默认落在主目录的 data 下（`data/qq-proactive.json`）。默认值在 `src/score.ts` 的 `PROACTIVE_DEFAULTS`；闸门判定与两套缩放算法在 `src/gates.ts`：`cooldownMs` 取区间中点再除以夹进 `biasFloor~1` 的劲头，`dailyCapOf` 取 `dailyMax × 劲头` 向下取整且不低于 `dailyFloor`，同样的输入永远得到同一个下次时刻，没有随机。

先看再投的状态在 `src/store.ts`：待发文件版本 2，`previewed` 记着看过哪些编号，投递或过期就一起删掉；`put` 重复放同一条是覆盖，看过的记录保留。`deliver` 的三条路是 `proactive.unknown_item`（这个会话里没有这一条）、`proactive.not_previewed`（还没摆出来看过）、成功时返回那一条并把说话时刻记进账。
