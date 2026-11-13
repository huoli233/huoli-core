import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent, PreStepDecision } from '@huoli/huoli-agent'
import { createAssistantMessage, createToolResultMessage, LlmAttemptId } from '@huoli/huoli-llm'
import { SessionSeq, type Session, type SessionEvent } from '@huoli/huoli-session'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention } from '@huoli/huoli-qq-attention'
import { apply as applyChannel, qqChannelOf } from '@huoli/huoli-qq-channel'
import { apply as applyContinuity, qqContinuityOf } from '@huoli/huoli-qq-continuity'
import { apply as applyMemory, qqMemoryOf } from '@huoli/huoli-qq-memory'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import type { ToolDefinition, ToolGuard, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, qqBundleOf, type DecisionRecord } from '../src/index.ts'
import { appendConsidered, createDecisionLog, createTimeline } from '../src/decisions.ts'
import { saidTextOf } from '../src/memory-events.ts'

type SocketHandler = (event: { data?: string }) => void

// 每次发出去都立刻回一个 echo，好让发送这条路当场结算
class FakeSocket {
  static readonly opened: FakeSocket[] = []
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, SocketHandler[]>()

  constructor() {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, handler: SocketHandler): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(payload: string): void {
    this.sent.push(payload)
    const echo = (JSON.parse(payload) as { echo?: string }).echo
    if (echo === undefined) return
    this.emit('message', JSON.stringify({ echo, retcode: 0, data: { message_id: this.sent.length } }))
  }

  close(): void {
    this.readyState = 3
  }

  open(): void {
    this.readyState = 1
    this.emit('open')
  }

  deliver(raw: Record<string, unknown>): void {
    this.emit('message', JSON.stringify(raw))
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

const CHAT = 'group:123'
const AGENT = { id: CHAT } as Agent

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-decisions-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  ctx: Context
  file: string
  socket: FakeSocket
  tool: (name: string) => ToolDefinition
  records(): DecisionRecord[]
  /** 记忆仓那一面，看她说了话有没有攒进队列 */
  memory: NonNullable<ReturnType<typeof qqMemoryOf>>
  continuity: NonNullable<ReturnType<typeof qqContinuityOf>>
  guards: ToolGuard[]
}

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
async function mount(
  patch: {
    banned?: readonly string[]
    quietStart?: string
    quietEnd?: string
    privateFallbackText?: string
    privateWorkingAck?: string
    privateErrorFallbackText?: string
    allowGroups?: readonly string[]
  } = {},
  createAgent?: (
    sessionId: string,
    options: { agentOptions?: { provider?: string; model?: string } },
  ) => {
    followup: (message: unknown) => void
    dispose: () => Promise<void>
    cancel?: (reason: unknown) => void
    whenIdle?: () => Promise<void>
  },
  resumeAgent?: (
    sessionId: string,
    options: { agentOptions?: { provider?: string; model?: string } },
  ) => {
    followup: (message: unknown) => void
    dispose: () => Promise<void>
    cancel?: (reason: unknown) => void
    whenIdle?: () => Promise<void>
  },
): Promise<Mounted> {
  const dir = tempDir()
  const file = path.join(dir, 'qq-decisions.jsonl')
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  const guards: ToolGuard[] = []
  ctx.accessor('tools', {
    get: () => ({
      definitions: () => [...tools.values()],
      register: (definition: ToolDefinition) => {
        tools.set(definition.name, definition)
        return () => {}
      },
      guard: (guard: ToolGuard) => {
        guards.push(guard)
        return () => {}
      },
    }),
  })
  await ctx.plugin(SystemPrompt, {})
  if (createAgent !== undefined) {
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
    } as never)
    const handleOf = (
      live: {
        followup: (message: unknown) => void
        dispose: () => Promise<void>
        cancel?: (reason: unknown) => void
        whenIdle?: () => Promise<void>
      },
      sessionId: string,
    ) => {
      const agent = { id: sessionId } as Agent
      Object.assign(agent, {
        ctx: {
          tools: { restrict: () => () => {} },
          on: () => () => {},
        },
        followup: live.followup,
        ...live.cancel === undefined ? {} : { cancel: live.cancel },
        whenIdle: live.whenIdle ?? (async () => {}),
      })
      return { agent, dispose: live.dispose }
    }
    ctx.provide('agents', {
      async create(options: { sessionId: string; agentOptions?: { provider?: string; model?: string } }) {
        const live = createAgent(options.sessionId, options)
        return handleOf(live, options.sessionId)
      },
      async resume(options: { resumeSessionId: string; agentOptions?: { provider?: string; model?: string } }) {
        if (resumeAgent === undefined) throw new Error('unexpected resume')
        const live = resumeAgent(options.resumeSessionId, options)
        return handleOf(live, options.resumeSessionId)
      },
      get: () => undefined,
    } as never)
  }
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyContinuity(ctx, { file: path.join(dir, 'continuity.json') })
  // 队列与记录也落在临时目录里：每轮收尾会推一拍队列，别去碰主目录那份
  applyMemory(ctx, {
    file: path.join(dir, 'memory.json'),
    ledgerFile: path.join(dir, 'ledger.json'),
    healthLogFile: path.join(dir, 'health.log'),
    queueFile: path.join(dir, 'queue.json'),
  })
  applyChannel(ctx, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    sentLedgerFile: path.join(dir, 'sent.json'),
    quietStart: patch.quietStart ?? '00:00',
    quietEnd: patch.quietEnd ?? '00:00',
    ...patch.allowGroups === undefined ? {} : { allowGroups: patch.allowGroups },
    ...patch.banned === undefined ? {} : { banned: patch.banned },
  })
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepAt: '04:00',
    privateMergeMs: 0,
    groupMergeMs: 0,
    decisionsFile: file,
    wakeLogFile: path.join(dir, 'qq-wake.jsonl'),
    emergencyStopFile: path.join(dir, 'qq-emergency-stop.json'),
    ...patch.privateFallbackText === undefined ? {} : { privateFallbackText: patch.privateFallbackText },
    ...patch.privateWorkingAck === undefined ? {} : { privateWorkingAck: patch.privateWorkingAck },
    ...patch.privateErrorFallbackText === undefined ? {} : { privateErrorFallbackText: patch.privateErrorFallbackText },
  })
  const socket = FakeSocket.opened.at(-1)
  if (socket === undefined) throw new Error('通道没有装起来')
  socket.open()
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  const memory = qqMemoryOf(ctx)
  if (memory === undefined) throw new Error('记忆没有装起来')
  const continuity = qqContinuityOf(ctx)
  if (continuity === undefined) throw new Error('收尾仓没有装起来')
  return { ctx, file, socket, tool, memory, continuity, guards, records: () => qqBundleOf(ctx)?.decisions(0, 100) ?? [] }
}

