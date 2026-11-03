/**
 * The five attention tools. Each one reads facts or appends an event; none of
 * them decides whether the bot should speak.
 *
 * @module @huoli/huoli-qq-attention
 */

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import type { QqInbox } from './inbox.ts'
import { NOTE_MAX_CHARS, type AttentionEvent, type AttentionState, type WakeTriggers } from './types.ts'
import type { AttentionStore } from './store.ts'
import type { SignalMessage } from './select.ts'

/** Longest wait a single call may request. */
export const WAIT_MAX_MS = 300_000

/** Default number of messages returned by one look. */
export const DEFAULT_READ_LIMIT = 20

/** Quiet window used when the caller names none. */
export const DEFAULT_QUIET_MS = 5_000

/** Runtime pieces the tools need. */
export interface ToolDeps {
  /** Live message buffer. */
  readonly inbox: QqInbox
  /** Durable attention state. */
  readonly store: AttentionStore
  /** Recent messages of one chat, oldest first, for signal collection. */
  readonly recentOf: (chatKey: string) => readonly SignalMessage[]
  /** Bot names and learned aliases. */
  readonly selfNames: () => readonly string[]
}

/** Model-facing failure carrying a next step, surfaced as a tool error. */
function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

/** Chat key for the current call; one chat maps to one session. */
function chatKeyOf(exec: { agent?: { id: string } }): string {
  const id = exec.agent?.id
  if (id === undefined || id === '') refuse('attention.no_chat', '这次调用没有会话身份', '从带会话的入口调用工具')
  return String(id)
}

