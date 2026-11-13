// 面板能拧的行为约束：静默、主动开关、每小时次数、作息；改完立刻生效并落盘

import fs from 'node:fs'
import path from 'node:path'
import type { LimitsState } from '@huoli/huoli-qq-self'
import type { SelfQuiet } from './self-quiet.ts'

/** 默认值：都在配置里能改，这里只是兜底 */
export const LIMITS_DEFAULTS: LimitsState = {
  quietMinutes: 0,
  proactiveAllowed: true,
  proactivePerHour: 3,
  sleepFrom: 23,
  sleepUntil: 7,
}

/** 落盘的样子 */
interface StoredLimits {
  version: 2
  proactiveAllowed: boolean
  proactivePerHour: number
  sleepFrom: number
  sleepUntil: number
  proactiveSentAt: Record<string, number[]>
}

interface StoredLimitsInput {
  version?: number
  proactiveAllowed?: unknown
  proactivePerHour?: unknown
  sleepFrom?: unknown
  sleepUntil?: unknown
  proactiveSentAt?: unknown
}

const PROACTIVE_HOUR_MS = 60 * 60_000

/** 一次实际主动发送的预留结果 */
export type ProactiveSendReservation =
  | { ok: false; code: string; reason: string; hint: string; retryAt?: number }
  | { ok: true; settle: (sent: boolean, at: number) => void }

/** 这份约束要用的东西 */
export interface LimitsControlOptions {
  /** 落盘位置 */
  file: string
  /** 静默这件事由她自己那份状态管 */
  quiet: SelfQuiet
  /** 默认值，来自配置 */
  defaults: LimitsState
  /** 每会话每小时主动发送上限的最大值 */
  maxProactivePerHour?: number
  /** 改完通知外面一声，让提示词与关卡立刻换口径 */
  onChange?: (state: LimitsState) => void
  /** 记一行日志 */
  warn: (message: string) => void
}

/** 面板可读写的行为约束 */
export interface LimitsControl {
  /** 当前约束 */
  state(): LimitsState
  /** 修改并持久化约束 */
  set(patch: Partial<LimitsState>): LimitsState
  /** 最近一小时已经提交的条数 */
  proactiveSentThisHour(chatKey: string, at: number): number
  /** 已提交与已预留的条数是否还没到上限 */
  canReserveProactiveSend(chatKey: string, at: number): boolean
  /** 为一条真实发送预留位置 */
  reserveProactiveSend(chatKey: string, at: number): ProactiveSendReservation
}

/** 数字收在区间里，认不出来就用兜底 */
function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/**
 * 面板那一侧的行为约束
 * @param options - 落盘位置、静默、默认值与回调
 * @returns 面板能读写的那一对接口
 */
