// 重要度每天掉多少、被召回回到哪：公式与默认值只在这里，别处照它算

/** 每日衰减的参数，默认值见 IMPORTANCE_DECAY */
export interface DecayParams {
  /** 一天的基础跌幅（分） */
  decayBase: number
  /** 显著度打到高分档的重要度下限 */
  salienceHighAt: number
  /** 显著度打到中分档的重要度下限 */
  salienceMidAt: number
  /** 高显著度的跌幅倍数 */
  salienceHigh: number
  /** 中显著度的跌幅倍数 */
  salienceMid: number
  /** 低显著度的跌幅倍数 */
  salienceLow: number
  /** 每被召回一次减掉多少跌幅 */
  reviewStep: number
  /** 跌幅减到不再变少的召回次数 */
  reviewCap: number
  /** 情绪把跌幅放大的倍数 */
  emotionGain: number
  /** 单日跌幅上限（分） */
  decayDailyCap: number
  /** 重要度地板（分） */
  importanceFloor: number
}

/** 召回回升的参数 */
export interface RecoverParams {
  /** 被召回一次回升多少分 */
  recallRecover: number
  /** 回升的最高点 */
  recoverCeiling: number
  /** 同一天最多回升几次 */
  recoverPerDay: number
}

/** 算一天跌幅要的三个输入 */
export interface DecayInput {
  /** 现在的重要度 */
  importance: number
  /** 被召回过的次数 */
  recallCount: number
  /** 情绪强度，0 到 1 */
  emotional: number
}

/** 重要度衰减与召回回升的默认值，全仓只此一处 */
export const IMPORTANCE_DECAY: DecayParams & RecoverParams = {
  decayBase: 0.8,
  salienceHighAt: 70,
  salienceMidAt: 40,
  salienceHigh: 1.6,
  salienceMid: 1.25,
  salienceLow: 1,
  reviewStep: 0.15,
  reviewCap: 4,
  emotionGain: 0.4,
  decayDailyCap: 3,
  importanceFloor: 5,
  recallRecover: 2,
  recoverCeiling: 68,
  recoverPerDay: 1,
}

/**
 * 重要度只记到一位小数，每天掉的那点分能累到下一次
 * @param value - 想记的值
 * @returns 记到一位小数的值
 */
export function quantizeImportance(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.round(value * 10) / 10
}

// 夹到 0 到 1，越界的输入按边界算
function unit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

// 重要度越高，跌幅倍数越大
function salienceOf(importance: number, params: DecayParams): number {
  if (importance >= params.salienceHighAt) return params.salienceHigh
  if (importance >= params.salienceMidAt) return params.salienceMid
  return params.salienceLow
}

/**
 * 算这一天的跌幅速率
 * @param input - 重要度、召回次数、情绪强度
 * @param params - 衰减参数
 * @returns 速率，单位是分／天
 */
export function importanceDecayRate(input: DecayInput, params: DecayParams = IMPORTANCE_DECAY): number {
  const reviewBase = 1 - params.reviewStep * Math.min(Math.max(0, input.recallCount), params.reviewCap)
  const emotion = 1 + params.emotionGain * unit(input.emotional)
  return params.decayBase * salienceOf(input.importance, params) * Math.max(0, reviewBase) * emotion
}

/**
 * 算这一天实际掉多少分：受保护的不动，单日跌幅封顶
 * @param input - 重要度、召回次数、情绪强度
 * @param protectImportance - 保护线，重要度到这里就不再衰减
 * @param params - 衰减参数
 * @returns 掉的分数，0 表示不动
 */
export function importanceDailyDrop(
  input: DecayInput,
  protectImportance: number,
  params: DecayParams = IMPORTANCE_DECAY,
): number {
  if (input.importance >= protectImportance) return 0
  return Math.min(importanceDecayRate(input, params), params.decayDailyCap)
}

/**
 * 掉完之后的重要度，不低于地板
 * @param importance - 现在的重要度
 * @param drop - 这一天的跌幅
 * @param floor - 地板
 * @returns 掉完之后的重要度
 */
export function importanceAfterDrop(importance: number, drop: number, floor: number): number {
  const left = Math.max(0, importance - drop)
  return quantizeImportance(Math.max(floor, left))
}

/**
 * 被召回一次之后的重要度，回升不越过保护线也不压低现值
 * @param importance - 现在的重要度
 * @param protectImportance - 保护线，回升不能把它抬成保护对象
 * @param params - 回升参数
 * @returns 回升之后的重要度
 */
export function importanceAfterRecall(
  importance: number,
  protectImportance: number,
  params: RecoverParams = IMPORTANCE_DECAY,
): number {
  const ceiling = Math.max(1, Math.min(100, params.recoverCeiling, protectImportance - 1))
  const raised = Math.min(ceiling, importance + Math.max(0, params.recallRecover))
  return quantizeImportance(Math.max(importance, raised))
}
