/**
 * Attention state for one chat: how far it has read, when it last closed a
 * conversation, and when it wants to be woken again.
 *
 * @module @huoli/huoli-qq-attention
 */

/** Wake conditions the model may set for a chat. */
export interface WakeTriggers {
  /** Wake on a mention of the bot. */
  at?: boolean
  /** Wake on any mention token reported by the channel. */
  mention?: boolean
  /** Wake on the bot's name appearing in text. */
  name?: boolean
  /** Wake on a question mark. */
  question?: boolean
  /** Wake on a poke. */
  poke?: boolean
  /** Baseline probability for ambient messages, zero to one. */
  prob?: number
  /** Senders whose messages always wake the bot. */
  speakerIds?: readonly string[]
}

/** Attention state of one chat. */
export interface AttentionState {
  /** Chat this state belongs to. */
  readonly chatKey: string
  /** Read watermark; never decreases. */
  readSeq: number
  /** Time of the last close, or null when the conversation is open. */
  closedAt: number | null
  /** How the last conversation ended, at most 200 characters. */
  closeSummary: string
  /** How to resume next time, at most 200 characters. */
  nextOpening: string
  /** Whether the bot wakes on its own or at a fixed time. */
  wakeMode: 'infinite' | 'timed'
  /** Deadline for timed wake, null under infinite mode. */
  wakeUntil: number | null
  /** Wake conditions. */
  triggers: WakeTriggers
  /** Last time messages were looked at. */
  lastSeenAt: number
}

/** Failure shape shared with the tool layer. */
export interface AttentionRefusal {
  readonly ok: false
  readonly code: string
  readonly error: string
  readonly hint: string
}

/** Input for closing a conversation. */
export interface CloseInput {
  /** How the conversation ended. */
  summary: string
  /** How to resume next time. */
  nextOpening: string
  /** Optional watermark to advance to. */
  throughSeq?: number
  /** Current time in milliseconds. */
  at: number
}

/** Input for setting the wake behaviour. */
export interface WakeInput {
  /** Wake on every message. */
  infinite?: boolean
  /** Sleep length under timed mode, in milliseconds. */
  sleepMs?: number
  /** Replacement wake conditions. */
  triggers?: WakeTriggers
  /** Current time in milliseconds. */
  at: number
}

/** Longest accepted close note, matching the conversation close contract. */
export const NOTE_MAX_CHARS = 200

/** Attention state store keyed by chat. */
export interface AttentionStore {
  /** State for one chat, created on first use. */
  of(chatKey: string): AttentionState
  /** Advance the read watermark; rejects a backwards move. */
  markRead(chatKey: string, throughSeq: number): { ok: true; readSeq: number } | AttentionRefusal
  /** Record how the conversation ended. */
  close(chatKey: string, input: CloseInput): { ok: true; state: AttentionState } | AttentionRefusal
  /** Set the wake behaviour. */
  setWake(chatKey: string, input: WakeInput): { ok: true; state: AttentionState } | AttentionRefusal
}

/** Create an attention store holding state in memory. */
export function createAttentionStore(now: () => number = () => Date.now()): AttentionStore {
  const states = new Map<string, AttentionState>()

  const of = (chatKey: string): AttentionState => {
    const existing = states.get(chatKey)
    if (existing !== undefined) return existing
    const created: AttentionState = {
      chatKey,
      readSeq: 0,
      closedAt: null,
      closeSummary: '',
      nextOpening: '',
      wakeMode: 'infinite',
      wakeUntil: null,
      triggers: { at: true, mention: true, name: true, question: true, poke: true, prob: 0.05 },
      lastSeenAt: now(),
    }
    states.set(chatKey, created)
    return created
  }

  return {
    of,
    markRead(chatKey, throughSeq) {
      const state = of(chatKey)
      if (!Number.isInteger(throughSeq) || throughSeq < 0) {
        return { ok: false, code: 'attention.invalid_seq', error: '水位必须是自然数', hint: '传当前读到的序号' }
      }
      if (throughSeq < state.readSeq) {
        return { ok: false, code: 'attention.seq_backwards', error: '水位只能前进', hint: `当前水位 ${state.readSeq}` }
      }
      state.readSeq = throughSeq
      state.lastSeenAt = now()
      return { ok: true, readSeq: state.readSeq }
    },
    close(chatKey, input) {
      const summary = input.summary.slice(0, NOTE_MAX_CHARS)
      const nextOpening = input.nextOpening.slice(0, NOTE_MAX_CHARS)
      if (summary.length === 0 && nextOpening.length === 0) {
        return { ok: false, code: 'attention.empty_close', error: '收尾必须留下结束点', hint: '给 summary 或 nextOpening' }
      }
      const state = of(chatKey)
      if (input.throughSeq !== undefined) {
        const moved = this.markRead(chatKey, input.throughSeq)
        if (!moved.ok) return moved
      }
      state.closedAt = input.at
      state.closeSummary = summary
      state.nextOpening = nextOpening
      return { ok: true, state }
    },
    setWake(chatKey, input) {
      const state = of(chatKey)
      if (input.infinite === true) {
        state.wakeMode = 'infinite'
        state.wakeUntil = null
      } else if (Number.isInteger(input.sleepMs) && (input.sleepMs ?? 0) > 0) {
        state.wakeMode = 'timed'
        state.wakeUntil = input.at + (input.sleepMs ?? 0)
      } else if (input.triggers === undefined) {
        return { ok: false, code: 'attention.bad_wake', error: '唤醒参数不合法', hint: '给 infinite 或正整数 sleepMs' }
      }
      if (input.triggers !== undefined) state.triggers = { ...state.triggers, ...input.triggers }
      return { ok: true, state }
    },
  }
}
