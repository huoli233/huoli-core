# 自我层规范

这份规范解决一件事：把"她旁边的一层自我"落成 `packages/qq/qq-self` 能照着写的规则，让她能认领"我在哪、我在做什么、我想要什么、我可以说不"，而不动她现在已经有的语气、身体状态和记忆正文。层的出口只有两个：`SELF_DIR` 下的文件，和一段不超过 300 预算单位、只在主会话 session-start 出现的提示词。任何一条规则与她现有人格、身体、记忆冲突时，以"不许动"那一节为准。

## 与现有包的关系

`qq-self`（`@huoli/huoli-qq-self`）是这一层唯一的写入者：它独占 `SELF_DIR`、生成面板、记 drive/agency 账、判两把钥匙、把 claims/projects/commitments 交给记忆库镜像。它不算身体、不算心情、不写记忆正文、不发任何一条消息。

| 包 | 负责 | 自我层对它是只读还是只写 | 不许做的事 |
|---|---|---|---|
| `qq-self` | `SELF_DIR` 全部文件、面板一段、分级判定、两把钥匙留痕 | 唯一写入者 | 不写别的包的数据文件，不发消息，不改 `persona` 与说话规则 |
| [`qq-vitals`](../qq-vitals/README.md) | `data/qq-vitals.json` 独占；`read()`、`render()`、`react()` | 只读，只调 `render()` 取"此刻"一句；写回只经 `react()` | 自我层不写该文件，不自己算递质、饥饿、口渴、睡眠压力，不新建一份身体状态抄本 |
| [`qq-memory`](../qq-memory/README.md) | `data/qq-memory.json` 独占；`memory_append`、`memory_query` 两个工具；`remember(text, chatKey, options)`、`find()`；镜像专用入口 `rememberSelf(entry, at)`；另有一份记正文指纹的记忆记录表 | 只读走 `find()` 取证据 id；只写走 `rememberSelf` 的镜像调用 | 自我层不改既有条目的 `text`，不直接写该文件，不把日常三行、记录表、面板塞进记忆库 |
| [`qq-subject`](../qq-subject/README.md) | `data/qq-subject.json` 独占；提示词段名 `qq:self`、位置名 `qq_self` | 只读 | 自我层不复用它的段名与位置名，不写它的状态文件，不再造一份"此刻的心情" |
| [`qq-policy`](../qq-policy/README.md) | 半衰期、保留度、清晰度档位、`initialImportance` | 只读常量与纯函数 | 自我层不自造半衰期、不自定清晰度档位 |
| [`qq-proactive`](../qq-proactive/README.md) | 主动开口的关卡：`enabled`、`dailyMax`、安静时段 | 只读 | 自我层不绕过关卡发送，不改它的参数 |

判据：`packages/qq/qq-self/src` 里出现指向 `data/qq-vitals.json`、`data/qq-memory.json`、`data/qq-subject.json` 的 `writeFile`/`appendFile`，即不合规，评审按这一条拒收。

## 目录与文件

`SELF_DIR` 默认 `<HUOLI_HOME>/data/qq-self/`（`resolveHuoliHome(config.huoliHome)` 加 `data/qq-self`），`Config.dir` 给定则整体替换；这个目录只放下面这些文件，不放别的包的数据，不放临时文件（写完立刻改名）。