// 造一条 tool/call 事实，跟真跑时内核发的一样
function toolCall(name: string, args: Record<string, unknown>, callId = 'c1'): SessionEvent {
  return {
    type: 'tool/call',
    seq: 1,
    time: Date.now(),
    data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) },
  } as SessionEvent
}

function failedToolResult(callId: string, text: string, seq = 2): SessionEvent {
  return {
    type: 'tool/result',
    seq: SessionSeq(seq),
    time: Date.now(),
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: callId as never,
        content: [{ type: 'text', text }],
        isError: true,
      }),
    },
  }
}

function assistantMessage(text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq: SessionSeq(2),
    time: Date.now(),
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test', model: 'test' },
      }),
      stream: [],
    },
  } satisfies SessionEvent
}

function assistantMessageWithReasoning(reasoning: string, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq: SessionSeq(2),
    time: Date.now(),
    surfaceOp: 'append',
    data: {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [
          { type: 'reasoning', text: reasoning },
          { type: 'text', text },
        ],
        source: { provider: 'test', model: 'test' },
      }),
      stream: [],
    },
  } satisfies SessionEvent
}

function failedTurn(code: string): SessionEvent {
  return {
    type: 'turn/end',
    seq: SessionSeq(3),
    time: Date.now(),
    data: {
      turn: 1,
      reason: {
        kind: 'error',
        error: { code, message: '请求失败' },
      },
    },
  } satisfies SessionEvent
}

function completedTurn(turn = 1): SessionEvent {
  return {
    type: 'turn/end',
    seq: SessionSeq(3),
    time: Date.now(),
    data: {
      turn,
      reason: { kind: 'completed' },
    },
  } satisfies SessionEvent
}

function requestHeader(provider: string, model: string): SessionEvent {
  return {
    type: 'request/header',
    seq: SessionSeq(4),
    time: Date.now(),
    data: {
      reason: 'initial',
      header: {
        config: { provider, model },
        tools: [],
      },
    },
  } satisfies SessionEvent
}

// 工具体只读会话编号与取消信号，其余字段由内核在真实调用时给
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

const next = async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] })

function stepOf(step: number, agent: Agent = AGENT) {
  return {
    agent,
    messages: [],
    turn: 1,
    step,
    signal: new AbortController().signal,
    modelSelection: { provider: 'test', model: 'test' },
  }
}

// 走一轮：进门、说一句、收尾
async function oneRound(
  seat: Mounted,
  text: string,
  mind?: {
    reason: string
    focus: string
    tone: string
    impulse?: string
    counter?: string
    choice?: string
    inner: string
    next: string
    reflect?: string
    waitMs?: number
    interrupt?: string
    cancel?: string
    settle?: string
  },
): Promise<void> {
  await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
  const args = mind === undefined ? { text } : { text, mind }
  await seat.tool('qq_send_message').execute(args, execOf(CHAT))
  seat.ctx.emit('session/event', { id: CHAT } as Session, toolCall('qq_send_message', args))
  await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })
}

function groupMessage(text: string, id: number, userId = 555): Record<string, unknown> {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: 123,
    user_id: userId,
    sender: { card: userId === 555 ? '阿澈' : `群友${userId}` },
    message: [{ type: 'text', data: { text } }],
    message_id: id,
    time: Math.floor(Date.now() / 1000),
  }
}

function groupMentionMessage(text: string, id: number, userId = 555): Record<string, unknown> {
  return {
    ...groupMessage(text, id, userId),
    message: [
      { type: 'at', data: { qq: '999' } },
      { type: 'text', data: { text: ` ${text}` } },
    ],
  }
}

function privateMessage(text: string, id: number): Record<string, unknown> {
  return {
    post_type: 'message',
    message_type: 'private',
    user_id: 555,
    sender: { nickname: '阿澈' },
    message: [{ type: 'text', data: { text } }],
    message_id: id,
    time: Math.floor(Date.now() / 1000),
  }
}

function sentMessages(seat: Mounted): string[] {
  return seat.socket.sent.flatMap((payload) => {
    const frame = JSON.parse(payload) as { params?: { message?: unknown } }
    const message = frame.params?.message
    if (typeof message === 'string') return [message]
    if (!Array.isArray(message)) return []
    return message.flatMap(segment => segment !== null && typeof segment === 'object'
      && (segment as { type?: unknown }).type === 'text'
      && typeof (segment as { data?: { text?: unknown } }).data?.text === 'string'
      ? [(segment as { data: { text: string } }).data.text]
      : [])
  })
}

