// 开经日事实：只在周期日真的跨到开经那天时产一条，本模块不写记忆

import { localDate, localDayDiff } from './clock.ts'
import { DEFAULTS, type Tuning } from './defaults.ts'
import type { VitalsState } from './types.ts'

/** 开经那一刻的可核对事实，交订阅者自己成文 */
export interface CycleFact {
  /** 这一刻的毫秒时间戳 */
  at: number
  /** 当前周期第几天，开经时是 1 */
  day: number
  /** 本地日历日，按配置时区算 */
  date: string
}

/**
 * 周期日真的跨到开经那天才产事实，同一周期的重复结算不给
 * @param before - 结算前的状态，周期日与幂等标记都从它读
 * @param after - 结算后的状态，周期日与周期长度都从它读
 * @param at - 这一刻的毫秒时间戳
 * @param tuning - 参数，时区在里面
 * @returns 这一次产出的事实，没跨日或已经产过时为 undefined
 */
export function cycleStartOf(
  before: VitalsState,
  after: VitalsState,
  at: number,
  tuning: Tuning = DEFAULTS,
): CycleFact | undefined {
  if (after.cycle_day !== 1 || before.cycle_day === 1 || before.cycle_day === 0) return undefined
  const marked = before.cycle_start_applied_at
  if (marked > 0 && localDayDiff(marked, at, tuning.timeZone) < Math.max(1, after.cycle_len)) return undefined
  return { at, day: after.cycle_day, date: localDate(at, tuning.timeZone) }
}