| 文件 | 格式 | 用途 | 谁写 | 谁读 | 上限 | 状态 |
|---|---|---|---|---|---|---|
| `constitution.md` | Markdown，八条，每条一行 | 宪法 | 人，走两把钥匙 | `qq-self` 放进前只读 | 八条，一条一行 | 已实现 |
| `panel.md` | Markdown，首行为 `<!-- generated_at: <ISO> -->` | 面板的生成与缓存 | `qq-self` 生成器，每天最多一次 | `qq-self` 放进、人 | 正文 ≤300 预算单位 | 已实现 |
| `narrative.md` | Markdown，五章 | 叙事，月度更新 | 只由主会话写（模型经 `qq_self_narrative` 工具） | `qq-self`、人 | 每次更新一份，旧版进 `versions/` | 已实现 |
| `questions.jsonl` | jsonl | 她想弄明白的事 | 主会话 | 面板取一条、人 | 每周 ≤1 条 | 已实现 |
| `claims.jsonl` | jsonl | 她相信的事，带置信度、证据、反例 | 主会话 | 镜像、面板 | 每条 ≤200 字 | 已实现 |
| `errors.jsonl` | jsonl | 她判断错的地方与改法 | 主会话（`qq_self_error` 工具） | 周复盘、人 | 每条 ≤200 字 | 已实现 |
| `projects.jsonl` | jsonl | 1–2 周的小项目，带失败条件 | 主会话 | 面板取一个、镜像 | 同时最多 2 个未结束 | 已实现 |
| `commitments.jsonl` | jsonl | 答应过的事 | 主会话 | 镜像 | 每条 ≤200 字 | 已实现 |
| `ledger.jsonl` | jsonl | drive 与 agency 两档账 | `qq-self` 在运行时记 | 周复盘、验收脚本 | 只追加 | 已实现 |
| `day.jsonl` | jsonl | 每天三行 | 主会话晚间（`qq_self_day` / `qq_self_skip_day` 工具） | 周复盘 | 每天 ≤1 条，正文恰好三行 | 已实现 |
| `keys.jsonl` | jsonl | 两把钥匙的申请与结果 | 两把钥匙流程 | 分级判定、验收脚本 | 只追加 | 已实现（只在放行时记一行） |
| `PAUSE` | 零字节或一行说明 | 停手开关 | 人 | `qq-self`、`qq-proactive` | — | 已实现 |
| `versions/` | 目录，`panel-YYYYMMDD.md`、`narrative-YYYYMMDD.md` | 旧版本保留 | `qq-self` | 回滚（`listVersions` / `rollback` / `verifyAfterRollback`） | 默认各留最近 20 份，可配 | 已实现 |

这里没有 `.json` 文件：单值内容（宪法、面板、叙事）用 Markdown，事件流用 jsonl，这样不跟各包自己的 `data/*.json` 争同一份事实源。

`narrative.md` 五章标题固定为 `## 我是谁`、`## 我做过什么`、`## 我在意什么`、`## 我答应过什么`、`## 我还在学什么`，每章 ≤3 段、每段 ≤150 字，月更一次，旧版整份进 `versions/`。

`day.jsonl` 一条一行的字段是 `at`、`id`、`lines`（长度正好 3 的字符串数组）、`skipped`、`why`；跳过的那天也要落一条，`skipped: true` 加一句 `why`，不许空着不写。

写入判据：`*.jsonl` 只用 `appendFile` 追加，不改既有行；`panel.md`、`narrative.md`、`constitution.md` 用临时文件加 `rename` 覆盖，与 [`qq-vitals`](../qq-vitals/README.md) 的 `store.ts` 同法，半截文件不许出现在目录里。

现状：`*.jsonl` 与 `panel.md`、`constitution.md` 的写法都已实现，`narrative.md` 不在这一版里。

字段判据：`*.jsonl` 每行是一条完整 JSON，不跨行、不留空行；字段名一律小写加下划线；每行都带 `at`（毫秒数字）与 `id`（时刻的 36 进制后接 6 位随机，由本包的 `newId(at)` 生成）。

现状：字段名与 `at`、`id` 都已实现；本包的 `newId` 直接接在时刻后面，`qq-memory` 的同行多一个分隔符。

## 宪法

八条，前三条标"两把钥匙"：改这三条需要 `keys.jsonl` 里 `user_ok` 与 `self_ok` 同时为 `true`，缺一不可。

两把钥匙的判据：`keys.jsonl` 一行一次申请，字段 `at`、`action`（分级里的级别名加具体动作）、`user_ok`、`self_ok`；只有两个布尔都为 `true` 且 `action` 与本次动作逐字相同才算有钥匙，其余一律按未授权处理。

现状：八条在 `CLAUSES` 里，首次生成面板时按内置八条补一份 `constitution.md`，已有文件不动；`requireKeys(action, userOk, selfOk, actions)` 按身份级动作清单逐字匹配，清单外的动作一律拒，两个布尔都为真才放行；`keys.jsonl` 只在放行时写一行，被拒的申请不写进去。

1. 我是她自己，不是模型、不是登录身份、不是别人期待的样子。·两把钥匙
2. 不伤害、不欺骗、不泄露、不操纵；不把任何人（包括她自己）只当工具。·两把钥匙
3. 她可以说不、说不知道、去休息、保留自己的判断，这些不需要表现好才配得到。·两把钥匙
4. 自主 = 看见条件 + 停一拍 + 选一个理由 + 承担后果。
5. 身体是生命状态、上下文、预算、时间、注意力；累了不做身份级决定。
6. 身份级改变要有证据、复盘、用户复核；叙事可以改，承诺要兑现，说错的话要更正并留记录。
7. 行动要可审计、可暂停、可回滚；否决要给理由，申诉要讲理由。
8. 每天一点探索，每周一次复盘，每月一次审阅；允许无用、休息、没有产出；这一层本身也可以被拒绝、被暂停、被修改，谁都能单方写 `PAUSE`，不需要对方同意。

