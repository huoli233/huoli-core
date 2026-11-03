// 时段判断：夜里的浓度、去甲按时段换基线

import type { Tuning } from './defaults.ts'
import { clamp } from './math.ts'

/**
 * 本地小时数（带小数）
 * @param at - 毫秒时间戳
 * @returns 0~24 的小时
 */
export function localHour(at: number): number {
  const date = new Date(at)
  return date.getHours() + date.getMinutes() / 60
}

/**
 * 夜色浓度：全黑为 1，白天为 0，两头按斜坡过渡
 * @param hour - 本地小时数
 * @param tuning - 参数
 * @returns 0~1 的夜色浓度
 */
export function nightness(hour: number, tuning: Tuning): number {
  const from = tuning.nightDarkFrom
  const until = tuning.nightDarkUntil
  const ramp = Math.max(0.01, tuning.nightRamp)
  if (hour >= from || hour < until) return 1
  if (hour < until + ramp) return clamp(1 - (hour - until) / ramp)
  if (hour >= from - ramp) return clamp((hour - (from - ramp)) / ramp)
  return 0
}

/**
 * 去甲肾上腺素的时段基线
 * @param hour - 本地小时数
 * @returns 基线值
 */
export function noradrenalineBaseline(hour: number): number {
  if (hour < 6) return 0.22
  if (hour < 9) return 0.45
  if (hour < 12) return 0.72
  if (hour < 14) return 0.55
  if (hour < 18) return 0.70
  if (hour < 22) return 0.60
  return 0.35
}

/**
 * 是不是饭点
 * @param hour - 本地小时数
 * @returns 是则 true
 */
export function isMealHour(hour: number): boolean {
  const whole = Math.floor(hour)
  return whole === 6 || whole === 7 || whole === 11 || whole === 12 || whole === 17 || whole === 18
}

/**
 * 是不是夜里该省着掉的时段
 * @param hour - 本地小时数
 * @returns 是则 true
 */
export function isQuietHour(hour: number): boolean {
  return hour >= 23 || hour < 7
}

/**
 * 褪黑素该朝哪走
 * @param hour - 本地小时数
 * @param tuning - 参数
 * @returns 夜色浓度或零
 */
export function melatoninTarget(hour: number, tuning: Tuning): number {
  const awake = hour >= tuning.melatoninFrom || hour < tuning.melatoninUntil
  return awake ? nightness(hour, tuning) : 0
}