/** Register the five attention tools. */
export function registerAttentionTools(ctx: Context, deps: ToolDeps): void {
  const { inbox, store } = deps

  ctx.tools.register(defineTool({
    name: 'read_messages',
    description: '看这个会话的消息。返回消息与读水位；不传 afterSeq 就从上次读到的地方继续。水位是这次读到的最后一条，不是消息总数。',
    parameters: {
      afterSeq: { type: 'number', description: '从这条之后开始读；不传就用水位。' },
      limit: { type: 'number', description: `最多返回多少条，默认 ${DEFAULT_READ_LIMIT}。` },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const state = store.of(chatKey)
      const afterSeq = Number.isInteger(args.afterSeq) && args.afterSeq !== undefined ? args.afterSeq : state.readThroughSeq
      const limit = Number.isInteger(args.limit) && args.limit !== undefined ? Math.max(1, args.limit) : DEFAULT_READ_LIMIT
      const result = inbox.read(chatKey, afterSeq, limit)
      return {
        messages: result.messages.map(message => ({ seq: message.seq, senderId: message.senderId, text: message.text, at: message.at })),
        readThroughSeq: result.readThroughSeq,
        latestSeq: result.latestSeq,
        partial: result.partial,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wait_for_messages',
    description: '等这个会话继续说话。purpose=reply 用来等对方把话说完；purpose=messages 用来睡前观察。超时不是错误，取消也不是错误。',
    parameters: {
      purpose: { type: 'string', description: 'reply 等对方说完；messages 观察一段时间。' },
      timeoutMs: { type: 'number', description: `总等待时长，上限 ${WAIT_MAX_MS}。` },
      quietMs: { type: 'number', description: `安静多久算说完，默认 ${DEFAULT_QUIET_MS}。` },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const requested = Number.isInteger(args.timeoutMs) && args.timeoutMs !== undefined ? args.timeoutMs : WAIT_MAX_MS
      const timeoutMs = Math.min(Math.max(requested, 1), WAIT_MAX_MS)
      const quietMs = Number.isInteger(args.quietMs) && args.quietMs !== undefined ? Math.max(args.quietMs, 0) : DEFAULT_QUIET_MS
      const waited = await inbox.wait(chatKey, { timeoutMs, quietMs, signal: exec.signal })
      const latestSeq = inbox.latestSeq(chatKey)
      return {
        newMessages: waited.messages.map(message => ({ seq: message.seq, senderId: message.senderId, text: message.text })),
        latestSeq,
        readThroughSeq: store.of(chatKey).readThroughSeq,
        quietReached: waited.quietReached,
        timedOut: waited.timedOut,
        cancelled: waited.cancelled,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mark_read',
    description: '把消息划走，不回复。必须用 read_messages 给的水位；水位只能前进。这不是收尾，想留结束点用 close_conversation。',
    parameters: {
      throughSeq: { type: 'number', description: '读到哪一条为止；必须是 read_messages 返回的水位。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      if (!Number.isInteger(args.throughSeq) || args.throughSeq === undefined) {
        refuse('attention.seq_required', '没有给水位', '用 read_messages 返回的 readThroughSeq')
      }
      const throughSeq = args.throughSeq as number
      const state = store.of(chatKey)
      const latestSeq = inbox.latestSeq(chatKey)
      if (throughSeq < 0) refuse('attention.invalid_seq', '水位不能是负数', '用 read_messages 返回的水位')
      if (throughSeq < state.readThroughSeq) {
        refuse('attention.seq_backwards', `水位只能前进，当前 ${state.readThroughSeq}`, '传一个不小于当前水位的值')
      }
      if (latestSeq > 0 && throughSeq > latestSeq) {
        refuse('attention.seq_ahead', `水位超过了最新消息 ${latestSeq}`, '用 read_messages 返回的水位，别自己编')
      }
      store.append({ type: 'read', chatKey, throughSeq, at: Date.now() })
      return { readThroughSeq: store.of(chatKey).readThroughSeq, latestSeq }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'close_conversation',
    description: '这段聊完了：记下收在哪、下次怎么接。不是潜水，下次被叫到仍会醒。对方还在提问时别用它逃避。',
    parameters: {
      summary: { type: 'string', description: `这段收在哪，最多 ${NOTE_MAX_CHARS} 字。` },
      nextOpening: { type: 'string', description: `下次怎么接，最多 ${NOTE_MAX_CHARS} 字。` },
      throughSeq: { type: 'number', description: '顺便把水位推到这条。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const summary = String(args.summary ?? '').slice(0, NOTE_MAX_CHARS)
      const nextOpening = String(args.nextOpening ?? '').slice(0, NOTE_MAX_CHARS)
      if (summary.length === 0 && nextOpening.length === 0) {
        refuse('attention.empty_close', '收尾必须留下结束点', '给 summary 或 nextOpening')
      }
      const state = store.of(chatKey)
      let throughSeq: number | undefined
      if (args.throughSeq !== undefined) {
        if (!Number.isInteger(args.throughSeq)) refuse('attention.invalid_seq', '水位必须是整数', '用 read_messages 返回的水位')
        const value = args.throughSeq as number
        if (value < state.readThroughSeq) refuse('attention.seq_backwards', `水位只能前进，当前 ${state.readThroughSeq}`, '传一个不小于当前水位的值')
        const latestSeq = inbox.latestSeq(chatKey)
        if (latestSeq > 0 && value > latestSeq) refuse('attention.seq_ahead', `水位超过了最新消息 ${latestSeq}`, '用 read_messages 返回的水位')
        throughSeq = value
      }
      const event: AttentionEvent = { type: 'close', chatKey, summary, nextOpening, at: Date.now(), ...throughSeq !== undefined ? { throughSeq } : {} }
      store.append(event)
      const next = store.of(chatKey)
      return { closedAt: next.closedAt, closeSummary: next.closeSummary, nextOpening: next.nextOpening, readThroughSeq: next.readThroughSeq }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'set_wake_config',
    description: '决定下次什么时候叫醒你：每条都醒、睡一会儿、或者只在这几种情况醒。默认推荐被叫、被点名、有提问，普通消息低概率。',
    parameters: {
      infinite: { type: 'boolean', description: '每条消息都醒。' },
      sleepMs: { type: 'number', description: '睡这么久再醒，与 infinite 二选一。' },
      triggers: {
        type: 'object',
        additionalProperties: true,
        description: '唤醒条件：atMention、nameMention、question、poke、anyMessage、probability、speakerIds。',
      },
      throughSeq: { type: 'number', description: '顺便把水位推到这条。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const state = store.of(chatKey)
      const now = Date.now()

      let wakeMode: 'infinite' | 'timed' = state.wakeMode
      let wakeUntil: number | null = state.wakeUntil
      const wantsInfinite = args.infinite === true
      const sleepMs = Number.isInteger(args.sleepMs) && args.sleepMs !== undefined ? args.sleepMs : undefined
      if (wantsInfinite && sleepMs !== undefined) {
        refuse('attention.conflicting_wake', 'infinite 与 sleepMs 不能同时给', '只给其中一个')
      }
      if (!wantsInfinite && sleepMs === undefined && args.triggers === undefined && args.throughSeq === undefined) {
        refuse('attention.bad_wake', '没有给任何唤醒参数', '给 infinite、sleepMs 或 triggers')
      }
      if (sleepMs !== undefined) {
        if (sleepMs <= 0) refuse('attention.bad_wake', 'sleepMs 必须是正整数', '给一个大于零的毫秒数')
        wakeMode = 'timed'
        wakeUntil = now + sleepMs
      } else if (wantsInfinite) {
        wakeMode = 'infinite'
        wakeUntil = null
      }

      // Validate the watermark before touching any state, so a rejected call
      // cannot leave a half-applied wake setting behind.
      let throughSeq: number | undefined
      if (args.throughSeq !== undefined) {
        if (!Number.isInteger(args.throughSeq)) refuse('attention.invalid_seq', '水位必须是整数', '用 read_messages 返回的水位')
        const value = args.throughSeq as number
        if (value < state.readThroughSeq) refuse('attention.seq_backwards', `水位只能前进，当前 ${state.readThroughSeq}`, '传一个不小于当前水位的值')
        const latestSeq = inbox.latestSeq(chatKey)
        if (latestSeq > 0 && value > latestSeq) refuse('attention.seq_ahead', `水位超过了最新消息 ${latestSeq}`, '用 read_messages 返回的水位')
        throughSeq = value
      }

      const triggers: WakeTriggers = { ...state.triggers, ...(args.triggers as WakeTriggers | undefined ?? {}) }
      if (triggers.probability !== undefined) {
        const probability = Number(triggers.probability)
        if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
          refuse('attention.bad_probability', 'probability 必须在 0 到 1 之间', '给一个 0 到 1 的小数')
        }
        triggers.probability = probability
      }

      store.append({ type: 'wake', chatKey, wakeMode, wakeUntil, triggers, at: now })
      if (throughSeq !== undefined) store.append({ type: 'read', chatKey, throughSeq, at: now })
      const next = store.of(chatKey)
      return { wakeMode: next.wakeMode, wakeUntil: next.wakeUntil, triggers: JSON.parse(JSON.stringify(next.triggers)), readThroughSeq: next.readThroughSeq }
    },
  }))
}

/** Read the current attention state of one chat, for prompt rendering. */
export function attentionStateOf(store: AttentionStore, chatKey: string): AttentionState {
  return store.of(chatKey)
}
