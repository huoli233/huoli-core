/**
 * Attention state and its persisted events. The tools never mutate state
 * directly: they append an event, and the store applies it.
 *
 * @module @huoli/huoli-qq-attention
 */

/** Wake conditions the model may set for one chat. */
export interface WakeTriggers {
  /** Wake when the bot is mentioned. */
  atMention?: boolean
  /** Wake when the bot's name appears in text. */
  nameMention?: boolean
  /** Wake on a question. */
  question?: boolean
  /** Wake on a poke. */
  poke?: boolean
  /** Wake on any ambient message. */
  anyMessage?: boolean
  /** Baseline probability for ambient messages, zero to one. */
  probability?: number
  /** Senders whose messages always wake the bot. */
  speakerIds?: readonly string[]
}

/** Attention state of one chat. */
export interface AttentionState {
  /** Watermark: the sequence the bot has read up to. Never decreases. */
  readThroughSeq: number
  /** Time the last conversation was closed, or null while open. */
  closedAt: number | null
  /** How the last conversation ended, at most 200 characters. */
  closeSummary: string
  /** How to resume next time, at most 200 characters. */
  nextOpening: string
  /** Whether the bot wakes on its own or after a sleep. */
  wakeMode: 'infinite' | 'timed'
  /** Deadline for timed wake, null under infinite mode. */
  wakeUntil: number | null
  /** Wake conditions. */
  triggers: WakeTriggers
  /** Last time messages were looked at. */
  lastSeenAt: number
}

/** An attention event the store knows how to apply. */
export type AttentionEvent =
  | { type: 'read'; chatKey: string; throughSeq: number; at: number }
  | { type: 'close'; chatKey: string; summary: string; nextOpening: string; throughSeq?: number; at: number }
  | { type: 'wake'; chatKey: string; wakeMode: 'infinite' | 'timed'; wakeUntil: number | null; triggers: WakeTriggers; at: number }

/** Longest accepted close note. */
export const NOTE_MAX_CHARS = 200

/** State of a chat that has never been touched. */
export function emptyAttention(): AttentionState {
  return {
    readThroughSeq: 0,
    closedAt: null,
    closeSummary: '',
    nextOpening: '',
    wakeMode: 'infinite',
    wakeUntil: null,
    triggers: { atMention: true, nameMention: true, question: true, poke: true, anyMessage: false, probability: 0.05 },
    lastSeenAt: 0,
  }
}

/** Apply one event to a state, returning a new state. */
export function applyAttention(state: AttentionState, event: AttentionEvent): AttentionState {
  switch (event.type) {
    case 'read': {
      if (!Number.isInteger(event.throughSeq) || event.throughSeq <= state.readThroughSeq) return state
      return { ...state, readThroughSeq: event.throughSeq, lastSeenAt: event.at }
    }
    case 'close': {
      const summary = event.summary.slice(0, NOTE_MAX_CHARS)
      const nextOpening = event.nextOpening.slice(0, NOTE_MAX_CHARS)
      const readThroughSeq = event.throughSeq !== undefined && Number.isInteger(event.throughSeq) && event.throughSeq > state.readThroughSeq
        ? event.throughSeq
        : state.readThroughSeq
      return { ...state, closedAt: event.at, closeSummary: summary, nextOpening, readThroughSeq, lastSeenAt: event.at }
    }
    case 'wake': {
      return { ...state, wakeMode: event.wakeMode, wakeUntil: event.wakeUntil, triggers: { ...event.triggers }, lastSeenAt: event.at }
    }
    default:
      return state
  }
}