export function createLimitsControl(options: LimitsControlOptions): LimitsControl {
  const maxProactivePerHour = Math.max(1, Math.floor(options.maxProactivePerHour ?? 30))
  let stored: StoredLimits = { version: 2, ...toStored(options.defaults, maxProactivePerHour), proactiveSentAt: {} }
  const reservations = new Map<string, Map<symbol, number>>()
  try {
    if (fs.existsSync(options.file)) {
      const parsed = JSON.parse(fs.readFileSync(options.file, 'utf8')) as StoredLimitsInput
      stored = {
        version: 2,
        ...toStored({ ...options.defaults, ...fromStored(parsed) }, maxProactivePerHour),
        proactiveSentAt: cleanSentAt(parsed.proactiveSentAt, Date.now()),
      }
    }
  } catch (error) {
    // 读不动就用默认值，坏文件不该拦住面板
    options.warn(`行为约束没读出来：${String(error)}`)
  }

  const persist = (): void => {
    try {
      stored = { ...stored, proactiveSentAt: cleanSentAt(stored.proactiveSentAt, Date.now()) }
      fs.mkdirSync(path.dirname(options.file), { recursive: true })
      const temporary = `${options.file}.${process.pid}.tmp`
      fs.writeFileSync(temporary, `${JSON.stringify(stored, null, 1)}\n`, { mode: 0o600 })
      fs.renameSync(temporary, options.file)
    } catch (error) {
      options.warn(`行为约束没写进去：${String(error)}`)
    }
  }

  const sentAtFor = (chatKey: string, at: number): number[] =>
    (stored.proactiveSentAt[chatKey] ?? [])
      .filter(time => Number.isFinite(time) && time <= at && at - time < PROACTIVE_HOUR_MS)
      .sort((left, right) => left - right)

  const reservedFor = (chatKey: string): Map<symbol, number> => {
    let active = reservations.get(chatKey)
    if (active === undefined) {
      active = new Map()
      reservations.set(chatKey, active)
    }
    return active
  }

  const canReserveProactiveSend = (chatKey: string, at: number): boolean => {
    if (!stored.proactiveAllowed) return false
    const sent = sentAtFor(chatKey, at)
    const active = reservations.get(chatKey)?.size ?? 0
    return sent.length + active < stored.proactivePerHour
  }

  const current = (): LimitsState => ({
    quietMinutes: Math.max(0, Math.round(options.quiet.remainingMs() / 60_000)),
    proactiveAllowed: stored.proactiveAllowed,
    proactivePerHour: stored.proactivePerHour,
    sleepFrom: stored.sleepFrom,
    sleepUntil: stored.sleepUntil,
  })

  return {
    state: current,
    proactiveSentThisHour(chatKey, at) {
      return sentAtFor(chatKey, at).length
    },
    canReserveProactiveSend,
    reserveProactiveSend(chatKey, at) {
      if (!stored.proactiveAllowed) {
        return { ok: false, code: 'bundle.proactive_off', reason: '自主开口已关闭', hint: '在面板重新开启后再发送' }
      }
      const sent = sentAtFor(chatKey, at)
      const active = reservedFor(chatKey)
      if (sent.length + active.size >= stored.proactivePerHour) {
        const oldest = sent[0]
        return {
          ok: false,
          code: 'bundle.proactive_hour_limit',
          reason: '这一小时的主动发送次数已用完',
          hint: '等一条已计入的主动发送满一小时后再发',
          ...oldest === undefined ? {} : { retryAt: oldest + PROACTIVE_HOUR_MS },
        }
      }
      const token = Symbol(chatKey)
      active.set(token, at)
      return {
        ok: true,
        settle(sentSuccessfully, sentAt) {
          if (!active.delete(token)) return
          if (active.size === 0) reservations.delete(chatKey)
          if (!sentSuccessfully) return
          const committedAt = Number.isFinite(sentAt) ? sentAt : at
          const kept = sentAtFor(chatKey, committedAt)
          kept.push(committedAt)
          stored.proactiveSentAt = {
            ...stored.proactiveSentAt,
            [chatKey]: kept,
          }
          persist()
        },
      }
    },
    set(patch) {
      // 静默走她自己那份状态，改它就等于让她现在起闭嘴多久
      if (patch.quietMinutes !== undefined) {
        const minutes = clamp(patch.quietMinutes, 0, 4320, current().quietMinutes)
        if (minutes === 0) options.quiet.resume()
        else options.quiet.quiet(minutes, '面板静默', '')
      }
      stored = {
        version: 2,
        proactiveAllowed: patch.proactiveAllowed === undefined
          ? stored.proactiveAllowed
          : patch.proactiveAllowed === true,
        proactivePerHour: clamp(patch.proactivePerHour, 0, maxProactivePerHour, stored.proactivePerHour),
        sleepFrom: clamp(patch.sleepFrom, 0, 23, stored.sleepFrom),
        sleepUntil: clamp(patch.sleepUntil, 0, 23, stored.sleepUntil),
        proactiveSentAt: stored.proactiveSentAt,
      }
      persist()
      const next = current()
      options.onChange?.(next)
      return next
    },
  }
}

/** 从面板字段挑出要落盘的那几项 */
function toStored(state: LimitsState, maxProactivePerHour: number): Omit<StoredLimits, 'version'> {
  return {
    proactiveAllowed: state.proactiveAllowed,
    proactivePerHour: clamp(state.proactivePerHour, 0, maxProactivePerHour, LIMITS_DEFAULTS.proactivePerHour),
    sleepFrom: clamp(state.sleepFrom, 0, 23, LIMITS_DEFAULTS.sleepFrom),
    sleepUntil: clamp(state.sleepUntil, 0, 23, LIMITS_DEFAULTS.sleepUntil),
    proactiveSentAt: {},
  }
}

/** 把磁盘上的值收回合法范围 */
function fromStored(raw: StoredLimitsInput): Partial<LimitsState> {
  return {
    ...typeof raw.proactiveAllowed !== 'boolean' ? {} : { proactiveAllowed: raw.proactiveAllowed },
    ...typeof raw.proactivePerHour !== 'number' ? {} : { proactivePerHour: raw.proactivePerHour },
    ...typeof raw.sleepFrom !== 'number' ? {} : { sleepFrom: raw.sleepFrom },
    ...typeof raw.sleepUntil !== 'number' ? {} : { sleepUntil: raw.sleepUntil },
  }
}

function cleanSentAt(raw: unknown, at: number): Record<string, number[]> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const cutoff = at - PROACTIVE_HOUR_MS
  const cleaned: Record<string, number[]> = {}
  for (const [chatKey, value] of Object.entries(raw)) {
    if (chatKey === '' || !Array.isArray(value)) continue
    const timestamps = value.filter((item): item is number =>
      typeof item === 'number' && Number.isFinite(item) && item >= cutoff && item <= at,
    )
    if (timestamps.length > 0) cleaned[chatKey] = timestamps.sort((left, right) => left - right)
  }
  return cleaned
}
