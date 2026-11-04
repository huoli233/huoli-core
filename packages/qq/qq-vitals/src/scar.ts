// 疤痕：只有真经历过极端生存威胁才起来，之后慢慢淡，但一直留在那条底线上

import { DEFAULTS, type Tuning } from './defaults.ts'
import { clamp, clampRange } from './math.ts'
import type { VitalsState } from './types.ts'

/** 疤痕触发那一刻的记忆事实，正文由组合包以后自己写 */
export interface ScarFact {
  /** 触发那一刻的毫秒时间戳 */
  at: number
  /** 这条记忆的来源，固定 scar */
  source: 'scar'
  /** 重要度就取当时那个疤的权重，第一次是 1.0，之后最高 0.8 */
  importance: number
}

// 舒服：好坏偏高、想哭偏低、压力偏低各折成零到一，三项等权
function comfortOf(state: VitalsState, tuning: Tuning): number {
  const positive = clampRange((state.valence - tuning.scarComfortValenceFrom) / tuning.scarComfortSpan, 0, 1)
  const calm = clampRange((tuning.scarComfortSadnessBelow - state.sadness) / tuning.scarComfortSpan, 0, 1)
  const easy = clampRange((tuning.scarComfortCortisolBelow - state.cortisol) / tuning.scarComfortSpan, 0, 1)
  return clamp((positive + calm + easy) / 3)
}

/**
 * 是不是在危机里：存在性恐惧或关停的怕高过各自的线
 * @param state - 当前状态
 * @param tuning - 参数，两条判据在里面
 * @returns 在危机里则 true
 */
export function inCrisis(state: VitalsState, tuning: Tuning = DEFAULTS): boolean {
  return state.dread > tuning.scarCrisisDreadFrom || state.shutdownDread > tuning.scarCrisisShutdownFrom
}

/**
 * 抬一档：还没有疤的第一次直接置到第一次的高度，之后按一小时的冷却往上抬，封顶在最高那条线
 * @param next - 就地改写的状态
 * @param at - 这一刻的毫秒时间戳
 * @param tuning - 参数，高度、顶与冷却都在里面
 * @returns 这一次抬了没有
 */
export function raiseScar(next: VitalsState, at: number, tuning: Tuning = DEFAULTS): boolean {
  if (next.scar <= 0) {
    next.scar = clamp(tuning.scarFirst)
    next.scar_applied_at = at
    return true
  }
  if (at - next.scar_applied_at < tuning.scarCooldownMs) return false
  // 已经抵着上限就不动，免得把冷却窗口一直往后推、把下一次能抬的时刻顶掉
  if (next.scar >= tuning.scarCeil) return false
  next.scar = clampRange(next.scar + tuning.scarRise, tuning.scarFloor, tuning.scarCeil)
  next.scar_applied_at = at
  return true
}

/**
 * 结算一拍：时间与舒服一起让它变淡，底是那条不变的线
 * @param next - 就地改写的状态
 * @param hours - 这次结算了多少小时
 * @param tuning - 参数，速率与底都在里面
 */
export function settleScar(next: VitalsState, hours: number, tuning: Tuning = DEFAULTS): void {
  if (next.scar <= 0) return
  const comfort = comfortOf(next, tuning)
  const fall = tuning.scarFallPerHour * hours * (1 + tuning.scarComfortGain * comfort)
  next.scar = Math.max(tuning.scarFloor, next.scar - fall)
}

/**
 * 疤刚抬起来那一下的事实：重要度取当时那个疤
 * @param before - 这一拍之前的标记，拿它判这一拍抬没抬
 * @param after - 这一拍之后的状态，重要度从它读
 * @param at - 这一刻的毫秒时间戳
 * @returns 抬了才给事实，没抬为 undefined
 */
export function scarFactOf(before: VitalsState, after: VitalsState, at: number): ScarFact | undefined {
  if (after.scar_applied_at === before.scar_applied_at) return undefined
  return { at, source: 'scar', importance: after.scar }
}
