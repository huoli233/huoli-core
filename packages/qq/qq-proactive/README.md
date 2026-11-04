---
description: "管主动开口：攒理由、过闸门，先给人看，说不说由模型定，默认关着。"
kind: "package-reference"
---

# qq-proactive

## Summary

主动开口：先攒理由、再过闸门，最后先给人看。每一条待发都带着自己的理由与原始事实，说不说、说哪条由模型定。默认是关的。开了以后夜里也不吵人。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

这一行不注册工具；候选用 `preview` 先看：每条带一句 `text`、自己的 `why`，以及原样的 `facts`（种类、把握、有用程度、风险、来源、到达时刻），不做任何合成。挑中哪条就把它的编号交给 `deliver`。

#### Token effect

每条待发只说一句，带上一份事实，条数受闸门与去重限制。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 待发只按到达时间排队，哪条更值得说交给模型判断。
- 冷却取区间的中点，不随对方活跃程度变化。
- 还没接真 QQ 试过。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：开关、每天开口上限、安静时段起止、冷却区间上下限、主目录覆盖，待发的与记账共用一个文件，默认落在主目录的 data 下（`data/qq-proactive.json`）。默认值在 `src/score.ts` 的 `PROACTIVE_DEFAULTS`；闸门判定与冷却中点算法在 `src/gates.ts`，同样的输入永远得到同一个下次时刻。
