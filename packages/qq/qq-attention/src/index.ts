/**
 * Attention state machine for one chat, exposed as five model-facing tools:
 * look, wait, mark read, close, and set the wake behaviour.
 *
 * The channel bridge pushes inbound messages through the seam returned by
 * {@link qqAttentionOf}; the tools only read and advance state.
 *
 * @module @huoli/huoli-qq-attention
 */

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import { createInbox, type QqInbox } from './inbox.ts'
import { createAttentionStore, NOTE_MAX_CHARS, type AttentionStore, type WakeTriggers } from './state.ts'

export type { InboxPush, InboxRead, InboxWait, QqInbox, QqMessage } from './inbox.ts'
export type { AttentionState, AttentionStore, WakeTriggers } from './state.ts'

/** Both seams created for one application context. */
export interface QqAttentionSeam {
  /** Inbound message inbox fed by the channel bridge. */
  readonly inbox: QqInbox
  /** Attention state store. */
  readonly attention: AttentionStore
}

const seams = new WeakMap<Context, QqAttentionSeam>()

/** Reach the attention seam of a running application; undefined before apply. */
export function qqAttentionOf(ctx: Context): QqAttentionSeam | undefined {
  return seams.get(ctx)
}

/** Cordis row name. */
export const name = 'qq-attention'

/** Services this row needs. */
export const inject = ['tools']

/** Messages returned by one look, at most this many. */
const DEFAULT_READ_LIMIT = 20

/** Longest wait a single call may request. */
const WAIT_MAX_MS = 300_000

/** Quiet window used when the caller asks for no specific one. */
const DEFAULT_QUIET_MS = 5_000

/** Chat key for the current call, derived from the session the tool runs in. */
function chatKeyOf(exec: { agent?: { id: string } }): string {
  return exec.agent?.id ?? 'chat:unknown'
}

/** Render a refusal as readable model text. */
function refusal(code: string, error: string, hint: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: `${code}: ${error}｜下一步: ${hint}` }], isError: true }
}

/** Register the five attention tools and their state seam. */
export function apply(ctx: Context): void {
  const seam: QqAttentionSeam = { inbox: createInbox(), attention: createAttentionStore() }
  seams.set(ctx, seam)

  ctx.tools.register(defineTool({
    name: 'read_messages',
    description: 'Look at what the chat said. Returns the newest messages plus the read watermark; pass nothing to continue from where you stopped.',
    parameters: {
      afterSeq: { type: 'number', description: 'Read messages after this sequence; omit to continue from the current watermark.' },
      limit: { type: 'number', description: 'How many messages to return at most; defaults to 20.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const watermark = seam.attention.of(chatKey).readSeq
      const limit = Number.isInteger(args.limit) && args.limit !== undefined ? args.limit : DEFAULT_READ_LIMIT
      const result = seam.inbox.read(chatKey, Number.isInteger(args.afterSeq) && args.afterSeq !== undefined ? args.afterSeq : watermark, limit)
      seam.attention.of(chatKey).lastSeenAt = Date.now()
      return {
        messages: result.messages.map(message => ({ seq: message.seq, senderId: message.senderId, text: message.text, at: message.at })),
        readThroughSeq: result.nextSeq,
        partial: result.partial,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wait_for_messages',
    description: 'Wait for the chat to keep talking. A timeout is an ordinary outcome, not a failure; use it to let people finish before deciding whether to speak.',
    parameters: {
      purpose: { type: 'string', description: 'reply to let them finish before answering, messages to observe before sleeping.' },
      timeoutMs: { type: 'number', description: `Total wait in milliseconds, capped at ${WAIT_MAX_MS}.` },
      quietMs: { type: 'number', description: `How long the chat must stay silent to count as finished; defaults to ${DEFAULT_QUIET_MS}.` },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const wanted = Number.isInteger(args.timeoutMs) && args.timeoutMs !== undefined ? args.timeoutMs : WAIT_MAX_MS
      const timeoutMs = Math.min(Math.max(wanted, 1), WAIT_MAX_MS)
      const quietMs = Number.isInteger(args.quietMs) && args.quietMs !== undefined ? Math.max(args.quietMs, 0) : DEFAULT_QUIET_MS
      const waited = await seam.inbox.wait(chatKey, { timeoutMs, quietMs, signal: exec.signal })
      const watermark = seam.attention.of(chatKey).readSeq
      return {
        newMessages: waited.messages.filter(message => message.seq > watermark).map(message => ({ seq: message.seq, senderId: message.senderId, text: message.text })),
        readThroughSeq: seam.inbox.count(chatKey),
        quietReached: waited.quietReached,
        timedOut: waited.timedOut,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mark_read',
    description: 'Move the read watermark forward without saying anything. It never moves backwards and does not close the conversation.',
    parameters: {
      throughSeq: { type: 'number', description: 'Advance the watermark to this sequence; omit to mark everything read.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const target = Number.isInteger(args.throughSeq) && args.throughSeq !== undefined ? args.throughSeq : seam.inbox.count(chatKey)
      const marked = seam.attention.markRead(chatKey, target)
      if (!marked.ok) return refusal(marked.code, marked.error, marked.hint)
      return { readThroughSeq: marked.readSeq }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'close_conversation',
    description: 'Mark this stretch of conversation as finished and leave a note for next time. This is not going silent: a later mention still wakes you.',
    parameters: {
      summary: { type: 'string', description: `Where the conversation ended, at most ${NOTE_MAX_CHARS} characters.` },
      nextOpening: { type: 'string', description: `How to pick it up next time, at most ${NOTE_MAX_CHARS} characters.` },
      throughSeq: { type: 'number', description: 'Also advance the read watermark to this sequence.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const closed = seam.attention.close(chatKey, {
        summary: String(args.summary ?? ''),
        nextOpening: String(args.nextOpening ?? ''),
        ...Number.isInteger(args.throughSeq) && args.throughSeq !== undefined ? { throughSeq: args.throughSeq } : {},
        at: Date.now(),
      })
      if (!closed.ok) return refusal(closed.code, closed.error, closed.hint)
      return { closedAt: closed.state.closedAt, closeSummary: closed.state.closeSummary, nextOpening: closed.state.nextOpening }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'set_wake_config',
    description: 'Decide when to wake again: every message, after a sleep, or only when specific things happen.',
    parameters: {
      infinite: { type: 'boolean', description: 'Wake on every message.' },
      sleepMs: { type: 'number', description: 'Sleep this long, then wake, when infinite is not set.' },
      triggers: {
        type: 'object',
        description: 'Wake conditions such as at, mention, name, question, poke, prob, and speakerIds.',
        additionalProperties: true,
      },
      throughSeq: { type: 'number', description: 'Also advance the read watermark to this sequence.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const set = seam.attention.setWake(chatKey, {
        ...args.infinite !== undefined ? { infinite: args.infinite } : {},
        ...Number.isInteger(args.sleepMs) && args.sleepMs !== undefined ? { sleepMs: args.sleepMs } : {},
        ...args.triggers !== undefined ? { triggers: args.triggers as WakeTriggers } : {},
        at: Date.now(),
      })
      if (!set.ok) return refusal(set.code, set.error, set.hint)
      if (Number.isInteger(args.throughSeq) && args.throughSeq !== undefined) {
        const marked = seam.attention.markRead(chatKey, args.throughSeq)
        if (!marked.ok) return refusal(marked.code, marked.error, marked.hint)
      }
      return { wakeMode: set.state.wakeMode, wakeUntil: set.state.wakeUntil, triggers: JSON.parse(JSON.stringify(set.state.triggers)) }
    },
  }))
}
