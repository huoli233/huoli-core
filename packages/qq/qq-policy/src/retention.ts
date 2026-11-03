// 记忆保留度与清晰度：重要度写入时算一次，这里只算还能剩多少

const DAY_MS = 86_400_000

// 保留度参数，全仓只此一处
export const RETENTION = {
  recallBonusPer: 2,
  recallBonusMax: 12,
  recentDays: 7,
  recentBonus: 18,
  seenDays: 2,
  seenBonus: 8,
  ageGraceDays: 7,
  agePenaltyMax: 80,
  rateAnchor: 0.12,
  rateNormal: 0.35,
  anchorImportance: 60,
} as const

// 清晰度五档，只许一档一档降
export const CLARITY_ORDER = ['vivid', 'clear', 'fuzzy', 'trace', 'forgotten'] as const

export type Clarity = (typeof CLARITY_ORDER)[number]

// 分数落到哪一档
export const CLARITY_THRESHOLDS = { vivid: 68, clear: 46, fuzzy: 24, trace: 12 } as const

// 算保留度需要的字段
export interface MemoryRecord {
  importance: number
  at: number
  lastSeenAt: number
  recallCount: number
}

// 写入时看得见的上下文
export interface ImportanceInput {
  scene: 'private' | 'group' | 'platform' | 'self'
  directed?: boolean
  emotional?: number
  firstMeeting?: boolean
  agreement?: boolean
  conflict?: boolean
  self?: boolean
  platformScore?: number
  favored?: boolean
  diary?: boolean
  tooShort?: boolean
}

// 夹到 1 到 100
function clampImportance(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(100, Math.max(1, Math.round(value)))
}

// 写入时算一次重要度
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

// 算这条记忆此刻还剩多少分量
export function retention(record: MemoryRecord, now: number): number {
  // 时间可能是 0（很久以前），不能拿它当没填
  const atRaw = Number(record.at)
  const at = Number.isFinite(atRaw) ? atRaw : now
  const seenRaw = Number(record.lastSeenAt)
  const lastSeenAt = Number.isFinite(seenRaw) ? seenRaw : at
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

// 分数换成清晰度那一档
export function clarityFor(score: number): Clarity {
  if (score >= CLARITY_THRESHOLDS.vivid) return 'vivid'
  if (score >= CLARITY_THRESHOLDS.clear) return 'clear'
  if (score >= CLARITY_THRESHOLDS.fuzzy) return 'fuzzy'
  if (score >= CLARITY_THRESHOLDS.trace) return 'trace'
  return 'forgotten'
}

// 一次只降一档，忘得才像人
export function stepClarity(current: Clarity, computed: Clarity): Clarity {
  const from = Math.max(0, CLARITY_ORDER.indexOf(current))
  const to = Math.max(0, CLARITY_ORDER.indexOf(computed))
  const held = CLARITY_ORDER[from] ?? 'vivid'
  if (to <= from) return held
  return CLARITY_ORDER[Math.min(to, from + 1)] ?? 'forgotten'
}
