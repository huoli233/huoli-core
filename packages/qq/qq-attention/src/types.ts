// 注意力状态与它的事件：工具只发事件，状态由事件推导

// 唤醒条件，全部可选
export interface WakeTriggers {
  atMention?: boolean
  nameMention?: boolean
  question?: boolean
  poke?: boolean
  anyMessage?: boolean
  probability?: number
  speakerIds?: readonly string[]
}

// 一个会话的注意力状态
export interface AttentionState {
  readThroughSeq: number
  closedAt: number | null
  closeSummary: string
  nextOpening: string
  wakeMode: 'infinite' | 'timed'
  wakeUntil: number | null
  triggers: WakeTriggers
  lastSeenAt: number
}

// 状态能接受的三种事件
export type AttentionEvent =
  | { type: 'read'; chatKey: string; throughSeq: number; at: number }
  | { type: 'close'; chatKey: string; summary: string; nextOpening: string; throughSeq?: number; at: number }
  | { type: 'wake'; chatKey: string; wakeMode: 'infinite' | 'timed'; wakeUntil: number | null; triggers: WakeTriggers; at: number }

// 收尾摘要上限
export const NOTE_MAX_CHARS = 200

// 没碰过的会话长这样
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

// 把一条事件叠到状态上，返回新状态
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