// 只取那一条，没留下就直接判失败
function only(seat: Mounted): DecisionRecord {
  const [record] = seat.records()
  if (record === undefined) throw new Error('一条记录都没留下')
  return record
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('自己说过的话', () => {
  it('引用、连发和表情包都留下可记忆的文字', () => {
    expect(saidTextOf(JSON.stringify({ text: '我看见了' }), 'qq_reply')).toBe('我看见了')
    expect(saidTextOf(JSON.stringify({ lines: '在吗\n刚回来' }), 'qq_send_burst')).toBe('在吗；刚回来')
    expect(saidTextOf(JSON.stringify({ steps: [
      { kind: 'send', text: '打错了' },
      { kind: 'replace', text: '算了，是我看错' },
    ] }), 'qq_send_messy')).toBe('打错了；算了，是我看错')
    expect(saidTextOf('{}', 'qq_send_sticker')).toBe('我发了一张表情包')
  })

  it('括号旁白不会跟着正文进记忆', () => {
    expect(saidTextOf(JSON.stringify({ text: '（停了一下）\n我还在' }), 'qq_send_message')).toBe('我还在')
    expect(saidTextOf(JSON.stringify({ text: '（不理。）' }), 'qq_send_message')).toBe('')
  })
})

describe('一轮一条记录', () => {
  it('好友私聊会开自己的会话并唤醒', async () => {
    const followup = vi.fn()
    const created: string[] = []
    let selected: { provider?: string; model?: string } | undefined
    const seat = await mount({}, (sessionId, options) => {
      created.push(sessionId)
      selected = options.agentOptions
      return { followup, dispose: async () => {} }
    })
    expect(seat.ctx.get('agents')).toBeDefined()
    seat.socket.deliver(privateMessage('私聊在吗', 2))

    await vi.waitFor(() => { expect(created).toEqual(['private:555']) })
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    expect(followup.mock.calls[0]?.[0]).toBeDefined()
    expect(selected).toEqual({ provider: 'test-provider', model: 'test-model' })
  })

  it('连续两条私聊各有一个回复回合，后一条不会被静默闸误拦', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 5, 3, 0, 0, 0))
    try {
      const followup = vi.fn()
      const seat = await mount(
        { quietStart: '23:30', quietEnd: '07:30' },
        () => ({ followup, dispose: async () => {} }),
      )
      const agent = { id: 'private:555' } as Agent
      seat.socket.deliver(privateMessage('第一条', 4))
      seat.socket.deliver(privateMessage('第二条', 5))
      await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })

      for (let turn = 1; turn <= 2; turn += 1) {
        await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
        const sent = await seat.tool('qq_send_message').execute({ text: `回复${turn}` }, execOf('private:555')) as { parts: number }
        expect(sent.parts).toBe(1)
        await seat.ctx.serial('agent/turn-stopping', { agent, turn, signal: new AbortController().signal })
      }

      expect(seat.records().filter(record => record.chatKey === 'private:555')).toHaveLength(2)
      expect(seat.records().filter(record => record.chatKey === 'private:555').every(record => record.sent === 1)).toBe(true)
      expect(seat.records().filter(record => record.chatKey === 'private:555').every(record => record.mode === 'autonomous')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('近期反复叫短外号会记到对应的人身上', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))

    seat.socket.deliver(privateMessage('臭小岸', 120))
    seat.socket.deliver(privateMessage('臭小岸', 121))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })

    const tags = qqSubjectOf(seat.ctx)?.relations.nameTags('555', 'private:555', Date.now()) ?? []
    expect(tags[0]).toMatchObject({ label: '臭小岸', stance: 'tease' })
  })

  it('重启后已有 Session 时恢复原会话并带上模型', async () => {
    const followup = vi.fn()
    let selected: { provider?: string; model?: string } | undefined
    const seat = await mount(
      {},
      () => { throw Object.assign(new Error('exists'), { name: 'SessionAlreadyExistsError' }) },
      (_sessionId, options) => {
        selected = options.agentOptions
        return { followup, dispose: async () => {} }
      },
    )
    seat.socket.deliver(privateMessage('恢复后在吗', 3))

    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    expect(selected).toEqual({ provider: 'test-provider', model: 'test-model' })
  })

  it('私聊模型只写正文没调发送工具时，直接发出这段正文、不再多跑一轮', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 5, 3, 0, 0, 0))
    try {
      const followup = vi.fn()
      const seat = await mount(
        { quietStart: '23:30', quietEnd: '07:30' },
        () => ({ followup, dispose: async () => {} }),
      )
      const agent = { id: 'private:555' } as Agent
      seat.socket.deliver(privateMessage('你回我一句', 6))
      await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
      await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
      seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('已经回复你了'))
      await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

      expect(seat.records().at(-1)).toMatchObject({
        reason: 'incoming',
        awake: true,
        attempted: true,
        sent: 1,
        blocked: null,
      })
      expect(sentMessages(seat)).toContain('已经回复你了')
      expect(followup).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('私聊只收到 turn/end 时也会把模型正文发出去', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('你在吗', 20))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('在，刚看到。'))

    seat.ctx.emit('session/event', { id: 'private:555' } as Session, completedTurn())

    await vi.waitFor(() => { expect(sentMessages(seat)).toEqual(expect.arrayContaining(['在，刚看到。'])) })
    expect(seat.records().at(-1)).toMatchObject({
      reason: 'incoming',
      attempted: true,
      sent: 1,
      blocked: null,
    })
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('私聊兜底只发最终正文，不把思考过程带进 QQ', async () => {
    const followup = vi.fn()
    const seat = await mount(
      {},
      () => ({ followup, dispose: async () => {} }),
    )
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('你回我一句', 7))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessageWithReasoning(
      '先想一下该怎么回，不要直接发这段。',
      '在，刚看到你消息。',
    ))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    expect(sentMessages(seat)).toEqual(expect.arrayContaining(['在，刚看到你消息。']))
    expect(seat.socket.sent.some(payload => payload.includes('先想一下该怎么回'))).toBe(false)
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('私聊只写括号旁白时先拦下，再只重试一次并让第二次正文发出', async () => {
    const followup = vi.fn()
    const seat = await mount(
      {},
      () => ({ followup, dispose: async () => {} }),
    )
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('你回我一句', 16))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('（不理。）'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    expect(seat.records().at(-1)).toMatchObject({
      attempted: false,
      sent: 0,
      blocked: { code: 'bundle.reply_inner_only' },
    })
    expect(seat.socket.sent.some(payload => payload.includes('不理'))).toBe(false)

    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('在，刚醒。'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 2, signal: new AbortController().signal })

    const last = seat.records().at(-1)
    expect(last).toMatchObject({ reason: 'private-retry', attempted: true, sent: 1, blocked: null })
    expect(sentMessages(seat)).toEqual(expect.arrayContaining(['在，刚醒。']))
  })

  it('普通文本没经过发送工具时也照原样发出', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('凑肥鱼', 118))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('嗯，我刚才没看手机'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    expect(seat.records().at(-1)).toMatchObject({ reason: 'incoming', attempted: true, sent: 1, blocked: null })
    expect(sentMessages(seat)).toEqual(expect.arrayContaining(['嗯，我刚才没看手机']))
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('私聊先发一句接手回复，工具结束后的最终正文仍会发出', async () => {
    const followup = vi.fn()
    const seat = await mount(
      { privateWorkingAck: '我看看' },
      () => ({ followup, dispose: async () => {} }),
    )
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('帮我查一下 B站', 18))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)

    seat.ctx.emit('session/event', { id: 'private:555' } as Session, toolCall('web_search', { query: 'B站' }))

    await vi.waitFor(() => {
      expect(seat.socket.sent.some(payload => payload.includes('我看看'))).toBe(true)
    })

    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('查到了，刚看完。'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    expect(sentMessages(seat)).toEqual(expect.arrayContaining(['我看看', '查到了', '刚看完。']))
    expect(seat.records().at(-1)).toMatchObject({ reason: 'incoming', attempted: true, sent: 3, blocked: null })
  })

  it('默认不自动发送固定接手语', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('帮我查一下 B站', 20))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)

    seat.ctx.emit('session/event', { id: 'private:555' } as Session, toolCall('web_search', { query: 'B站' }))

    expect(sentMessages(seat)).toEqual([])
  })

  it('私聊重试后仍只有旁白时，发出一次配置好的真实短句', async () => {
    const followup = vi.fn()
    const seat = await mount(
      { privateFallbackText: '我在，刚才走神了。' },
      () => ({ followup, dispose: async () => {} }),
    )
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('你回我一句', 17))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('（还是不理。）'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('（忍住。）'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 2, signal: new AbortController().signal })

    expect(seat.records().at(-1)).toMatchObject({
      reason: 'private-retry',
      attempted: true,
      sent: 2,
      blocked: null,
    })
    expect(sentMessages(seat)).toEqual(expect.arrayContaining(['我在', '刚才走神了。']))
  })

  it('默认没有固定起床兜底', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('你回我一句', 21))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('（还是不理。）'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('（忍住。）'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 2, signal: new AbortController().signal })

    expect(sentMessages(seat)).toEqual([])
  })

  it('被一条消息叫起来，说完一句就留下一条', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('在吗', 1))

    await oneRound(seat, '在的')

    const record = only(seat)
    expect(seat.records()).toHaveLength(1)
    expect(record.at).toBeGreaterThan(0)
    expect(record.chatKey).toBe(CHAT)
    expect(record.awake).toBe(true)
    expect(record.reason).toBe('incoming')
    expect(record.attempted).toBe(true)
    expect(record.sent).toBe(1)
    expect(record.blocked).toBeNull()
    expect(record.outcome).toBe('completed')
  })

  it('群里点名时不能用安静收掉这一轮，会回到同一会话补正文', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    const agent = { id: CHAT } as Agent
    seat.socket.deliver(groupMentionMessage('小岸，回我一句', 22))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, toolCall('qq_stay_quiet', { mind: { reason: '不想接' } }))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, assistantMessage('我在，刚看到'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 2, signal: new AbortController().signal })

    expect(sentMessages(seat)).toEqual(expect.arrayContaining(['我在', '刚看到']))
  })

  it('群聊只写普通文本漏掉发送工具时也照原样发出', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    const agent = { id: CHAT } as Agent
    seat.socket.deliver(groupMessage('在吗', 18))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })

    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, assistantMessage('在的，刚看到'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    expect(seat.records().at(-1)).toMatchObject({
      reason: 'incoming',
      attempted: true,
      sent: 2,
      blocked: null,
    })
    expect(sentMessages(seat)).toEqual(expect.arrayContaining(['在的', '刚看到']))
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('发送被拦下后，同一轮不再换发送工具连续重试', async () => {
    const seat = await mount({ allowGroups: ['999'] })
    const agent = { id: CHAT } as Agent
    seat.socket.deliver(groupMessage('在吗', 19))
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)

    await expect(seat.tool('qq_send_message').execute({ text: '在的' }, execOf(CHAT)))
      .rejects.toThrow('outbound.not_allowed')
    const blocked = seat.guards
      .map(guard => guard(Object.assign({} as ToolRunContext, { name: 'qq_send_message', agent })))
      .find(reason => reason?.includes('QQ_SEND_ALREADY_BLOCKED'))

    expect(blocked).toContain('QQ_SEND_ALREADY_BLOCKED')
    expect(blocked).toContain('outbound.not_allowed')
  })

  it('同轮留下的复盘会进入收尾仓', async () => {
    const seat = await mount()

    await oneRound(seat, '我在听', {
      reason: '对方在等我',
      focus: '他刚才没被接住',
      tone: '放软一点',
      impulse: '想立刻解释',
      counter: '别显得像找补',
      choice: '先接住话，不解释太多',
      inner: '其实有点着急',
      next: '等他说完',
      reflect: '刚才差点又急着解释',
    })

    expect(seat.continuity.history(CHAT, 5).at(-1)?.text).toBe('刚才差点又急着解释')
  })

  it('等待、打断和收回会留下可观察事实，不额外发消息', async () => {
    const seat = await mount()

    await oneRound(seat, '我在听', {
      reason: '对方话还没说完',
      focus: '先看清最后一句',
      tone: '安静一点',
      impulse: '想立刻接',
      counter: '现在接会打断他',
      choice: '先等，不抢话',
      inner: '先记着这个由头',
      next: '等他说完再接',
      waitMs: 3000,
      interrupt: '他还有没说完的事',
      cancel: '不追问刚才的话题',
      settle: '先让自己缓一下',
    })

    expect(seat.continuity.history(CHAT, 5).at(-1)?.text).toContain('先等一小会儿')
    expect(seat.continuity.history(CHAT, 5).at(-1)?.text).toContain('收回打算')
    expect(seat.socket.sent.filter(payload => payload.includes('"message":"我在听"'))).toHaveLength(1)
  })

  it('模型请求失败也留下这一轮和原因码', async () => {
    const seat = await mount()
    const agent = { id: CHAT } as Agent
    seat.socket.deliver(groupMessage('在吗', 8))

    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, requestHeader('actual-provider', 'actual-model'))
    seat.ctx.emit('session/event', { id: CHAT } as Session, failedTurn('LLM_TIMEOUT'))

    const record = only(seat)
    expect(record).toMatchObject({
      awake: true,
      reason: 'incoming',
      attempted: false,
      sent: 0,
      outcome: 'error',
      failureCode: 'LLM_TIMEOUT',
      provider: 'actual-provider',
      model: 'actual-model',
    })
  })

  it('好友私聊的模型请求失败时发出故障说明并记录原始原因', async () => {
    const seat = await mount({ privateErrorFallbackText: '我这边卡了一下，你再发我一次。' })
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('你回我一句', 18))

    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, requestHeader('actual-provider', 'actual-model'))
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, failedTurn('RATE_LIMIT'))

    await vi.waitFor(() => { expect(seat.records().at(-1)?.sent).toBe(2) }, { timeout: 3_000 })
    expect(seat.records().at(-1)).toMatchObject({
      reason: 'incoming',
      attempted: true,
      sent: 2,
      outcome: 'error',
      failureCode: 'RATE_LIMIT',
    })
    expect(sentMessages(seat)).toEqual(expect.arrayContaining(['我这边卡了一下', '你再发我一次。']))
  })

  it('私聊发过接手回复后模型失败，仍补发故障说明', async () => {
    const seat = await mount({
      privateWorkingAck: '我看看',
      privateErrorFallbackText: '我这边卡了一下，你再发我一次。',
    })
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('帮我查一下 B站', 19))

    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, toolCall('web_search', { query: 'B站' }))
    await vi.waitFor(() => {
      expect(seat.socket.sent.some(payload => payload.includes('我看看'))).toBe(true)
    })
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, failedTurn('LLM_TIMEOUT'))

    await vi.waitFor(() => { expect(seat.records().at(-1)?.sent).toBe(3) }, { timeout: 3_000 })
    expect(seat.records().at(-1)).toMatchObject({
      reason: 'incoming',
      attempted: true,
      sent: 3,
      outcome: 'error',
      failureCode: 'LLM_TIMEOUT',
    })
    expect(sentMessages(seat)).toEqual(expect.arrayContaining([
      '我看看',
      '我这边卡了一下',
      '你再发我一次。',
    ]))
  })

  it('私聊入站时提示词明确告诉模型现在要正常回复', async () => {
    const seat = await mount()
    const agent = { id: 'private:555' } as Agent

    const assembly = await seat.ctx.systemPrompt.assemble({ agent })
    const section = assembly.sections.find(item => item.name === 'qq:private-reply-now')

    expect(section?.text).toContain('[SYSTEM_LOAD] QQ_PRIVATE_REPLY')
    expect(section?.text).toContain('MODE: private')
    expect(section?.text).toContain('FIRST_VISIBLE_ACTION: call_qq_send_message')
    expect(section?.text).toContain('send_real_text_via_QQ_SEND')
    expect(section?.text).toContain('IF_PLAIN_TEXT_ONLY')
  })

  it('没被叫起来的一轮也留一条，awake 是假的', async () => {
    const seat = await mount()

    await oneRound(seat, '在的')

    const record = only(seat)
    expect(record.awake).toBe(false)
    expect(record.reason).toBeNull()
    expect(record.attempted).toBe(true)
    expect(record.sent).toBe(1)
  })

  it('只有入站消息唤醒的 QQ Agent 回复能越过静默时段', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 5, 3, 0, 0, 0))
    try {
      const seat = await mount({ quietStart: '23:30', quietEnd: '07:30' })
      seat.socket.deliver(groupMessage('晚上好', 1))

      await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
      const reply = await seat.tool('qq_send_message').execute({ text: '在呢' }, execOf(CHAT)) as { parts: number }
      await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })
      expect(seat.records().at(-1)).toMatchObject({ awake: true, attempted: true, sent: 1, blocked: null })

      const proactive = await qqChannelOf(seat.ctx)?.send('主动消息', CHAT)

      expect(reply.parts).toBe(1)
      expect(proactive).toMatchObject({ ok: false, code: 'outbound.quiet' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('没有入站唤醒的一轮仍受静默时段限制', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 5, 3, 0, 0, 0))
    try {
      const seat = await mount({ quietStart: '23:30', quietEnd: '07:30' })
      await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)

      await expect(seat.tool('qq_send_message').execute({ text: '主动消息' }, execOf(CHAT)))
        .rejects.toThrow(/outbound\.quiet/u)
    } finally {
      vi.useRealTimers()
    }
  })

  it('戳一戳也算唤醒了，理由是 poke', async () => {
    const seat = await mount()
    seat.socket.deliver({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', target_id: 999, user_id: 555, group_id: 123 })

    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })

    const record = only(seat)
    expect(record.awake).toBe(true)
    expect(record.reason).toBe('poke')
  })

  it('戳一戳唤醒后模型写了正文没调工具，也要真的发出一条', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', target_id: 999, user_id: 555 })
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })

    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('别戳了，痒'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    expect(seat.socket.sent.some(payload => payload.includes('别戳了，痒'))).toBe(true)
    expect(seat.records().at(-1)).toMatchObject({ reason: 'poke', attempted: true, sent: 1, blocked: null })
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('同一轮收尾走两次也只兜底发出一条', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    const agent = { id: 'private:555' } as Agent
    seat.socket.deliver(privateMessage('你回我一句', 21))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })

    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, assistantMessage('在，别刷了'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    expect(seat.socket.sent.filter(payload => payload.includes('在，别刷了'))).toHaveLength(1)
  })

  it('群聊只写空应声时先重排一次，再要不到就照原样发出', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    const agent = { id: CHAT } as Agent
    seat.socket.deliver(groupMessage('在吗', 22))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })

    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, assistantMessage('嗯'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })

    expect(seat.records().at(-1)).toMatchObject({ attempted: false, sent: 0, blocked: { code: 'bundle.reply_bare' } })
    expect(seat.socket.sent.some(payload => payload.includes('"message":"嗯"'))).toBe(false)

    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, assistantMessage('嗯'))
    await seat.ctx.serial('agent/turn-stopping', { agent, turn: 2, signal: new AbortController().signal })

    expect(seat.records().at(-1)).toMatchObject({ reason: 'group-retry', attempted: true, sent: 1, blocked: null })
    expect(seat.socket.sent.some(payload => payload.includes('"message":"嗯"'))).toBe(true)
  })
})

