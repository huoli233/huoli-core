// 把七维状态写成一段第一人称处境，不给模型念数字

import {
  DIMS,
  DRIFT,
  EVENTS,
  effectiveDesire,
  type Dim,
  type LongingState,
  type LongingTuning,
  pressureOf,
} from './model.ts'

/** 最近事件保留多久才进提示 */
const RECENT_MS = 30 * 60_000

function recentNotes(state: LongingState, at: number): string[] {
  const seen = new Set<string>()
  const notes: string[] = []
  for (const event of state.events) {
    if (at - event.at >= RECENT_MS) continue
    const note = EVENTS[event.name].note
    if (seen.has(note)) continue
    seen.add(note)
    notes.push(note)
  }
  return notes.slice(-2)
}

function degree(value: number): 'low' | 'normal' | 'high' | 'veryHigh' {
  return value >= 80 ? 'veryHigh' : value >= 62 ? 'high' : value >= 38 ? 'normal' : 'low'
}

function bodyLine(state: LongingState, desire: number, at: number): string {
  if (state.aftercareUntil > at) return '刚刚结束，身体还软着，话不想多，也更想被稳稳抱着。'
  if (desire >= 80) return '身体已经很热，注意力很难从对方身上移开。'
  if (desire >= 60) return '身体有反应，愿意往前靠近，但还没完全放弃分寸。'
  if (desire >= 40) return '身体是温的，亲近会让她软下来，不亲近也不会硬追。'
  return '身体这边偏淡，不太主动往亲密上走。'
}

function tensionLines(state: LongingState, tuning: LongingTuning): string[] {
  const pressure = pressureOf(state, tuning)
  const lines: string[] = []
  if (state.resist > pressure.resist) lines.push('理智正被更高的占有欲顶着，嘴上可能还硬，心里已经不太稳。')
  if (state.possess > pressure.possess) lines.push('占有欲已经越过这段关系平时能承住的位置，容易把在意说成控制。')
  if (state.fatigue > 65) lines.push('身体累了，想要会更容易变成想被抱着、想被照顾。')
  if (state.shame > 70) lines.push('羞耻还高，越想要越可能说不出口，只能用反应泄露。')
  if (state.affection < 25) lines.push('关系还远，身体有反应也不等于她愿意给。')
  if (state.affection > 75 && state.possess > 70) lines.push('关系很近，但占有也高，黏人和嘴硬可能同时出现。')
  if (state.grudges.length > 0) {
    const names = state.grudges.map(item => EVENTS[item.name].note).slice(-2)
    lines.push(`心里还压着事：${names.join('；')}。`)
  }
  return lines
}

/**
 * 生成私聊提示块
 * @param state - 当前状态
 * @param tuning - 参数
 * @param at - 当前时间
 * @returns 可直接放进上下文的状态块
 */
export function renderLongingBlock(
  state: LongingState,
  tuning: LongingTuning,
  at = Date.now(),
): string {
  if (state.pausedUntil > at) {
    return '[暗涌状态]\n这段先停着：不提身体欲望，不往亲密上引，正常聊天。'
  }
  const desire = effectiveDesire(state)
  const lines = [
    '[暗涌状态]',
    bodyLine(state, desire, at),
    ...tensionLines(state, tuning),
  ]
  if (state.scene !== '') lines.push(`此刻的处境：${state.scene}`)
  const recent = recentNotes(state, at)
  if (recent.length > 0) lines.push(`最近发生的：${recent.join('；')}。`)
  const veryHigh = DIMS.filter((dim: Dim) => degree(state[dim]) === 'veryHigh')
  if (veryHigh.length > 0) {
    const names: Record<Dim, string> = {
      lust: '性欲', lewd: '露骨程度', possess: '占有', shame: '羞耻',
      resist: '理智', fatigue: '疲劳', affection: '好感',
    }
    lines.push(`很高的维度：${veryHigh.map(dim => names[dim]).join('、')}。`)
  }
  lines.push(
    '[看完别复述这些判断，也别照抄里面的词。先在心里过一遍：这会儿身体是什么感觉、想不想靠近、为什么还忍着。想完只说出口的那部分。]',
  )
  return lines.join('\n')
}

/** 当前状态是否适合主动往外走 */
export function longingDesireLevel(state: LongingState): 'calm' | 'warm' | 'active' | 'high' {
  const desire = effectiveDesire(state)
  return desire >= 80 ? 'high' : desire >= 60 ? 'active' : desire >= 40 ? 'warm' : 'calm'
}

/** 时间衰减是否已经推动过状态 */
export function longingStaleHours(state: LongingState, at = Date.now()): number {
  return Math.max(0, (at - state.tickedAt) / 3_600_000)
}

/** 日常值，供别的包读事实时对照 */
export const LONGING_BASELINES = DRIFT
