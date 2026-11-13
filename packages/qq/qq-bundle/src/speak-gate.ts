// 这一轮说到第几条收口：只认配置给的条数上限，不替她判断该不该说

import type { ReplyFacts } from '@huoli/huoli-qq-pacing'
import type { QqVitalsSeam } from '@huoli/huoli-qq-vitals'

/** 身体没接上时按中性的身体算，只用来摆事实 */
export const NEUTRAL_FACTS: ReplyFacts = { tired: 0.5, annoyed: 0.5, energy: 0.5, clingy: 0.5, lonely: 0.5 }

/** 单轮物理安全上限：只防无限连发，不替模型判断这一轮该说几句 */
export const REPLY_HARD_CAP = 8
/** 睡着时仍允许把一句长话分成几个短气泡 */
export const SLEEPING_REPLY_CAP = 3
/** 身体已经该休息时仍允许把一句话拆成几条 */
export const RESTING_REPLY_CAP = 3

/**
 * 这一轮最多几条
 * @param vitals - 身体状态，只用来判断是否睡着
 * @param sleepingCap - 睡着时允许的最大气泡数
 * @param restingCap - 精力低时允许的最大气泡数
 * @returns 按睡眠、精力和清醒三档给出的物理上限
 */
export function budgetOf(
  vitals: QqVitalsSeam | undefined,
  sleepingCap = SLEEPING_REPLY_CAP,
  restingCap = RESTING_REPLY_CAP,
): number {
  if (vitals?.read().sleep_state === 'sleeping') return Math.max(1, Math.floor(sleepingCap))
  const rest = restCapOf(vitals)
  if (rest === 1) return 1
  if (rest === 2) return Math.max(1, Math.floor(restingCap))
  return REPLY_HARD_CAP
}

/**
 * 身体是否已经该休息
 * @param vitals - 身体状态
 * @returns 一或二表示休息倾向，未到线为 undefined
 */
export function restCapOf(vitals: QqVitalsSeam | undefined): number | undefined {
  const state = vitals?.read()
  if (state === undefined || state.sleep_state === 'waking') return undefined
  if (state.sleep_state === 'sleeping' || state.energy < 0.22 || state.adenosine > 0.72) return 1
  if (state.energy < 0.36 || state.adenosine > 0.58) return 2
  return undefined
}

/**
 * 渲染回复容量事实
 * @param vitals - 身体状态
 * @returns 模型可见的条数与休息事实
 */
export function budgetLine(
  vitals: QqVitalsSeam | undefined,
  sleepingCap = SLEEPING_REPLY_CAP,
  restingCap = RESTING_REPLY_CAP,
): string {
  const cap = budgetOf(vitals, sleepingCap, restingCap)
  const rest = restCapOf(vitals)
  return [
    '[DATA] QQ_REPLY_CAPACITY',
    `physical_cap=${cap}`,
    `sleeping_cap=${sleepingCap}`,
    `resting_cap=${restingCap}`,
    `sleep_state=${vitals?.read().sleep_state ?? 'unknown'}`,
    ...rest === undefined ? [] : [`body_feels_like_resting_score=${rest}`],
    'RULE: low_energy_reduces_lines_not_replies; a_private_message_still_needs_one_direct_answer; do_not_use_quiet_as_rest',
    'CHOICE: you_decide_how_many_lines_to_actually_send_within_the_physical_cap',
  ].join('\n')
}

/**
 * 说满预算就收口，别再往下发
 * @param budget - 这一轮最多几条，配置给的数
 * @returns 给定已经发了几条，回答要不要停
 */
export function stopNowOf(budget: number): (sent: number) => boolean {
  const cap = Math.max(1, Math.floor(budget))
  return sent => sent >= cap
}
