// 一轮回几条：只看事实给个下限与上限，不说该不该回

/** 定下限与上限要看的事实，除精力外都是往上加的量 */
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
  /** 惊吓，零到一，没接上按零算 */
  fear?: number
  /** 存在性恐惧，零到一，没接上按零算 */
  dread?: number
  /** 担心，零到一，没接上按零算 */
  worry?: number
  /** 愤怒，零到一，没接上按零算 */
  anger?: number
  /** 记恨，零到一，没接上按零算 */
  resentment?: number
}

/** 分档要用的参数 */
export interface ReplyTuning {
  /** 条数下限，默认 1，最少也要说一句；上限与下限都不低于它 */
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
  /** 惊吓或存在性恐惧过线时把上限压到几条，默认 2 */
  fearCapMax: number
  /** 惊吓高于这条线要收着说，零到一，默认 0.50 */
  fearAbove: number
  /** 存在性恐惧高于这条线要收着说，零到一，默认 0.65 */
  dreadAbove: number
  /** 担心过线时上限抬几条，默认 1，担心对方就会多问一句 */
  worryBonus: number
  /** 担心高于这条线算惦记着，零到一，默认 0.60 */
  worryAbove: number
  /** 愤怒过线时把上限压到几条，默认 2 */
  angerCap: number
  /** 愤怒高于这条线算在气头上，零到一，默认 0.50 */
  angerCapAbove: number
  /** 愤怒高于这条线只剩一句，零到一，默认 0.75 */
  angerOneAbove: number
  /** 记恨高于这条线只剩一句，零到一，默认 0.50 */
  resentOneAbove: number
  /** 只剩一句时的那一句，默认 1 */
  oneMax: number
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
  fearCapMax: 2,
  fearAbove: 0.50,
  dreadAbove: 0.65,
  worryBonus: 1,
  worryAbove: 0.60,
  angerCap: 2,
  angerCapAbove: 0.50,
  angerOneAbove: 0.75,
  resentOneAbove: 0.50,
  oneMax: 1,
}

/** 分档表的一行 */
export interface ReplyTier {
  /** 这一档的名字 */
  name: string
  /** 命中这一档时这一轮最多几条 */
  cap: number
  /** 命中这一档时这一轮最少几条 */
  floor: number
  /** 命中这一档的判据 */
  hit(facts: ReplyFacts, tuning: ReplyTuning): boolean
}

/** 平常那一档：别的档都不命中时就落在它上面，下限一条、上限两条 */
const PLAIN_TIER: ReplyTier = {
  name: '平常',
  cap: 2,
  floor: 1,
  hit: () => true,
}

/** 分档表：从上往下取第一条命中的，又累又烦最紧，特别黏又孤独最松 */
export const REPLY_TIERS: readonly ReplyTier[] = [
  {
    name: '又累又烦',
    cap: 1,
    floor: 1,
    hit: (facts, tuning) => facts.tired >= tuning.tiredFrom && facts.annoyed >= tuning.annoyedFrom,
  },
  {
    name: '烦',
    cap: 2,
    floor: 1,
    hit: (facts, tuning) => facts.annoyed >= tuning.annoyedFrom,
  },
  {
    name: '累',
    cap: 2,
    floor: 1,
    hit: (facts, tuning) => facts.tired >= tuning.tiredFrom,
  },
  {
    name: '特别黏又孤独',
    cap: 4,
    floor: 3,
    hit: (facts, tuning) => facts.clingy >= tuning.clingyStrongFrom && facts.lonely >= tuning.lonelyFrom,
  },
  {
    name: '有劲又想黏',
    cap: 3,
    floor: 2,
    hit: (facts, tuning) => facts.energy >= tuning.energyEagerFrom && facts.clingy >= tuning.clingyFrom,
  },
  PLAIN_TIER,
]

/** 一轮最少说几条与最多说几条 */
export interface ReplyRange {
  /** 这一轮最少几条，永不超过 max */
  min: number
  /** 这一轮最多几条 */
  max: number
}

// 从上往下取第一条命中的那一档
function tierOf(facts: ReplyFacts, tuning: ReplyTuning): ReplyTier {
  return REPLY_TIERS.find(tier => tier.hit(facts, tuning)) ?? PLAIN_TIER
}

// 一档的上限夹到配置的上下限里
function capped(tier: ReplyTier, tuning: ReplyTuning): number {
  return Math.min(tuning.maxCap, Math.max(tuning.minCap, tier.cap))
}

// 分档给出上限之后，按惊吓、担心、愤怒、记恨再压或再抬一把，顺序照文档
function hardened(max: number, facts: ReplyFacts, tuning: ReplyTuning): number {
  const fear = facts.fear ?? 0
  const anger = facts.anger ?? 0
  let kept = max
  if (fear > tuning.fearAbove || (facts.dread ?? 0) > tuning.dreadAbove) kept = Math.min(kept, tuning.fearCapMax)
  if ((facts.worry ?? 0) > tuning.worryAbove) kept = Math.min(tuning.maxCap, kept + tuning.worryBonus)
  if (anger > tuning.angerCapAbove) kept = Math.min(kept, tuning.angerCap)
  if (anger > tuning.angerOneAbove || (facts.resentment ?? 0) > tuning.resentOneAbove) kept = tuning.oneMax
  return Math.min(tuning.maxCap, Math.max(tuning.minCap, kept))
}

/**
 * 这一轮最多说几条：只给上限，具体回几句由模型自己定
 * @param facts - 累、烦、精力、黏、孤独
 * @param tuning - 分档参数，不给就用默认表
 * @returns 一到四之间的上限
 */
export function replyBudget(facts: ReplyFacts, tuning: ReplyTuning = REPLY_DEFAULTS): number {
  return hardened(capped(tierOf(facts, tuning), tuning), facts, tuning)
}

/**
 * 这一轮说几条：上限沿用 `replyBudget`，下限按同一档给出，累或烦时不抬下限
 * @param facts - 累、烦、精力、黏、孤独，以及惊吓、存在性恐惧、担心、愤怒、记恨
 * @param tuning - 分档参数，不给就用默认表
 * @returns 下限与上限，下限永不超过上限
 */
export function replyRange(facts: ReplyFacts, tuning: ReplyTuning = REPLY_DEFAULTS): ReplyRange {
  const tier = tierOf(facts, tuning)
  const max = hardened(capped(tier, tuning), facts, tuning)
  return { min: Math.min(max, Math.max(tuning.minCap, tier.floor)), max }
}
