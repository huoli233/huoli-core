// 自己的状态：心情、精力、无聊、想说话这些，读写都走这里

import { relaxToBaseline, type TauKind } from '@huoli/huoli-qq-policy'

// 全局的慢变量，各群共用
export interface GlobalState {
  mood: number
  energy: number
  boredom: number
  socialHunger: number
  curiosity: number
  tension: number
  irritation: number
  sleepPressure: number
  updatedAt: number
}

// 一个群里的关系
export interface ChatState {
  familiarity: number
  affection: number
  trust: number
  annoyance: number
  updatedAt: number
}

// 整份状态
export interface SubjectState {
  global: GlobalState
  chats: Record<string, ChatState>
  lastActive: string
}

// 各字段回到平稳时的样子
const BASE: Record<string, number> = {
  mood: 0.5,
  energy: 0.7,
  boredom: 0.2,
  socialHunger: 0.25,
  curiosity: 0.45,
  tension: 0.1,
  irritation: 0.05,
  sleepPressure: 0.15,
  familiarity: 0,
  affection: 0.5,
  trust: 0.5,
  annoyance: 0.05,
}

// 一开始的样子
export function emptySubject(now: number): SubjectState {
  return {
    global: {
      mood: BASE.mood!,
      energy: BASE.energy!,
      boredom: BASE.boredom!,
      socialHunger: BASE.socialHunger!,
      curiosity: BASE.curiosity!,
      tension: BASE.tension!,
      irritation: BASE.irritation!,
      sleepPressure: BASE.sleepPressure!,
      updatedAt: now,
    },
    chats: {},
    lastActive: '',
  }
}

// 一个群一开始的样子
export function emptyChat(now: number): ChatState {
  return {
    familiarity: BASE.familiarity!,
    affection: BASE.affection!,
    trust: BASE.trust!,
    annoyance: BASE.annoyance!,
    updatedAt: now,
  }
}

// 收回 0 到 1
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

// 让全局状态按过去了多久慢慢回到平稳
export function settleGlobal(state: GlobalState, now: number): GlobalState {
  const passed = Math.max(0, now - state.updatedAt)
  if (passed <= 0) return state
  const next: GlobalState = { ...state, updatedAt: now }
  const keys: Array<[keyof GlobalState & TauKind, number]> = [
    ['mood', BASE.mood!],
    ['energy', BASE.energy!],
    ['boredom', BASE.boredom!],
    ['socialHunger', BASE.socialHunger!],
    ['curiosity', BASE.curiosity!],
    ['tension', BASE.tension!],
    ['irritation', BASE.irritation!],
    ['sleepPressure', BASE.sleepPressure!],
  ]
  for (const [key, base] of keys) {
    next[key] = clamp01(relaxToBaseline(state[key], key, passed, base))
  }
  return next
}

// 让一个群的关系按过去了多久慢慢回到平稳
export function settleChat(state: ChatState, now: number): ChatState {
  const passed = Math.max(0, now - state.updatedAt)
  if (passed <= 0) return state
  const next: ChatState = { ...state, updatedAt: now }
  const keys: Array<[keyof ChatState & TauKind, number]> = [
    ['familiarity', BASE.familiarity!],
    ['affection', BASE.affection!],
    ['trust', BASE.trust!],
    ['annoyance', BASE.annoyance!],
  ]
  for (const [key, base] of keys) {
    next[key] = clamp01(relaxToBaseline(state[key], key, passed, base))
  }
  return next
}

// 按名字改一个全局字段
export function nudgeGlobal(state: GlobalState, field: keyof GlobalState, delta: number, now: number): GlobalState {
  if (field === 'updatedAt') return state
  const current = Number(state[field]) || 0
  return { ...state, [field]: clamp01(current + delta), updatedAt: now } as GlobalState
}

// 按名字改一个群里的字段
export function nudgeChat(state: ChatState, field: keyof ChatState, delta: number, now: number): ChatState {
  if (field === 'updatedAt') return state
  const current = Number(state[field]) || 0
  return { ...state, [field]: clamp01(current + delta), updatedAt: now } as ChatState
}

// 心情的称呼
export function moodWord(mood: number): string {
  if (mood >= 0.75) return '不错'
  if (mood >= 0.55) return '还行'
  if (mood >= 0.4) return '一般'
  if (mood >= 0.2) return '偏低'
  return '低落'
}

// 熟悉度的称呼
export function familiarityWord(value: number): string {
  if (value >= 0.8) return '很熟'
  if (value >= 0.55) return '熟人'
  if (value >= 0.3) return '认识'
  if (value >= 0.1) return '有点印象'
  return '还不太认识'
}
