// 这一包可调的参数只在这里出现一次，别处一律从 Tuning 里取

import { RETENTION, type Clarity } from '@huoli/huoli-qq-policy'

/** 可被 Config 覆盖的参数集合 */
export interface Tuning {
  /** 重要度到这条线以上算受保护 */
  protectLine: number
  /** 注入整串的字数上限，模板与条目一起算 */
  injectMaxChars: number
  /** 一次注入最多几条 */
  injectMaxItems: number
  /** 同一条记忆在最近多少轮内不重复注入 */
  injectRepeatTurns: number
  /** 召回默认取几条 */
  recallLimit: number
  /** 关键词切成几个字一段 */
  gramSize: number
  /** 查询短到几个字以内按短查询判 */
  shortQueryChars: number
  /** 短查询命中几个片段算相关 */
  shortQueryMinHits: number
  /** 长查询命中几个片段算相关 */
  longQueryMinHits: number
  /** 相似度在总分里占多少 */
  weightSim: number
  /** 重要度在总分里占多少 */
  weightImportance: number
  /** 新鲜度在总分里占多少 */
  weightFreshness: number
  /** 新鲜度按几天摊完 */
  freshnessDays: number
  /** 镜像写进来时重要度不低于这条线 */
  selfImportanceFloor: number
}

/** 全包唯一的默认值表 */
export const DEFAULTS: Tuning = {
  // 保护线跟保留度表里那条锚点线是同一条
  protectLine: RETENTION.anchorImportance,
  injectMaxChars: 1200,
  injectMaxItems: 3,
  injectRepeatTurns: 1,
  recallLimit: 3,
  gramSize: 2,
  shortQueryChars: 8,
  shortQueryMinHits: 1,
  longQueryMinHits: 2,
  weightSim: 0.75,
  weightImportance: 0.15,
  weightFreshness: 0.1,
  freshnessDays: 7,
  // 镜像进来的事是自我层认定要记住的，落在保护线之上
  selfImportanceFloor: 80,
}

/** 截断时清晰度的分量，越清楚越靠前 */
export const CLARITY_WEIGHT: Record<Clarity, number> = {
  vivid: 4,
  clear: 3,
  fuzzy: 2,
  trace: 0,
  forgotten: 0,
}

/**
 * 把配置里的覆盖项合到默认值上
 * @param override - 调用方给的覆盖项
 * @returns 合并后的参数
 */
export function resolveTuning(override?: Partial<Tuning>): Tuning {
  return override === undefined ? DEFAULTS : { ...DEFAULTS, ...override }
}
