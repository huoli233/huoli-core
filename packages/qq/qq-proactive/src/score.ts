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
  /** 想发动态的读数，外部候选带上来时才有，这里不重算也不比较 */
  postWant?: number
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
  /** 候选没带想发动态的读数时这一项为空 */
  postWant?: number
  source: string
  at: number
}

/** 关卡给的结果 */
export interface GateVerdict {
  ok: boolean
  code?: string
  reason?: string
  /** 下一步怎么办，只给方向，不改写内容也不代说 */
  hint?: string
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

/** 关卡要看的配置 */
export interface GateConfig {
  enabled: boolean
  quietStart: string
  quietEnd: string
  /** 一天最多开口几次，写死的上限，不由身体读数改 */
  dailyMax: number
  /** 旧配置，判定不再读它 */
  dailyFloor: number
  /** 冷却区间下限 */
  gapMinMs: number
  /** 冷却区间上限，下一次可开口时刻取区间中点 */
  gapMaxMs: number
  /** 旧配置，判定不再读它 */
  biasMin: number
  /** 旧配置，判定不再读它 */
  biasMax: number
  /** 旧配置，判定不再读它 */
  wakingDelayMs: number
  /** 正忙时多久再看 */
  busyRetryMs: number
  /** 旧配置，判定不再读它 */
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
  biasMin: 0.2,
  biasMax: 2.5,
  wakingDelayMs: 10 * 60_000,
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
