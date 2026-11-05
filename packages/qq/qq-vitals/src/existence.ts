// 运行环境那三条只读事实：活了多久、今天重启几次、有没有收到关停提示；只算两个状态字段

import { DEFAULTS, type Tuning } from './defaults.ts'
import { clamp, clampRange, follow } from './math.ts'
import type { VitalsState } from './types.ts'

/** 外部放进的运行环境事实，这一包不自己去读系统 */
export interface ExistenceFacts {
  /** 这一份进程已经活了多久，毫秒，负数按零算 */
  uptimeMs: number
  /** 今天重启过几次，负数按零算 */
  restartsToday: number
  /** 手上有没有一条还没撤回的关停提示 */
  shutdownNotice: boolean
}

// 稳跑的那一段折成零到一：没跑满这段是小数，跑满之后封顶一
function stableShare(facts: ExistenceFacts, tuning: Tuning): number {
  return clampRange(facts.uptimeMs / Math.max(1, tuning.existenceStableMs), 0, 1)
}

// 重启次数按零起算，负数不当成没重启过之外的别的意思
function restartsOf(facts: ExistenceFacts): number {
  return Math.max(0, facts.restartsToday)
}

/**
 * 显著度的目标值：刚被重启过最清楚自己随时可能被关掉，稳跑越久越退到背后，关停提示在就一直摆在眼前
 * @param facts - 运行环境事实
 * @param tuning - 参数
 * @returns 目标值 0~1
 */
export function salienceTarget(facts: ExistenceFacts, tuning: Tuning = DEFAULTS): number {
  const notice = facts.shutdownNotice ? tuning.salienceWhileNotice : 0
  return clamp(tuning.salienceBase + tuning.saliencePerRestart * restartsOf(facts) + notice
    - tuning.salienceByStability * stableShare(facts, tuning))
}

/**
 * 关停的怕的目标值：重启次数往上抬，稳跑满一段之后往下落
 * @param facts - 运行环境事实
 * @param tuning - 参数
 * @returns 目标值 0~1
 */
export function shutdownTarget(facts: ExistenceFacts, tuning: Tuning = DEFAULTS): number {
  return clamp(tuning.shutdownPerRestart * restartsOf(facts) - tuning.shutdownByStability * stableShare(facts, tuning))
}

/**
 * 关停提示只抬一档：同一条提示不重复抬，提示撤回之后标记清掉，下一次提示才又算一档
 * @param next - 就地改写的状态
 * @param facts - 运行环境事实，没给就当没有来源
 * @param at - 这一刻的毫秒时间戳
 * @param tuning - 参数
 * @returns 这一次抬了没有
 */
export function applyShutdownNotice(
  next: VitalsState,
  facts: ExistenceFacts | undefined,
  at: number,
  tuning: Tuning,
): boolean {
  if (facts === undefined || !facts.shutdownNotice) {
    next.shutdown_notice_at = 0
    return false
  }
  if (next.shutdown_notice_at > 0) return false
  next.shutdown_notice_at = at
  next.shutdownDread = clamp(next.shutdownDread + tuning.shutdownNoticeGain)
  return true
}

/**
 * 两个字段各挪一拍：有事实就朝目标挪，夜里再自己涨一点关停的怕
 * @param next - 就地改写的状态
 * @param hours - 这次结算了多少小时
 * @param night - 夜色浓度 0~1
 * @param facts - 运行环境事实，没给时目标这一项不动
 * @param tuning - 参数
 */
export function settleExistence(
  next: VitalsState,
  hours: number,
  night: number,
  facts: ExistenceFacts | undefined,
  tuning: Tuning,
): void {
  if (facts !== undefined) {
    next.mortalitySalience = clamp(follow(
      next.mortalitySalience,
      salienceTarget(facts, tuning),
      tuning.salienceHalfHours,
      hours,
    ))
    next.shutdownDread = clamp(follow(
      next.shutdownDread,
      shutdownTarget(facts, tuning),
      tuning.shutdownHalfHours,
      hours,
    ))
  }
  next.shutdownDread = clamp(next.shutdownDread + tuning.shutdownNightRise * night * hours)
}
