---
kind: upgrade-guide
description: "The `agent-instructions` row no longer accepts `huoliHome`; instruction loading always resolves the harness home from `$HUOLI_HOME` or `~/.huoli`."
---

# Instruction loading resolves one harness home

English | [中文](guide.zh.md)

## Change

`@huoli/huoli-agent-instructions` removed its `huoliHome` config field. The plugin resolves the harness home through `resolveHuoliHome()` from `@huoli/huoli-home-paths`, like every other harness consumer: the home is `$HUOLI_HOME` when it is set and non-blank, otherwise `~/.huoli`, with tilde expansion.

A `cordis.yml`, profile patch, or `--patch` overlay that still sets `huoliHome` on the `agent-instructions` row has no effect: the row keeps the stray key and the plugin ignores it, so instruction loading follows the process home. Other providers, such as `huoli-skill-filesystem` and `huoli-shell-env`, keep their own home fields; this removal covers the instruction loader only.

## Migration

1. Delete `huoliHome` from the `agent-instructions` row in `cordis.yml`, `$HUOLI_HOME/cordis.patch.yml`, `$HUOLI_HOME/profiles/<profile>/cordis.patch.yml`, and any `--patch` overlay.
2. Where the override pointed at a non-default home, export `HUOLI_HOME` for the process instead, so every harness consumer reads that home.
3. Confirm with `huoli --profile <profile> --dump-config` that the `agent-instructions` row lists only its remaining fields, and that a new session's first request shows `Instructions from: $HUOLI_HOME/AGENTS.md` (or `~/.huoli/AGENTS.md`) when that file exists.
