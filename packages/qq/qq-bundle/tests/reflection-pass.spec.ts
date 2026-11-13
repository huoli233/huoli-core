import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import { SessionId, SessionSeq, type Session, type SessionEvent } from '@huoli/huoli-session'
import type { ToolDefinition, ToolExecution, ToolGuard } from '@huoli/huoli-tools'
import { describe, expect, it } from 'vitest'
import { registerReflectionPass } from '../src/reflection-pass.ts'

interface Harness {
  ctx: Context
  tool: ToolDefinition | undefined
  guards: ToolGuard[]
  deferred: unknown[]
  dispose(): void
}

function mount(): Harness {
  const ctx = new Context()
  let tool: ToolDefinition | undefined
  const guards: ToolGuard[] = []
  const deferred: unknown[] = []
  ctx.accessor('tools', {
    get: () => ({
      register: (definition: ToolDefinition) => {
        tool = definition
        return () => { tool = undefined }
      },
      guard: (guard: ToolGuard) => {
        guards.push(guard)
        return () => { guards.splice(guards.indexOf(guard), 1) }
      },
    }),
  })
  const dispose = registerReflectionPass(ctx, () => {})
  return { ctx, get tool() { return tool }, guards, deferred, dispose }
}

function execution(name: string, chatKey = 'group:1', mind?: string): ToolExecution {
  return Object.assign({} as ToolExecution, {
    name,
    arguments: mind === undefined ? {} : { mind: { review: mind } },
    agent: { id: SessionId(chatKey) },
  })
}

function turnEnd(): SessionEvent<'turn/end'> {
  return {
    type: 'turn/end',
    seq: SessionSeq(0),
    time: Date.now(),
    data: { turn: 1, reason: { kind: 'completed' } },
  } satisfies SessionEvent<'turn/end'>
}

describe('DSH 同轮复核', () => {
  it('模型主动调用时只延后一次独立来源的短复核，不污染正常轮次', async () => {
    const h = mount()
    const reflect = h.tool
    if (reflect === undefined) throw new Error('复核工具未注册')
    const exec = Object.assign(execution('qq_reflect'), {
      deferContext: (message: unknown) => { h.deferred.push(message) },
      concludeTurn: () => {},
    })

    await expect(reflect.execute({ reason: '可能把群友的话当成对我说' }, exec))
      .resolves.toMatchObject({ started: true })
    await expect(reflect.execute({ reason: '再来一次' }, exec))
      .resolves.toMatchObject({ started: false, reason: 'already_used_this_turn' })

    expect(h.deferred).toHaveLength(1)
    expect(JSON.stringify(h.deferred[0])).toContain('qq-reflection')
    expect(h.guards[0]?.(execution('qq_send_message'))).toContain('QQ_REFLECTION_REVIEW_REQUIRED')
    expect(h.guards[0]?.(execution('qq_send_message', 'group:1', '我重新确认了说话对象'))).toBeUndefined()
    h.dispose()
  })

  it('普通轮不拦外发；turn/end 后状态清掉，但同一会话十分钟内不再复核', async () => {
    const h = mount()
    const reflect = h.tool
    if (reflect === undefined) throw new Error('复核工具未注册')
    expect(h.guards[0]?.(execution('qq_send_message'))).toBeUndefined()
    const exec = Object.assign(execution('qq_reflect'), { deferContext: () => {}, concludeTurn: () => {} })
    await reflect.execute({ reason: '有疑点' }, exec)

    h.ctx.emit('session/event', { id: SessionId('group:1') } as Session, turnEnd())

    expect(h.guards[0]?.(execution('qq_send_message'))).toBeUndefined()
    await expect(reflect.execute({ reason: '新一轮的疑点' }, exec))
      .resolves.toMatchObject({ started: false, reason: 'cooldown' })
    h.dispose()
  })

  it('轮次被打断时也清掉复核状态，不给下一轮留下反思债', async () => {
    const h = mount()
    const reflect = h.tool
    if (reflect === undefined) throw new Error('复核工具未注册')
    const exec = Object.assign(execution('qq_reflect'), { deferContext: () => {}, concludeTurn: () => {} })
    await reflect.execute({ reason: '有疑点' }, exec)
    expect(h.guards[0]?.(execution('qq_send_message'))).toContain('QQ_REFLECTION_REVIEW_REQUIRED')

    await h.ctx.serial('agent/turn-stopping', {
      agent: { id: SessionId('group:1') } as Agent,
      turn: 1,
      signal: new AbortController().signal,
    })

    expect(h.guards[0]?.(execution('qq_send_message'))).toBeUndefined()
    h.dispose()
  })
})
