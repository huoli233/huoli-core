import { describe, expect, it, vi } from 'vitest'
import { createBackgroundToolRuntime } from '../src/background-tools.ts'
import type { ToolDefinition, ToolDispatchExecution } from '@huoli/huoli-tools'
import type { Context } from '@huoli/cordis'

interface Harness {
  runtime: ReturnType<typeof createBackgroundToolRuntime>
  results: { text: string; chatKey: string; traceIds: readonly string[] }[]
  notes: { kind: string; chatKey: string }[]
  sent: string[]
  stopped: { value: boolean }
}

function execOf(chatKey: string, callId: string, name = 'bili_look'): ToolDispatchExecution {
  return {
    name,
    callId,
    rootCallId: callId,
    arguments: { url: 'https://example.invalid/BV1' },
    signal: new AbortController().signal,
    agent: { id: chatKey },
    token: Symbol(callId),
  } as unknown as ToolDispatchExecution
}

function toolOf(run: (args: unknown, exec: ToolDispatchExecution) => Promise<unknown>): ToolDefinition {
  return {
    name: 'bili_look',
    description: 'test',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    execute: run,
  } as unknown as ToolDefinition
}

function harness(overrides: { timeoutMs?: number; maxPerChat?: number; wake?: () => boolean } = {}): Harness {
  const results: Harness['results'] = []
  const notes: Harness['notes'] = []
  const sent: string[] = []
  const stopped = { value: false }
  const ctx = { logger: () => ({ info: () => {}, warn: () => {} }) } as unknown as Context
  const channel = { send: async (text: string) => { sent.push(text); return { ok: true } } } as never
  const runtime = createBackgroundToolRuntime({
    ctx,
    channel,
    config: {
      tools: ['bili_look'],
      timeoutMs: overrides.timeoutMs ?? 5000,
      workingAckText: '我接着看。',
      failureText: '没办完。',
      maxPerChat: overrides.maxPerChat ?? 2,
    },
    isStopped: () => stopped.value,
    note: (kind, chatKey) => { notes.push({ kind, chatKey }) },
    setWake: () => {},
    wake: (chatKey, text, _reason, traceIds) => {
      results.push({ chatKey, text, traceIds })
      return overrides.wake?.() ?? true
    },
  })
  return { runtime, results, notes, sent, stopped }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('后台长工具', () => {
  it('短路时不改原调用信号，返回结束本轮标记并发出接手回复', async () => {
    const h = harness()
    let release: () => void = () => {}
    const tool = toolOf(() => new Promise<unknown>((resolve) => { release = () => resolve('看完了') }))
    const exec = execOf('group:1', 'c1')
    const before = exec.signal
    const handled = h.runtime.handle(exec, tool, ['t1'])
    expect(handled.accepted).toBe(true)
    expect(handled.concludesTurn).toBe(true)
    expect(exec.signal).toBe(before)
    expect(h.sent).toEqual(['我接着看。'])
    expect(h.results).toEqual([])
    release()
    await settle()
    expect(h.results).toHaveLength(1)
    expect(h.results.at(0)?.chatKey).toBe('group:1')
    expect(h.results.at(0)?.traceIds).toEqual(['t1'])
    expect(h.results.at(0)?.text).toContain('看完了')
  })

  it('同一会话乱序完成仍按顺序补发，且每条只发一次', async () => {
    const h = harness()
    const pending = new Map<string, (text: string) => void>()
    const tool = toolOf((_a, exec) => new Promise<unknown>((resolve) => { pending.set(String(exec.callId), t => resolve(t)) }))
    const first = h.runtime.handle(execOf('group:1', 'c1'), tool, [])
    const second = h.runtime.handle(execOf('group:1', 'c2'), tool, [])
    expect(first.accepted && second.accepted).toBe(true)
    pending.get('c2')?.('第二条')
    await settle()
    expect(h.results).toEqual([])
    pending.get('c1')?.('第一条')
    await settle()
    expect(h.results.map(row => row.text.includes('第一条') ? '1' : '2')).toEqual(['1', '2'])
    expect(h.results).toHaveLength(2)
  })

  it('失败发出说明，取消后旧结果不再补发', async () => {
    const h = harness()
    let release: (text?: string) => void = () => {}
    const tool = toolOf(() => new Promise<unknown>((resolve, reject) => { release = text => text === undefined ? reject(new Error('boom')) : resolve(text) }))
    h.runtime.handle(execOf('group:1', 'c1'), tool, [])
    h.runtime.cancel('group:1', 'new_message_interrupt')
    release('迟到的结果')
    await settle()
    expect(h.results).toEqual([])
    const failing = toolOf(() => Promise.reject(new Error('boom')))
    h.runtime.handle(execOf('group:2', 'c2'), failing, [])
    await settle()
    await settle()
    expect(h.results).toHaveLength(1)
    expect(h.results.at(0)?.text).toContain('没办完。')
  })

  it('急停、超时、关闭后丢弃结果，跨会话互不干扰', async () => {
    vi.useFakeTimers()
    try {
      const h = harness({ timeoutMs: 1000 })
      let release: (text: string) => void = () => {}
      const tool = toolOf(() => new Promise<unknown>((resolve) => { release = t => resolve(t) }))
      h.runtime.handle(execOf('group:1', 'c1'), tool, [])
      h.runtime.handle(execOf('group:2', 'c2'), toolOf(() => Promise.resolve('别群')), [])
      h.stopped.value = true
      vi.advanceTimersByTime(1001)
      await settle()
      expect(h.results).toEqual([])
      h.stopped.value = false
      release('旧结果')
      await settle()
      expect(h.results).toEqual([])
      h.runtime.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('同一会话超过上限时放行原执行链，不重复登记', async () => {
    const h = harness({ maxPerChat: 1 })
    const tool = toolOf(() => new Promise<unknown>(() => {}))
    expect(h.runtime.handle(execOf('group:1', 'c1'), tool, []).accepted).toBe(true)
    expect(h.runtime.handle(execOf('group:1', 'c2'), tool, []).accepted).toBe(false)
    expect(h.runtime.handle(execOf('group:1', 'c1'), tool, []).accepted).toBe(false)
    expect(h.runtime.handle(execOf('group:2', 'c3'), tool, []).accepted).toBe(true)
  })
})
