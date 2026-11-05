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

// 身体给的读数折回间隔倍率：零对下限、一对上限，没接上按中性的一倍算
function multiplierOf(bias: number | undefined, config: GateConfig): number {
  if (bias === undefined || !Number.isFinite(bias)) return 1
  const unit = Math.min(1, Math.max(0, bias))
  return config.biasMin + unit * (config.biasMax - config.biasMin)
}

/**
 * 两次开口之间隔多久：区间中点乘倍率，同样的输入永远得到同样的数
 * @param config - 闸门配置
 * @param bias - 身体给的那条读数，零到一，累与气往久那头走，想人往近那头落，不给按一倍算
 * @returns 毫秒数
 */
export function cooldownMs(config: GateConfig, bias?: number): number {
  const span = Math.max(0, config.gapMaxMs - config.gapMinMs)
  const base = config.gapMinMs + Math.floor(span / 2)
  return Math.round(base * multiplierOf(bias, config))
}

/**
 * 这一天最多开口几次：倍率越大开口越少，最少留下限那么多次，最多不超过上限
 * @param config - 闸门配置
 * @param bias - 身体给的那条读数，零到一，不给按一倍算
 * @returns 次数
 */
export function dailyCapOf(config: GateConfig, bias?: number): number {
  const scaled = Math.floor(config.dailyMax / multiplierOf(bias, config))
  return Math.min(config.dailyMax, Math.max(config.dailyFloor, scaled))
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
  // 刚被吵醒还有一段缓不过来，按配置延后再看
  if (input.waking === true) {
    return { ok: false, code: 'proactive.waking', reason: '她刚被吵醒，还没缓过来', hint: '等这一段缓过去再看', retryAt: input.now + config.wakingDelayMs }
  }
  if (!input.hasChannel) return { ok: false, code: 'proactive.no_channel', reason: '没有能发出去的通道', hint: '先把通道那一行装上' }
  if (input.botBusy) {
    return { ok: false, code: 'proactive.busy', reason: '正在说话', hint: '等这一轮说完再问', retryAt: input.now + config.busyRetryMs }
  }

  if (inQuietHours(input.now, config.quietStart, config.quietEnd)) {
    return { ok: false, code: 'proactive.quiet', reason: '现在是安静时段', hint: '等安静时段过去', retryAt: endOfQuiet(input.now, config.quietEnd) }
  }

  if (input.todayCount >= dailyCapOf(config, input.proactiveBias)) {
    return { ok: false, code: 'proactive.day_full', reason: '今天主动开口够了', hint: '明天再说', retryAt: startOfNextDay(input.now) }
  }

  const gap = cooldownMs(config, input.proactiveBias)
  if (input.lastSpokenAt > 0 && input.now - input.lastSpokenAt < gap) {
    return { ok: false, code: 'proactive.too_soon', reason: '上次开口还不久', hint: '等冷却过去', retryAt: input.lastSpokenAt + gap }
  }

  if (input.humanActive) {
    return { ok: false, code: 'proactive.people_talking', reason: '有人在聊，先听', hint: '等他们聊完再看', retryAt: input.now + config.talkingRetryMs }
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
