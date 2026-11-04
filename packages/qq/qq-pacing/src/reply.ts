// 一轮回几条：只看事实给个上限，不说该不该回

/** 定上限要看的事实，除精力外都是往上加的量 */
export interface ReplyFacts {
  /** 累，零到一，取睡眠压力 */
  tired: number
  /** 烦，零到一，取易怒 */
  annoyed: number
  /** 精力，零到一 */
  energy: number
  /** 黏，零到一 */
  clingy: number
  /** 孤独，零到一 */
  lonely: number
}

/** 分档要用的参数 */
export interface ReplyTuning {
  /** 下限，默认 1，最少也要说一句 */
  minCap: number
  /** 上限，默认 4 */
  maxCap: number
  /** 烦高于这条线就不再往下给，零到一，默认 0.62 */
  annoyedFrom: number
  /** 累高于这条线就少说两句，零到一，默认 0.70 */
  tiredFrom: number
  /** 精力高于这条线算有劲，零到一，默认 0.60 */
  energyEagerFrom: number
  /** 黏高于这条线算想黏人，零到一，默认 0.62 */
  clingyFrom: number
  /** 黏高于这条线算特别黏，零到一，默认 0.78 */
  clingyStrongFrom: number
  /** 孤独高于这条线算空，零到一，默认 0.50 */
  lonelyFrom: number
}

/** 分档表的默认参数 */
export const REPLY_DEFAULTS: ReplyTuning = {
  minCap: 1,
  maxCap: 4,
  annoyedFrom: 0.62,
  tiredFrom: 0.70,
  energyEagerFrom: 0.60,
  clingyFrom: 0.62,
  clingyStrongFrom: 0.78,
  lonelyFrom: 0.50,
}

/** 分档表的一行 */
export interface ReplyTier {
  /** 这一档的名字 */
  name: string
  /** 命中这一档时这一轮最多几条 */
  cap: number
  /** 命中这一档的判据 */
  hit(facts: ReplyFacts, tuning: ReplyTuning): boolean
}

/** 分档表：从上往下取第一条命中的，又累又烦最紧，特别黏又孤独最松 */
export const REPLY_TIERS: readonly ReplyTier[] = [
  {
    name: '又累又烦',
    cap: 1,
    hit: (facts, tuning) => facts.tired >= tuning.tiredFrom && facts.annoyed >= tuning.annoyedFrom,
  },
  {
    name: '烦',
    cap: 2,
    hit: (facts, tuning) => facts.annoyed >= tuning.annoyedFrom,
  },
  {
    name: '累',
    cap: 2,
    hit: (facts, tuning) => facts.tired >= tuning.tiredFrom,
  },
  {
    name: '特别黏又孤独',
    cap: 4,
    hit: (facts, tuning) => facts.clingy >= tuning.clingyStrongFrom && facts.lonely >= tuning.lonelyFrom,
  },
  {
    name: '有劲又想黏',
    cap: 3,
    hit: (facts, tuning) => facts.energy >= tuning.energyEagerFrom && facts.clingy >= tuning.clingyFrom,
  },
  {
    name: '平常',
    cap: 2,
    hit: () => true,
  },
]

/**
 * 这一轮最多说几条：只给上限，具体回几句由模型自己定
 * @param facts - 累、烦、精力、黏、孤独
 * @param tuning - 分档参数，不给就用默认表
 * @returns 一到四之间的上限
 */
export function replyBudget(facts: ReplyFacts, tuning: ReplyTuning = REPLY_DEFAULTS): number {
  let cap = tuning.maxCap
  for (const tier of REPLY_TIERS) {
    if (!tier.hit(facts, tuning)) continue
    cap = tier.cap
    break
  }
  return Math.min(tuning.maxCap, Math.max(tuning.minCap, cap))
}
