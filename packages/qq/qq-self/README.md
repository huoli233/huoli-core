---
description: "自我层：一份独占目录、一段只读面板、drive 与 agency 两档账、两把钥匙留下的痕迹。"
kind: "package-reference"
---

# qq-self

## Summary

她旁边的那一层自我：认领"我在哪、我在做什么、我想弄明白什么、我可以说不"，并判一条动态按哪一级才放行。这一包独占 `SELF_DIR`，只读身体那一段话，把面板写进提示词，把两档账与两把钥匙的痕迹留在目录里。它不算身体、不算心情、不写记忆正文、不发消息。

## Table of Contents

- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

主会话的提示词里多一段 `{{qq_self_panel}}`，写的是面板那几行：此刻、我在做、我想弄明白、可以说不；`Config.mainChatKey` 之外的会话拿不到这一段。

#### Token effect

固定不超过三百字，一天最多重做一次，不随聊天变长。

#### KV Cache effect

同一会话逐字不变，前缀缓存不受影响；只有换会话或面板重做才会换文本。

## Known Limitations and Deferred Work

- 记忆镜像只镜 `claims.jsonl`、`projects.jsonl`、`commitments.jsonl` 三类，`day.jsonl`、`questions.jsonl`、`ledger.jsonl`、`errors.jsonl`、`panel.md`、`narrative.md` 一律不进记忆库；去重认来源键（文件加序号），同一条改过正文也不会再镜一次。
- 镜像的证据只取行内 `evidence`，没有就挂这一行的日期，不回头查记忆编号是否真实存在。
- 一条正文超过 `mirrorMaxChars`（默认 500）的条目不写，只计入 `overlong`，没有拆成多条。
- 面板的"此刻"留了 `useVitals()` 端口，本刀没在装配层接线：要把身体那段话压成面板能用的"一句"，得先定压法，这一步留给下一刀。
- `narrative.md`、`day.jsonl`、`errors.jsonl`、`versions/` 没做，本刀只管面板、两档账、钥匙与 `PAUSE`。
- `PAUSE` 下 `drive` 也降级为只提议，与规范里"`drive` 照旧"不同；这一版按"暂停时所有写入只提议，不落盘"实现。
- 分级只判能不能，不判冷却与额度：三类动作的冷却、去重、每日额度与一次确认都在发布的那个包，冷却中写提议也没做。
- 阶段推进只有 `advanceStage(to, reason)` 这个装配层入口，没有模型可见的工具：推哪一档、为什么推由人给，推了才写留痕。
- `keys.jsonl` 只在放行时写一行，被拒的申请不入账，所以那份文件证明的是"谁被放过"，不是"谁申请过"；按记录抬级别的代码也没有。
- 项目、问句、主张、承诺只有 `QqSelfSeam` 上的写入口，没有对应的工具与提示词入口，主会话暂时还不能自己往这些文件里写。
- 宪法在首次启用时按内置八条补一份，已有文件不动；改前三条仍然要两把钥匙，本刀没提供改写入口。

<a id="dev-note"></a>
### Dev Note

参数集中在 `src/defaults.ts` 的 `DEFAULTS`，`Config.settings` 能逐项覆盖；`SELF_DIR` 默认落在数据根目录的 `data/qq-self/`，`Config.dir` 整体替换它。模块分工：目录读写与原子覆盖在 `src/store.ts`（事件流只追加，单值内容先写临时文件再改名），面板排版与预算在 `src/panel.ts`，宪法八条在 `src/constitution.ts`，两档账在 `src/ledger.ts`，钥匙判定在 `src/keys.ts`，三类公共动作的分级判定在 `src/grade.ts`，行字段的读取判据在 `src/rows.ts`，镜像在 `src/mirror.ts`。

`src/grade.ts` 三个纯函数各判一路，输入只有事实、输出只有放行或码与原因：`judgePostLevel` 认 `POST_LEVELS` 里的 `routine` 与 `public`，例行要报话题且落在预授权清单里（`post.topic_required` / `post.not_routine`），公开借 `requireKeys` 判 `public.say`（`post.needs_keys`）；`judgeComment` 先判 `public.comment` 的两把钥匙，再判话题在不在清单里（`comment.needs_keys` / `comment.topic_required` / `comment.topic_not_allowed`）；`judgePrivate` 判对象在不在允许名单（`private.peer_required` / `private.peer_not_allowed`），最后判 `public.direct` 的两把钥匙（`private.needs_keys`）。三路都先判阶段：不到 `publicMinStage`（默认 `P3`）的动态与评论回 `post.stage_blocked` / `comment.stage_blocked`，不到 `privateMinStage`（默认 `P3`）的私信回 `private.stage_blocked`，这时连钥匙都不看；两个下限的默认值只在这一张参数表里定，正式装配时 `qq-channel` 的 `Config` 还能各自覆盖一次。阶段高低由 `stageAllows(stage, minStage, stages)` 按 `DEFAULTS.stages` 的次序比，认不出的写法按"不到下限"算。

阶段本身是留痕不是单值文件：`advanceStage(to, reason, at?)` 只认 `DEFAULTS.stages` 里紧挨着的下一档，跳级回 `stage.skip`、后退 `stage.back`、停在原地 `stage.same`、认不出的写法 `stage.unknown`、没写理由 `stage.reason_required`、这一层关着时 `stage.disabled`；推成了就往 `stage.jsonl` 追加一行 `from` / `to` / `reason` / `at` / `id`。`stage()` 读这最后一条，没推进过就用 `DEFAULTS.stage`（默认 `P0`），所以重装也读得回来。阶段不写进 `keys.jsonl`：那份文件每行都是一次两把钥匙的授权，两类记录混在一起就分不清"谁被放过"和"阶段推到哪"。

镜像的那一面由装配层用 `useMemory(port)` 接上（`port` 只需要"已经镜过的来源键"与"写一条"两件事，`qq-memory` 的装配结果按结构直接满足），关着或没接上时 `mirror()` 只回 `disabled` / `no_memory`，一条都不写。`Config.enabled` 默认关：关着时不注册提示词段，也不建目录、不写文件，所有写入口返回 `disabled`。面板在进程内定稿一次，跨进程用 `panel.md` 的修改时间判一天窗口，同一会话第 1 轮与第 7 轮逐字相同。
