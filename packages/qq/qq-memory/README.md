---
description: "记事情：四层记忆会慢慢变淡，淡到底清掉正文，被找出来又会重新变清楚；重要度每天掉一点，每条另记一份指纹，每天对一次账。"
kind: "package-reference"
---

# qq-memory

## Summary

记事情：刚发生、这段经历、长期印象、私下的事，四层。会慢慢变淡，一次只降一档，淡到底就先退役再清掉正文，只留编号与退役时刻。被找出来会重新变清楚。重要度每天按显著度、召回次数与情绪掉一点，到保护线以上就不再掉。每条另记一份指纹进账本，每天只整理一次、顺手补新账并写一行健康记录。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

两个工具 `memory_append` 与 `memory_query`。记的时候要说明这话是不是直接对她说的、里面情绪有多重；找的时候返回日期、内容、还有多清楚，默认三条。

#### Token effect

只把找到的那几条带进上下文，条数默认上限 3，可以不填关键词；注入整串另有 1200 字上限。

#### KV Cache effect

不影响提示词前缀。

## Known Limitations and Deferred Work

- 向量路是字面哈希编码，不带语义模型：意思相近但用字不同的两句（如「爬山」与「登山」）仍然对不上。
- 每次召回都按需重算库内每条的向量，没有落盘缓存；条目多到几千条时要换成预先算好并持久化的索引。
- 注入是纯函数，追加位置由消息入口保证；本包不接消息链路，也不改系统提示词。
- 全部记忆装在一个文件里，条数多了要换存储。
- 重要度只在写入时算一次，之后只由每日衰减与召回回升改，没有按内容重评。
- `maintain` 一天只跑一次由本包的整理日兜底，真正的每日定时触发在组合包里，本包没有自己的调度。
- 镜像按来源键（`metadata.self_id`）去重，同一个来源换了来源键仍会各写一条：去重认的是来源位置，不是正文。

<a id="dev-note"></a>
### Dev Note

配置项在 `src/index.ts` 的 `Config`：记忆文件、账本文件、主目录覆盖，以及 `tuning` 里的一整组参数，默认值只在 `src/defaults.ts` 的 `DEFAULTS` 出现一次，其中每天掉分那一组直接展开 `@huoli/huoli-qq-policy` 的 `IMPORTANCE_DECAY`。默认落在主目录的 data 下（`data/qq-memory.json` 与 `data/qq-memory-ledger.json`）；往上挪一层与每天变淡分别由 `promoteAll` 和 `sweepOnce` 做，每天掉一次重要度由 `decayAll` 做，半衰期、清晰度档位与跌幅公式都取自 `@huoli/huoli-qq-policy`。

保护线与地板也在 `DEFAULTS` 里：`protectLine` 取保留度表的 `anchorImportance`（默认 70），到这条线以上的条目 `decayAll` 一分不掉；`importanceFloor` 默认 5，任何跌幅都夹在它之上。重要度写入时是整数，衰减把它记到一位小数，读回来不取整，所以关掉再开还是同一个数。

来源只有五档：`chat`、`tool`、`proactive`、`manual`、`self`，写入时按 `MEMORY_SOURCES` 校验，别的值直接抛 `memory.source_unknown`；`metadata` 必须是对象且键为非空字符串，否则抛 `memory.metadata_invalid`。第五档由镜像专用入口 `rememberSelf(entry, at)` 写入：它照 `remember` 落一条，`layer` 固定 `semantic`、`source` 固定 `self`、重要度取 `selfImportanceFloor`（默认 80）与调用方给的值里较大的那个，`metadata` 由它自己拼 `self_id`、`self_kind`、`evidence`、`mirrored_at` 四项，缺来源键或证据就抛 `memory.mirror_incomplete`。同一个 `self_id` 只写一条，重复调用拿回原来那条并给出 `created: false`；`mirroredSelfIds()` 供镜像侧先查再写。


