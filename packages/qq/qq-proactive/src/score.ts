// 主动开口：只把候选的理由与原始事实摆出来，说不说、说哪条由模型定

/** 一条想说话的理由，字段都是候选自己带上来的事实 */
export interface Candidate {
  id: string
  kind: 'share' | 'ask' | 'join' | 'greet'
  why: string
  text: string
  /** 候选自己声明的把握，没人声明时就没有这一项，不补默认数 */
  confidence?: number
  /** 同上，候选自己声明的有用程度 */
  value?: number
  /** 同上，候选自己声明的风险 */
  risk?: number
  /** 这条理由从哪里来，只做溯源用 */
  source: string
  /** 到达时刻，只用来排先后 */
  at: number
}

/** 候选带上来的原始事实，原样存着给模型看 */
export interface CandidateFacts {
  kind: Candidate['kind']
  /** 候选没声明把握时这一项为空 */
  confidence?: number
  /** 候选没声明有用程度时这一项为空 */
  value?: number
  /** 候选没声明风险时这一项为空 */
  risk?: number
  source: string
  at: number
}

/** 闸门给的结果 */
export interface GateVerdict {
  ok: boolean
  code?: string
  reason?: string
  retryAt?: number
}

/** 攒住的一条，等模型决定要不要说 */
export interface PendingItem {
  id: string
  chatKey: string
  text: string
  why: string
  facts: CandidateFacts
  createdAt: number
  expiresAt: number
}

/** 闸门要看的配置 */
export interface GateConfig {
  enabled: boolean
  quietStart: string
  quietEnd: string
  dailyMax: number
  /** 一天至少留几次开口，劲头再低也不低于这个数 */
  dailyFloor: number
  /** 冷却区间下限 */
  gapMinMs: number
  /** 冷却区间上限，下一次可开口时刻取区间中点 */
  gapMaxMs: number
  /** 劲头低于这个数就按这个数算，免得间隔被拉得没边 */
  biasFloor: number
  /** 正忙时多久再看 */
  busyRetryMs: number
  /** 有人在聊时多久再看 */
  talkingRetryMs: number
  pendingTtlMs: number
}

/** 默认保守档 */
export const PROACTIVE_DEFAULTS: GateConfig = {
  enabled: false,
  quietStart: '23:30',
  quietEnd: '08:30',
  dailyMax: 4,
  dailyFloor: 1,
  gapMinMs: 150 * 60_000,
  gapMaxMs: 300 * 60_000,
  biasFloor: 0.2,
  busyRetryMs: 60_000,
  talkingRetryMs: 5 * 60_000,
  pendingTtlMs: 14 * 86_400_000,
}

/**
 * 按到达时间排先后，同一时刻保持传进来的顺序
 * @param candidates - 若干候选
 * @returns 排好的候选
 */
export function orderByArrival(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => a.at - b.at)
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
 * 去掉说过的和重复的，只删不加
 * @param candidates - 若干候选
 * @param history - 说过的话
 * @returns 剩下的候选
 */
export function dropRepeats(candidates: readonly Candidate[], history: readonly string[]): Candidate[] {
  const kept: Candidate[] = []
  for (const candidate of candidates) {
    if (history.some(old => sameThing(old, candidate.text))) continue
    if (kept.some(already => sameThing(already.text, candidate.text))) continue
    kept.push(candidate)
  }
  return kept
}
