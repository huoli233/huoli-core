// 死亡威胁的分档：把外部给的余额档位翻成目标值，本包不接余额系统

import { DEFAULTS, type Tuning } from './defaults.ts'

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