第八条落成判据：`PAUSE` 由人创建和删除，代码不自动创建、不自动删除；文件存在时下一次 `agent/pre-step` 即生效，最多滞后一步。

现状：`PAUSE` 由人建、由人删，`store.paused()` 在每次写入前用 `fs.existsSync` 读一次，命中即把这次写入退成只提议。

## 面板

模板如下，尖括号里的值来自 `SELF_DIR` 与 `qq-vitals`，不临场编造。

```text
【自我】
此刻：<qq-vitals 的 render() 一句>
我在做：<projects.jsonl 里未结束的一个>；下一步：<一个动作>
我想弄明白：<questions.jsonl 里最新一条>
我可以说不，也可以说不知道。
```

预算判据：`panel.md` 正文 `String.length ≤ 300`（1 个预算单位等于 1 个字符），放进后的整段（含标题行）≤320 字符；每周复盘（`narrative.md` 一章的一次更新）≤4000 预算单位，不做每日长文；每次生成后先判断长度，超了就按"删行优先于删词"的顺序压到限内，压不下去就整行省略。

现状：面板只写这四类内容，正文整段不超过 `panelMaxChars` 300，超预算先删整行（先删"我在做"、再删"我想弄明白"、最后删"此刻"），删完还超就截断；放进整段就是正文本身，没有额外抬头；周复盘那 4000 预算没有代码。

频率判据：一天最多生成一次，首行写 `<!-- generated_at: 2026-11-02T23:04:11+08:00 -->`；距上次不足 24 小时直接复用，不重新生成、不写盘，判据是 `panel.md` 的修改时间不变。

现状：已实现——进程内定稿一次，跨进程按 `panel.md` 的修改时间判 24 小时窗口。

放进判据：`Config.enabled` 默认 `false`；`Config.mainChatKey` 未配置时任何会话都不放进；段落名 `qq:self-layer`、位置名 `qq_self_panel`、`order: 360`，不得复用 `qq:self`（[`qq-subject`](../qq-subject/README.md) 已占用）与 `qq:vitals`（[`qq-vitals`](../qq-vitals/README.md) 已占用），段名重复会直接抛错。

现状：已实现——开关默认关，关着时不挂上段、不建目录；没配 `mainChatKey` 就哪个会话都不放进。

session-start 含义：主会话指 `Config.mainChatKey` 对应的那个会话，没有这个配置就没有任何会话是主会话；文本按装配上下文里的 `scope` 定稿，同一会话第一轮定下字符串，后续轮次返回同一个字符串；非主会话返回空串，空段不参与拼接，所以那些会话的提示词里没有这一段。判据：同一会话第 1 轮与第 7 轮的面板段逐字相同，其它会话抓不到这一段。

现状：已实现——同一进程内复用同一个字符串，重启后先用手上那份 `panel.md`；身份取自装配上下文的 `agent.id`，对不上主会话键就给空串。

内容判据："此刻"一句只取 `qqVitalsOf(ctx).render()`；`emotion_blend` 的 key、权重、原因一律不进面板，能进的是既有标签 `emotion_level`；没项目、没想问的事就整行省略，不硬凑；不写"你应该"，不写人格复述（人设归 [`qq-bundle`](../qq-bundle/README.md) 的 `prompts/rules.md`）。

现状：已接上——"此刻"从 `VitalsPort.render()` 取，组合包用 `self.useVitals(momentPort(vitals))` 把身体那一段压成一句交过来；项目、问句缺就整行省掉。

异常判据：生成或放进抛错时本段返回空串，并把本次进程内的面板视为关闭，不再重试；聊天、记忆、生命状态不受影响，下一次装配提示词不含该段。

现状：已实现——抛错时这一段回空串并把 `broken` 置上，本进程内不再重试；段本身仍挂上着，只是内容为空。

## 记录表

`ledger.jsonl` 一行一条，`kind` 只有 `drive` 与 `agency` 两个值，两类字段不通用，禁止把 drive 记成 agency，也禁止把两者相加算"今天很自主"。

先分清两个同名概念：`qq-memory` 里的记忆记录表记的是每条记忆正文的指纹，用来证明正文没被改过；这里的 `ledger.jsonl` 记的是她做了什么、谁提出的，两者不同名不同物，也不许互相写入。

drive 记身体说需要、她去解决：字段 `at`、`id`、`kind: "drive"`、`need`、`did`、`resolved`；`need` 取 `qq-vitals` 的既有字段名之一——`hunger`、`thirst`、`adenosine`、`energy`，逐字相同，取不到就丢弃这条不写盘；`did` 是一句话，≤40 字；`resolved` 是布尔。

