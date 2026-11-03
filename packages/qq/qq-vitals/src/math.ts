// 结算用到的两个小工具：夹住区间、按半衰期靠近目标

/**
 * 夹到 0~1
 * @param value - 原值
 * @returns 夹住后的值
 */
export function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * 夹到给定区间
 * @param value - 原值
 * @param min - 下界
 * @param max - 上界
 * @returns 夹住后的值
 */
export function clampRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * 按半衰期朝目标靠近：follow(x, target, τ)
 * @param value - 原值
 * @param target - 目标
 * @param tauHours - 半衰期（小时）
 * @param hours - 过去了多少小时
 * @returns 靠近后的值
 */
export function follow(value: number, target: number, tauHours: number, hours: number): number {
  return value + (target - value) * (1 - 0.5 ** (hours / tauHours))
}

/**
 * 半衰衰减
 * @param value - 原值
 * @param hours - 过去了多少小时
 * @param halfHours - 半衰期（小时）
 * @returns 衰减后的值
 */
export function decay(value: number, hours: number, halfHours: number): number {
  return value * 0.5 ** (hours / halfHours)
}

/**
 * 只留正数部分
 * @param value - 原值
 * @returns 小于零时为 0
 */
export function above(value: number): number {
  return Math.max(0, value)
}
