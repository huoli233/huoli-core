// 主动开口装配入口：攒理由、过闸门、先给你看，说不说由模型定

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import {
  dropRepeats,
  orderByArrival,
  PROACTIVE_DEFAULTS,
  type Candidate,
  type GateConfig,
  type GateVerdict,
  type PendingItem,
} from './score.ts'
import { runGates, type GateInput } from './gates.ts'
import { createPendingStore, createTimingStore, PENDING_TTL_MS, type PendingStore, type TimingStore } from './store.ts'

export type { Candidate, CandidateFacts, GateConfig, GateVerdict, PendingItem } from './score.ts'
export { orderByArrival, dropRepeats, sameThing, PROACTIVE_DEFAULTS } from './score.ts'
export { runGates, inQuietHours, endOfQuiet, startOfNextDay, cooldownMs, dailyCapOf } from './gates.ts'
export type { PendingStore, TimingStore } from './store.ts'
export { describeWait, PENDING_TTL_MS } from './store.ts'

/** 一次主动开口的判断结果 */
export interface ProactiveDecision {
  verdict: GateVerdict
  /** 这一趟攒住的全部候选，挑哪条由调用方决定 */
  pending: PendingItem[]
  /** 过了去重之后剩下的候选 */
  considered: Candidate[]
  /** 只给模型参考的事实，不参与打分，也不参与排序 */
  facts: ProactiveFacts
}

/** 攒理由时一并摆出来的事实 */
export interface ProactiveFacts {
  /** 想开口的劲，零到一，身体没接上时为空 */
  proactive_bias: number | null
}

/** 投递的结论：成了给那一条，没成就给码与下一步 */
export interface DeliverResult {
  /** 投没投出去 */
  ok: boolean
  /** 投出去的那一条，没投成时没有 */
  item?: PendingItem
  /** 失败码，形如 proactive.原因 */
  code?: string
  /** 人能读的一句话 */
  reason?: string
  /** 下一步怎么做 */
  hint?: string
}

/** 一个应用里的主动开口 */
export interface QqProactiveSeam {
  pending: PendingStore
  timing: TimingStore
  /** 这一行开没开，调用方据此决定要不要来问 */
  readonly enabled: boolean
  consider(input: ConsiderInput): ProactiveDecision
  preview(chatKey: string): PendingItem[]
  deliver(chatKey: string, id: string): DeliverResult
}

/** 攒理由时要看的东西 */
export interface ConsiderInput {
  chatKey: string
  candidates: readonly Candidate[]
  /** 别处攒出来的候选（比如想发一条动态），只并进候选表，不评分、不排序、不决定发不发 */
  external?: readonly Candidate[]
  history: readonly string[]
  humanActive: boolean
  botBusy: boolean
  hasChannel: boolean
  /** 身体那边给的想开口的劲，零到一，冷却与每天额度都按它缩放 */
  proactiveBias?: number
  /** 身体那边给的睡眠事实：现在睡着就一条候选都不攒 */
  asleep?: boolean
  /** 睡着时预计醒来的毫秒时间戳，零表示没排期 */
  wakeAfter?: number
  /** 刚被吵醒、还没缓过来 */
  waking?: boolean
  config?: Partial<GateConfig>
}

/** 这一行接受的配置 */
export interface Config {
  /** 攒着的和记账都放这个文件，不填就用主目录下的 data */
  file?: string
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 要不要主动开口 */
  enabled?: boolean
  /** 一天最多开口几次 */
  dailyMax?: number
  /** 一天至少开口几次，劲头再低也不低于这个数 */
  dailyFloor?: number
  /** 安静时段从几点开始 */
  quietStart?: string
  /** 安静时段到几点结束 */
  quietEnd?: string
  /** 冷却区间下限 */
  gapMinMs?: number
  /** 冷却区间上限 */
  gapMaxMs?: number
  /** 劲头低于这个数就按这个数算 */
  biasFloor?: number
  /** 刚被吵醒之后还要安静多久，毫秒 */
  wakingDelayMs?: number
}

const seams = new WeakMap<Context, QqProactiveSeam>()

