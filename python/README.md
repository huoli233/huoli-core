# Huoli Core Python SDK

English | [中文](README.zh.md)

Python packages for driving Huoli Core as a subprocess. The client SDK communicates with the bundled runtime over newline-delimited JSON-RPC on stdio.

## Packages

| Directory | Dist / module | Role |
|---|---|---|
| [sdk](sdk/README.md) | `huoli-core-sdk` / `deepseek_harness` | High-level turns API and lower-level JSON-RPC client |
| [sdk-runtime](sdk-runtime/README.md) | `huoli-core-runtime-bin` / `deepseek_harness_runtime` | Bundled `huoli` CLI executable and native sidecars |

## Behavior

The SDK starts the matching bundled `huoli --profile sdk` runtime unless the caller selects another `huoli` executable or profile. The runnable minimal example selects the shipped standalone `sdk-minimal` profile; the same runtime also packages `huoli web` and its frontend assets for separate CLI use. Every launch requires an explicitly selected Harness home; Python never silently reads `~/.huoli`. The [SDK reference](sdk/README.md) and [runtime carrier reference](sdk-runtime/README.md) own runtime selection, profiles, patches, and external plugin management.

## Contributor workflows

The [Python contributor workflows](development.md) cover building runtime artifacts, validating the packages, source-mode development, and distribution.
