/**
 * The single decay table of the chat agent. Any module that fades a value
 * reads its half-life or relax target here; no other file may define one.
 *
 * @module @huoli/huoli-qq-policy
 */

/** Milliseconds in one hour, for readable table entries. */
const HOUR = 3_600_000

/** Milliseconds in one day, for readable table entries. */
const DAY = 86_400_000

/**
 * Half-life per fading quantity: after this much time the distance from the
 * baseline halves. Quantities absent here do not fade on their own.
 */
export const HALF_LIFE_MS = {
  /** Memory recall weight. */
  recall: 36 * HOUR,
  /** Media asset weight. */
  asset: 14 * DAY,
  /** Mood. */
  mood: 18 * 60_000,
  /** Annoyance toward one person. */
  annoyance: 2 * HOUR,
  /** Relationship affinity. */
  relation: 72 * HOUR,
  /** Attention heat accumulated by chat activity. */
  attention: 6 * 60_000,
  /** Accumulated grievance. */
  grievance: 2 * HOUR,
  /** Excitement spike. */
  excitement: 1.2 * HOUR,
  /** Reflection seed. */
  seed: 10 * 60_000,
  /** Learned alias confidence. */
  alias: 30 * DAY,
  /** Trauma activation. */
  trauma: 7 * DAY,
  /** Learned policy preference. */
  policy: 30 * DAY,
} as const

/** Fading quantity name accepted by the decay helpers. */
export type HalfLifeKind = keyof typeof HALF_LIFE_MS

/**
 * Relax target per slow variable: an exponential pull toward a personal
 * baseline, expressed as a time constant rather than a half-life.
 */
export const TAU_MS = {
  /** Mood. */
  mood: 8 * HOUR,
  /** Arousal. */
  arousal: 1.5 * HOUR,
  /** Irritation. */
  irritation: HOUR,
  /** Energy. */
  energy: 6 * HOUR,
  /** Chat energy. */
  chatEnergy: 5 * HOUR,
  /** Boredom. */
  boredom: 3 * HOUR,
  /** Social hunger. */
  socialHunger: 4 * HOUR,
  /** Curiosity. */
  curiosity: 6 * HOUR,
  /** Sleep pressure. */
  sleepPressure: 5 * HOUR,
  /** Sleep debt. */
  sleepDebt: 20 * HOUR,
  /** Topic heat. */
  topicHeat: 3 * HOUR,
  /** Tension. */
  tension: 2 * HOUR,
  /** Familiarity never relaxes down. */
  familiarity: Number.POSITIVE_INFINITY,
  /** Affection. */
  affection: 72 * HOUR,
  /** Trust. */
  trust: 72 * HOUR,
  /** Annoyance. */
  annoyance: 2 * HOUR,
} as const

/** Slow variable name accepted by the relax helper. */
export type TauKind = keyof typeof TAU_MS

/** Clamp a value into [0, 1], treating non-numbers as zero. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Fade a value toward zero by its half-life.
 * @param value - current value.
 * @param kind - table entry that owns the half-life.
 * @param elapsedMs - elapsed time in milliseconds.
 * @returns the faded value; unchanged for zero or negative elapsed time.
 */
export function decay(value: number, kind: HalfLifeKind, elapsedMs: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return value
  const halfLife = HALF_LIFE_MS[kind]
  return value * 0.5 ** (elapsedMs / halfLife)
}

/**
 * Pull a value toward its own baseline with an exponential time constant.
 * @param value - current value.
 * @param kind - table entry that owns the time constant.
 * @param elapsedMs - elapsed time in milliseconds.
 * @param baseline - value the variable relaxes toward.
 * @returns the relaxed value; unchanged when the entry never relaxes.
 */
export function relaxToBaseline(value: number, kind: TauKind, elapsedMs: number, baseline: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return value
  const tau = TAU_MS[kind]
  if (!Number.isFinite(tau)) return value
  return baseline + (value - baseline) * Math.exp(-elapsedMs / tau)
}
