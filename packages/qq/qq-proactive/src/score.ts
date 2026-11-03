// 主动开口：先攒理由，再打分，再过闸门，最后**先给你看**再发

/** 一个想说话的理由 */
export interface Candidate {
  id: string
  kind: 'share' | 'ask' | 'join' | 'greet'
  why: string
  text: string
  confidence: number
  value: number
  risk: number
  source: string
}

/** 打分后的样子 */
export interface ScoredCandidate extends Candidate {
  score: number
}

/** 闸门给的结果 */
export interface GateVerdict {
  ok: boolean
  code?: string
  reason?: string
  retryAt?: number
}

/** 一次主动开口的完整样子 */
export interface PendingItem {
  id: string
  chatKey: string
  text: string
  why: string
  score: number
  createdAt: number
  expiresAt: number
}

/** 打分时用的当下的劲头 */
export interface Drives {
  bored: number
  curious: number
  lonely: number
}

/** 闸门要看的配置 */
export interface GateConfig {
  enabled: boolean
  quietStart: string
  quietEnd: string
  dailyMax: number
  gapMinMs: number
  gapMaxMs: number
  pendingTtlMs: number
}

/** 默认保守档 */
export const PROACTIVE_DEFAULTS: GateConfig = {
  enabled: false,
  quietStart: '23:30',
  quietEnd: '08:30',
  dailyMax: 4,
  gapMinMs: 150 * 60_000,
  gapMaxMs: 300 * 60_000,
  pendingTtlMs: 14 * 86_400_000,
}

/**
 * 打分：把握大、有用、风险小的分高
 * @param candidate - 一条候选
 * @param drives - 当下的劲头
 * @returns 算出来的数
 */
export function scoreCandidate(candidate: Candidate, drives: Drives): number {
  const base = 0.55 + 0.7 * candidate.confidence + 0.35 * candidate.value - 0.25 * candidate.risk
  const driveBoost = 0.65 + 0.55 * Math.max(drives.bored, drives.curious, drives.lonely)
  return Math.max(0, base * driveBoost)
}

/**
 * 把候选按分排好
 * @param candidates - 若干候选
 * @param drives - 当下的劲头
 * @returns 处理结果
 */
export function rankCandidates(candidates: readonly Candidate[], drives: Drives): ScoredCandidate[] {
  return candidates
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, drives) }))
    .sort((a, b) => b.score - a.score)
}

/**
 * 两条候选说的是不是一回事
 * @param a - 左边那份
 * @param b - 右边那份
 * @returns 是或不是
 */
export function sameThing(a: string, b: string): boolean {
  const left = a.replace(/\s+/g, '')
  const right = b.replace(/\s+/g, '')
  if (left === right) return true
  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  if (shorter.length < 4) return false
  return longer.includes(shorter.slice(0, Math.max(4, Math.floor(shorter.length * 0.6))))
}

/**
 * 去掉说过的和重复的
 * @param candidates - 若干候选
 * @param history - 说过的话
 * @returns 处理结果
 */
export function dropRepeats(candidates: readonly ScoredCandidate[], history: readonly string[]): ScoredCandidate[] {
  const kept: ScoredCandidate[] = []
  for (const candidate of candidates) {
    if (history.some((old) => sameThing(old, candidate.text))) continue
    if (kept.some((already) => sameThing(already.text, candidate.text))) continue
    kept.push(candidate)
  }
  return kept
}
