// 闸门：只回答"现在能不能开口"，不能就告诉它下次什么时候再来

import { PROACTIVE_DEFAULTS, type GateConfig, type GateVerdict } from './score.ts'

/** 闸门看的东西 */
export interface GateInput {
  now: number
  config?: Partial<GateConfig>
  lastSpokenAt: number
  todayCount: number
  humanActive: boolean
  botBusy: boolean
  hasChannel: boolean
}

// 时分转成当天的分钟数
function toMinutes(hhmm: string): number {
  const parts = hhmm.split(':')
  const hour = Number(parts[0])
  const minute = Number(parts[1])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1
  return hour * 60 + minute
}

/**
 * 两次开口之间隔多久：冷却区间的中点，同样的配置永远得到同样的数
 * @param config - 闸门配置
 * @returns 毫秒数
 */
export function cooldownMs(config: GateConfig): number {
  const span = Math.max(0, config.gapMaxMs - config.gapMinMs)
  return config.gapMinMs + Math.floor(span / 2)
}

/**
 * 现在是不是安静时段
 * @param now - 现在的时间
 * @param start - 开始时间
 * @param end - 结束时间
 * @returns 是或不是
 */
export function inQuietHours(now: number, start: string, end: string): boolean {
  const from = toMinutes(start)
  const to = toMinutes(end)
  if (from < 0 || to < 0 || from === to) return false
  const date = new Date(now)
  const at = date.getHours() * 60 + date.getMinutes()
  return from < to ? (at >= from && at < to) : (at >= from || at < to)
}

/**
 * 一道道过闸门，第一道不过就返回，并告诉它下次什么时候
 * @param input - 传进来的东西
 * @returns 闸门结论
 */
export function runGates(input: GateInput): GateVerdict {
  const config: GateConfig = { ...PROACTIVE_DEFAULTS, ...(input.config ?? {}) }

  if (!config.enabled) return { ok: false, code: 'proactive.off', reason: '主动开口没开' }
  if (!input.hasChannel) return { ok: false, code: 'proactive.no_channel', reason: '没有能发出去的通道' }
  if (input.botBusy) {
    return { ok: false, code: 'proactive.busy', reason: '正在说话', retryAt: input.now + config.busyRetryMs }
  }

  if (inQuietHours(input.now, config.quietStart, config.quietEnd)) {
    return { ok: false, code: 'proactive.quiet', reason: '现在是安静时段', retryAt: endOfQuiet(input.now, config.quietEnd) }
  }

  if (input.todayCount >= config.dailyMax) {
    return { ok: false, code: 'proactive.day_full', reason: '今天主动开口够了', retryAt: startOfNextDay(input.now) }
  }

  const gap = cooldownMs(config)
  if (input.lastSpokenAt > 0 && input.now - input.lastSpokenAt < gap) {
    return { ok: false, code: 'proactive.too_soon', reason: '上次开口还不久', retryAt: input.lastSpokenAt + gap }
  }

  if (input.humanActive) {
    return { ok: false, code: 'proactive.people_talking', reason: '有人在聊，先听', retryAt: input.now + config.talkingRetryMs }
  }

  return { ok: true }
}

/**
 * 安静时段什么时候结束
 * @param now - 现在的时间
 * @param end - 结束时间
 * @returns 算出来的数
 */
export function endOfQuiet(now: number, end: string): number {
  const to = toMinutes(end)
  if (to < 0) return now + 60 * 60_000
  const date = new Date(now)
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(to / 60), to % 60, 0, 0)
  if (target.getTime() <= now) target.setDate(target.getDate() + 1)
  return target.getTime()
}

/**
 * 第二天开始的时间
 * @param now - 现在的时间
 * @returns 算出来的数
 */
export function startOfNextDay(now: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime()
}
