---
kind: upgrade-guide
description: "Auxiliary LLM request purposes require producer-owned type declarations instead of a shared fixed union."
---

# Declare auxiliary LLM request purposes

English | [中文](guide.zh.md)

## Change

`GenerateOptions.purpose` derives from the declaration-mergeable `LlmRequestPurposeMap` exported by `@huoli/huoli-llm/types`. The shared package no longer declares `compaction` or `session-title`. Plugins that construct auxiliary requests must load the producer's declarations or declare their own purpose. Existing runtime purpose strings keep their meaning.

## Migration

1. Import `@huoli/huoli-compaction-basic` for direct compaction requests, or `@huoli/huoli-session-title-llm` for title requests, using a type-only import when only the declaration is needed.
2. For a plugin-owned purpose, augment `LlmRequestPurposeMap` from the plugin's public type entry. Map the purpose key to `true`:

   ```ts
   import type {} from '@huoli/huoli-llm/types'

   declare module '@huoli/huoli-llm/types' {
     interface LlmRequestPurposeMap {
       'my-plugin-purpose': true
     }
   }
   ```

3. Compile the plugin against the new package declarations. Confirm that its request accepts the declared purpose and rejects an undeclared key.
