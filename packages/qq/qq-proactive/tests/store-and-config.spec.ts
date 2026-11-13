// 一份文件只有一个 owner，以及过期时长真的跟着配置走

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqProactiveOf } from '../src/index.ts'
import { Context } from '@huoli/cordis'
import { createProactiveStore, PROACTIVE_STORE_VERSION } from '../src/store.ts'

const dirs: string[] = []
const contexts: Context[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-proactive-store-'))
  dirs.push(dir)
  return path.join(dir, 'proactive.json')
}

function item(id: string, chatKey: string, at: number): Parameters<ReturnType<typeof createProactiveStore>['pending']['put']>[0] {
  return { id, chatKey, text: '想说的一句', why: '有人问起', facts: { kind: 'share', source: 'thought', at }, createdAt: at, expiresAt: at + 60_000 }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('一份文件一个 owner', () => {
  it('攒下一条候选之后记录再写，候选不会被整份覆盖掉', () => {
    const file = tempFile()
    const store = createProactiveStore({ file, now: () => 1_000 })

    store.pending.put(item('a', 'group:1', 1_000))
    store.timing.noteSpoken('group:1')

    const reopened = createProactiveStore({ file, now: () => 1_000 })
    expect(reopened.pending.all()).toHaveLength(1)
    expect(reopened.timing.todayCount('group:1')).toBe(1)
  })

  it('记录之后攒候选，今天那一次开口的数还在', () => {
    const file = tempFile()
    const store = createProactiveStore({ file, now: () => 1_000 })

    store.timing.noteSpoken('group:1')
    store.pending.put(item('b', 'group:1', 1_000))

    const reopened = createProactiveStore({ file, now: () => 1_000 })
    expect(reopened.timing.todayCount('group:1')).toBe(1)
    expect(reopened.pending.all()).toHaveLength(1)
  })

  it('正式文件写成半截时退到备份，备份里的候选还在', () => {
    const file = tempFile()
    const store = createProactiveStore({ file, now: () => 1_000 })
    store.pending.put(item('c', 'group:1', 1_000))
    // 第二笔写下去之前先把现状留成备份
    store.flush()
    store.timing.noteSpoken('group:1')
    fs.writeFileSync(file, '{"version": 2, "items": [', 'utf8')

    const reopened = createProactiveStore({ file, now: () => 1_000 })
    expect(reopened.pending.all()).toHaveLength(1)
  })

  it('版本对不上的文件按读不出来处理，不拿它当现状', () => {
    const file = tempFile()
    fs.writeFileSync(file, JSON.stringify({ version: PROACTIVE_STORE_VERSION + 1, items: [item('d', 'group:1', 1_000)] }), 'utf8')

    expect(createProactiveStore({ file }).pending.all()).toEqual([])
  })
})

describe('攒多久过期跟着配置走', () => {
  it('配置给了 pendingTtlMs 就按它算 expiresAt', async () => {
    const file = tempFile()
    const ctx = new Context()
    contexts.push(ctx)
    apply(ctx, { file, enabled: true, pendingTtlMs: 5_000, quietStart: '00:00', quietEnd: '00:00' })
    const seam = qqProactiveOf(ctx)
    if (seam === undefined) throw new Error('没装上')

    const decided = seam.consider({
      chatKey: 'group:1',
      candidates: [{ id: 'x', kind: 'share', why: '有人问起', text: '想说的一句', source: 'thought', at: 1_000 }],
      history: [],
      humanActive: false,
      botBusy: false,
      hasChannel: true,
    })

    expect(decided.pending[0]?.expiresAt).toBe(6_000)
  })

  it('没给配置时默认留两小时，不再攒十四天', () => {
    const file = tempFile()
    const ctx = new Context()
    contexts.push(ctx)
    apply(ctx, { file, enabled: true, quietStart: '00:00', quietEnd: '00:00' })
    const seam = qqProactiveOf(ctx)
    if (seam === undefined) throw new Error('没装上')

    const decided = seam.consider({
      chatKey: 'group:1',
      candidates: [{ id: 'x', kind: 'share', why: '有人问起', text: '想说的一句', source: 'thought', at: 1_000 }],
      history: [],
      humanActive: false,
      botBusy: false,
      hasChannel: true,
    })

    expect(decided.pending[0]?.expiresAt).toBe(1_000 + 2 * 60 * 60_000)
  })
})

describe('同会话同理由的候选不重复攒', () => {
  it('换了个编号但理由一样，只留最新那条', () => {
    const file = tempFile()
    const store = createProactiveStore({ file, now: () => 1_000 })
    store.pending.put(item('a', 'group:1', 1_000))
    store.pending.put(item('b', 'group:1', 1_000))

    expect(store.pending.all()).toHaveLength(1)
    expect(store.pending.all()[0]?.id).toBe('b')
  })

  it('理由不同或会话不同就各留一条', () => {
    const file = tempFile()
    const store = createProactiveStore({ file, now: () => 1_000 })
    const other = (id: string, chatKey: string, why: string) => ({ ...item(id, chatKey, 1_000), why })
    store.pending.put(other('a', 'group:1', '有人问起'))
    store.pending.put(other('b', 'group:1', '刚看了个视频'))
    store.pending.put(other('c', 'group:2', '有人问起'))

    expect(store.pending.all()).toHaveLength(3)
  })
})
