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

这一行不挂上工具，只改发送行为；拆句结果由 `splitSpeech` 给出，提示词里看不到。

#### Token effect

拆句按字数算，不额外消耗。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 额度按小时和按天各一个上限，没有按群分别设。
- 间隔是按时长估的，没考虑对方正在打字。
- 切分只认标点与字数，读不懂句子的意思，讲到一半被切开时不会重新组织说法。
- 整段不切的网址比单条上限还长时，那一条会比上限长：宁可这一条长，也不把链接切成两半。
- 间隔默认用真随机，同一段话每次的气泡间隔都不一样；要复现就传 `seededRandom(seed)` 当随机源。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：记录文件、主目录覆盖、一段最多拆几条、每条最多几个字，以及一小时额度 `perHour`、一天额度 `perDay`、同文本窗口 `repeatWindowMs`、留多少条最近文本 `recentKeep`；后四项的默认值都在 `src/plan.ts` 的 `PACING_DEFAULTS`，改配置后记录行为跟着变。计数默认落在主目录的 data 下（`data/qq-pacing.json`）。

语音有自己那本账：`voicePerHour` 4 与 `voicePerDay` 20 两项单独记，发语音既不占文本额度，文本额度也不会把语音拦下来；记在同一个文件的 `voiceHourCount` 与 `voiceDayCount` 上，按小时与按天各自清零。发语音前要过的上限是 `resolveVoiceLimits` 解析的三项 `voiceMaxSeconds` 60、`voiceMaxBytes` 1048576、`voiceBytesPerSecond` 1500，装配后由 `voiceLimits()` 交给调用方去量，这几项的默认值在 `PACING_DEFAULTS` 里只写一次。`voiceAllow()` 查额度、`voiceSpend()` 记一笔、`voiceUsed()` 给读数，与 `allow` / `spend` / `used` 互不影响；额度用满分别给 `pacing.voice_hour_full` 与 `pacing.voice_day_full`，附一句改成文字说的下一步。

按小时与按天这一档只有一处判据：纯函数 `quotaVerdict(kind, reading, ceiling, at)`，文本与语音只是换本账、换上限与换码。它给的四组码是 `pacing.hour_full`、`pacing.day_full`、`pacing.voice_hour_full`、`pacing.voice_day_full`，原因里写清「这一小时/今天已经说了（发了）多少条（段），到多少的上限了」，`retryAt` 给下一个整点或明天零点（`nextHourAt` / `nextDayAt`）。记录仓的 `check` 由 `quota()` 与重复窗口拼起来，`voiceCheck` 直接读同一处，所以说话与发语音不会各判一套。出站体检（`qq-channel/src/outbound.ts`）不再自己存小时与每日阈值，它拿正文来问 `allow`，把这一处的码与原因原样透传；分钟那一档按会话计数，仍由体检自己判，码是 `outbound.rate`。

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

切分是纯函数 `splitByBudget(text, budget)`：`budget` 是这一轮的条数上限与单条字数上限两项，先按句末标点与换行断句，一句长过单条上限再退到逗号与换行，都没有才按字数硬切；断出来的条数超过上限时把相邻几段并按字数平分进前几条，顺序不动、一个字不丢。同样的输入与同样的上限得到同一份切分，没有随机与时间依赖。条与条之间的间隔由 `speechGaps(parts, options)` 给，`splitSpeech` 是两者合起来的入口。

切点只落在码点边界上，不会切开表情这类代理对，两段各自都是完整字符。网址、markdown 链接与 `[CQ:` 段整块不切：断句与按字数硬切都会绕开这些片段，切点不落在它们内部，整段比单条上限还长时整块带走。这些片段由 `semantic.ts` 的 `protectedRanges` 给出，语义分段与按上限切分共用同一套规则，没有第二份。

`semantic` 与 `semanticSplit` 打开时先走 `splitSemantically`：书面标点、换行和中文之间的空格都是分句切点，句号与问号感叹号留在句尾，网址、CQ 码、@ 与 markdown 链接整段不当切点，网址与 @ 后面紧跟的中文标点不算它的一部分；短话（`SEMANTIC_DEFAULTS.minChars` 6 字）、分句太少（`minPieces` 2）或切不动时原样返回一条，让 `preferSingle` 继续生效；长话切成不超过 `maxParts` 个气泡，过短的碎片（`minPartChars` 2 字）并回更短的邻居，拼接不加空格。换行是模型写出的气泡边界，不跨行合并。三项门槛由调用方通过 `resolveSemanticSplit` 传进来，包本身不写死部署值。

间隔按每条的字数估：`minGapMs` 打底，每条字数乘 `gapPerCharMs` 后封顶 `gapCapMs`，再按序号加 `gapStepMs`，得到这一条的基准时长；再按 `gapJitter`（默认 0.35）上下浮动，并以 `longGapProbability`（默认 0.1）的概率换成一次 `longGapMinMs` 到 `longGapMaxMs`（默认 1800 到 2800）之间的明显停顿，取两者中较长的一个，最后夹在 `minGapMs` 与 `maxGapMs` 之间取整。抖动与停顿都从注入的随机源取，不给就用真随机，测试传 `seededRandom(seed)` 固定种子；`splitSpeech` 的 `gaps` 选项把它一路传进来。间隔参数由 `resolveGapTuning` 从配置解析，默认值只在 `PACING_DEFAULTS` 出现一次。
