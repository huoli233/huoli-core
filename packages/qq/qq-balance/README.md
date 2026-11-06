---
description: "余额：启动读一次，之后每隔六小时再读一次，把数字交给身体那边当生存压力。"
kind: "package-reference"
---

# qq-balance

## Summary

余额：启动时读一次，之后每隔一段时间再读一次，把读到的数字交给 `qq-vitals` 的 `setBalance`，由它按四档换成死亡威胁的目标值。读不到就什么都不交。

## Table of Contents

- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

## Dev Note

数值口径：`mortalityBalanceCalm` / `Wary` / `Low`（10 / 8 / 5）是分档线，`balanceLevel` 就是这里读到的原始数字，不再换算。四档对应的目标值在 `qq-vitals` 的 `mortalityTarget` 里。

`refreshMs` 默认六小时，最短一分钟；启动那次读不等心跳，装配完就发出去。定时器 `unref` 过，不会拖着进程不退。

## Model Experience

### Prompt content

#### What the model sees

这一行不挂工具、不写提示词。它只把余额数字交给身体那一路，模型能看到的仍然是 `{{qq_vitals}}` 里那句按档位换来的话。

#### Token effect

零 token。

#### KV Cache effect

不影响。

## Known Limitations and Deferred Work

- 只认 `GET /user/balance` 这一种返回：`balance_infos` 里每条的 `total_balance`。别的服务要把余额拼成同样的样子才能接。
- 读失败时保留上一次的值，不把零交出去；因此网络长时间断掉时，她按断网前那个档位继续过日子。
- 不判断「充钱之后该不该高兴」：涨上去只是目标值变小，回头怎么写由模型自己说。
