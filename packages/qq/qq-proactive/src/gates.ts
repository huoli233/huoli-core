// 关卡：只回答"现在能不能开口"，不能就告诉它下次什么时候再来

import { PROACTIVE_DEFAULTS, type GateConfig, type GateVerdict } from './score.ts'

/** 关卡看的东西 */
export interface GateInput {
  now: number
  config?: Partial<GateConfig>
  botBusy: boolean
  hasChannel: boolean
  /** 现在是不是睡着，没接上身体时为空 */
  asleep?: boolean
  /** 睡着时预计醒来的毫秒时间戳，零表示没排期 */
  wakeAfter?: number
  /** 身体已经需要收口休息时为真 */
  resting?: boolean
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
  if (input.resting === true) {
    return {
      ok: false,
      code: 'proactive.resting',
      reason: '身体已经该休息了',
      hint: '先安静一会儿，等身体缓过来再想主动开口',
      retryAt: input.now + config.restRetryMs,
    }
  }
  if (!input.hasChannel) return { ok: false, code: 'proactive.no_channel', reason: '没有能发出去的通道', hint: '先把通道那一行装上' }
  if (input.botBusy) {
    return { ok: false, code: 'proactive.busy', reason: '正在说话', hint: '等这一轮说完再问', retryAt: input.now + config.busyRetryMs }
  }

  if (inQuietHours(input.now, config.quietStart, config.quietEnd)) {
    return { ok: false, code: 'proactive.quiet', reason: '现在是安静时段', hint: '等安静时段过去', retryAt: endOfQuiet(input.now, config.quietEnd) }
  }

  // 社交时机交给模型；这里只执行显式安静设置和运行状态约束
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
