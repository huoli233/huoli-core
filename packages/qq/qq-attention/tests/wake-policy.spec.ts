import { describe, expect, it, vi } from 'vitest'
import { emptyAttention } from '../src/types.ts'
import { shouldWake } from '../src/wake-policy.ts'

function message(patch: Partial<{
  chatKey: string
  senderId: string
  at: number
  atMe: boolean
  replyToBot: boolean
  isPoke: boolean
}> = {}) {
  return {
    chatKey: 'group:1',
    senderId: 'u1',
    text: '普通群聊',
    at: 1_000,
    ...patch,
  }
}

const wake = (state: ReturnType<typeof emptyAttention>, patch: Parameters<typeof message>[0] = {}, policy = {}, now = 1_000,
  store?: { append(event: { type: 'reopen'; chatKey: string; at: number }): void }) =>
  shouldWake(state, message(patch), undefined, policy, now, store)

describe('唤醒规则只认模型设过的休息与收尾', () => {
  it('默认状态允许普通群消息进入模型判断', () => {
    expect(wake(emptyAttention())).toMatchObject({ allow: true, reason: 'trigger' })
  })

  it('名字与问句不由正则判断，设了这两项就交给模型', () => {
    const state = {
      ...emptyAttention(),
      triggers: { atMention: false, nameMention: true, question: true, poke: false, anyMessage: false },
    }

    expect(wake(state)).toMatchObject({ allow: true, reason: 'trigger' })
  })

  it('明确关闭全部唤醒条件时不进入模型', () => {
    const state = {
      ...emptyAttention(),
      triggers: { atMention: false, nameMention: false, question: false, poke: false, anyMessage: false },
    }

    expect(wake(state)).toMatchObject({ allow: false, reason: 'wake_trigger_required' })
  })

  it('私聊、点名和引用仍是明确直呼', () => {
    const state = {
      ...emptyAttention(),
      triggers: { anyMessage: false, atMention: false, nameMention: false, question: false, poke: false },
    }

    expect(wake(state, { chatKey: 'private:1' }).allow).toBe(true)
    expect(wake(state, { atMe: true }).allow).toBe(true)
    expect(wake(state, { replyToBot: true }).allow).toBe(true)
  })

  it('定时休息期间普通消息不进入，好友私聊可按组合配置放行', () => {
    const state = { ...emptyAttention(), wakeMode: 'timed' as const, wakeUntil: 2_000 }

    expect(wake(state)).toMatchObject({ allow: false, reason: 'timed_rest' })
    expect(wake(state, { chatKey: 'private:1' }, { privateWakeWhileTimedRest: true }))
      .toMatchObject({ allow: true, reason: 'direct' })
  })

  it('定时休息期间群聊点名、引用和戳一戳仍可直接叫醒', () => {
    const state = { ...emptyAttention(), wakeMode: 'timed' as const, wakeUntil: 2_000 }

    expect(wake(state, { atMe: true })).toMatchObject({ allow: true, reason: 'direct' })
    expect(wake(state, { replyToBot: true })).toMatchObject({ allow: true, reason: 'direct' })
    expect(wake(state, { isPoke: true })).toMatchObject({ allow: true, reason: 'direct' })
  })

  it('收尾之后普通消息不再进入，模型明确留的人仍可进入', () => {
    const state = { ...emptyAttention(), closedAt: 1_000, triggers: { anyMessage: true, speakerIds: ['u2'] } }

    expect(wake(state, { at: 2_000 }, {}, 2_000)).toMatchObject({ allow: false, reason: 'conversation_closed' })
    expect(wake(state, { senderId: 'u2', at: 2_000 }, {}, 2_000))
      .toMatchObject({ allow: true, reason: 'closed_speaker' })
  })

  it('完整自主模式重新打开收尾过的会话，普通消息交给模型', () => {
    const state = { ...emptyAttention(), closedAt: 1_000 }
    const append = vi.fn()

    expect(wake(state, { at: 2_000 }, { ambientAll: true }, 2_000, { append }))
      .toMatchObject({ allow: true, reason: 'ambient_all' })
    expect(append).toHaveBeenCalledWith({ type: 'reopen', chatKey: 'group:1', at: 2_000 })
  })
})
