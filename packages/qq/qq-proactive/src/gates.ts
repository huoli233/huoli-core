// 关卡：只回答"现在能不能开口"，不能就告诉它下次什么时候再来

import { PROACTIVE_DEFAULTS, type GateConfig, type GateVerdict } from './score.ts'

/** 关卡看的东西 */
export interface GateInput {
  now: number
  config?: Partial<GateConfig>
  lastSpokenAt: number
  todayCount: number
  humanActive: boolean
  botBusy: boolean
  hasChannel: boolean
  /** 身体给的想开口的劲，零到一，没接上身体时为空 */
  proactiveBias?: number
  /** 现在是不是睡着，没接上身体时为空 */
  asleep?: boolean
  /** 睡着时预计醒来的毫秒时间戳，零表示没排期 */
  wakeAfter?: number
  /** 刚被吵醒、还没缓过来时为真，没接上身体时为空 */
  waking?: boolean
}

/** 一小时多少分钟，单位换算，不随配置改 */
const MINUTES_PER_HOUR = 60

/** 一小时的毫秒数，单位换算，不随配置改 */
const MS_PER_HOUR = 60 * 60_000

// 时分转成当天的分钟数
function toMinutes(hhmm: string): number {
  const parts = hhmm.split(':')
  const hour = Number(parts[0])
  const minute = Number(parts[1])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1
  return hour * MINUTES_PER_HOUR + minute
}

/**
 * 两次开口之间隔多久：取配置里那段区间的中点，同样的配置永远得到同样的数
 * @param config - 关卡配置
 * @returns 毫秒数
 */
export function cooldownMs(config: GateConfig): number {
  const span = Math.max(0, config.gapMaxMs - config.gapMinMs)
  return config.gapMinMs + Math.floor(span / 2)
}

/**
 * 这一天最多开口几次：只按配置里的上限，不由身体读数改
 * @param config - 关卡配置
 * @returns 次数
 */
export function dailyCapOf(config: GateConfig): number {
  return Math.min(config.dailyMax, Math.max(config.dailyFloor, config.dailyMax))
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
  const at = date.getHours() * MINUTES_PER_HOUR + date.getMinutes()
  return from < to ? (at >= from && at < to) : (at >= from || at < to)
}

/**
 * 一道道过关卡，第一道不过就返回，并告诉它下次什么时候
 * @param input - 传进来的东西
 * @returns 关卡结论
 */
export function runGates(input: GateInput): GateVerdict {
  const config: GateConfig = { ...PROACTIVE_DEFAULTS, ...(input.config ?? {}) }

  if (!config.enabled) return { ok: false, code: 'proactive.off', reason: '主动开口没开', hint: '把这一行的 enabled 打开再问' }
  // 睡着时一条候选都不攒，下次能来的时候就是身体排的那个醒点
  if (input.asleep === true) {
    const wakeAfter = input.wakeAfter ?? 0
    return {
      ok: false,
      code: 'proactive.asleep',
      reason: '她睡着了，这时候不出声',
      hint: '等她醒，醒点已经放在下次可开口的时刻上',
      ...wakeAfter > 0 ? { retryAt: wakeAfter } : {},
    }
  }
  if (!input.hasChannel) return { ok: false, code: 'proactive.no_channel', reason: '没有能发出去的通道', hint: '先把通道那一行装上' }
  if (input.botBusy) {
    return { ok: false, code: 'proactive.busy', reason: '正在说话', hint: '等这一轮说完再问', retryAt: input.now + config.busyRetryMs }
  }

  if (inQuietHours(input.now, config.quietStart, config.quietEnd)) {
    return { ok: false, code: 'proactive.quiet', reason: '现在是安静时段', hint: '等安静时段过去', retryAt: endOfQuiet(input.now, config.quietEnd) }
  }

  if (input.todayCount >= dailyCapOf(config)) {
    return { ok: false, code: 'proactive.day_full', reason: '今天主动开口够了', hint: '明天再说', retryAt: startOfNextDay(input.now) }
  }

  const gap = cooldownMs(config)
  if (input.lastSpokenAt > 0 && input.now - input.lastSpokenAt < gap) {
    return { ok: false, code: 'proactive.too_soon', reason: '上次开口还不久', hint: '等冷却过去', retryAt: input.lastSpokenAt + gap }
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
  if (to < 0) return now + MS_PER_HOUR
  const date = new Date(now)
  const hour = Math.floor(to / MINUTES_PER_HOUR)
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, to % MINUTES_PER_HOUR, 0, 0)
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