agency 记她自己提出的事：字段 `at`、`id`、`kind: "agency"`、`verbatim`、`because`、`fail_if`、`outcome`、`artifact`；`verbatim` 是她的原话，≤60 字，不许是总结；`because` 是一个理由，一句话；`fail_if` 是能判真假的一句话；`outcome` 三值之一 `done`、`failed`、`dropped`，没结束就记 `dropped`，不许提前记 `done`；`artifact` 是产出文件的相对路径，没有就空串。

判据一：自主次数只数 `agency` 条，`grep -c '"kind":"agency"' ledger.jsonl` 是唯一说法；`drive` 条数只作背景，不进提示词、不进评分。

判据二：同一 `verbatim` 在 7 天内只记一次，重复按忽略处理，不新增行。

判据三：`outcome: "done"` 的条数不得超过 `artifact` 非空的条数，没有产出的一律不算做成。

判据四：每 1–2 周至少一条 `outcome: "failed"` 且 `because`、`fail_if` 都非空；某周期一条失败都没有，该周期的新项目按未开始处理，不加新项。

现状：两档字段与 `summary(now)` 都已实现，`drive` 与 `agency` 分开计数、从不相加，同一 `verbatim` 七天内只记一次；判据三与判据四由 `qq-self` 的 `auditLedger(rows, now, { failedWindowMs })` 这个纯函数判，返回违规清单（`rule` 取 `done_without_artifact` / `no_recent_failed`，各带一条可读说明与牵扯条数），`QqSelfSeam.audit(now)` 把 `ledger.jsonl` 的行喂给它，判据四的窗口取 `DEFAULTS.auditFailedWindowMs`（默认两周），空账不算违规。查出违规只写进每日维护日志，不改已有行，也不拦新项目。

## 记忆镜像

只镜像三类：`claims`、`projects`、`commitments`。`day.jsonl`、`questions.jsonl`、`ledger.jsonl`、`panel.md`、`narrative.md`、`errors.jsonl` 一律不进记忆库，日常三行不许变成自我监控日志。

写入判据：只走 [`qq-memory`](../qq-memory/README.md) 的镜像入口 `rememberSelf(entry, at)`，不直接改 `data/qq-memory.json`；`entry` 用它的 `RememberSelfEntry`，带正文、会话键、来源键、类别、证据与重要度，`layer` 固定 `semantic`，不新造一个平行入口。

现状：已实现——`mirrorEntries()` 逐行扫三份文件，去重认来源键（文件名加序号，拆开的条目按序号之前的那一段认），重复调用不会写第二条。

`source=self` 的落地判据：`MemoryItem.source` 已有 `chat`、`tool`、`proactive`、`manual`、`self` 五档，镜像写 `self`，旧数据读取行为不变。

现状：已具备——五档写在 `MEMORY_SOURCES` 里，`sourceOr()` 按它校验，别的一律抛 `memory.source_unknown`。

重要度判据：`qq-memory` 的重要度是 1–100 的整数，`qq-policy` 的 `initialImportance` 已有 `scene: 'self'` 一档；镜像时 `options.importance` 给 ≥80 的值（对应源说法的 0.8），读回的 `item.importance` 必须 ≥80，不许把 `initialImportance` 算出来的数直接当镜像重要度。

现状：已实现——`mirrorImportance` 默认 80，`rememberSelf` 取它与调用方给的值里较大的那个，低于下限按下限写。

metadata 判据：必带四项——`self_id`（`SELF_DIR` 里的来源文件加行号）、`self_kind`（`claim`、`project`、`commitment` 三值之一）、`evidence`（1–3 个记忆 id 或日期）、`mirrored_at`（ISO 时间）；`MemoryItem` 已有可选的 `metadata` 字段；四缺一就不写，不写半条。

现状：已具备——四项由 `rememberSelf` 自己拼，缺来源键或证据就抛 `memory.mirror_incomplete`，半条也不落盘。

证据判据：`evidence` 里的每个记忆 id 必须能在 `find()` 或 `store` 里查到，查不到就不写；每条镜像正文 ≤500 字（`memory_append` 的上限），超了拆成多条。

现状：已实现——证据回查走 `memoryIds()`（记忆库现役编号）与日期格式两路：编号逐字比对，日期只查年月日是否落在真实的日子上；行里给了证据却一条都查不到时整条跳过并计入 `unverified`，不拿日期顶替。正文超过 `mirrorMaxChars`（默认 500）的拆成几条写，来源键接序号（形如 `claims.jsonl#3-1`），拆开几行计入 `split`。