describe('全局急停', () => {
  it('停下后新消息不再叫醒会话，解除后状态恢复', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    const seam = qqBundleOf(seat.ctx)
    if (seam === undefined) throw new Error('组合包没装上')

    expect(seam.emergencyStop('人工急停')).toMatchObject({ active: true, reason: '人工急停' })
    seat.socket.deliver(groupMessage('急停期间', 91))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(followup).not.toHaveBeenCalled()
    expect(seam.emergencyStopState()).toMatchObject({ active: true, reason: '人工急停' })

    seam.resume()
    expect(seam.emergencyStopState().active).toBe(false)
  })
})

describe('后续话', () => {
  it('一轮真发出去后把双方这次实际来往记成下次可接的话头', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    seat.socket.deliver(groupMessage('周末还去江边吗', 92))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })

    await oneRound(seat, '去，等你一起')

    const continuity = qqContinuityOf(seat.ctx)
    expect(continuity?.store.lastClose(CHAT)?.summary).toContain('周末还去江边吗')
    expect(continuity?.store.lastClose(CHAT)?.summary).toContain('我：去，等你一起')
  })

  it('同一次发送里的想法进入下一轮，但不会混进正文', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    seat.socket.deliver(groupMessage('你是不是不想理我', 97))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })

    await oneRound(seat, '没有，我刚在。', {
      reason: '对方觉得被冷落了',
      focus: '先接住那句不想理',
      tone: '有点别扭，但不故意端着',
      inner: '其实想解释，又怕越说越像找补',
      next: '下次先正面回答，再解释刚才在做什么',
    })

    const note = qqContinuityOf(seat.ctx)?.store.lastClose(CHAT)
    expect(note).toMatchObject({
      summary: '对方：阿澈：[#97]你是不是不想理我；我：没有，我刚在。',
      nextOpening: '下次先正面回答，再解释刚才在做什么',
      thought: '其实想解释，又怕越说越像找补',
    })
    expect(seat.socket.sent.some(payload => payload.includes('其实想解释'))).toBe(false)
  })

  it('两边声音都有时，连续性优先留下最后选择', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    seat.socket.deliver(groupMessage('你刚刚是不是不想理我', 99))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })

    await oneRound(seat, '没有，我只是在听。', {
      reason: '对方在问关系里的不安',
      focus: '先回那句是不是不想理',
      tone: '认真，不敷衍',
      impulse: '想反问你怎么又这么想',
      counter: '先解释会让她更安心',
      choice: '先接住不安，再说明刚才在做什么',
      inner: '其实有点委屈，但不想把火撒回去',
      next: '下次先说我在听',
    })

    expect(qqContinuityOf(seat.ctx)?.store.lastClose(CHAT)).toMatchObject({
      thought: '先接住不安，再说明刚才在做什么',
    })
    expect(seat.socket.sent.some(payload => payload.includes('想反问'))).toBe(false)
  })

  it('群里明确先不说时也留下判断，不算偷偷没反应', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('他们正在聊别的事', 98))

    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    const args = {
      mind: {
        reason: '他们在聊自己的事',
        focus: '没有需要我接的话',
        tone: '安静听着',
        inner: '这会儿插进去反而打断他们',
        next: '等有人问起再看',
      },
    }
    await seat.tool('qq_stay_quiet').execute(args, execOf(CHAT))
    seat.ctx.emit('session/event', { id: CHAT } as Session, toolCall('qq_stay_quiet', args))
    await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })

    expect(seat.records().at(-1)).toMatchObject({ held: true, attempted: false, sent: 0 })
    expect(qqContinuityOf(seat.ctx)?.store.lastClose(CHAT)).toMatchObject({
      nextOpening: '等有人问起再看',
      thought: '这会儿插进去反而打断他们',
    })
  })

  it('引用回复成功后也进入这一轮的记忆队列', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    seat.socket.deliver(groupMessage('回我一句', 93))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })

    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    await seat.tool('qq_reply').execute({ message_id: '93', text: '我看见了' }, execOf(CHAT))
    seat.ctx.emit('session/event', { id: CHAT } as Session, toolCall('qq_reply', {
      message_id: '93',
      text: '我看见了',
    }))
    await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })

    expect(seat.memory.pending()).toBeGreaterThan(0)
  })

  it('模型明确收尾后仍会记下收尾，完整自主模式的普通群消息也能重新打开', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))
    seat.socket.deliver(groupMessage('先聊到这里', 94))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })

    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    await seat.tool('close_conversation').execute({
      summary: '这段先收住',
      nextOpening: '下次接着问近况',
    }, execOf(CHAT))
    seat.ctx.emit('session/event', { id: CHAT } as Session, toolCall('close_conversation', {
      summary: '这段先收住',
      nextOpening: '下次接着问近况',
    }))
    await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })

    const continuity = qqContinuityOf(seat.ctx)
    expect(continuity?.store.lastClose(CHAT)).toMatchObject({
      summary: '这段先收住',
      nextOpening: '下次接着问近况',
      origin: 'explicit',
    })

    seat.socket.deliver(groupMessage('普通群消息', 95))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })

    seat.socket.deliver({
      ...groupMessage('叫我了', 96),
      message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: '叫我了' } }],
    })
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(3) })
  })
})

