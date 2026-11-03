// 收尾装配入口：这段收在哪、下次怎么接、事后想到什么

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { evaluateOutcome, type CloseInput, type CloseNote, type Outcome, type Reflection } from './close.ts'
import { createContinuityStore, type ContinuityStore } from './store.ts'
import { registerContinuityTools } from './tools.ts'

export type { CloseInput, CloseNote, Outcome, Reflection } from './close.ts'
export { describeOutcome, evaluateOutcome, suggestNote, MIN_RUN_MS, NOTE_MAX_CHARS } from './close.ts'
export type { ContinuityStore, ContinuityStoreOptions } from './store.ts'

/** 一个应用里的收尾 */
export interface QqContinuitySeam {
  store: ContinuityStore
  close(input: CloseInput): CloseNote
  resume(chatKey: string): string
  judge(messages: Array<{ self?: boolean; at: number }>): Outcome
  history(chatKey: string, limit?: number): Reflection[]
}

/** 这一行接受的配置 */
export interface Config {
  /** 收尾记录放哪，不填就用主目录下的 data */
  file?: string
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
}

const seams = new WeakMap<Context, QqContinuitySeam>()

/**
 * 取收尾，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqContinuityOf(ctx: Context): QqContinuitySeam | undefined {
  return seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-continuity'

/** 要用的内核接口 */
export const inject = ['tools']

/**
 * 装配收尾与回想
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const file = config.file ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-continuity.json')
  const store = createContinuityStore({ file })

  const seam: QqContinuitySeam = {
    store,
    close(input) {
      return store.close(input)
    },
    resume(chatKey) {
      const note = store.lastClose(chatKey)
      if (note === undefined) return ''
      const when = new Date(note.closedAt).toLocaleString('zh-CN', { hour12: false })
      const parts = [`上次聊到 ${when}`]
      if (note.summary !== '') parts.push(`收在：${note.summary}`)
      if (note.nextOpening !== '') parts.push(`下次可以：${note.nextOpening}`)
      return parts.join('｜')
    },
    judge(messages) {
      return evaluateOutcome(messages, Date.now())
    },
    history(chatKey, limit) {
      return store.reflections(chatKey, limit)
    },
  }
  seams.set(ctx, seam)

  registerContinuityTools(ctx, { store })

  // 卸载时落一次盘
  ctx.effect(() => () => {
    store.flush()
    seams.delete(ctx)
  })
}
