---
description: "项目内 DSH agent-soul 插件，用灵魂架构说明、体检、脚手架和验证工具补齐能力。"
kind: "package-bundle"
---

# @huoli/huoli-agent-soul

[English](README.md) | 中文

## 概述

把 `dsh-agent-soul` 的宿主半作为项目内 profile bundle 加载。插件提供八个工具，覆盖灵魂架构、清单、诊断、规划、脚手架和本地验证；它不注册改变对话行为的钩子。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

把 `@huoli/huoli-agent-soul` 加进 profile 的 `huoli.profile.bundles`，并让该 profile 的 `node_modules` 能解析这个包。bundle 自带的 `cordis.patch.yml` 会插入 `agent-soul` 行。

QQ profile 通过 `qq-bundle.config.allowedTools` 只把这八个工具开放给私聊。群聊继续走现有工具守卫，不开放这些工具。

-----

<a id="understand-the-implementation"></a>
## 理解实现

[`index.js`](index.js) 导出 `name`、`inject = ['tools']` 和 `apply(ctx)`，通过 `ctx.tools.register` 注册标准 Cordis 工具定义。[`cordis.patch.yml`](cordis.patch.yml) 负责插入插件行，`tsdown.config.ts` 生成运行时入口 `lib/index.js`。

包从自身目录读取 `soul/`、`kit/` 和 `skeleton/`。`package-root.mjs` 让源码入口和 `lib/index.js` 入口都能解析到同一个包根目录。

-----

<a id="further-exploration"></a>
## 进一步探索

- [上游项目](https://github.com/cyanwell/dsh-agent-soul)
- 上游原始 README：`UPSTREAM-README.txt`

-----

<a id="model-experience"></a>
## 模型体验

### 提示内容

#### 模型看到什么

私聊工具目录增加 `agent_soul_layers`、`agent_soul_manifest`、`agent_soul_doctor`、`agent_soul_install`、`agent_soul_plan`、`agent_soul_scaffold`、`agent_soul_check` 和 `agent_soul_verify`。

#### Token 影响

工具 schema 只在 profile 允许的会话出现。灵魂知识文件在调用工具时读取，不会每轮进入提示词。

#### KV Cache 影响

同一会话的工具目录保持稳定。读取知识文件只改变工具结果，不改变请求前缀。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- 这个包只包含宿主半，不包含上游桌面安装器、页面客户端和其它子插件。
- `soul/` 下的文件每次工具调用都会重新读取。修改 profile bundle、`cordis.patch.yml` 或宿主 JavaScript 后仍需重新启动 Host，这与上游限制一致。
- 其它 DSH 插件并非自动兼容。插件必须使用当前可用的 Cordis 服务；来自其它宿主家族的服务导入可能需要兼容适配层。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

项目包名是 `@huoli/huoli-agent-soul`，profile 插件 id 是 `agent-soul`。包根目录的源码入口继续供测试和上游对照使用，运行时入口是打包后的 `lib/index.js`。

</details>