describe('被关卡拦下', () => {
  it('敏感词拦下时留下码与下次时间', async () => {
    const seat = await mount({ banned: ['加群'] })
    seat.socket.deliver(groupMessage('在吗', 1))

    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    await expect(seat.tool('qq_send_message').execute({ text: '你也来加群' }, execOf(CHAT))).rejects.toThrow(/outbound\.banned/u)
    await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })

    const record = only(seat)
    expect(record.attempted).toBe(true)
    expect(record.sent).toBe(0)
    expect(record.blocked?.code).toBe('outbound.banned')
    expect(record.blocked?.retryAt).toBeGreaterThan(0)
  })

  it('步数用满时留下一个码，没有下次时间', async () => {
    const seat = await mount()

    const late = await seat.ctx.waterfall('agent/pre-step', stepOf(6), next)

    expect(late.kind).toBe('reject')
    const record = only(seat)
    expect(record.blocked?.code).toBe('bundle.step_cap')
    expect(record.blocked?.retryAt).toBeNull()
  })

  it('同一工具同样错误重复三次后，下一步模型请求前停下', async () => {
    const seat = await mount()
    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    for (let index = 1; index <= 3; index += 1) {
      seat.ctx.emit('session/event', { id: CHAT } as Session, toolCall('qq_read_history', { count: 1 }, `c${index}`))
      seat.ctx.emit('session/event', { id: CHAT } as Session, failedToolResult(`c${index}`, '读取失败 500', index + 1))
    }

    const stopped = await seat.ctx.waterfall('agent/pre-step', stepOf(2), next)

    expect(stopped.kind).toBe('reject')
    expect(only(seat).blocked?.code).toBe('bundle.repeated_tool_error')
  })
})

