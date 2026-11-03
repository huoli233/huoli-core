// 闸门：只回答"现在能不能开口"，不能就告诉它下次什么时候再来

import { PROACTIVE_DEFAULTS, type GateVerdict } from './score.ts'

// 闸门看的东西
export interface GateInput {
  now: number
  config?: Partial<typeof PROACTIVE_DEFAULTS>
  lastSpokenAt: number
  todayCount: number
  humanActive: boolean
  botBusy: boolean
  hasChannel: boolean
}

// 时分转成当天的分钟数
function toMinutes(hhmm: string): number {
  const parts = String(hhmm ?? '').split(':')
  const hour = Number(parts[0])
  const minute = Number(parts[1])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1
  return hour * 60 + minute
}

// 现在是不是安静时段
export function inQuietHours(now: number, start: string, end: string): boolean {
  const from = toMinutes(start)
  const to = toMinutes(end)
  if (from < 0 || to < 0 || from === to) return false
  const date = new Date(now)
  const at = date.getHours() * 60 + date.getMinutes()
  return from < to ? (at >= from && at < to) : (at >= from || at < to)
}

// 一道道过闸门，第一道不过就返回，并告诉它下次什么时候
export function runGates(input: GateInput): GateVerdict {
  const config = { ...PROACTIVE_DEFAULTS, ...(input.config ?? {}) }

  if (!config.enabled) return { ok: false, code: 'proactive.off', reason: '主动开口没开' }
  if (!input.hasChannel) return { ok: false, code: 'proactive.no_channel', reason: '没有能发出去的通道' }
  if (input.botBusy) return { ok: false, code: 'proactive.busy', reason: '正在说话', retryAt: input.now + 60_000 }

  if (inQuietHours(input.now, config.quietStart, config.quietEnd)) {
    return { ok: false, code: 'proactive.quiet', reason: '现在是安静时段', retryAt: endOfQuiet(input.now, config.quietEnd) }
  }

  if (input.todayCount >= config.dailyMax) {
    return { ok: false, code: 'proactive.day_full', reason: '今天主动开口够了', retryAt: startOfNextDay(input.now) }
  }

  const gap = config.gapMinMs + Math.floor(Math.random() * Math.max(1, config.gapMaxMs - config.gapMinMs))
  if (input.lastSpokenAt > 0 && input.now - input.lastSpokenAt < gap) {
    return { ok: false, code: 'proactive.too_soon', reason: '上次开口还不久', retryAt: input.lastSpokenAt + gap }
  }

  if (input.humanActive) {
    return { ok: false, code: 'proactive.people_talking', reason: '有人在聊，先听', retryAt: input.now + 5 * 60_000 }
  }

  return { ok: true }
}

// 安静时段什么时候结束
export function endOfQuiet(now: number, end: string): number {
  const to = toMinutes(end)
  if (to < 0) return now + 60 * 60_000
  const date = new Date(now)
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(to / 60), to % 60, 0, 0)
  if (target.getTime() <= now) target.setDate(target.getDate() + 1)
  return target.getTime()
}

// 第二天开始的时间
export function startOfNextDay(now: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime()
}
