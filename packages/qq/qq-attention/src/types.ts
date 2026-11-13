// 注意力状态与它的事件：工具只发事件，状态由事件推导

/** 唤醒条件，全部可选 */
export interface WakeTriggers {
  atMention?: boolean
  nameMention?: boolean
  question?: boolean
  poke?: boolean
  anyMessage?: boolean
  speakerIds?: readonly string[]
}

/** 一个会话的注意力状态 */
export interface AttentionState {
  readThroughSeq: number
  closedAt: number | null
  closeSummary: string
  nextOpening: string
  wakeMode: 'infinite' | 'timed'
  wakeUntil: number | null
  triggers: WakeTriggers
  lastSeenAt: number
  /** 最近一次成功发出群聊或私聊消息的时刻 */
  lastSelfSpokeAt?: number
  /** 自适应话痨度；旧文件没有这一项时按中间值 */
  talkativeness?: number
  talkativenessAt?: number
  /** 最近一次真人发言后，自己连续说了几条 */
  selfTalkStreak?: number
}

/** 状态能接受的三种事件 */
export type AttentionEvent =
  | { type: 'read'; chatKey: string; throughSeq: number; at: number }
  | { type: 'close'; chatKey: string; summary: string; nextOpening: string; throughSeq?: number; at: number }
  | { type: 'reopen'; chatKey: string; at: number }
  | { type: 'wake'; chatKey: string; wakeMode: 'infinite' | 'timed'; wakeUntil: number | null; triggers: WakeTriggers; at: number }
  | { type: 'talkativeness'; chatKey: string; target: number; weight: number; at: number }
  | { type: 'self_spoke'; chatKey: string; at: number; count?: number }
  | { type: 'human_spoke'; chatKey: string; at: number }

/** 收尾摘要上限 */
export const NOTE_MAX_CHARS = 200

/**
 * 没碰过的会话长这样
 * @returns 处理结果
 */
export function emptyAttention(): AttentionState {
  return {
    readThroughSeq: 0,
    closedAt: null,
    closeSummary: '',
    nextOpening: '',
    wakeMode: 'infinite',
    wakeUntil: null,
    triggers: { atMention: true, nameMention: true, question: true, poke: true, anyMessage: true },
    lastSeenAt: 0,
    lastSelfSpokeAt: 0,
    talkativeness: 0.5,
    talkativenessAt: 0,
    selfTalkStreak: 0,
  }
}

/**
 * 把一条事件叠到状态上，返回新状态
 * @param state - 现状
 * @param event - 一条事件
 * @returns 处理结果
 */
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
    case 'reopen':
      return state.closedAt === null ? state : { ...state, closedAt: null, lastSeenAt: event.at }
    case 'wake': {
      return { ...state, wakeMode: event.wakeMode, wakeUntil: event.wakeUntil, triggers: { ...event.triggers }, lastSeenAt: event.at }
    }
    case 'talkativeness': {
      const before = typeof state.talkativeness === 'number' && Number.isFinite(state.talkativeness)
        ? state.talkativeness : 0.5
      const target = Math.min(1, Math.max(0, event.target))
      const weight = Math.min(1, Math.max(0, event.weight))
      return {
        ...state,
        talkativeness: Number((before + (target - before) * weight).toFixed(4)),
        talkativenessAt: event.at,
        lastSeenAt: event.at,
      }
    }
    case 'self_spoke': {
      const count = Math.max(1, Math.floor(event.count ?? 1))
      const before = typeof state.talkativeness === 'number' && Number.isFinite(state.talkativeness)
        ? state.talkativeness : 0.5
      // 一次发得越多，越往“收着说”那边移动；真人接话会再往基准拉回一点
      const speechWeight = Math.min(1, count * 0.08)
      return {
        ...state,
        lastSelfSpokeAt: Math.max(state.lastSelfSpokeAt ?? 0, event.at),
        selfTalkStreak: Math.max(0, state.selfTalkStreak ?? 0) + count,
        talkativeness: Number((before + (0.2 - before) * speechWeight).toFixed(4)),
        talkativenessAt: event.at,
        lastSeenAt: event.at,
      }
    }
    case 'human_spoke': {
      const streak = state.selfTalkStreak ?? 0
      const before = typeof state.talkativeness === 'number' && Number.isFinite(state.talkativeness)
        ? state.talkativeness : 0.5
      const resumed = before < 0.5 ? Number((before + (0.5 - before) * 0.12).toFixed(4)) : before
      if (streak === 0 && resumed === before) return state
      return {
        ...state,
        selfTalkStreak: 0,
        talkativeness: resumed,
        ...resumed === before ? {} : { talkativenessAt: event.at },
        lastSeenAt: event.at,
      }
    }
    default:
      return state
  }
}
