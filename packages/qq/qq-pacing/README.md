---
description: "说话的规矩：一段话拆成几条、条与条之间隔多久、今天还能说几句，同一句不重复发。"
kind: "package-reference"
---

# qq-pacing

## Summary

说话的规矩：一段话拆成几条、条与条之间隔多久、今天还能说几句。同一句刚说过就不再发。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

这一行不注册工具，只改发送行为；拆句结果由 `splitSpeech` 给出，提示词里看不到。

#### Token effect

拆句按字数算，不额外消耗。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 额度按小时和按天各一个上限，没有按群分别设。
- 间隔是按时长估的，没考虑对方正在打字。
- 切分只认标点与字数，读不懂句子的意思，讲到一半被切开时不会重新组织说法。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：记账文件、主目录覆盖、一段最多拆几条、每条最多几个字；计数默认落在主目录的 data 下（`data/qq-pacing.json`），每轮第一步把本轮已说的条数清零。

回几条的入口是纯函数 `replyRange(facts)`：输入累、烦、精力、黏、孤独五项事实，输出 `{ min, max }` 这一轮最少与最多几条，只给范围，不做该不该回的判断；只要上限时用兼容入口 `replyBudget(facts)`，它给的就是 `replyRange` 的 `max`。分档表在 `src/reply.ts` 的 `REPLY_TIERS`，从上往下取第一条命中的，下限与上限取自同一档，所以 `min` 永不超过 `max`：

| 命中条件 | 最少几条 | 最多几条 |
|---|---|---|
| 累与烦都过线 | 1 | 1 |
| 烦过线 | 1 | 2 |
| 累过线 | 1 | 2 |
| 特别黏且孤独 | 3 | 4 |
| 有劲又想黏 | 2 | 3 |
| 其余 | 1 | 2 |

阈值全在 `REPLY_DEFAULTS`：`annoyedFrom` 0.62、`tiredFrom` 0.70、`energyEagerFrom` 0.60、`clingyFrom` 0.62、`clingyStrongFrom` 0.78、`lonelyFrom` 0.50，上下限是 `minCap` 1 与 `maxCap` 4，两个数一起夹住 `max`，`min` 也被夹在 `minCap` 与 `max` 之间。

切分是纯函数 `splitByBudget(text, budget)`：`budget` 是这一轮的条数上限与单条字数上限两项，先按句末标点与换行断句，一句长过单条上限再退到逗号与换行，都没有才按字数硬切；断出来的条数超过上限时把相邻几段并按字数平分进前几条，顺序不动、一个字不丢。同样的输入与同样的上限得到同一份切分，没有随机与时间依赖。条与条之间的间隔由 `speechGaps(parts)` 给，`splitSpeech` 是两者合起来的入口。

间隔按每条的字数估：`minGapMs` 打底，每条字数乘 `gapPerCharMs` 后封顶 `gapCapMs`，再按序号加 `gapStepMs`，整体不超过 `maxGapMs`；这几个数只在 `PACING_DEFAULTS` 出现一次。
