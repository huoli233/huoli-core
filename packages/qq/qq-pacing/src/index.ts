// 说话装配入口：一段话先拆开、量够不够、记一笔

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import '@huoli/huoli-agent'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { createPacingStore, type PacingStore } from './store.ts'
import { splitSpeech, PACING_DEFAULTS, type PacingVerdict, type PlannedSpeech, type QuotaUse } from './plan.ts'

export type { PacingVerdict, PlannedSpeech, QuotaUse, SplitBudget } from './plan.ts'
export { splitSpeech, splitByBudget, speechGaps, dayKey, hourKey, PACING_DEFAULTS } from './plan.ts'
export { replyBudget, REPLY_DEFAULTS, REPLY_TIERS } from './reply.ts'
export type { ReplyFacts, ReplyTier, ReplyTuning } from './reply.ts'
export type { PacingStore, PacingStoreOptions } from './store.ts'

/** 一个应用里的记账仓 */
export interface QqPacingSeam {
  store: PacingStore
  plan(text: string): PlannedSpeech
  allow(text: string): PacingVerdict
  spend(text: string): QuotaUse
  used(): QuotaUse
  resetTurn(): void
}

/** 这一行接受的配置 */
export interface Config {
  /** 记账文件放哪，不填就用主目录下的 data */
  file?: string
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 一段话最多拆几条 */
  maxParts?: number
  /** 每条最多几个字 */
  maxCharsPerPart?: number
}

const seams = new WeakMap<Context, QqPacingSeam>()

/**
 * 取记账仓，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqPacingOf(ctx: Context): QqPacingSeam | undefined {
  return seams.get(ctx)
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
  const store = createPacingStore({ file })

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
    resetTurn() {
      store.resetTurn()
    },
  }
  seams.set(ctx, seam)

  // 每轮开始时把这一轮已经说了几条清零
  ctx.on('agent/pre-step', (payload, next) => {
    if (payload.step === 1) store.resetTurn()
    return next()
  })

  // 卸载时落一次盘
  ctx.effect(() => () => {
    store.flush()
    seams.delete(ctx)
  })
}