describe('记录只落文件，不带原文', () => {
  it('文件里没有用户原文，也没有模型要说的话', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('我们约一个只有我们知道的暗号', 1))

    await oneRound(seat, '这句话也不该出现在记录里')

    const text = fs.readFileSync(seat.file, 'utf8')
    expect(text).not.toContain('暗号')
    expect(text).not.toContain('这句话也不该出现')
    expect(text.trim().split('\n')).toHaveLength(1)
  })

  it('第二轮是追加，第一行原样留着', async () => {
    const seat = await mount()
    await oneRound(seat, '第一轮')
    const first = fs.readFileSync(seat.file, 'utf8')
    await oneRound(seat, '第二轮')
    const both = fs.readFileSync(seat.file, 'utf8')

    expect(both.startsWith(first)).toBe(true)
    expect(both.trim().split('\n')).toHaveLength(2)
  })

  it('记录不进提示词', async () => {
    const seat = await mount()
    await oneRound(seat, '在的')

    const assembly = await seat.ctx.systemPrompt.assemble()
    const text = assembly.sections.map(section => section.text).join('\n')

    expect(text).not.toContain('qq-decisions')
    expect(text).not.toContain('attempted')
  })
})

describe('排查用的入口', () => {
  it('按时刻筛，按条数截尾', async () => {
    const seat = await mount()
    await oneRound(seat, '第一轮')
    const first = only(seat)
    await oneRound(seat, '第二轮')

    const newest = qqBundleOf(seat.ctx)?.decisions(0, 1) ?? []
    const afterFirst = qqBundleOf(seat.ctx)?.decisions(first.at + 1, 100) ?? []

    expect(newest).toHaveLength(1)
    expect(newest[0]?.at).toBeGreaterThanOrEqual(first.at)
    expect(afterFirst.length).toBeLessThanOrEqual(1)
    expect(seat.records()).toHaveLength(2)
  })
})

