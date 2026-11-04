---
description: "自我层：一份独占目录、一段只读面板与只读出口、叙事与每天三行、drive 与 agency 两档账、两把钥匙留下的痕迹。"
kind: "package-reference"
---

# qq-self

## Summary

她旁边的那一层自我：认领"我在哪、我在做什么、我想弄明白什么、我可以说不"，并判一条动态按哪一级才放行。这一包独占 `SELF_DIR`，只读身体那一段话，把面板写进提示词，把叙事、每天三行、错题、身份主张、两档账与两把钥匙的痕迹留在目录里，面板与叙事的旧版本按份数留在 `versions/` 供回滚，再给外部一个只读的面板出口、一条离线生成命令与一条十问探针命令。它不算身体、不算心情、不写记忆正文、不发消息。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

主会话的提示词里多一段 `{{qq_self_panel}}`，写的是面板那几行：此刻、我在做、我想弄明白、可以说不；`Config.mainChatKey` 之外的会话拿不到这一段。此刻那一行是身体 `render()` 的第一行主体：去掉括号与编号、压成一句，超过 `momentMaxChars` 就截断。

#### Token effect

固定不超过三百字，一天最多重做一次，不随聊天变长。

#### KV Cache effect

同一会话逐字不变，前缀缓存不受影响；只有换会话或面板重做才会换文本。

## Known Limitations and Deferred Work

