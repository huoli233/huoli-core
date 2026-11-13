---
description: "暗涌：七维关系与欲望状态、事件冲击、时间衰减和私聊注入块。"
kind: "package-reference"
---

# qq-longing

把 `dsh-longing` 的七维状态、事件冲击、软上限、时间衰减和事后余韵迁入项目内的一等插件。`qq-bundle` 通过服务接口读取状态和写入事件，不再依赖 profile 外挂或进程全局变量。

## Summary

七维关系与欲望状态、事件冲击、时间衰减和私聊提示块。

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

### Prompt content

#### What the model sees

私聊回合会多一段 `[暗涌状态]`：身体热度、占有、羞耻、理智、疲劳、好感和最近事件被写成第一人称处境。它不是给模型复述的数值表，而是这一轮的反应起点。群聊不加载这段成人状态；真实事件由 `qq_longing_event` 交给服务。

#### Token effect

状态块限制在一千二百字以内，正常情况下约两百到四百字。插件不重复注册发送、记忆或关系工具。

#### KV Cache effect

状态块每轮随时间变化，会让该段之后的缓存失效；它位于提示词前部，属于有意保留的短动态上下文。

## Known Limitations and Deferred Work

- 当前迁入的是状态与提示核心，原插件的独立网页面板、自动搜索和发图没有搬入。
- 四十五分钟事后余韵按状态时间戳实现，不另建第二套计时器。
- 日记正文不在这里生成；每日三行仍归 `qq-self`。

<a id="dev-note"></a>
### Dev Note

状态默认落在 `data/qq-longing.json`。计算在 `src/model.ts`，提示在 `src/prompt.ts`，原子存盘在 `src/store.ts`，装配与心跳在 `src/index.ts`。