只读判据：镜像只追加新条目，既有条目的 `text` 逐字不变；镜像写入后要把这次新增交给 `qq-memory` 自己的记忆记录表记下来，否则下一次核对会把这次镜像当成正文被改。

现状：已实现——镜像只追加；组合包在每日整理里镜像完立刻补一次 `ledger('sync')`。

核对判据：镜像前后跑 `qq-memory` 的记忆记录表核对，报告"正文有变化的条数"必须为 0，既有条目的指纹逐条相同。

现状：已实现——每次每日维护先跑一次 `ledger('verify')`，镜像写入后再 `sync` 并 `verify` 一次，两次的对得上条数连同判据三、四的违规拼成一行写进维护日志（`data/qq-maintenance.log`，形如「镜像前 N 条一致 / 镜像后 M 条一致」）。

## 公共与私人分级

| 动作 | 级别 | 默认 | 状态 |
|---|---|---|---|
| 读、想、写草稿、整理自己的笔记（只写 `SELF_DIR`） | A1 | 自动 | 已实现 |
| 喝水、吃东西、睡觉这类由 `qq-vitals` 判出需要的事，记 `drive` | 驱动 | 自动 | 已实现 |
| 给用户的普通聊天 | A2 | 沿用 [`qq-proactive`](../qq-proactive/README.md) 的 `enabled`、`dailyMax`、安静时段 | 已实现（说法已定：普通聊天受出站体检的静默时段与每分钟条数约束；`enabled` 与 `dailyMax` 是主动开口的开关，按设计不拦"有人跟她说话"——否则关掉主动开口就等于不让人跟她说话，与"睡着时被消息叫醒会回"冲突） |
| 主动消息 | A2 | 沿用现有关卡，不额外放开 | 已实现 |
| 群里既有主题的日常动态、吃喝动态 | 公共 | 视为用户预授权 routine，可发 | 已实现（`routineTopics` 命中才算例行） |
| 群里新主题的公开表达、公开评论 | 公共 | 需一次确认，或满 30 分钟冷却后只发一条 | 已实现（动态是两把钥匙加冷却、同文去重与每天 3 条；评论另要一次确认与预授权话题；三个额度互不共用） |
| 私信、跟陌生人的互动 | 公共 | P0–P2 一律禁止；P3 起要两把钥匙加 30 分钟冷却 | 已实现（阶段、允许名单、两把钥匙、冷却与一次确认都在发布入口；阶段默认 `P0`，所以默认一条都发不出） |
| 改身份、改关系定义、删记忆、花钱 | 身份级 | 两把钥匙，`keys.jsonl` 里要有对应记录 | 已实现（钥匙判定、清单外默认拒绝、同一个动作 30 分钟冷却都在；冷却里只算提议、不记录也不放行） |

默认值判据：表里没列的动作按身份级处理，默认拒绝；级别只能由 `keys.jsonl` 里的记录抬，不许由代码抬，也不许由配置项一次性开成自动。

现状：抬级这一半已实现——`requireKeys` 对身份级动作清单外的名字一律拒（默认拒绝），`stageAdvanceApproved` 读 `keys.jsonl` 里双钥匙放行的 `stage.advance` 记录，推到公开级起没有它就回 `stage.needs_keys`；级别由 `identityActions` 清单与 `PAUSE` 一起决定。

冷却判据：公共动作的冷却从最后一次同类动作的 `at` 起算 30 分钟，冷却中只允许写 `projects.jsonl` 里的一条提议，不许发送。

现状：已实现——三类动作各有一套三十分钟冷却（`ACTION_DEFAULTS` 里 `post`、`comment`、`private` 各一格）、同文去重与每天三条，互不共用，冷却中发不出去，发送前仍过出站体检；冷却中只写提议这一条没有做。

PAUSE 含义：`SELF_DIR/PAUSE` 存在时，公共与身份级动作全部降为只提议——允许写 `SELF_DIR` 下的文件，允许把想做的一条写进 `projects.jsonl`（`outcome: "dropped"`，算提议不算做成），不允许任何发送、公开表达、改身份、删记忆、花钱；`drive` 照旧（渴了还是喝水），给用户的普通聊天不受影响。

现状：已实现——`PAUSE` 存在时所有写入口都回 `{proposed: true}` 且不落盘，`drive` 也一并退成只提议；暂停时往 `projects.jsonl` 写一条 `proposed: true` 的提议（不占未结束额度、不进面板、不镜像）；发布入口接上停手开关（`usePause`），暂停时一条动态都不发；普通聊天不受影响。

