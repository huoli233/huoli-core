---
description: "管主动开口：攒理由、打分、过闸门，先给人看再发，默认关着。"
kind: "package-reference"
---

# qq-proactive

## Summary

主动开口：先攒理由、再打分、再过闸门，最后先给人看再发。默认是关的。开了以后夜里也不吵人。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

这一行不注册工具；攒住的想说话可以用 `preview` 先看，再由上层决定要不要放进提示词。

#### Token effect

每条攒住的只说一句，最多带一条进上下文。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 打分还是几个乘数的组合，没有让模型参与排序。
- 闸门里的间隔是随机区间，不是按对方活跃程度自适应。
- 还没接真 QQ 试过。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：开关、每天开口上限、安静时段的起止、主目录覆盖，攒住的与记账共用一个文件，默认落在主目录的 data 下（`data/qq-proactive.json`）；打分常数在 `src/score.ts` 的 `PROACTIVE_DEFAULTS`，闸门判定在 `src/gates.ts`。