describe('快到上限时提醒收尾', () => {
  it('提醒那一句把两条路都写明白', async () => {
    const seat = await mount()

    const decision = await seat.ctx.waterfall('agent/pre-step', stepOf(3), next)

    expect(decision.kind).toBe('enter')
    const said = JSON.stringify(decision)
    expect(said).toContain('QQ_WRAP_UP')
    expect(said).toContain('QQ_SEND')
  })

  it('平常那几步不打扰', async () => {
    const seat = await mount()

    const decision = await seat.ctx.waterfall('agent/pre-step', stepOf(2), next)

    expect(JSON.stringify(decision)).not.toContain('QQ_WRAP_UP')
  })

  it('记录里留下走到第几步、提醒过没有', async () => {
    const seat = await mount()

    await seat.ctx.waterfall('agent/pre-step', stepOf(3), next)
    await seat.ctx.waterfall('agent/pre-step', stepOf(6), next)

    const record = only(seat)
    expect(record.steps).toBe(6)
    expect(record.wrapped).toBe(true)
    expect(record.blocked?.code).toBe('bundle.step_cap')
  })

  it('记下这一轮最后调的是哪个工具', async () => {
    const seat = await mount()

    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    const call = toolCall('read_messages', {})
    seat.ctx.emit('session/event', { id: CHAT } as Session, call)
    await seat.ctx.waterfall('agent/pre-step', stepOf(6), next)

    expect(only(seat).lastTool).toBe('read_messages')
  })
})

describe('两种行分得开', () => {
  it('跑完的一轮记成 round', async () => {
    const seat = await mount()

    await oneRound(seat, '在的呀，怎么了')

    expect(only(seat).kind).toBe('round')
  })

  it('主动开口的一次考虑记成 considered，它那栏 awake 不代表没被叫醒', () => {
    const log = createDecisionLog({ file: path.join(tempDir(), 'd.jsonl') })

    appendConsidered(log, { warn: () => {} }, CHAT, 1, { ok: false, code: 'proactive.quiet' })

    const [row] = log.read(0, 10)
    expect(row?.kind).toBe('considered')
    expect(row?.awake).toBe(false)
    expect(row?.blocked?.code).toBe('proactive.quiet')
  })
})

describe('说出去的话攒进记忆队列', () => {
  it('一轮真说了话，队列里就有一条', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('在吗', 1))

    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, toolCall('qq_send_message', { text: '在的呀，怎么了' }))
    await seat.tool('qq_send_message').execute({ text: '在的呀，怎么了' }, execOf(CHAT))
    await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })

    expect(seat.memory.pending()).toBe(1)
  })

  it('排空之后记忆里能找回来', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('在吗', 2))

    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, toolCall('qq_send_message', { text: '我在听你说呢' }))
    await seat.tool('qq_send_message').execute({ text: '我在听你说呢' }, execOf(CHAT))
    await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })
    seat.memory.flushQueue(Date.now())

    const hits = seat.memory.find('我在听你说', CHAT, 5)
    expect(hits.length).toBeGreaterThan(0)
  })
})

