/**
 * Memory retention and clarity: how much a record is still worth, and which
 * discrete step it has fallen to. Importance is computed once at write time;
 * nothing here raises it again.
 *
 * @module @huoli/huoli-qq-policy
 */

/** Milliseconds in one day. */
const DAY_MS = 86_400_000

/** Retention parameters; the only place these numbers exist. */
export const RETENTION = {
  /** Bonus per recall, capped. */
  recallBonusPer: 2,
  /** Cap on the recall bonus. */
  recallBonusMax: 12,
  /** Records newer than this keep the recency bonus. */
  recentDays: 7,
  /** Recency bonus. */
  recentBonus: 18,
  /** Records seen within this window keep the freshness bonus. */
  seenDays: 2,
  /** Freshness bonus. */
  seenBonus: 8,
  /** Age before the age penalty starts. */
  ageGraceDays: 7,
  /** Cap on the age penalty. */
  agePenaltyMax: 80,
  /** Age penalty rate for anchored records. */
  rateAnchor: 0.12,
  /** Age penalty rate for ordinary records. */
  rateNormal: 0.35,
  /** Importance at or above this anchors a record. */
  anchorImportance: 60,
} as const

/** Clarity steps from clearest to gone; a record may only descend one step at a time. */
export const CLARITY_ORDER = ['vivid', 'clear', 'fuzzy', 'trace', 'forgotten'] as const

/** One clarity step. */
export type Clarity = (typeof CLARITY_ORDER)[number]

/** Score thresholds that select a clarity step. */
export const CLARITY_THRESHOLDS = { vivid: 68, clear: 46, fuzzy: 24, trace: 12 } as const

/** Fields retention needs from a memory record. */
export interface MemoryRecord {
  /** Importance computed at write time, 1 to 100. */
  readonly importance: number
  /** Time the record was written, in milliseconds. */
  readonly at: number
  /** Time the record was last recalled, in milliseconds. */
  readonly lastSeenAt: number
  /** How many times the record has been recalled. */
  readonly recallCount: number
}

/** What a conversation looked like when the record was written. */
export interface ImportanceInput {
  /** Private chat with the owner scores higher than a group. */
  scene: 'private' | 'group' | 'platform' | 'self'
  /** Whether the message addressed the bot directly. */
  directed?: boolean
  /** Emotional charge, 0 to 24. */
  emotional?: number
  /** First meeting with this person. */
  firstMeeting?: boolean
  /** A promise or agreement was made. */
  agreement?: boolean
  /** A conflict happened. */
  conflict?: boolean
  /** The record is about the bot itself. */
  self?: boolean
  /** Platform quality score, 0 to 18. */
  platformScore?: number
  /** The owner marked it as favoured. */
  favored?: boolean
  /** Written from diary-style reflection. */
  diary?: boolean
  /** The content was too short to be worth much. */
  tooShort?: boolean
}

/** Clamp an importance value into 1 to 100. */
function clampImportance(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(100, Math.max(1, Math.round(value)))
}

/**
 * Compute importance once, when the record is written.
 * @param input - what the conversation looked like.
 * @returns importance from 1 to 100.
 */
export function initialImportance(input: ImportanceInput): number {
  let score = 8
  if (input.scene === 'private') score += 42
  else if (input.scene === 'group') score += 32
  if (input.directed === true) score += 8
  score += Math.min(24, Math.max(0, Number(input.emotional) || 0))
  if (input.firstMeeting === true) score += 30
  if (input.agreement === true) score += 16
  if (input.conflict === true) score += 14
  if (input.self === true) score += 5
  score += Math.min(18, Math.max(0, Number(input.platformScore) || 0))
  if (input.favored === true) score += 8
  if (input.diary === true) score += 4
  if (input.tooShort === true) score -= 12
  return clampImportance(score)
}

/**
 * Score how much a record is still worth right now.
 * @param record - stored record fields.
 * @param now - current time in milliseconds.
 * @returns retention score; higher means clearer.
 */
export function retention(record: MemoryRecord, now: number): number {
  const at = Number(record.at) || now
  const lastSeenAt = Number(record.lastSeenAt) || at
  const ageDays = Math.max(0, (now - at) / DAY_MS)
  const sinceSeenDays = Math.max(0, (now - lastSeenAt) / DAY_MS)
  const recallCount = Math.max(0, Number(record.recallCount) || 0)
  const importance = Math.max(1, Number(record.importance) || 1)
  const rate = importance >= RETENTION.anchorImportance ? RETENTION.rateAnchor : RETENTION.rateNormal

  let score = importance
  score += Math.min(RETENTION.recallBonusMax, recallCount * RETENTION.recallBonusPer)
  if (ageDays <= RETENTION.recentDays) score += RETENTION.recentBonus
  if (sinceSeenDays <= RETENTION.seenDays) score += RETENTION.seenBonus
  score -= Math.min(RETENTION.agePenaltyMax, Math.max(0, ageDays - RETENTION.ageGraceDays) * rate)
  return score
}

/**
 * Map a retention score to the clarity step it earns.
 * @param score - retention score.
 * @returns the clarity step matching that score.
 */
export function clarityFor(score: number): Clarity {
  if (score >= CLARITY_THRESHOLDS.vivid) return 'vivid'
  if (score >= CLARITY_THRESHOLDS.clear) return 'clear'
  if (score >= CLARITY_THRESHOLDS.fuzzy) return 'fuzzy'
  if (score >= CLARITY_THRESHOLDS.trace) return 'trace'
  return 'forgotten'
}

/**
 * Descend at most one clarity step per sweep, so forgetting feels gradual.
 * @param current - step the record has now.
 * @param computed - step its score would earn.
 * @returns the step to store.
 */
export function stepClarity(current: Clarity, computed: Clarity): Clarity {
  const from = Math.max(0, CLARITY_ORDER.indexOf(current))
  const to = Math.max(0, CLARITY_ORDER.indexOf(computed))
  const held = CLARITY_ORDER[from] ?? 'vivid'
  if (to <= from) return held
  return CLARITY_ORDER[Math.min(to, from + 1)] ?? 'forgotten'
}
