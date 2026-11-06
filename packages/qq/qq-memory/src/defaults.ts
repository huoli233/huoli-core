// 这一包可调的参数只在这里出现一次，别处一律从 Tuning 里取

import {
  IMPORTANCE_DECAY,
  RETENTION,
  type Clarity,
  type DecayParams,
  type RecoverParams,
} from '@huoli/huoli-qq-policy'

/** 可被 Config 覆盖的参数集合 */
export interface Tuning extends DecayParams, RecoverParams {
  /** 重要度到这条线以上算受保护，当天不再衰减 */
  protectLine: number
  /** 放进整串的字数上限，模板与条目一起算 */
  injectMaxChars: number
  /** 一次放进最多几条 */
  injectMaxItems: number
  /** 同一条记忆在最近多少轮内不重复放进 */
  injectRepeatTurns: number
  /** 召回默认取几条 */
  recallLimit: number
  /** 放进时每条只给多少字的底稿，要细节让模型自己看全文 */
  skeletonMaxChars: number
  /** 一次召回总共最多带多少字，默认零表示不限；开了就超预算换更短的 */
  budgetChars: number
  /** 低于这条重要度才算不重要，够格被合并式遗忘 */
  mergeBelow: number
  /** 隔多久才允许她乱想一次 */
  wanderEveryMs: number
  /** 多少天之前的才算旧 */
  mergeAfterDays: number
  /** 核心记忆最多保底几条：她的身份、对方的基本情况不能被挤掉 */
  coreMax: number
  /** 关键词切成几个字一段 */
  gramSize: number
  /** 查询短到几个字以内按短查询判 */
  shortQueryChars: number
  /** 短查询命中几个片段算相关 */
  shortQueryMinHits: number
  /** 长查询命中几个片段算相关 */
  longQueryMinHits: number
  /** 向量路的相似度低于这条线不算候选 */
  minSimilarity: number
  /** 相似度在总分里占多少 */
  weightSim: number
  /** 重要度在总分里占多少 */
  weightImportance: number
  /** 新鲜度在总分里占多少 */
  weightFreshness: number
  /** 星链在总分里占多少：连得多的更容易一起被想起 */
  weightEdge: number
  /** 相隔多久之内的两次写入算同一轮，彼此连一条边 */
  sameTurnWindowMs: number
  /** 新鲜度按几天摊完 */
  freshnessDays: number
  /** 镜像写进来时重要度不低于这条线 */
  selfImportanceFloor: number
  /** 一条待写的正文短过这几个字当噪声，不入队 */
  minTextChars: number
  /** 一条正文长过这几个字要求拆分，不入队 */
  maxTextChars: number
  /** 新写入算出的重要度低于这条线就丢掉，1 到 100 与重要度同刻度 */
  writeMinImportance: number
  /** 待写队列最多压几条，满了先丢最旧的 */
  queueMax: number
  /** 每几轮把队列排空一次 */
  flushEveryTurns: number
  /** 每几轮反思一次 */
  reflectEveryTurns: number
  /** 一次反思最多拿最近几条合成 */
  reflectWindow: number
  /** 反思至少要有几条才值得合成 */
  reflectMinItems: number
  /** 两条正文的相似度到这条线以上算近似重复 */
  nearDuplicateRatio: number
  /** 每天那一行还写不写进健康日志，关掉就一次都不写 */
  healthLog: boolean
  /** 已入队还没写入的条数超过它就在健康一行末尾告警 */
  pendingAlert: number
  /** 受保护条数超过它就在健康一行末尾告警 */
  pinnedAlert: number
  /** 已退役与只剩印象的条数占未退役条数的比例超过它就在健康一行末尾告警 */
  coldRatioAlert: number
  /** 总条数占到上限的这个比例就在健康一行末尾告警，默认 0.8 */
  totalWarnAt: number
  /** 总条数最多留多少条，超过就在末尾报超，默认两万条 */
  totalCap: number
  /** 备份留几份，超出的按最旧先删 */
  backupKeep: number
  /** 性格不变快照拿来找记忆的那句，空串只按重要度与新鲜度挑 */
  snapshotQuery: string
  /** 性格不变快照拿来试放进的那句闲聊，固定问题集在调用方 */
  snapshotSample: string
}

/** 健康一行末尾用的告警阈值 */
export type AlertThresholds = Pick<Tuning, 'pendingAlert' | 'pinnedAlert' | 'coldRatioAlert' | 'totalWarnAt' | 'totalCap'>

/** 全包唯一的默认值表 */
export const DEFAULTS: Tuning = {
  // 每天掉多少、被召回回到哪，与 qq-policy 的公式共用一张表
  ...IMPORTANCE_DECAY,
  // 保护线跟保留度表里那条锚点线是同一条
  protectLine: RETENTION.anchorImportance,
  injectMaxChars: 1200,
  injectMaxItems: 3,
  injectRepeatTurns: 3,
  recallLimit: 3,
  skeletonMaxChars: 40,
  budgetChars: 0,
  mergeBelow: 55,
  mergeAfterDays: 7,
  wanderEveryMs: 10_800_000,
  coreMax: 2,
  gramSize: 2,
  shortQueryChars: 8,
  shortQueryMinHits: 1,
  longQueryMinHits: 2,
  minSimilarity: 0.52,
  weightSim: 0.75,
  weightImportance: 0.15,
  weightFreshness: 0.1,
  weightEdge: 0.15,
  sameTurnWindowMs: 60_000,
  freshnessDays: 7,
  // 镜像进来的事是自我层认定要记住的，落在保护线之上
  selfImportanceFloor: 80,
  minTextChars: 4,
  maxTextChars: 500,
  // 门槛只管新写入：算出来不到这一分的事不值得占掉一条记忆
  writeMinImportance: 10,
  queueMax: 200,
  flushEveryTurns: 4,
  reflectEveryTurns: 10,
  reflectWindow: 6,
  reflectMinItems: 2,
  nearDuplicateRatio: 0.92,
  healthLog: true,
  pendingAlert: 50,
  pinnedAlert: 30,
  coldRatioAlert: 0.5,
  // 占到上限的八成就在健康一行末尾提一句，满了两万条直接报超
  totalWarnAt: 0.8,
  totalCap: 20_000,
  backupKeep: 7,
  // 快照不在这里带问题集：调用方给哪句就试哪句，默认按重要度挑、拿一句闲聊试一下
  snapshotQuery: '',
  snapshotSample: '今天过得怎么样？',
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