describe('统一诊断时间线', () => {
  it('一条入站能串起接收、排队和模型请求', async () => {
    const followup = vi.fn()
    const seat = await mount({}, () => ({ followup, dispose: async () => {} }))

    seat.socket.deliver(groupMessage('在吗', 42))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, requestHeader('test-provider', 'test-model'))

    const kinds = qqBundleOf(seat.ctx)?.timeline('group:123#msg-42', 30).map(row => row.kind) ?? []
    expect(kinds).toEqual(expect.arrayContaining([
      'inbound_received',
      'followup_request',
      'queue_started',
      'followup_queued',
      'model_step',
      'model_request',
    ]))
  })

  it('同一个追踪编号能串起多个阶段，正文不落盘', () => {
    const file = path.join(tempDir(), 'timeline.jsonl')
    const timeline = createTimeline({ file, warn: { warn: () => {} } })

    timeline.startTrace('group:1#msg-9', 'group:1')
    timeline.record('inbound_received', 'group:1', { messageId: '9' })
    timeline.record('mode_skipped', 'group:1', { reason: 'probability_skip' })
    timeline.record('turn_finished', 'group:1', { attempted: false, sent: 0 })

    expect(timeline.read('group:1#msg-9', 10).map(row => row.kind)).toEqual([
      'inbound_received',
      'mode_skipped',
      'turn_finished',
    ])
    expect(fs.readFileSync(file, 'utf8')).not.toContain('聊天正文')
  })

  it('坏行跳过，空编号读最近几步', () => {
    const file = path.join(tempDir(), 'timeline.jsonl')
    fs.writeFileSync(file, '{bad json}\n')
    const timeline = createTimeline({ file, warn: { warn: () => {} } })

    timeline.record('first', 'group:1', { traceId: 'trace-1' })
    timeline.record('second', 'group:1', { traceId: 'trace-2' })

    expect(timeline.read('', 1)).toMatchObject([{ kind: 'second', traceId: 'trace-2' }])
  })

  it('模型流记录请求耗时和实际 token 用量，不记录正文', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('在吗', 43))
    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, requestHeader('test-provider', 'test-model'))
    const attemptId = LlmAttemptId('qq-test-attempt')
    seat.ctx.emit('agent/assistant-stream', {
      agent: AGENT,
      frame: { type: 'start', attemptId, revision: 1, turn: 1, step: 1 },
    })
    seat.ctx.emit('agent/assistant-stream', {
      agent: AGENT,
      frame: {
        type: 'chunk', attemptId, revision: 2, index: 0, time: Date.now(),
        chunk: { type: 'usage', usage: { inputTokens: 321, outputTokens: 12, cacheReadTokens: 80 } },
      },
    })
    seat.ctx.emit('agent/assistant-stream', {
      agent: AGENT,
      frame: {
        type: 'end', attemptId, revision: 3, index: 1,
        outcome: { kind: 'committed', eventType: 'assistant/message', seq: SessionSeq(5) },
      },
    })

    const records = qqBundleOf(seat.ctx)?.timeline('group:123#msg-43', 30) ?? []
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'model_call_started', provider: 'test-provider', model: 'test-model' }),
      expect.objectContaining({
        kind: 'model_call_finished',
        provider: 'test-provider',
        model: 'test-model',
        inputTokens: 321,
        outputTokens: 12,
        cacheReadTokens: 80,
        outcome: 'committed',
      }),
    ]))
    expect(JSON.stringify(records)).not.toContain('在吗')
  })

  it('首条成功发送记录模型到回复的耗时且不保存回复正文', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('在吗', 46))
    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    const requestedAt = Date.now() - 100
    seat.ctx.emit('session/event', { id: CHAT } as Session, {
      ...requestHeader('test-provider', 'test-model'),
      time: requestedAt,
    })

    await qqChannelOf(seat.ctx)?.send('这是回复正文\n这是第二段', CHAT)
    await qqChannelOf(seat.ctx)?.send('这是第三段', CHAT)

    const records = qqBundleOf(seat.ctx)?.timeline('group:123#msg-46', 30) ?? []
    const sends = records.filter(row => row.kind === 'outbound_sent')
    const firstSend = sends[0]
    expect(typeof firstSend?.firstSendAt).toBe('number')
    expect(typeof firstSend?.modelToFirstSendMs).toBe('number')
    if (typeof firstSend?.modelToFirstSendMs === 'number') expect(firstSend.modelToFirstSendMs).toBeGreaterThanOrEqual(100)
    expect(sends.slice(1).every(row => row.firstSendAt === undefined && row.modelToFirstSendMs === undefined)).toBe(true)
    expect(JSON.stringify(records)).not.toContain('这是回复正文')
    expect(JSON.stringify(records)).not.toContain('这是第二段')
    expect(JSON.stringify(records)).not.toContain('这是第三段')
  })

  it('没有模型请求时只记录发送时刻，不伪造模型延迟', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('在吗', 47))
    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)

    await qqChannelOf(seat.ctx)?.send('直接回一句', CHAT)

    const sent = (qqBundleOf(seat.ctx)?.timeline('group:123#msg-47', 30) ?? [])
      .find(row => row.kind === 'outbound_sent')
    expect(typeof sent?.firstSendAt).toBe('number')
    expect(sent).not.toHaveProperty('modelToFirstSendMs')
  })

  it('成功工具调用也记录执行耗时，不记录参数或结果', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('在吗', 44))
    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, toolCall('qq_read_history', { privateValue: 'hidden' }, 'timed-tool'))
    seat.ctx.emit('session/event', { id: CHAT } as Session, {
      type: 'tool/result',
      seq: SessionSeq(5),
      time: Date.now() + 5,
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId: 'timed-tool' as never,
          content: [{ type: 'text', text: 'hidden result' }],
          isError: false,
        }),
      },
    } satisfies SessionEvent)

    const records = qqBundleOf(seat.ctx)?.timeline('group:123#msg-44', 30) ?? []
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool_finished', tool: 'qq_read_history', outcome: 'completed' }),
    ]))
    expect(JSON.stringify(records)).not.toContain('hidden')
  })

  it('失败工具记录使用结果消息里的工具调用编号', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('在吗', 45))
    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, toolCall('qq_read_history', { privateValue: 'hidden' }, 'failed-tool'))
    seat.ctx.emit('session/event', { id: CHAT } as Session, failedToolResult('failed-tool', '读取失败 500'))

    const records = qqBundleOf(seat.ctx)?.timeline('group:123#msg-45', 30) ?? []
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool_finished', tool: 'qq_read_history', callId: 'failed-tool', outcome: 'failed' }),
      expect.objectContaining({ kind: 'tool_result', tool: 'qq_read_history', callId: 'failed-tool', failed: true }),
    ]))
    expect(JSON.stringify(records)).not.toContain('hidden')
    expect(JSON.stringify(records)).not.toContain('读取失败')
  })

  it('超过条数上限就只留最近的几步', () => {
    const file = path.join(tempDir(), 'timeline.jsonl')
    const timeline = createTimeline({ file, warn: { warn: () => {} }, maxLines: 2 })

    timeline.record('first', 'group:1', { traceId: 'trace-1' })
    timeline.record('second', 'group:1', { traceId: 'trace-2' })
    timeline.record('third', 'group:1', { traceId: 'trace-3' })

    expect(timeline.read('', 10).map(row => row.kind)).toEqual(['second', 'third'])
  })
})

describe('新消息打断', () => {
  it('同会话新消息先停旧轮次，旧稿不再兜底发出', async () => {
    const followup = vi.fn()
    const cancel = vi.fn()
    const seat = await mount({}, () => ({ followup, cancel, dispose: async () => {} }))

    seat.socket.deliver(groupMessage('先听我说完', 70))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    seat.ctx.emit('session/event', { id: CHAT } as Session, assistantMessage('这是被打断前的旧稿'))

    seat.socket.deliver(groupMessage('别说了，换个话题', 71))
    await vi.waitFor(() => { expect(cancel).toHaveBeenCalledTimes(1) })
    await seat.ctx.serial('agent/turn-stopping', {
      agent: AGENT,
      turn: 1,
      signal: new AbortController().signal,
    })

    expect(seat.socket.sent).toHaveLength(0)
    expect(only(seat).blocked?.code).toBe('bundle.interrupted_by_message')
  })

  it('同群另一个人说话不打断正在回复的旧轮次', async () => {
    const followup = vi.fn()
    const cancel = vi.fn()
    const seat = await mount({}, () => ({ followup, cancel, dispose: async () => {} }))

    seat.socket.deliver(groupMessage('先听我说完', 72, 555))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)

    seat.socket.deliver(groupMessage('另一个人插一句', 73, 777))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(cancel).not.toHaveBeenCalled()

    await seat.ctx.serial('agent/turn-stopping', {
      agent: AGENT,
      turn: 1,
      signal: new AbortController().signal,
    })
    expect(only(seat).blocked?.code).not.toBe('bundle.interrupted_by_message')
  })

  it('私聊被新消息打断后，旧轮取消错误也不补发提示', async () => {
    const followup = vi.fn()
    const cancel = vi.fn()
    const agent = { id: 'private:555' } as Agent
    const seat = await mount(
      { privateErrorFallbackText: '我这边卡了一下，你再发我一次。' },
      () => ({ followup, cancel, dispose: async () => {} }),
    )

    seat.socket.deliver(privateMessage('先回答旧问题', 80))
    await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
    await seat.ctx.waterfall('agent/pre-step', stepOf(1, agent), next)

    seat.socket.deliver(privateMessage('等等，换个问题', 81))
    await vi.waitFor(() => { expect(cancel).toHaveBeenCalledTimes(1) })
    seat.ctx.emit('session/event', { id: 'private:555' } as Session, failedTurn('interrupted'))
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(seat.socket.sent).toHaveLength(0)
  })
})