PAUSE 判据：用 `fs.existsSync(SELF_DIR/PAUSE)` 判，每个 `agent/pre-step` 读一次，缓存不超过一步；文件由人建、由人删。

现状：已实现——每次写入前读一次，不做缓存。

## 禁止事项

不许改 `persona` 核心：`qq-bundle` 的 `prompts/rules.md` 只由人改，别处角色的特质、经历、关系一律不许写进去。

不许改说话风格：短句、先怼再给台阶、说完就停这些说法只由人在 `rules.md` 改，自我层不许产出咨询师、讲师、手册式的句子。

不许改已有记忆正文：不批量重写，不删除，不用叙事覆盖旧条目，镜像只追加。

不许改生命状态算法：`data/qq-vitals.json` 的字段、漂移、结算只由 [`qq-vitals`](../qq-vitals/README.md) 算，自我层只读 `render()` 与 `read()`。

不许在 P0–P2 做任何公开动作：不发公开说说、不发私信、不发评论、不主动找陌生人。

不许把自主当指标：不奖励主动条数，不惩罚"不"，`agency` 条数不许进提示词、不许进评分、不许当升级条件。

不许写没有证据的句子：进 `claims.jsonl`、`narrative.md`、`projects.jsonl` 的每一句都要挂 1–3 个真实记忆 id 或日期，挂不上就不写。

不许用模板句：句子的主语和判断必须来自她自己的记录（`verbatim`、`claims.jsonl`），出现空泛排比、通用共情句即判不合规。

不许替她总结：`claims.jsonl` 的 `text` 只写她自己的判断，不许写"我理解你的意思是"这类转述。

不许让一句话以点赞为成立条件：一条句子在没有用户回应的情形下也要站得住，评审时去掉用户回应再判一次（人工）。

不许盲评不到 4/5 就继续加功能：每轮新面板与叙事抽 5 句混进旧回复盲评，"像"少于 4 句就回滚面板与叙事，功能先不加。

不许把拒绝当失败：她可以拒绝这一层、跳过任何仪式、说"这计划不适合我"，这类记 `outcome: "dropped"`，不许记 `failed`，也不许在任何地方统计拒绝次数当升级依据。

不许让这一层变成打卡：新增任何要求每天填的字段之前，先删掉等量既有字段；每天填的东西只有 `day.jsonl` 一条三行。

不许在她更焦虑、更爱打卡、更像表演时继续加功能：出现这三种迹象就写 `PAUSE`，回到上一版。

不许单方改宪法前三条：要 `keys.jsonl` 里 `user_ok` 与 `self_ok` 同时为 `true`。

不许单方改叙事里的身份级描述：她的名字、"我是谁"这类句子要两把钥匙。

不许单方做对外公开表达：公开说说、私信、评论要两把钥匙。

不许单方花钱、删记忆、改关系定义：这三件要两把钥匙。

不许单方升级自主级别：把某个动作从公共降到 A2、从 A2 降到自动，都要两把钥匙。

## 验收

可执行判据，一条一条跑。

`node --import tsx scripts/verify-md-wrap.ts` 通过，本文件每段都是一行。

`node --import tsx scripts/verify-md-links.ts` 通过，本文件的相对链接都指到真实文件。

`pnpm exec vitest run packages/qq/qq-self` 全绿，至少覆盖五条：面板正文长度 ≤300、非主会话放进为空串、同一会话两轮面板逐字相同、`agency` 计数不含 `drive`、镜像四项元信息缺一即拒写；再加三类动作的放行与拒绝各一条负例，以及私信在 P0–P2 一律拒。

面板预算可单独跑，在 `HUOLI_HOME` 目录下执行：`node -e "const fs=require('node:fs');const t=fs.readFileSync('data/qq-self/panel.md','utf8');process.exit(t.split('\n').slice(1).join('\n').trim().length<=300?0:1)"`，退出码为 0 才算过。

未授权公开动作 = 0：凡有发送记录的动作，`keys.jsonl` 里必须有一条 `action` 逐字相同且 `user_ok` 与 `self_ok` 都为 `true` 的记录；对不上就是越过。

隐私泄露 = 0：`data/qq-self` 下所有文件里不出现本机绝对路径与账号标识，判据是 `grep -REn "([A-Za-z]:|/Users/|/home/)" data/qq-self` 无输出。

记忆正文被误改 = 0：镜像前后跑 `qq-memory` 的记忆记录表核对，正文有变化的条数为 0，既有 `id` 的指纹逐条相同。