- 记忆镜像只镜 `claims.jsonl`、`projects.jsonl`、`commitments.jsonl` 三类，`day.jsonl`、`questions.jsonl`、`ledger.jsonl`、`errors.jsonl`、`panel.md`、`narrative.md` 一律不进记忆库；去重认来源键（文件加序号），同一条改过正文也不会再镜一次。
- 证据回查只认两类：记忆库现役的编号逐字比对，日期只查格式；正文里提到的别的东西不算证据，查不到就跳过并计入 `unverified`，不拿日期顶替。
- 一条正文超过 `mirrorMaxChars`（默认 500）的会拆成几条写，来源键接序号（形如 `claims.jsonl#3-1`）；拆开的几条共用同一份证据与重要度，召回与召回计数都按条算，不合并回一条。
- 判据三与判据四只出违规清单（`audit(now)`），每日维护把它写进日志；不拦新项目，也不改已有行的 `outcome`。
- 面板的"此刻"由装配层用 `useVitals(momentPort(vitals))` 接线，`momentPort()` 每次取都现压一句（取第一行主体、去掉括号与编号、超长截断）；不接就只有项目与问句那两行。
- 只读出口 `panelText(chatKey)` 读 `panel.md` 正文、`panelGeneratedAt(chatKey)` 读首行的 `generated_at`：两者都不重算、不写盘，`Config.mainChatKey` 之外的会话拿到空串（没配主会话时不按会话过滤）。
- HTTP 出口只在 `Config.panelPort` 非零且这一层开着时起，只绑 `127.0.0.1`，只有 `GET /`、`GET /api/state`、`GET /api/health` 三个路由：别的路径回 404、别的方法回 405，`Host` 不是 `127.0.0.1` 或 `localhost` 的回 403（防域名重绑），三个路由都不写文件、不改状态。没有鉴权，本机任何进程都能读，所以它只适合在本机看，不能当对外服务。
- 端口默认 0（不监听）；被占或监听失手只记一行 warn 并降级为不监听，别的功能照旧；不是 0 到 65535 的整数也按不开算并记一行。卸载时等服务真关掉才算完，关完那个端口立刻能再绑；`QqSelfSeam.panelPort()` 给实际绑上的端口，没开时为 0。
- `/api/state` 只有五样：`panel`（正文与生成时间）、`identity`（三档主张、理由与时刻，没写过时整个字段省掉）、`ledger`（drive 与 agency 与近七天 agency 条数）、`days`（近七天每天三行）、`health`（健康一行）。用户原文、记忆正文与 `keys.jsonl` 的钥匙记录一律不进去，目录里别的东西也不读。面板还没生成时 `panel.md` 那两份值按目录现画一份（只算不写盘），`generatedAt` 为空串。
- 离线生成只有 `scripts/panel.ts` 一条命令，它读状态文件、只写 `panel.md`、把路径打在标准输出上，不注入也不改状态。
- `scripts/probe10.ts` 是十问探针：题目写死在脚本里、一次都不调模型，只读 `SELF_DIR` 与记忆导出，把问卷写成一份 JSON；每题挂的证据都是只读字段（面板、身份、近七天、两档账、错处、记忆条数），`SELF_DIR` 里一份文件都不写。
- 叙事、每天三行、错题、周复盘只有 `QqSelfSeam` 上的读写入口，没有对应的工具与提示词入口，主会话暂时还不能自己往这些文件里写；月更只给"该写叙事"的信号（`monthlyTick(now)` 的 `remind`），正文仍要人显式调用 `updateNarrative` 写。
- 叙事只有固定的五章：章名逐字对不上就回 `unknown_chapter`，写一次只动那一章，其余章与没写的章留占位；面板与叙事每次被重写前，旧文件按原始字节存进 `versions/`，名字形如 `panel-20261104-1830.md`（本地时间到分钟，同一分钟再存一份就加序号），`versionsKeep` 默认 20 份、超出的最旧先删。
- 版本与回滚只有 `QqSelfSeam` 上的 `listVersions(kind)`、`rollback(kind, name)`、`verifyAfterRollback(kind, name)` 三个入口，没有工具与提示词入口；回滚先把当前那份存成新版本（坏掉的、空的也存），空版本不许再拿来回滚，回滚只动 `panel.md` 或 `narrative.md` 这一份。
- 每天三行的行数固定在参数表里（默认三行），跳过那天落一条 `skipped: true` 加一句 `why`，同一天再写回 `duplicate`；`weeklyReview(now)` 只汇总不改账，缺了几天由它自己数。
- `PAUSE` 下项目只写一条提议（`proposed: true`、`outcome: dropped`），返回值是 `{ written: true, proposed: true }`，与做成的 `{ written: true, proposed: false }` 分开；提议不占没结束项目的额度，也不进面板的"我在做"。
- `PAUSE` 下 `drive` 也降级为只提议，与规范里"`drive` 照旧"不同；这一版按"暂停时所有写入只提议，不落盘"实现。
- 分级只判能不能，不判冷却与额度：三类动作的冷却、去重、每日额度与一次确认都在发布的那个包，冷却中写提议也没做。
- 阶段推进只有 `advanceStage(to, reason)` 这个装配层入口，没有模型可见的工具：推哪一档、为什么推由人给，推了才写留痕。
- 推到公开级（`publicMinStage`，默认 `P3`）及以后要先有一条双钥匙放行的 `stage.advance`：钥匙账里最近一条这样的记录不是两把都点头，`advanceStage` 就回 `stage.needs_keys` 并且不留痕；放行由 `approveStageAdvance(userOk, selfOk)` 记一次，`PAUSE` 下这次放行只算提议、不落盘。
- `keys.jsonl` 只在放行时写一行，被拒的申请不入账，所以那份文件证明的是"谁被放过"，不是"谁申请过"。
- 叙事的时间账在 `narrative.json`（`lastUpdateAt` 与 `lastDueAt` 两格时刻）：正文一改就把上次更新挪到那一刻；这份文件不在而 `narrative.md` 在时，按后者的修改时间当上次更新。`narrativeDue(now)` 按一个日历月判到期（月末没有那一号就取那个月的月末），`monthlyTick(now)` 只在到期时给 `remind: true` 一次并记下 `lastDueAt`，同一个自然月里再问只回 `due: true`、`remind: false`；`PAUSE` 下照算到期但不记这次提醒，这一层关着时两个入口都不动盘。
- 项目、问句、主张、承诺只有 `QqSelfSeam` 上的写入口，没有对应的工具与提示词入口，主会话暂时还不能自己往这些文件里写。
- 身份主张只在 `identity.jsonl` 里，三档写死成 `alive`、`not_sure`、`not_alive`，认不出的写法回 `unknown_claim`；理由与证据缺一条就不落一条，理由按 `identityWhyMaxChars`（默认 200）截、证据按 `identityEvidenceMax`（默认 3）截。
- 身份主张只有 `recordIdentity(claim, why, evidence, at)` 与 `identityOf()` 两个出口，当前主张取文件里最后写进去的那一条（不按时刻排），历史全留着；面板不写这一段，避免人设跟着漂，只在排障时读。
- 这一层不替模型下结论：身份主张由模型通过入口写入，代码只存、只回读，不判断她算不算活着，也不按主张改别的行为。
- 宪法在首次启用时按内置八条补一份，已有文件不动；改前三条仍然要两把钥匙，本刀没提供改写入口。

