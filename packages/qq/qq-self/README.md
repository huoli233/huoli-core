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
- 两把钥匙只在放行时写 `keys.jsonl`，被拒的申请不入账，所以那份文件证明的是"谁被放过"，不是"谁申请过"。
- 公共动作的三十分钟冷却、动态的额度与去重、`qq-proactive` 的联动都没做，本刀只有分级判定与身份级动作的钥匙判定：分级只认 `routine` 与 `public` 两张级别，`public` 要两把钥匙同时为真，冷却与额度归发布的那个包。
- 项目、问句、主张、承诺只有 `QqSelfSeam` 上的写入口，没有对应的工具与提示词入口，主会话暂时还不能自己往这些文件里写。
- 宪法在首次启用时按内置八条补一份，已有文件不动；改前三条仍然要两把钥匙，本刀没提供改写入口。

<a id="dev-note"></a>
### Dev Note

参数集中在 `src/defaults.ts` 的 `DEFAULTS`，`Config.settings` 能逐项覆盖；`SELF_DIR` 默认落在数据根目录的 `data/qq-self/`，`Config.dir` 整体替换它。模块分工：目录读写与原子覆盖在 `src/store.ts`（事件流只追加，单值内容先写临时文件再改名），面板排版与预算在 `src/panel.ts`，宪法八条在 `src/constitution.ts`，两档账在 `src/ledger.ts`，钥匙判定在 `src/keys.ts`，动态的分级判定在 `src/grade.ts`（纯函数 `judgePostLevel`，只认 `POST_LEVELS` 里的两级，`public` 那一级借 `requireKeys` 判 `public.say` 这个动作，两把钥匙缺一把回 `post.needs_keys`），行字段的读取判据在 `src/rows.ts`，镜像在 `src/mirror.ts`。镜像的那一面由装配层用 `useMemory(port)` 接上（`port` 只需要"已经镜过的来源键"与"写一条"两件事，`qq-memory` 的装配结果按结构直接满足），关着或没接上时 `mirror()` 只回 `disabled` / `no_memory`，一条都不写。`Config.enabled` 默认关：关着时不注册提示词段，也不建目录、不写文件，所有写入口返回 `disabled`。面板在进程内定稿一次，跨进程用 `panel.md` 的修改时间判一天窗口，同一会话第 1 轮与第 7 轮逐字相同。
