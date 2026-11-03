// 主动开口装配入口：攒理由、打分、过闸门、先给你看，再发

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import {
  dropRepeats,
  rankCandidates,
  PROACTIVE_DEFAULTS,
  type Candidate,
  type Drives,
  type GateVerdict,
  type PendingItem,
  type ScoredCandidate,
} from './score.ts'
import { runGates, type GateInput } from './gates.ts'
import { createPendingStore, createTimingStore, PENDING_TTL_MS, type PendingStore, type TimingStore } from './store.ts'

export type { Candidate, Drives, GateVerdict, PendingItem, ScoredCandidate } from './score.ts'
export { rankCandidates, scoreCandidate, dropRepeats, sameThing, PROACTIVE_DEFAULTS } from './score.ts'
export { runGates, inQuietHours, endOfQuiet, startOfNextDay } from './gates.ts'
export type { PendingStore, TimingStore } from './store.ts'
export { describeWait, PENDING_TTL_MS } from './store.ts'

/** 一次主动开口的判断结果 */
export interface ProactiveDecision {
  pick: PendingItem | null
  verdict: GateVerdict
  considered: ScoredCandidate[]
}

/** 一个应用里的主动开口 */
export interface QqProactiveSeam {
  pending: PendingStore
  timing: TimingStore
  consider(input: ConsiderInput): ProactiveDecision
  preview(chatKey: string): PendingItem[]
  deliver(chatKey: string): PendingItem | null
}

/** 攒理由时要看的东西 */
export interface ConsiderInput {
  chatKey: string
  candidates: readonly Candidate[]
  drives: Drives
  history: readonly string[]
  humanActive: boolean
  botBusy: boolean
  hasChannel: boolean
  config?: Partial<typeof PROACTIVE_DEFAULTS>
}

/** 这一行接受的配置 */
export interface Config {
  /** 攒着的和记账都放这个文件 */
  file?: string
  /** 要不要主动开口 */
  enabled?: boolean
  /** 一天最多开口几次 */
  dailyMax?: number
  /** 安静时段从几点开始 */
  quietStart?: string
  /** 安静时段到几点结束 */
  quietEnd?: string
}

const seams = new WeakMap<Context, QqProactiveSeam>()

/**
 * 取主动开口，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqProactiveOf(ctx: Context): QqProactiveSeam | undefined {
  return seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-proactive'

/** 不需要别的内核服务 */
export const inject: string[] = []

/**
 * 装配主动开口
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const file = config.file ?? path.join(process.cwd(), 'data', 'qq-proactive.json')
  const pending = createPendingStore({ file })
  const timing = createTimingStore({ file })
  const gateConfig: Partial<typeof PROACTIVE_DEFAULTS> = {
    ...config.enabled !== undefined ? { enabled: config.enabled } : {},
    ...config.dailyMax !== undefined ? { dailyMax: config.dailyMax } : {},
    ...config.quietStart !== undefined ? { quietStart: config.quietStart } : {},
    ...config.quietEnd !== undefined ? { quietEnd: config.quietEnd } : {},
  }

  const seam: QqProactiveSeam = {
    pending,
    timing,
    consider(input) {
      const now = Date.now()
      const gateInput: GateInput = {
        now,
        config: { ...gateConfig, ...(input.config ?? {}) },
        lastSpokenAt: timing.lastSpokenAt(input.chatKey),
        todayCount: timing.todayCount(input.chatKey),
        humanActive: input.humanActive,
        botBusy: input.botBusy,
        hasChannel: input.hasChannel,
      }
      const verdict = runGates(gateInput)
      if (!verdict.ok) return { pick: null, verdict, considered: [] }

      const ranked = dropRepeats(rankCandidates(input.candidates, input.drives), input.history)
      if (ranked.length === 0) {
        return { pick: null, verdict: { ok: false, code: 'proactive.nothing', reason: '没攒到值得说的事' }, considered: [] }
      }

      const best = ranked[0]!
      const item: PendingItem = {
        id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        chatKey: input.chatKey,
        text: best.text,
        why: best.why,
        score: best.score,
        createdAt: now,
        expiresAt: now + PENDING_TTL_MS,
      }
      pending.put(item)
      return { pick: item, verdict, considered: ranked }
    },
    preview(chatKey) {
      return pending.live(chatKey)
    },
    deliver(chatKey) {
      const items = pending.live(chatKey)
      const first = items[0]
      if (first === undefined) return null
      pending.markSent(first.id)
      timing.noteSpoken(chatKey)
      return first
    },
  }
  seams.set(ctx, seam)

  // 卸载时落一次盘
  ctx.effect(() => () => {
    pending.flush()
    seams.delete(ctx)
  })
}
