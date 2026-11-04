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
  /** 身体给的想开口的劲，零到一，没接上身体时为空 */
  proactiveBias?: number
  /** 现在是不是睡着，没接上身体时为空 */
  asleep?: boolean
  /** 睡着时预计醒来的毫秒时间戳，零表示没排期 */
  wakeAfter?: number
  /** 刚被吵醒、还没缓过来时为真，没接上身体时为空 */
  waking?: boolean
}

// 时分转成当天的分钟数
function toMinutes(hhmm: string): number {
  const parts = hhmm.split(':')
  const hour = Number(parts[0])
  const minute = Number(parts[1])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return -1
  return hour * 60 + minute
}

// 劲头夹进可用区间：没接上身体按满劲头算，接上了也不低于下限
function biasFactor(bias: number | undefined, config: GateConfig): number {
  if (bias === undefined || !Number.isFinite(bias)) return 1
  return Math.min(1, Math.max(config.biasFloor, bias))
}

/**
 * 两次开口之间隔多久：冷却区间的中点除以劲头，同样的输入永远得到同样的数
 * @param config - 闸门配置
 * @param bias - 身体给的想开口的劲，零到一，不给按满劲头算
 * @returns 毫秒数
 */
export function cooldownMs(config: GateConfig, bias?: number): number {
  const span = Math.max(0, config.gapMaxMs - config.gapMinMs)
  const base = config.gapMinMs + Math.floor(span / 2)
  return Math.round(base / biasFactor(bias, config))
}

/**
 * 这一天最多开口几次：额度按劲头缩，最低留下限那么多次
 * @param config - 闸门配置
 * @param bias - 身体给的想开口的劲，零到一，不给按满劲头算
 * @returns 次数
 */
export function dailyCapOf(config: GateConfig, bias?: number): number {
  return Math.max(config.dailyFloor, Math.floor(config.dailyMax * biasFactor(bias, config)))
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
  // 睡着时一条候选都不攒，下次能来的时候就是身体排的那个醒点
  if (input.asleep === true) {
    const wakeAfter = input.wakeAfter ?? 0
    return {
      ok: false,
      code: 'proactive.asleep',
      reason: '她睡着了，这时候不出声',
      ...wakeAfter > 0 ? { retryAt: wakeAfter } : {},
    }
  }
  // 刚被吵醒还有一段缓不过来，按配置延后再看
  if (input.waking === true) {
    return { ok: false, code: 'proactive.waking', reason: '她刚被吵醒，还没缓过来', retryAt: input.now + config.wakingDelayMs }
  }
  if (!input.hasChannel) return { ok: false, code: 'proactive.no_channel', reason: '没有能发出去的通道' }
  if (input.botBusy) {
    return { ok: false, code: 'proactive.busy', reason: '正在说话', retryAt: input.now + config.busyRetryMs }
  }

  if (inQuietHours(input.now, config.quietStart, config.quietEnd)) {
    return { ok: false, code: 'proactive.quiet', reason: '现在是安静时段', retryAt: endOfQuiet(input.now, config.quietEnd) }
  }

  if (input.todayCount >= dailyCapOf(config, input.proactiveBias)) {
    return { ok: false, code: 'proactive.day_full', reason: '今天主动开口够了', retryAt: startOfNextDay(input.now) }
  }

  const gap = cooldownMs(config, input.proactiveBias)
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
