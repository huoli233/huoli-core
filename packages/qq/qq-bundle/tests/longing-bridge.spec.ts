import { describe, expect, it } from 'vitest'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import type { Agent } from '@huoli/huoli-agent'
import {
  applyLongingEvent,
  emptyLongingState,
  type QqLongingSeam,
} from '@huoli/huoli-qq-longing'
import {
  longingBlockOf,
  noteLongingContact,
  registerLongingBridge,
} from '../src/longing-bridge.ts'

function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, {
    agent: { id: chatKey },
    signal: new AbortController().signal,
  })
}

function fakeSeam(options: {
  calls?: string[]
  render?: string
  active?: boolean
} = {}): QqLongingSeam {
  const calls = options.calls ?? []
  let state = emptyLongingState()
  return {
    read: () => state,
    event(name) {
      calls.push(`event:${name}`)
      const outcome = applyLongingEvent(state, name, {
        nsfwEnabled: true,
        eventGain: 1,
        couplingEnabled: true,
        couplingRate: 1,
        decayPerHour: 3,
        nightDecayPerHour: 6,
        peakWindow: '22:00-02:00',
        peakBonus: 25,
        interactionLust: 0.1,
        affectionGain: 1,
      })
      state = outcome.state
      return outcome
    },
    contact(text) {
      calls.push(`contact:${text}`)
      return state
    },
    render: () => options.render ?? '[暗涌状态]\n她刚被抱过',
    active: () => options.active ?? true,
  }
}

describe('暗涌桥接', () => {
  it('只读取项目内插件服务提供的状态块', () => {
    expect(longingBlockOf(fakeSeam())).toContain('她刚被抱过')
    expect(longingBlockOf(undefined)).toBe('')
  })

  it('私聊联系只交给插件，群聊不碰', () => {
    const calls: string[] = []
    const seam = fakeSeam({ calls })

    noteLongingContact(seam, 'private:10000001', '我回来了')
    noteLongingContact(seam, 'group:1', '群里说话')

    expect(calls).toEqual(['contact:我回来了'])
  })

  it('状态块只进入私聊，一个事件工具能把真实事件交给插件', async () => {
    const calls: string[] = []
    const seam = fakeSeam({ calls })
    let tool: ToolDefinition | undefined
    const ctx = new Context()
    ctx.accessor('tools', {
      get: () => ({
        register: (definition: ToolDefinition) => {
          tool = definition
          return () => {}
        },
      }),
    })
    await ctx.plugin(SystemPrompt, {})
    registerLongingBridge(ctx, seam)

    const privateAssembly = await ctx.systemPrompt.assemble({ agent: { id: 'private:1' } as Agent })
    const groupAssembly = await ctx.systemPrompt.assemble({ agent: { id: 'group:1' } as Agent })

    expect(privateAssembly.contexts.find(item => item.name === 'qq:longing')?.text)
      .toContain('她刚被抱过')
    expect(groupAssembly.contexts.find(item => item.name === 'qq:longing')?.text).toBe('')
    expect(tool?.name).toBe('qq_longing_event')

    const result = await tool?.execute({
      events: [{ name: 'intimate', detail: '抱了很久' }],
    }, execOf('private:1'))

    expect(result).toMatchObject({ ok: true, applied: 5 })
    expect(calls).toEqual(['event:intimate'])
    await ctx.fiber.dispose()
  })
})
