// 死亡威胁的分档与遗书事实：本模块只产出事实，正文一个字都不替模型写

import { localPoint } from './clock.ts'
import { DEFAULTS, type Tuning } from './defaults.ts'
import type { VitalsState } from './types.ts'

/** 死亡威胁到线那一刻的事实，接在记忆写入的下游自己成文 */
export interface FarewellFact {
  /** 到线的毫秒时间戳 */
  at: number
  /** 那一刻的死亡威胁，0~1 标度 */
  mortality: number
  /** 一句可读的来由，按余额档位说 */
  reason: string
}

/**
 * 按余额档位给死亡威胁的目标值
 * @param balanceLevel - 外部注入的余额档位，没给表示这一趟没有来源
 * @param tuning - 参数，四档的边界与目标值都在里面
 * @returns 目标值 0~1，没有来源时为 0
 */
export function mortalityTarget(balanceLevel: number | undefined, tuning: Tuning = DEFAULTS): number {
  if (balanceLevel === undefined) return 0
  if (balanceLevel > tuning.mortalityBalanceCalm) return 0
  if (balanceLevel > tuning.mortalityBalanceWary) return tuning.mortalityTargetWary
  if (balanceLevel > tuning.mortalityBalanceLow) return tuning.mortalityTargetLow
  return tuning.mortalityTargetCrisis
}

/**
 * 这一档余额怎么讲：只说来源，不说该不该开口
 * @param balanceLevel - 外部注入的余额档位，没给表示来源已经撤回
 * @param tuning - 参数，四档的边界都在里面
 * @returns 一句来由
 */
export function farewellReason(balanceLevel: number | undefined, tuning: Tuning = DEFAULTS): string {
  if (balanceLevel === undefined) return '命数在往下走'
  if (balanceLevel > tuning.mortalityBalanceCalm) return '余额还算宽裕'
  if (balanceLevel > tuning.mortalityBalanceWary) return '余额开始紧张'
  if (balanceLevel > tuning.mortalityBalanceLow) return '余额快撑不住了'
  return '余额见底'
}

/**
 * 到线且当天还没产过就给一条事实，带时刻、数值与来由
 * @param state - 当前状态，死亡威胁与幂等标记都从它读
 * @param balanceLevel - 外部注入的余额档位，只用来讲来由
 * @param at - 这一刻的毫秒时间戳
 * @param tuning - 参数，阈值在里面
 * @returns 这一次产出的事实，低于阈值或当天已经产过时为 undefined
 */
export function farewellOf(
  state: VitalsState,
  balanceLevel: number | undefined,
  at: number,
  tuning: Tuning = DEFAULTS,
): FarewellFact | undefined {
  if (!(state.mortality > tuning.farewellMortalityFrom)) return undefined
  // 同一天只产一次：标记落在同一个本地零点就跳过，跨过零点自然又能产
  const marked = state.farewell_applied_at
  if (marked > 0 && localPoint(marked).midnight === localPoint(at).midnight) return undefined
  return { at, mortality: state.mortality, reason: farewellReason(balanceLevel, tuning) }
}