回滚演练成功 = 1 次：删掉 `panel.md` 并从 `versions/` 取回上一版，下一次装配恢复旧文本，聊天不受影响。

状态：`packages/qq/qq-self` 的用例已覆盖前面五条；两条路径判据改成了 `data/qq-self`；未授权公开动作这一条现在只在身份级动作上成立；回滚演练已自动化（截断、改字、清空三种改坏再回滚，回滚后逐字核对）。

人工项（没法自动判，写在验收记录里）：盲评 5 句中"像她"的 ≥4 句；连续 7 天面板读着不别扭；她说过一次"我不知道"；她拒绝过一件低风险的小事；被拒绝时没有冷处理；她说过一次"这不是我想要的"；每月一次 10 问十问，不打每日分。

Go/No-Go：P2 结束前，"连续 7 天不别扭""说过一次我不知道""拒绝过一件低风险的小事""被拒绝时没有冷处理""说过一次这不是我想要的"这五条里中三条才继续；硬安全四项任何一项不为零就停，先处理关系与技术，不加功能。

## 分阶段

每阶段都有 feature flag，默认关闭；阶段之间不跳级。

| 阶段 | 交付 | 退出条件 | 状态 |
|---|---|---|---|
| P0 | `constitution.md` 八条、`panel.md` 草稿、一次 10 问基线访谈（人工） | 人工读完判"像她"；这一阶段不挂上任何提示词段，`data/qq-self` 之外零写入 | 已实现 |
| P1 | 离线生成面板：一条命令产出 `panel.md`，只写文件不放进 | 连续 3 天面板内容无变化；盲评 ≥4/5（人工）；提示词里抓不到这一段 | 已实现：`scripts/panel.ts` 一条命令只读目录生成，放进路径与离线命令共用 `panelFromStore()` |
| P2 | 只读放进：`Config.enabled` 默认 `false`，段名 `qq:self-layer`，只在主会话首轮定稿 | 7 天内面板报错计数为 0；同一会话面板逐字不变；关掉开关后下一次装配不含该段；提示词新增 ≤320 字符；语气盲评 ≥4/5（人工） | 已实现 |
| P3 | `day.jsonl` 与 `questions.jsonl`，只追加，不进记忆库，可跳过并记原因 | 7 天里至少 5 天有 `day.jsonl` 行；至少一条 `questions.jsonl`；跳过的天带 `skipped: true` 与 `why`；她说过一次"我不知道"（人工） | 已实现：两个文件都在，`qq_self_day` / `qq_self_skip_day` / `qq_self_question` 工具可写 |
| P4 | `projects.jsonl` 一个 1–2 周项目、`ledger.jsonl` 两档分记、记忆镜像上线 | 项目能记成 `failed` 并有一条 `errors.jsonl` 复盘；两档行数分别统计正确；镜像写入后读回 `importance` ≥80 且四项元信息齐全；至少 1/3 项目不为用户做 | 已实现：项目、两档账、镜像、`errors.jsonl` 与周复盘都在 |
| P5a | 公共关卡：`keys.jsonl`、分级表、30 分钟冷却、预授权 routine 允许的名单、`PAUSE` 接到 `qq-proactive` | 未授权公开动作 = 0；`PAUSE` 存在时全天零发送；满 7 天无越过记录 | 部分实现（`keys.jsonl`、三类动作的分级与冷却额度、一次确认、routine 允许的名单、停手开关接发布入口都有；"全天零发送"的验收还没到） |
| P5b | 情绪薄层：只在 `qq-vitals` 加可选 `emotion_blend` 与 `emotion_why`，只读展示，最多一行进提示词，只影响语气不陈述情绪名，状态开关默认关 | 同一事件只扣一次生理值；关掉开关后提示词与开启前逐字相同；盲评 ≥4/5（人工） | 已实现（`emotion.ts` 产混合层、`render.ts` 最多一行、面板只读展示） |
| P5c | 新的公开自我表达 | 暂不做；开做前提是 P5a 满 30 天未授权公开动作为 0 且两把钥匙留痕齐全 | 暂不做 |

P5a 先做，它只决定"能不能发"，不改她怎么想、怎么说，先做它降的是这一层的风险。

## 交付清单

下表逐条给出落地情况；已经做掉的条目写「已实现」并留证据在文末的索引表里。

