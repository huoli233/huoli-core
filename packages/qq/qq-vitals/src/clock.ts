// 时段判断：夜里的浓度、去甲按时段换基线、睡眠窗口与周期锚点

import type { Tuning } from './defaults.ts'
import { clamp, clampRange } from './math.ts'
import type { CyclePhase } from './types.ts'

// 一天固定的毫秒数，日历换算用，不随配置改
const DAY_MS = 86_400_000

/**
 * 本地小时数（带小数）
 * @param at - 毫秒时间戳
 * @returns 0~24 的小时
 */
export function localHour(at: number): number {
  const date = new Date(at)
  return date.getHours() + date.getMinutes() / 60
}

/** 某个时刻在本地日历上的位置 */
export interface LocalPoint {
  /** 当天本地零点的毫秒时间戳 */
  midnight: number
  /** 本地小时数，带小数 */
  hour: number
}

/**
 * 取某个时刻的本地零点与小时
 * @param at - 毫秒时间戳
 * @returns 零点与小时
 */
export function localPoint(at: number): LocalPoint {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return { midnight: date.getTime(), hour: localHour(at) }
}

/**
 * 夜色浓度：全黑为 1，白天为 0，两头按斜坡过渡
 * @param hour - 本地小时数
 * @param tuning - 参数
 * @returns 0~1 的夜色浓度
 */
export function nightness(hour: number, tuning: Tuning): number {
  const from = tuning.nightDarkFrom
  const until = tuning.nightDarkUntil
  const ramp = Math.max(0.01, tuning.nightRamp)
  if (hour >= from || hour < until) return 1
  if (hour < until + ramp) return clamp(1 - (hour - until) / ramp)
  if (hour >= from - ramp) return clamp((hour - (from - ramp)) / ramp)
  return 0
}

/**
 * 去甲肾上腺素的时段基线
 * @param hour - 本地小时数
 * @returns 基线值
 */
export function noradrenalineBaseline(hour: number): number {
  if (hour < 6) return 0.22
  if (hour < 9) return 0.45
  if (hour < 12) return 0.72
  if (hour < 14) return 0.55
  if (hour < 18) return 0.70
  if (hour < 22) return 0.60
  return 0.35
}

/**
 * 是不是饭点
 * @param hour - 本地小时数
 * @returns 是则 true
 */
export function isMealHour(hour: number): boolean {
  const whole = Math.floor(hour)
  return whole === 6 || whole === 7 || whole === 11 || whole === 12 || whole === 17 || whole === 18
}

/**
 * 是不是夜里该省着掉的时段
 * @param hour - 本地小时数
 * @returns 是则 true
 */
export function isQuietHour(hour: number): boolean {
  return hour >= 23 || hour < 7
}

/**
 * 褪黑素该朝哪走
 * @param hour - 本地小时数
 * @param tuning - 参数
 * @returns 夜色浓度或零
 */
export function melatoninTarget(hour: number, tuning: Tuning): number {
  const awake = hour >= tuning.melatoninFrom || hour < tuning.melatoninUntil
  return awake ? nightness(hour, tuning) : 0
}

/**
 * 是不是夜里该睡的时段
 * @param hour - 本地小时数
 * @param tuning - 参数
 * @returns 在时段内则 true
 */
export function inSleepWindow(hour: number, tuning: Tuning): boolean {
  return hour >= tuning.sleepFrom || hour < tuning.sleepUntil
}

/**
 * 是不是午睡时段
 * @param hour - 本地小时数
 * @param tuning - 参数
 * @returns 在时段内则 true
 */
export function inNapWindow(hour: number, tuning: Tuning): boolean {
  return hour >= tuning.napFrom && hour < tuning.napUntil
}

/**
 * 是不是白天：夜睡时段之外都算，白天强制醒的规则不许套到夜里
 * @param hour - 本地小时数
 * @param tuning - 参数
 * @returns 白天则 true
 */
export function isDaytime(hour: number, tuning: Tuning): boolean {
  return !inSleepWindow(hour, tuning)
}

/**
 * 这一夜该几点醒：落到下一个该醒钟点，再按抖动前后挪一点
 * @param at - 入睡时刻的毫秒时间戳
 * @param tuning - 参数
 * @param random - 取零到一的随机源，测试可以换成定值
 * @returns 醒来时刻的毫秒时间戳
 */
export function nightWakeAt(at: number, tuning: Tuning, random: () => number): number {
  const point = localPoint(at)
  const dayOffset = point.hour >= tuning.sleepFrom ? DAY_MS : 0
  const base = point.midnight + dayOffset + tuning.wakeAt * 3_600_000
  const jitter = (random() * 2 - 1) * tuning.wakeJitterMinutes * 60_000
  return Math.round(base + jitter)
}

/** 周期事实：第几天、本月多长、落在哪一段 */
export interface CycleFacts {
  /** 当前周期第几天，从开经日算起 */
  day: number
  /** 本月周期长度，28~31 天 */
  len: number
  /** 这一段叫什么 */
  phase: CyclePhase
}

// 第几天落在哪一段：边界当天归前一段
function phaseOf(day: number, tuning: Tuning): CyclePhase {
  if (day <= tuning.cycleMenstrualEnd) return 'menstrual'
  if (day <= tuning.cycleFollicularEnd) return 'follicular'
  if (day <= tuning.cycleOvulationEnd) return 'ovulation'
  if (day <= tuning.cycleLutealEnd) return 'luteal'
  return 'premenstrual'
}

/**
 * 开经日是每月几号，夹到 1~31 之间
 * @param tuning - 参数
 * @returns 每月的日期
 */
export function cycleAnchorDay(tuning: Tuning): number {
  return clampRange(Math.round(tuning.cycleDom), 1, 31)
}

/**
 * 按锚点日算当前周期：今天早于锚点就取上月的锚点，长度取到下一个锚点
 * @param at - 毫秒时间戳
 * @param tuning - 参数
 * @returns 第几天、本月多长、相位
 */
export function cycleOf(at: number, tuning: Tuning): CycleFacts {
  const today = localPoint(at)
  const date = new Date(today.midnight)
  const dom = cycleAnchorDay(tuning)
  const anchorOf = (monthOffset: number): Date =>
    new Date(date.getFullYear(), date.getMonth() + monthOffset, dom)
  const anchor = date.getDate() < dom ? anchorOf(-1) : anchorOf(0)
  const next = new Date(anchor.getFullYear(), anchor.getMonth() + 1, dom)
  const day = Math.round((today.midnight - anchor.getTime()) / DAY_MS) + 1
  const len = Math.round((next.getTime() - anchor.getTime()) / DAY_MS)
  return { day, len, phase: phaseOf(day, tuning) }
}