// 自己攒的与别处递来的候选并成一张表，先后只看到达时刻，不看值钱程度
function gatheredCandidates(input: ConsiderInput): Candidate[] {
  if (input.external === undefined) return [...input.candidates]
  return [...input.candidates, ...input.external]
}

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
  const file = config.file ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-proactive.json')
  const pending = createPendingStore({ file })
  const timing = createTimingStore({ file })
  const gateConfig: Partial<GateConfig> = {
    ...config.enabled !== undefined ? { enabled: config.enabled } : {},
    ...config.dailyMax !== undefined ? { dailyMax: config.dailyMax } : {},
    ...config.dailyFloor !== undefined ? { dailyFloor: config.dailyFloor } : {},
    ...config.quietStart !== undefined ? { quietStart: config.quietStart } : {},
    ...config.quietEnd !== undefined ? { quietEnd: config.quietEnd } : {},
    ...config.gapMinMs !== undefined ? { gapMinMs: config.gapMinMs } : {},
    ...config.gapMaxMs !== undefined ? { gapMaxMs: config.gapMaxMs } : {},
    ...config.biasFloor !== undefined ? { biasFloor: config.biasFloor } : {},
    ...config.wakingDelayMs !== undefined ? { wakingDelayMs: config.wakingDelayMs } : {},
  }
  const enabled = config.enabled ?? PROACTIVE_DEFAULTS.enabled

  const seam: QqProactiveSeam = {
    pending,
    timing,
    enabled,
    consider(input) {
      const now = Date.now()
      const facts: ProactiveFacts = { proactive_bias: input.proactiveBias ?? null }
      const gateInput: GateInput = {
        now,
        config: { ...gateConfig, ...(input.config ?? {}) },
        lastSpokenAt: timing.lastSpokenAt(input.chatKey),
        todayCount: timing.todayCount(input.chatKey),
        humanActive: input.humanActive,
        botBusy: input.botBusy,
        hasChannel: input.hasChannel,
        ...input.proactiveBias !== undefined ? { proactiveBias: input.proactiveBias } : {},
        ...input.asleep !== undefined ? { asleep: input.asleep } : {},
        ...input.wakeAfter !== undefined ? { wakeAfter: input.wakeAfter } : {},
        ...input.waking !== undefined ? { waking: input.waking } : {},
      }
      const gate = runGates(gateInput)
      if (!gate.ok) return { verdict: gate, pending: [], considered: [], facts }

      const considered = dropRepeats(orderByArrival(gatheredCandidates(input)), input.history)
      if (considered.length === 0) {
        const nothing: GateVerdict = { ok: false, code: 'proactive.no_candidate', reason: '没攒到能说的事' }
        return { verdict: nothing, pending: [], considered: [], facts }
      }

      const items: PendingItem[] = considered.map(candidate => ({
        id: `${input.chatKey}:${candidate.at.toString(36)}-${candidate.id}`,
        chatKey: input.chatKey,
        text: candidate.text,
        why: candidate.why,
        facts: {
          kind: candidate.kind,
          ...candidate.confidence !== undefined ? { confidence: candidate.confidence } : {},
          ...candidate.value !== undefined ? { value: candidate.value } : {},
          ...candidate.risk !== undefined ? { risk: candidate.risk } : {},
          ...candidate.postWant !== undefined ? { postWant: candidate.postWant } : {},
          source: candidate.source,
          at: candidate.at,
        },
        createdAt: candidate.at,
        expiresAt: candidate.at + PENDING_TTL_MS,
      }))
      for (const item of items) pending.put(item)
      return { verdict: { ok: true, code: 'proactive.preview_ready' }, pending: items, considered, facts }
    },
    preview(chatKey) {
      const live = pending.live(chatKey)
      pending.notePreviewed(live.map(item => item.id))
      return live
    },
    deliver(chatKey, id) {
      const found = pending.live(chatKey).find(item => item.id === id)
      if (found === undefined) {
        return { ok: false, code: 'proactive.unknown_item', reason: '待发里没有这一条', hint: '先用 preview 看一遍，拿里面的编号来投' }
      }
      if (!pending.isPreviewed(found.id)) {
        return { ok: false, code: 'proactive.not_previewed', reason: '这一条还没先给人看', hint: '先调 preview 摆出来，再投这一条' }
      }
      pending.markSent(found.id)
      timing.noteSpoken(chatKey)
      return { ok: true, item: found }
    },
  }
  seams.set(ctx, seam)

  // 卸载时落一次盘
  ctx.effect(() => () => {
    pending.flush()
    seams.delete(ctx)
  })
}
