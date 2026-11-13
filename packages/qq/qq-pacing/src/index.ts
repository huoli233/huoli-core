// 说话装配入口：一段话先拆开、量够不够、记一笔

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { createPacingStore, type PacingStore } from './store.ts'
import { resolveQuotaLimits, resolveVoiceLimits, splitSpeech, PACING_DEFAULTS, type PacingVerdict, type PlannedSpeech, type QuotaUse, type VoiceLimits } from './plan.ts'

export type { PacingVerdict, PlannedSpeech, QuotaUse, SplitBudget, QuotaLimits, GapTuning, RandomSource, SpeechGapOptions, VoiceLimits, QuotaKind, QuotaReading, QuotaCeiling } from './plan.ts'
export { splitSpeech, splitByBudget, speechGaps, dayKey, hourKey, PACING_DEFAULTS, quotaVerdict, nextHourAt, nextDayAt, resolveQuotaLimits, resolveGapTuning, resolveVoiceLimits, seededRandom } from './plan.ts'
export { SEMANTIC_DEFAULTS, resolveSemanticSplit, splitSemantically } from './semantic.ts'
export type { SemanticSplit } from './semantic.ts'
export { replyBudget, replyRange, REPLY_DEFAULTS, REPLY_TIERS } from './reply.ts'
export type { ReplyFacts, ReplyRange, ReplyTier, ReplyTuning } from './reply.ts'
export type { PacingStore, PacingFixedClockOptions, PacingStoreOptions } from './store.ts'
export { createPacingStore } from './store.ts'

/** 一个应用里的记录仓 */
export interface QqPacingSeam {
  store: PacingStore
  plan(text: string): PlannedSpeech
  allow(text: string): PacingVerdict
  spend(text: string): QuotaUse
  used(): QuotaUse
  /** 当前配置的小时与每日上限 */
  limits(): { perHour: number; perDay: number }
  /** 现在能不能发一段语音，这本账与文本分开算 */
  voiceAllow(): PacingVerdict
  /** 真发出去一段语音之后记一笔 */
  voiceSpend(): QuotaUse
  /** 语音那本账的当前读数 */
  voiceUsed(): QuotaUse
  /** 发语音前要过的时长与字节上限 */
  voiceLimits(): VoiceLimits
}

/** 这一行接受的配置 */
export interface Config {
  /** 记录文件放哪，不填就用主目录下的 data */
  file?: string
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 一段话最多拆几条 */
  maxParts?: number
  /** 每条最多几个字 */
  maxCharsPerPart?: number
  /** 一小时最多说几句 */
  perHour?: number
  /** 一天最多说几句 */
  perDay?: number
  /** 一小时最多发几段语音，与文本额度分开算 */
  voicePerHour?: number
  /** 一天最多发几段语音 */
  voicePerDay?: number
  /** 一段语音最多几秒 */
  voiceMaxSeconds?: number
  /** 一段语音最多多少字节 */
  voiceMaxBytes?: number
  /** 认不出音频格式时按多少字节一秒估时长 */
  voiceBytesPerSecond?: number
  /** 同一句隔多久才算说旧了 */
  repeatWindowMs?: number
  /** 留最近几句用来认重复 */
  recentKeep?: number
}

const seams = new WeakMap<Context, QqPacingSeam>()

/**
 * 取记一笔仓，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqPacingOf(ctx: Context): QqPacingSeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-pacing'

/** 不需要别的内核服务 */
export const inject: string[] = []

/**
 * 装配说话规矩
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const file = config.file ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-pacing.json')
  const maxParts = Math.max(1, config.maxParts ?? PACING_DEFAULTS.maxParts)
  const maxCharsPerPart = Math.max(20, config.maxCharsPerPart ?? PACING_DEFAULTS.maxCharsPerPart)
  const limits = resolveQuotaLimits(config)
  const voiceLimits = resolveVoiceLimits({
    ...config.voiceMaxSeconds === undefined ? {} : { maxSeconds: config.voiceMaxSeconds },
    ...config.voiceMaxBytes === undefined ? {} : { maxBytes: config.voiceMaxBytes },
    ...config.voiceBytesPerSecond === undefined ? {} : { bytesPerSecond: config.voiceBytesPerSecond },
  })
  const store = createPacingStore({ file, limits })

  const seam: QqPacingSeam = {
    store,
    plan(text) {
      return splitSpeech(text, { maxParts, maxCharsPerPart })
    },
    allow(text) {
      return store.check(text)
    },
    spend(text) {
      return store.record(text)
    },
    used() {
      return store.used()
    },
    limits() {
      return { perHour: limits.perHour, perDay: limits.perDay }
    },
    voiceAllow() {
      return store.voiceCheck()
    },
    voiceSpend() {
      return store.voiceRecord()
    },
    voiceUsed() {
      return store.voiceUsed()
    },
    voiceLimits() {
      return voiceLimits
    },
  }
  seams.set(ctx.root, seam)

  // 卸载时落一次盘
  ctx.effect(() => () => {
    store.flush()
    seams.delete(ctx.root)
  })
}
