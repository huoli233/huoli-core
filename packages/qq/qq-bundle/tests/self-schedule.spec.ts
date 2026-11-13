import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import {
  ScheduleId,
  type ScheduleCatalogEntry,
  type ScheduleCreateRequest,
  type ScheduleEditRequest,
} from '@huoli/huoli-schedule'
import { SessionId } from '@huoli/huoli-session'
import { describe, expect, it, vi } from 'vitest'
import {
  SELF_WAIT_PREFIX,
  cancelSelfWait,
  registerSelfScheduleAgentResolver,
  scheduleSelfWait,
  type SelfSchedulePort,
} from '../src/self-schedule.ts'

function entry(id: string, chatKey: string, title = `${SELF_WAIT_PREFIX}${chatKey}`): ScheduleCatalogEntry {
  return {
    kind: 'after',
    id: ScheduleId(id),
    title,
    prompt: 'wait',
    afterSeconds: 5,
    scheduledAt: new Date(Date.now() + 5_000).toISOString(),
    target: { kind: 'session', sessionId: SessionId(chatKey) },
    involvedSessionIds: [SessionId(chatKey)],
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function mount(initial: readonly ScheduleCatalogEntry[]): {
  port: SelfSchedulePort
  edits: ScheduleEditRequest[]
  creates: Array<{ request: ScheduleCreateRequest; actor: unknown }>
} {
  const edits: ScheduleEditRequest[] = []
  const creates: Array<{ request: ScheduleCreateRequest; actor: unknown }> = []
  const port: SelfSchedulePort = {
    async catalog() {
      return [...initial]
    },
    async create(request, actor) {
      creates.push({ request, actor })
      return entry(`new-${creates.length}`, String(request.target?.kind === 'session' ? request.target.sessionId : 'group:1'))
    },
    async edit(request) {
      edits.push(request)
      return { id: request.id, deleted: true }
    },
  }
  return { port, edits, creates }
}

describe('DSH 自主等待', () => {
  it('新等待替换同会话旧任务，并只投回当前 QQ 会话', async () => {
    const { port, edits, creates } = mount([entry('old', 'group:1')])
    const note = vi.fn()

    const id = await scheduleSelfWait(port, 'group:1', 2_400, note)

    expect(id).toBe('new-1')
    expect(edits).toHaveLength(1)
    expect(edits[0]).toMatchObject({ id: ScheduleId('old'), action: 'delete' })
    expect(typeof edits[0]?.expectedUpdatedAt).toBe('string')
    expect(creates[0]?.request).toMatchObject({
      title: `${SELF_WAIT_PREFIX}group:1`,
      timing: { kind: 'after', after_seconds: 3 },
      target: { kind: 'session', sessionId: SessionId('group:1') },
    })
    expect(String(creates[0]?.actor)).toBe('group:1')
    expect(creates[0]?.request.prompt).toContain('到点不等于必须发言')
    expect(note).toHaveBeenCalledWith('self_wait_scheduled', 'group:1', { id: 'new-1', afterSeconds: 3 })
  })

  it('取消只删除同一会话的自主等待，不碰别的会话和普通任务', async () => {
    const { port, edits } = mount([
      entry('one', 'group:1'),
      entry('two', 'group:1'),
      entry('other-chat', 'group:2'),
      entry('ordinary', 'group:1', '普通提醒'),
    ])

    const removed = await cancelSelfWait(port, 'group:1', vi.fn())

    expect(removed).toBe(2)
    expect(edits.map(edit => edit.id)).toEqual([ScheduleId('one'), ScheduleId('two')])
  })

  it('到点时通过 QQ 会话管理器恢复原 Agent', async () => {
    const ctx = new Context()
    const agent = { id: SessionId('group:1') } as Agent
    const agentFor = vi.fn(async () => agent)
    const off = registerSelfScheduleAgentResolver(ctx, { agentFor }, vi.fn())
    const fallback = vi.fn(async () => {
      throw new Error('不应走通用恢复')
    })
    try {
      await expect(ctx.waterfall('schedule/resolve-agent', SessionId('group:1'), fallback)).resolves.toBe(agent)
      expect(agentFor).toHaveBeenCalledWith('group:1')
      expect(fallback).not.toHaveBeenCalled()
    } finally {
      off()
      await ctx.fiber.dispose()
    }
  })
})
