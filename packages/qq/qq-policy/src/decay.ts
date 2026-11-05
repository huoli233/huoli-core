// 全仓唯一的衰减表：半衰期、松弛常数，别处不许再写

const HOUR = 3_600_000
const DAY = 86_400_000

/** 衰减类量的半衰期：过这段时间，与基线的距离减半 */
export const HALF_LIFE_MS = {
  recall: 36 * HOUR,
  asset: 14 * DAY,
  mood: 18 * 60_000,
  annoyance: 2 * HOUR,
  relation: 72 * HOUR,
  attention: 6 * 60_000,
  grievance: 2 * HOUR,
  excitement: 1.2 * HOUR,
  seed: 10 * 60_000,
  alias: 30 * DAY,
  trauma: 7 * DAY,
  policy: 30 * DAY,
} as const

/** 半衰期表里认的名字 */
export type HalfLifeKind = keyof typeof HALF_LIFE_MS

/** 慢变量的松弛常数：用时间常数向自身基线指数回归 */
export const TAU_MS = {
  mood: 8 * HOUR,
  arousal: 1.5 * HOUR,
  irritation: HOUR,
  energy: 6 * HOUR,
  chatEnergy: 5 * HOUR,
  boredom: 3 * HOUR,
  socialHunger: 4 * HOUR,
  curiosity: 6 * HOUR,
  sleepPressure: 5 * HOUR,
  sleepDebt: 20 * HOUR,
  topicHeat: 3 * HOUR,
  tension: 2 * HOUR,
  familiarity: Number.POSITIVE_INFINITY,
  affection: 72 * HOUR,
  trust: 72 * HOUR,
  annoyance: 2 * HOUR,
} as const

/** 松弛表里认的名字 */
export type TauKind = keyof typeof TAU_MS

/**
 * 收到 0 到 1
 * @param value - 值
 * @returns 算出来的数
 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * 按半衰期把值向零衰减
 * @param value - 值
 * @param kind - 哪一类
 * @param elapsedMs - 过去了多久
 * @returns 算出来的数
 */
export function decay(value: number, kind: HalfLifeKind, elapsedMs: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return value
  const halfLife = HALF_LIFE_MS[kind]
  return value * 0.5 ** (elapsedMs / halfLife)
}

/**
 * 按时间常数把值拉回自身基线
 * @param value - 值
 * @param kind - 哪一类
 * @param elapsedMs - 过去了多久
 * @param baseline - 回到哪个值
 * @returns 算出来的数
 */
export function relaxToBaseline(value: number, kind: TauKind, elapsedMs: number, baseline: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return value
  const tau = TAU_MS[kind]
  if (!Number.isFinite(tau)) return value
  return baseline + (value - baseline) * Math.exp(-elapsedMs / tau)
}
