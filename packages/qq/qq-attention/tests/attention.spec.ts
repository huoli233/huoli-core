import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqAttentionOf, type QqAttentionSeam } from '../src/index.ts'

// 工具体只读会话编号与取消信号，其余执行字段由内核在真实调用时注入
function execOf(chatKey: string, signal: AbortSignal = new AbortController().signal): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal })
}

interface Mounted {
  ctx: Context
  seam: QqAttentionSeam
  tool: (name: string) => ToolDefinition
}

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-attention-'))
  tempDirs.push(dir)
  return path.join(dir, 'attention.json')
}

function mount(file: string, selfNames?: readonly string[]): Mounted {
  const ctx = new Context()
  const registered = new Map<string, ToolDefinition>()
  ctx.accessor('tools', {
    get: () => ({
      register: (definition: ToolDefinition) => {
        registered.set(definition.name, definition)
        return () => {}
      },
    }),
  })
  apply(ctx, { file, ...selfNames === undefined ? {} : { selfNames } })
  const seam = qqAttentionOf(ctx)
  if (seam === undefined) throw new Error('注意力没有装配')
  const tool = (name: string): ToolDefinition => {
    const found = registered.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { ctx, seam, tool }
}

// 铺一串消息，水位相关用例都从这里开始
function fill(seam: QqAttentionSeam, chatKey: string, count = 30): void {
  for (let at = 0; at < count; at += 1) seam.inbox.push(chatKey, { senderId: 'u1', text: `第 ${at + 1} 条` })
}

async function call<T>(tool: ToolDefinition, args: Record<string, unknown>, exec: ToolRunContext): Promise<T> {
  return await tool.execute(args, exec) as T
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('看清消息', () => {
  it('读消息返回的水位是这次读到的最后一条', async () => {
    const { seam, tool } = mount(tempFile())
    fill(seam, 'group:1')

    const result = await call<{ readThroughSeq: number; latestSeq: number; messages: unknown[] }>(
      tool('read_messages'), { limit: 5 }, execOf('group:1'),
    )

    expect(result.readThroughSeq).toBe(5)
    expect(result.latestSeq).toBe(30)
    expect(result.messages).toHaveLength(5)
  })

  it('等待期间到达的消息会被等回来', async () => {
    const { seam, tool } = mount(tempFile())
    const waiting = tool('wait_for_messages').execute({ timeoutMs: 300, quietMs: 0 }, execOf('group:1'))
    setTimeout(() => seam.inbox.push('group:1', { senderId: 'u2', text: '晚到的消息' }), 20)

    const waited = await waiting as { newMessages: Array<{ text: string }> }

    expect(waited.newMessages).toHaveLength(1)
    expect(waited.newMessages[0]?.text).toBe('晚到的消息')
  })

  it('等到超时与等到取消是两件不同的事', async () => {
    const { tool } = mount(tempFile())
    const timed = await call<{ timedOut: boolean; cancelled: boolean }>(
      tool('wait_for_messages'), { timeoutMs: 50, quietMs: 0 }, execOf('group:1'),
    )

    expect(timed.timedOut).toBe(true)
    expect(timed.cancelled).toBe(false)
  })

  it('中途取消时报取消而不是超时', async () => {
    const { tool } = mount(tempFile())
    const controller = new AbortController()
    const pending = tool('wait_for_messages').execute({ timeoutMs: 5000, quietMs: 0 }, execOf('group:1', controller.signal))
    controller.abort()

    const cancelled = await pending as { timedOut: boolean; cancelled: boolean }

    expect(cancelled.cancelled).toBe(true)
    expect(cancelled.timedOut).toBe(false)
  })
})

describe('划走与收尾', () => {
  it('不给水位就划不走', async () => {
    const { tool } = mount(tempFile())

    await expect(tool('mark_read').execute({}, execOf('group:1'))).rejects.toThrow(/attention\.seq_required/)
  })

  it('水位超过最新消息时划不走', async () => {
    const { seam, tool } = mount(tempFile())
    fill(seam, 'group:1', 5)

    await expect(tool('mark_read').execute({ throughSeq: 999 }, execOf('group:1'))).rejects.toThrow(/attention\.seq_ahead/)
  })

  it('合法水位会推进，往回退则被拒绝', async () => {
    const { seam, tool } = mount(tempFile())
    fill(seam, 'group:1')

    const marked = await call<{ readThroughSeq: number }>(tool('mark_read'), { throughSeq: 5 }, execOf('group:1'))

    expect(marked.readThroughSeq).toBe(5)
    await expect(tool('mark_read').execute({ throughSeq: 3 }, execOf('group:1'))).rejects.toThrow(/attention\.seq_backwards/)
  })

  it('没有内容的收尾会被拒绝', async () => {
    const { tool } = mount(tempFile())

    await expect(tool('close_conversation').execute({}, execOf('group:1'))).rejects.toThrow(/attention\.empty_close/)
  })

  it('收尾会留下结束点与下次的接法', async () => {
    const { tool } = mount(tempFile())
    const closed = await call<{ closeSummary: string; nextOpening: string }>(
      tool('close_conversation'), { summary: '聊到周末开黑', nextOpening: '问是哪个游戏' }, execOf('group:1'),
    )

    expect(closed.closeSummary).toBe('聊到周末开黑')
    expect(closed.nextOpening).toBe('问是哪个游戏')
  })

  it('唤醒参数互相冲突时被拒绝且状态不变', async () => {
    const { seam, tool } = mount(tempFile())
    const before = seam.store.of('group:1')

    await expect(tool('set_wake_config').execute({ infinite: true, sleepMs: 1000 }, execOf('group:1')))
      .rejects.toThrow(/attention\.conflicting_wake/)

    const after = seam.store.of('group:1')
    expect(after.wakeMode).toBe(before.wakeMode)
    expect(after.wakeUntil).toBe(before.wakeUntil)
  })

  it('重新装配后水位与收尾摘要还在', async () => {
    const file = tempFile()
    const first = mount(file)
    fill(first.seam, 'group:1', 10)
    await first.tool('mark_read').execute({ throughSeq: 4 }, execOf('group:1'))
    await first.tool('close_conversation').execute({ summary: '聊到周末开黑' }, execOf('group:1'))
    const before = first.seam.store.of('group:1')

    const after = mount(file).seam.store.of('group:1')

    expect(after.readThroughSeq).toBe(before.readThroughSeq)
    expect(after.closeSummary).toBe(before.closeSummary)
  })
})

describe('采集到的事实', () => {
  it('只说现场发生了什么，不给该不该说话的结论', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })

    const signals = seam.signals('group:1')

    expect(Object.hasOwn(signals, 'shouldSpeak')).toBe(false)
    expect(Object.hasOwn(signals, 'speak')).toBe(false)
  })

  it('给出候选动作但不替模型做决定', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })

    const signals = seam.signals('group:1')

    expect(Array.isArray(signals.candidates)).toBe(true)
    expect(signals.candidates.length).toBeGreaterThan(0)
  })

  it('候选只有种类与理由，没有权重', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })

    const signals = seam.signals('group:1')

    for (const candidate of signals.candidates) {
      expect(Object.keys(candidate).sort()).toEqual(['kind', 'why'])
      expect(Object.hasOwn(candidate, 'weight')).toBe(false)
      expect(Object.hasOwn(candidate, 'score')).toBe(false)
    }
  })

  it('候选里没有数，排不了序也比不了阈值', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '@小岸 你在吗？' })

    const signals = seam.signals('group:1')

    for (const candidate of signals.candidates) {
      for (const value of Object.values(candidate)) expect(typeof value).toBe('string')
    }
  })

  it('有趣只报勾到了什么，不给分', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '这谁啊？！' })

    const signals = seam.signals('group:1')

    expect(Object.hasOwn(signals.fun, 'score')).toBe(false)
    expect(Object.keys(signals.fun).sort()).toEqual(['evidence', 'signals'])
    expect(typeof signals.fun.evidence).toBe('string')
    expect(signals.fun.evidence.length).toBeGreaterThan(0)
    expect(signals.fun.signals).toContain('带问号')
    expect(signals.fun.signals).toContain('带情绪标点')
  })

  it('没有特别之处时也只说一句事实', () => {
    const { seam } = mount(tempFile(), ['小岸'])
    seam.inbox.push('group:1', { senderId: 'u3', text: '嗯' })

    const signals = seam.signals('group:1')

    expect(signals.fun.signals).toEqual([])
    expect(signals.fun.evidence.length).toBeGreaterThan(0)
  })

  it('唤醒条件里没有概率', async () => {
    const { seam, tool } = mount(tempFile())
    const wake = tool('set_wake_config')

    expect(JSON.stringify(wake.parameters)).not.toContain('probability')

    const set = await call<{ triggers: Record<string, unknown> }>(
      wake, { triggers: { atMention: true } }, execOf('group:1'),
    )

    expect(Object.hasOwn(set.triggers, 'probability')).toBe(false)
    expect(Object.hasOwn(seam.store.of('group:1').triggers, 'probability')).toBe(false)
  })
})
