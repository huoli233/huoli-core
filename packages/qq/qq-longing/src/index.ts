// 暗涌装配：独占状态、心跳推进、事件入口和私聊提示

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import {
  DEFAULTS,
  applyLongingEvent,
  nextLongingState,
  normalizeLongingState,
  type EventName,
  type EventOutcome,
  type LongingState,
  type LongingTuning,
} from './model.ts'
import { renderLongingBlock } from './prompt.ts'
import { createLongingStore } from './store.ts'

export {
  DEFAULTS,
  DIMS,
  DRIFT,
  EVENTS,
  EVENT_NAMES,
  INTIMATE_EVENTS,
  applyLongingEvent,
  effectiveDesire,
  emptyLongingState,
  nextLongingState,
  normalizeLongingState,
  pressureOf,
} from './model.ts'
export type { Dim, EventName, EventOutcome, LongingState, LongingTuning } from './model.ts'
export { LONGING_BASELINES, longingDesireLevel, renderLongingBlock } from './prompt.ts'
export { createLongingStore } from './store.ts'
export type { LongingStore, LongingStoreOptions } from './store.ts'

/** 这一行接受的配置 */
export interface Config {
  /** 状态文件，不填落在 data/qq-longing.json */
  file?: string
  /** 覆盖数据根目录 */
  home?: string
  /** 总开关 */
  enabled?: boolean
  /** 成人事件总闸 */
  nsfwEnabled?: boolean
  /** 事件倍率 */
  eventGain?: number
  /** 是否启用维度互相牵制 */
  couplingEnabled?: boolean
  /** 牵制速度 */
  couplingRate?: number
  /** 平时每小时性欲回落 */
  decayPerHour?: number
  /** 高峰时段每小时性欲回落 */
  nightDecayPerHour?: number
  /** 晚间高峰窗口 */
  peakWindow?: string
  /** 每天第一次进入高峰的加成 */
  peakBonus?: number
  /** 私聊一次增加的性欲 */
  interactionLust?: number
  /** 私聊一次增加的好感 */
  affectionGain?: number
}

/** 其他包读取和使用暗涌的服务 */
export interface QqLongingSeam {
  /** 读取当前状态，必要时先推进时间 */
  read(at?: number): LongingState
  /** 施加一个已确认发生的事件 */
  event(name: EventName, at?: number): EventOutcome
  /** 记录一次私聊联系 */
  contact(text: string, at?: number): LongingState
  /** 取私聊提示块 */
  render(at?: number): string
  /** 总开关是否打开 */
  active(): boolean
}

const seams = new WeakMap<Context, QqLongingSeam>()

/**
 * 取暗涌服务
 * @param ctx - 运行环境
 * @returns 未装配时为 undefined
 */
export function qqLongingOf(ctx: Context): QqLongingSeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
}

/** 插件行名 */
export const name = 'qq-longing'

/** 不依赖其他插件服务 */
export const inject: readonly string[] = []

const EVENT_COOLDOWN_MS = 30_000
const TICK_MS = 60_000

function tuningOf(config: Config): LongingTuning {
  return {
    nsfwEnabled: config.nsfwEnabled ?? DEFAULTS.nsfwEnabled,
    eventGain: Math.max(0, config.eventGain ?? DEFAULTS.eventGain),
    couplingEnabled: config.couplingEnabled ?? DEFAULTS.couplingEnabled,
    couplingRate: Math.max(0, config.couplingRate ?? DEFAULTS.couplingRate),
    decayPerHour: Math.max(0, config.decayPerHour ?? DEFAULTS.decayPerHour),
    nightDecayPerHour: Math.max(0, config.nightDecayPerHour ?? DEFAULTS.nightDecayPerHour),
    peakWindow: config.peakWindow ?? DEFAULTS.peakWindow,
    peakBonus: Math.max(0, config.peakBonus ?? DEFAULTS.peakBonus),
    interactionLust: config.interactionLust ?? DEFAULTS.interactionLust,
    affectionGain: config.affectionGain ?? DEFAULTS.affectionGain,
  }
}

/**
 * 装配暗涌
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const enabled = config.enabled ?? true
  const tuning = tuningOf(config)
  const file = config.file ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-longing.json')
  const store = createLongingStore({ file })
  let state = store.read()
  store.write(state)
  const cooldowns = new Map<EventName, number>()

  const advance = (at = Date.now()): LongingState => {
    if (!enabled || at - state.tickedAt < TICK_MS) return state
    state = nextLongingState(state, tuning, at)
    store.write(state)
    return state
  }

  const seam: QqLongingSeam = {
    read(at = Date.now()) {
      return advance(at)
    },
    event(eventName, at = Date.now()) {
      if (!enabled) return { ok: false, reason: '暗涌关着', applied: {}, state }
      const last = cooldowns.get(eventName) ?? 0
      if (last > 0 && at - last < EVENT_COOLDOWN_MS && eventName !== 'stop') {
        return { ok: false, reason: '这个事件刚记过，等一会儿再说', applied: {}, state }
      }
      cooldowns.set(eventName, at)
      const outcome = applyLongingEvent(advance(at), eventName, tuning, at)
      if (!outcome.ok) return outcome
      state = outcome.state
      store.write(state)
      return outcome
    },
    contact(text, at = Date.now()) {
      if (!enabled) return state
      if (state.pausedUntil > at) {
        state = { ...state, lastContactAt: at, everContacted: true, updatedAt: at }
        store.write(state)
        return state
      }
      const advanced = advance(at)
      state = {
        ...advanced,
        lust: Math.min(100, advanced.lust + tuning.interactionLust),
        affection: Math.min(100, advanced.affection + tuning.affectionGain),
        lastContactAt: at,
        everContacted: true,
        updatedAt: at,
      }
      store.write(state)
      void text
      return state
    },
    render(at = Date.now()) {
      if (!enabled) return ''
      return renderLongingBlock(advance(at), tuning, at)
    },
    active() {
      return enabled
    },
  }

  seams.set(ctx.root, seam)
  const timer = setInterval(() => {
    advance(Date.now())
  }, TICK_MS)
  timer.unref()

  ctx.effect(() => () => {
    clearInterval(timer)
    store.write(normalizeLongingState(state))
    seams.delete(ctx.root)
  })
}
