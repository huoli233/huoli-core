---
description: "额度：每说完一轮按真实用量记账，当天用掉多少、还剩多少，折成档位交给身体那边。"
kind: "package-reference"
---

# qq-balance

## Summary

额度：每提交一条带用量的回答就记一笔，当天累计用掉多少 token，折算成零到满档的一个数交给 `qq-vitals` 的 `setBalance`，由它换成死亡威胁的目标值。不查任何远端接口，账就在本机。

## Table of Contents

- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

## Dev Note

记账口径：`assistant/message` 这一条的 `usage` 才算，`assistant/attempt` 的中间尝试不算，免得同一笔两遍。一条用量按输入、输出、缓存读、缓存写四项相加。

档位口径：`levelOf(已用, 一天多少, 满档)` 给 `(1 - 已用/一天多少) × 满档`，用光就是零。零点使用满档十，用掉一半是五，正好落在 `qq-vitals` 的四档线上。

换天：按 `timeZone` 算本地日期，日期变了就清零再记。账写在 `data/qq-balance.json`，装配时先读回来，所以重启不会把今天已经花掉的忘掉。

写盘失败只在内存里继续记，并记一行 warn；不会因为磁盘问题丢掉当天的数。

## Model Experience

### Prompt content

#### What the model sees

这一行不挂工具、不写提示词。它只把档位交给身体那一路，模型能看到的仍然是 `{{qq_vitals}}` 里那句按档位换来的话。

#### Token effect

零 token。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 只按 token 记账，不折成钱：仓库里没有价目表，换成金额要另配一张表。
- 不区分是谁花的：QQ 会话与子代理的花费算在同一个当日总额里。
- 不读历史用量：进程不在的时候花掉的（比如别处直接调用模型）不会补进来。