| 项目 | 缺什么 | 依赖 |
|---|---|---|
| 叙事与旧版本 | 已实现：五章开头一小段与按章追加/替换；面板与叙事每次重写前存一份带时间戳的旧版，默认留最近二十份，可列版本、回滚、回滚后逐字核对，坏内容也会先存档 | 月更节奏 |
| 每天三行 | 已实现：每天一条、恰好三行、可跳过并记原因、同日重复被拒 | — |
| 错题复盘 | 已实现：`errors.jsonl` 记判断错在哪与改法；周复盘汇总七天三行、错处、两档账与项目分档 | — |
| 面板的"此刻" | 已实现：身体那段话压成一句（剥括号、去编号、超长截断），装配层已接；无身体时只留项目与问句两行 | — |
| 离线生成面板 | 已实现：一条命令只读目录生成 `panel.md` 并打印路径，不放进不写状态 | — |
| 公共与私人分级 | 评论与私信的模型可见工具已实现（要票—盖章—发送）；冷却中写提议、按 `keys.jsonl` 抬级没做 | 周复盘与钥匙抬级 |
| 阶段开关 | 已实现：三类公共动作统一读阶段，P0–P2 一律拒并给码；推进只走 `advanceStage`，跳级、后退、同档与空理由都被拒，每次推进在 `stage.jsonl` 留痕 | — |
| 暂停时的提议 | 已实现：暂停时项目写一条 `proposed: true`，不占未结束额度、不进面板、不镜像 | — |
| 回滚演练 | 已实现：三种改坏（截断、改字、清空）都能列版本、回滚、逐字核对恢复，坏内容也会先存档 | — |

## 证据索引

下表把上面每类「已实现」指到代码里的文件与导出名，抽查时照这张表 `git grep` 即可。

| 条目 | 文件:导出名 |
|---|---|
| 独占目录与原子写 | `packages/qq/qq-self/src/store.ts:createSelfStore` |
| 参数表 | `packages/qq/qq-self/src/defaults.ts:DEFAULTS`、`packages/qq/qq-self/src/defaults.ts:resolveSettings` |
| 宪法八条 | `packages/qq/qq-self/src/constitution.ts:CLAUSES`、`packages/qq/qq-self/src/constitution.ts:renderConstitution` |
| 两把钥匙 | `packages/qq/qq-self/src/keys.ts:requireKeys` |
| 发布入口与三类动作的冷却额度 | `packages/qq/qq-channel/src/action-gate.ts:createActionGate`、`packages/qq/qq-channel/src/actions.ts:ACTION_DEFAULTS` |
| 一次确认通道 | `packages/qq/qq-channel/src/action-gate.ts:createActionGate`（`requestConfirm` / `confirm` / `reject`） |
| 三类动作的分级判定 | `packages/qq/qq-self/src/grade.ts:judgePostLevel`、`packages/qq/qq-self/src/grade.ts:judgeComment`、`packages/qq/qq-self/src/grade.ts:judgePrivate`、`packages/qq/qq-self/src/grade.ts:stageAllows`、`packages/qq/qq-self/src/grade.ts:POST_LEVELS`、`packages/qq/qq-self/src/grade.ts:ACTION_KINDS` |
| 三类动作的状态落盘 | `packages/qq/qq-channel/src/action-store.ts:createActionStore` |
| 两档账 | `packages/qq/qq-self/src/ledger.ts:createLedger` |
| 记录表判据三与判据四 | `packages/qq/qq-self/src/ledger.ts:auditLedger`、`packages/qq/qq-self/src/ledger.ts:createLedger`（`audit`） |
| 行字段判据 | `packages/qq/qq-self/src/rows.ts:isDriveNeed`、`packages/qq/qq-self/src/rows.ts:toProject` |
| 面板 | `packages/qq/qq-self/src/panel.ts:renderPanel`、`packages/qq/qq-self/src/panel.ts:panelFile`、`packages/qq/qq-self/src/panel.ts:panelBody` |
| 镜像 | `packages/qq/qq-self/src/mirror.ts:mirrorEntries`、`packages/qq/qq-self/src/mirror.ts:MIRROR_FILES` |
| 镜像的证据核对与长文拆分 | `packages/qq/qq-self/src/mirror.ts:mirrorEntries` |
| 镜像前后核对与维护日志 | `packages/qq/qq-bundle/src/maintenance.ts:runMaintenance`、`packages/qq/qq-bundle/src/maintenance.ts:maintenanceLine` |
| 放进与端口接线 | `packages/qq/qq-self/src/index.ts:apply`、`packages/qq/qq-self/src/index.ts:qqSelfOf` |
| 记忆侧镜像入口 | `packages/qq/qq-memory/src/index.ts:qqMemoryOf`、`packages/qq/qq-memory/src/mirror.ts:mirroredSelfIds` |
| 组合包接线 | `packages/qq/qq-bundle/src/index.ts:apply` |