召回在 `src/recall.ts`：`recall(store, { query, scope, limit, now, tuning })` 返回 `RecallHit[]`，每条只有 `id`、`text`、`at`、`clarity`、`score`、`reasons` 六个字段；`reasons` 是 `grams`、`vectorSim`、`importanceTerm`、`freshnessTerm` 四项，相似度取关键词路的片段命中比例与 `vectorSim` 里较大的一个，分数按 `weightSim × 相似度 + importanceTerm + freshnessTerm` 重算得到，清晰度与时间读顶层那两个字段，保留度由两项一并重算。关键词路把两边都按 `gramSize` 切成片段，短查询命中一条、长查询命中两条才算相关，命中之后不受相似度门槛约束。

向量路把正文与查询各自编成 1024 维稀疏向量：单字与 2-gram 分别按 FNV-1a 哈希落到桶里，2-gram 另外给它覆盖的两个相邻字各记一次，最后按长度归一化，空文本是零向量。两段向量的余弦用 `cosineSimilarity` 算，它等于规范里「1 减平方距离的一半」；低于 `minSimilarity`（默认 0.52）的候选直接丢弃，任一侧是零向量时这一路整体缺席。条目只遍历一次，两路命中的同一条只产出一条结果，`grams` 与 `vectorSim` 一起留下两路的证据。编码在读取时按需计算，不落盘、不存第二份。没有候选就是空数组，占位句留给渲染层。副作用只在 `touch`：召回次数加一、`lastSeenAt` 改成现在，当天还没回升过就按 `recallRecover` 抬一点重要度，抬到 `recoverCeiling` 或保护线下方为止，`trace` 与 `forgotten` 条目只计数不回升。

注入在 `src/inject.ts`：`buildInjectBlock(hits, limitChars?, limitItems?)` 按逐字模板拼出背景，整串不超过 `injectMaxChars`（默认 1200），条数不超过 `injectMaxItems`（默认 3），放不下就整条丢并在末尾标出省略条数，首条就超限时返回空串；`trace` 与 `forgotten` 不进来。`injectIntoUserText(text, block)` 只在原文之后隔一个空行接上去，`shouldInject(turnIndex, lastInjectedTurn, repeatTurns?)` 判断这一轮该不该插。

账本在 `src/ledger.ts`：`init` 给现有全部记忆建账，`sync` 只补没记过的编号，`verify` 要求账本里每条都还在、正文没被改、现在每条也都已入账；`describeLedger` 把差异点成编号。文件头带 `schemaVersion`（现在是 1，缺这个字段的旧账本按 1 读，读回不报错），每条记 `sha256`、`len` 与 `state`，`state` 取 `held` 或 `retired`，退役的另带 `retiredAt`。淡到底的那条由整理先标退役再清正文，`sync` 把账本里这条的 `state` 换成 `retired` 而指纹与字数保持入账时的样子，对账仍算对得上；退役之后又长回正文、或把状态改回 `active` 又改写正文，都算正文被改。报告除丢了、被改、还没入账三类之外另给 `retired` 条数，`describeLedger` 一并写出。健康一行在 `src/health.ts`，字段顺序固定，`inject_cap` 与保护线从配置读。三件事由 `maintain(now)` 一次做完：先掉一遍重要度、再按新的重要度变淡、最后补账并拼一行，返回里 `decayed` 是这次掉了分的条数，`didWork` 说明这次是不是真的做了，`lastMaintainedDay` 与 `previousMaintainedDay` 给出这次记下的整理日与上一次的整理日。一天只整理一次：整理日按本地日期存进记忆文件的 `lastMaintainedDay`，同一天再调直接返回 `didWork: false`、计数归零与空行，不衰减、不清理、不补账；跨天第一次照常跑，隔了多天也只按一天的量衰减。旧文件由 `src/store.ts` 读入时补字段：缺的 `metadata` 取 `{}`、`source` 取 `chat`、`lastSeenAt` 取 `at`、`recallCount`、`recoverDay`、`recoverTimes` 与 `emotional` 取 0（大于 1 的按 24 分制折算），旧的 `forgotten` 布尔折成 `state` 并按写入时刻补 `retiredAt`，缺的 `lastMaintainedDay` 取空串，不认识的顶层字段原样留着。
