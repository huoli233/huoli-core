---
description: "记事情：四层记忆会慢慢变淡，淡到底清掉正文，被找出来又会重新变清楚；每条另记一份指纹，每天对一次账。"
kind: "package-reference"
---

# qq-memory

## Summary

记事情：刚发生、这段经历、长期印象、私下的事，四层。会慢慢变淡，一次只降一档，淡到底就把正文清掉，只留个记录。被找出来会重新变清楚。每条另记一份指纹进账本，每天补新账、对一次账，再写一行健康记录。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

两个工具 `memory_append` 与 `memory_query`。记的时候要说明这话是不是直接对她说的、里面情绪有多重；找的时候返回日期、内容、还有多清楚。

#### Token effect

只把找到的那几条带进上下文，条数有上限，可以不填关键词。

#### KV Cache effect

不影响提示词前缀。

## Known Limitations and Deferred Work

- 找记忆只按字面重合和重要度排，没有向量检索。
- 全部记忆装在一个文件里，条数多了要换存储。
- 重要度只在写入时算一次，之后不会自动重评。
- `maintain` 已经导出，按天调用还没接到组合包里。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：记忆文件、账本文件、主目录覆盖，以及 `tuning` 里的保护线与注入上限，默认值只在 `src/defaults.ts` 的 `DEFAULTS` 出现一次。默认落在主目录的 data 下（`data/qq-memory.json` 与 `data/qq-memory-ledger.json`）；往上挪一层与每天变淡分别由 `promoteAll` 和 `sweepOnce` 做，半衰期与清晰度档位取自 `@huoli/huoli-qq-policy`。

账本在 `src/ledger.ts`：`init` 给现有全部记忆建账，`sync` 只补没记过的编号，`verify` 要求账本里每条都还在、正文没被改、现在每条也都已入账；`describeLedger` 把差异点成编号。淡到底清掉正文的那条按遗忘对待，不算正文被改。健康一行在 `src/health.ts`，字段顺序固定，`inject_cap` 与保护线从配置读。两件事由 `maintain(now)` 一次做完：变淡、补账、拼一行。
