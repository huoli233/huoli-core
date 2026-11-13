---
description: "Project-local DSH agent-soul plugin for soul architecture checks, scaffolding, and verification."
kind: "package-bundle"
---

# @huoli/huoli-agent-soul

English | [中文](README.zh.md)

## Summary

Load the host half of `dsh-agent-soul` as a project-local profile bundle. The plugin registers eight tools for soul architecture, manifests, diagnostics, planning, scaffolding, and local verification. It does not register a hook that changes conversation behavior.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add `@huoli/huoli-agent-soul` to the profile's `huoli.profile.bundles` list and install the package in that profile. The bundle patch contributes the `agent-soul` plugin row.

The QQ profile exposes the eight tools only in private chat by listing them in `qq-bundle.config.allowedTools`. Group chat keeps the existing tool guard and does not expose them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

[`index.js`](index.js) exports `name`, `inject = ['tools']`, and `apply(ctx)`. It registers through `ctx.tools.register`, so the Host sees ordinary Cordis tool definitions. [`cordis.patch.yml`](cordis.patch.yml) inserts the row, and `tsdown.config.ts` produces the runtime entry at `lib/index.js`.

The package reads `soul/`, `kit/`, and `skeleton/` from its own directory. `package-root.mjs` keeps those paths stable when the same entry runs from source or from `lib/index.js`.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Upstream project](https://github.com/cyanwell/dsh-agent-soul)
- Original upstream README: `UPSTREAM-README.txt`

-----

<a id="model-experience"></a>
## Model Experience

### Prompt content

#### What the model sees

Private chat adds `agent_soul_layers`, `agent_soul_manifest`, `agent_soul_doctor`, `agent_soul_install`, `agent_soul_plan`, `agent_soul_scaffold`, `agent_soul_check`, and `agent_soul_verify`.

#### Token effect

The tool schemas are visible only where the profile allows them. Soul knowledge files are read when a tool runs and are not inserted into every turn.

#### KV Cache effect

The tool catalog is stable for a session. Reading a knowledge file changes a tool result, not the request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This package contains the host half only. The desktop installer, page client, and additional upstream subplugins are not included.
- Changes under `soul/` are re-read on each tool call. Changes to the profile bundle, `cordis.patch.yml`, or the host JavaScript require the Host process to start again, matching the upstream limitation.
- Other DSH plugins are not automatically compatible. A plugin must use an available Cordis service, and imports from another host family may need a compatibility adapter.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

The project package name is `@huoli/huoli-agent-soul`; the profile plugin id is `agent-soul`. The source entry remains at package root for tests and upstream comparison. The published/runtime entry is the bundled `lib/index.js`.

</details>