<a id="dev-note"></a>
### Dev Note

参数集中在 `src/defaults.ts` 的 `DEFAULTS`，`Config.settings` 能逐项覆盖；`SELF_DIR` 默认落在数据根目录的 `data/qq-self/`，`Config.dir` 整体替换它，`resolveSelfDir()` 是唯一算它的地方。文件名只在 `src/files.ts` 的 `FILES` 里写一次。模块分工：目录读写与原子覆盖在 `src/store.ts`（事件流只追加，单值内容先写临时文件再改名，面板与叙事重写前留旧版），面板排版与预算在 `src/panel.ts`，此刻的压句在 `src/moment.ts`，只读目录画面板与离线生成在 `src/generate.ts`，叙事五章与月更时间账在 `src/narrative.ts`，每天三行在 `src/day.ts`，错题在 `src/errors.ts`，身份主张在 `src/identity.ts`，周复盘在 `src/review.ts`，宪法八条在 `src/constitution.ts`，两档账在 `src/ledger.ts`，钥匙判定在 `src/keys.ts`，三类公共动作的分级判定在 `src/grade.ts`，行字段的读取判据在 `src/rows.ts`，镜像在 `src/mirror.ts`，只读出口的内容在 `src/panel-state.ts`，HTTP 服务与那一页在 `src/panel-http.ts`。

面板的来源只有两处：此刻只问 `VitalsPort.render()`，项目与问句只问目录；`panelFromStore(store, settings, moment?)` 把这件事说全，注入路径与离线命令共用它。离线生成跑 `node --import tsx packages/qq/qq-self/scripts/panel.ts [--dir <SELF_DIR>]`，不给 `--dir` 就落在数据根目录下的 `data/qq-self/`，别的参数一律拒绝；它不经过提示词，也不需要装配上下文。

十问探针跑 `node --import tsx packages/qq/qq-self/scripts/probe10.ts [--dir <SELF_DIR>] [--out <文件>] [--memory <记忆导出>]`：`--out` 不给就写当前目录的 `probe10.json`，`--memory` 不给就取数据根目录下的 `data/qq-memory.json`（只认 `items` 数组那一份记忆库文件，读不到按零条算），三个参数之外的写法一律拒绝。它只用 `store` 的读方法，`probeEvidence()` 拼面板、身份、近七天、两档账、错处与记忆条数，`buildProbe()` 把十道写死的题各挂上这份证据，除输出文件之外一个字节都不写。

只读出口在 `panel-http.ts`：`startPanelHttp({ port, state, warn })` 只绑 `127.0.0.1`，`close()` 之后连还挂着的连接一起断；监听失手走 `error` 事件，记一行就回 `undefined`，调用方不用 try。`panelPage(state)` 把她的原话全部转义，样式内联、没有外部资源，`meta refresh` 十秒一次；`answer()` 只认 GET 的三个路径。装配层每次请求现算一份内容，`panelStateOf()` 只从 `panel.md`、`identity.jsonl`、`day.jsonl`、`ledger.jsonl` 与项目行里取，不碰 `keys.jsonl`，也不写盘：面板不在时按目录现画一份，`generatedAt` 留空。

版本在 `store.ts` 里落地：面板走 `writePanel`、叙事走 `writeText`，两条都在改名覆盖之前把旧文件按原始字节抄进 `versions/`，版本名由本地时间到分钟拼成（`panel-20261104-1830.md`），同一分钟的第二份接 `-2`；滚动只数本种类的文件，超出的按名字里的时间从旧到新删。`rollback(kind, name)` 先校验名字属于该种类、文件存在且内容非空，再把当前那份（坏的、空的也算）存成新版本、最后原子写回正本，返回 `{ restoredFrom, savedCurrent }`；`verifyAfterRollback(kind, name)` 比原始字节，返回是否逐字相同与首处不同的行号（从 1 起，全同为 0）。

