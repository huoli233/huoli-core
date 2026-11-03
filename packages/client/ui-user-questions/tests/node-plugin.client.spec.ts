import * as NativeToolExecutor from '@huoli/huoli-tool-executor-native'
import { Context } from '@huoli/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import ToolRuntime from '@huoli/huoli-tools'
import SystemPrompt from '@huoli/huoli-system-prompt'
import UserQuestionService from '@huoli/huoli-user-questions'
import { apply } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('ui-user-questions node plugin', () => {
  it('mounts no model-facing tool', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(UserQuestionService)

    await ctx.plugin({ apply }).await()

    // Host UI registration must leave each preset's model-facing tool list intact.
    expect(ctx.tools.get('ask_user_question')).toBeUndefined()
  })
})
