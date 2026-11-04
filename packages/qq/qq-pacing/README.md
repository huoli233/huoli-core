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
- 条数上限只给到数，把一段话切成几条去发还没接回来。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：记账文件、主目录覆盖、一段最多拆几条、每条最多几个字；计数默认落在主目录的 data 下（`data/qq-pacing.json`），每轮第一步把本轮已说的条数清零。

回几条的入口是纯函数 `replyBudget(facts)`：输入累、烦、精力、黏、孤独五项事实，输出一到四之间的上限，只给上限，不做该不该回的判断。分档表在 `src/reply.ts` 的 `REPLY_TIERS`，从上往下取第一条命中的：

| 命中条件 | 上限 |
|---|---|
| 累与烦都过线 | 1 |
| 烦过线 | 2 |
| 累过线 | 2 |
| 特别黏且孤独 | 4 |
| 有劲又想黏 | 3 |
| 其余 | 2 |

阈值全在 `REPLY_DEFAULTS`：`annoyedFrom` 0.62、`tiredFrom` 0.70、`energyEagerFrom` 0.60、`clingyFrom` 0.62、`clingyStrongFrom` 0.78、`lonelyFrom` 0.50，上下限是 `minCap` 1 与 `maxCap` 4。