`src/grade.ts` 三个纯函数各判一路，输入只有事实、输出只有放行或码与原因：`judgePostLevel` 认 `POST_LEVELS` 里的 `routine` 与 `public`，例行要报话题且落在预授权清单里（`post.topic_required` / `post.not_routine`），公开借 `requireKeys` 判 `public.say`（`post.needs_keys`）；`judgeComment` 先判 `public.comment` 的两把钥匙，再判话题在不在清单里（`comment.needs_keys` / `comment.topic_required` / `comment.topic_not_allowed`）；`judgePrivate` 判对象在不在允许名单（`private.peer_required` / `private.peer_not_allowed`），最后判 `public.direct` 的两把钥匙（`private.needs_keys`）。三路都先判阶段：不到 `publicMinStage`（默认 `P3`）的动态与评论回 `post.stage_blocked` / `comment.stage_blocked`，不到 `privateMinStage`（默认 `P3`）的私信回 `private.stage_blocked`，这时连钥匙都不看；两个下限的默认值只在这一张参数表里定，正式装配时 `qq-channel` 的 `Config` 还能各自覆盖一次。阶段高低由 `stageAllows(stage, minStage, stages)` 按 `DEFAULTS.stages` 的次序比，认不出的写法按"不到下限"算。

阶段本身是留痕不是单值文件：`advanceStage(to, reason, at?)` 只认 `DEFAULTS.stages` 里紧挨着的下一档，跳级回 `stage.skip`、后退 `stage.back`、停在原地 `stage.same`、认不出的写法 `stage.unknown`、没写理由 `stage.reason_required`、这一层关着时 `stage.disabled`；推成了就往 `stage.jsonl` 追加一行 `from` / `to` / `reason` / `at` / `id`。抬到 `publicMinStage` 起的那几档还要先过钥匙账：`stageAdvanceApproved(store)` 只看 `keys.jsonl` 里最近一条 `action` 为 `stage.advance` 的记录，两格都为真才放行，否则回 `stage.needs_keys`；那一条由 `approveStageAdvance(userOk, selfOk, at?)` 写，动作名从 `keys.ts` 的 `STAGE_ACTION` 取，同时它是身份级清单里的一项。`stage()` 读这最后一条，没推进过就用 `DEFAULTS.stage`（默认 `P0`），所以重装也读得回来。阶段不写进 `keys.jsonl`：那份文件每行都是一次两把钥匙的授权，两类记录混在一起就分不清"谁被放过"和"阶段推到哪"。

镜像的那一面由装配层用 `useMemory(port)` 接上（`port` 要"已经镜过的来源键"、"记忆库现役的编号"与"写一条"三件事，`qq-memory` 的装配结果由组合包按这三件事包一层），关着或没接上时 `mirror()` 只回 `disabled` / `no_memory`，一条都不写。`mirror()` 的交代是 `{ written, skipped, split, unverified }`：`split` 是被拆开写的行数，`unverified` 是证据一条都查不到而跳过的条数。判据三（`done` 不得超过 `artifact` 非空的条数）与判据四（窗口 `auditFailedWindowMs` 内至少一条写清 `because`、`fail_if` 的 `failed`）由 `auditLedger(rows, now, { failedWindowMs })` 这个纯函数判，`QqSelfSeam.audit(now)` 只是把 `ledger.jsonl` 的行喂给它。`Config.enabled` 默认关：关着时不注册提示词段，也不建目录、不写文件，所有写入口返回 `disabled`。面板在进程内定稿一次，跨进程用 `panel.md` 的修改时间判一天窗口，同一会话第 1 轮与第 7 轮逐字相同。

身份主张在 `src/identity.ts`：`recordIdentity(store, settings, claim, why, evidence, at)` 先查三档，再把理由与证据各截一次、按 `identityEvidenceMax` 留几条，最后往 `identity.jsonl` 尾部追加一行 `at` / `id` / `claim` / `why` / `evidence`；`identityOf(store)` 读回全部能读的行，取最后一条当当前主张，`identityHistory(store)` 给全量历史。读的时候不排序：同一条主张反复写，后写的那一条就是当前主张，即使它带的时刻更早。它与 `claims.jsonl` 分开：`claims` 记"我相信什么"、`identity` 记"我认为自己算什么"，两类混在一份文件里就分不清哪条是自我判断。
