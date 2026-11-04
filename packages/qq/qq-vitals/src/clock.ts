// 时段判断：夜里的浓度、去甲按时段换基线、睡眠窗口与周期锚点

import type { Tuning } from './defaults.ts'
import { clamp, clampRange } from './math.ts'
import type { CyclePhase } from './types.ts'

// 一天固定的毫秒数，日历换算用，不随配置改
const DAY_MS = 86_400_000

// 读 Intl 读数用的语言，只要拉丁数字，与展示无关
const PARSE_LOCALE = 'en-US'

// 读数要的字段：年月日时分秒都要数字，钟点按零到二十三算
const ZONE_PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
}

/** 某一时区在某一刻的墙上读数 */
interface WallClock {
  /** 公历年 */
  year: number
  /** 月，一到十二 */
  month: number
  /** 当月第几天 */
  day: number
  /** 小时，零到二十三 */
  hour: number
  /** 分 */
  minute: number
  /** 秒 */
  second: number
}

// 取该时区的读数格式化器：留空按运行环境时区，名字认不出时 Intl 只抛 RangeError，认掉它退回运行环境
function formatterOf(timeZone: string): Intl.DateTimeFormat {
  if (timeZone === '') return new Intl.DateTimeFormat(PARSE_LOCALE, ZONE_PARTS)
  try {
    return new Intl.DateTimeFormat(PARSE_LOCALE, { ...ZONE_PARTS, timeZone })
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return new Intl.DateTimeFormat(PARSE_LOCALE, ZONE_PARTS)
  }
}

// 缺项说明 Intl 的字段表变了，照着剩下的读数猜会把时段算错，所以直接报错
function readPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const found = parts.find(part => part.type === type)
  if (found === undefined) throw new Error(`时区读数缺少 ${type}`)
  return Number(found.value)
}

// 该时区在这一刻的墙上读数
function wallClock(at: number, timeZone: string): WallClock {
  const parts = formatterOf(timeZone).formatToParts(new Date(at))
  return {
    year: readPart(parts, 'year'),
    month: readPart(parts, 'month'),
    day: readPart(parts, 'day'),
    hour: readPart(parts, 'hour'),
    minute: readPart(parts, 'minute'),
    second: readPart(parts, 'second'),
  }
}

// 该时区在这一刻相对 UTC 的偏移：把墙上读数当成 UTC 再减掉真实时刻
function offsetMs(at: number, timeZone: string): number {
  const wall = wallClock(at, timeZone)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  return asUtc - Math.floor(at / 1000) * 1000
}

// 当地某天零点折成毫秒时间戳：先估一次偏移，再用估出来的时刻校正一次，跨夏令时也落在真实零点上
function midnightMs(wall: WallClock, timeZone: string): number {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day)
  const guess = asUtc - offsetMs(asUtc, timeZone)
  return asUtc - offsetMs(guess, timeZone)
}

// 当地日历上的第几天：按年月日折算，与那一天实际有几个小时无关
function dayNumber(wall: WallClock): number {
  return Math.round(Date.UTC(wall.year, wall.month - 1, wall.day) / DAY_MS)
}

/**
 * 本地小时数（带小数）
 * @param at - 毫秒时间戳
 * @param timeZone - 时区名，留空跟随运行环境，认不出的名字也按运行环境算
 * @returns 0~24 的小时
 */
export function localHour(at: number, timeZone = ''): number {
  const wall = wallClock(at, timeZone)
  return wall.hour + wall.minute / 60
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
 * @param timeZone - 时区名，留空跟随运行环境，认不出的名字也按运行环境算
 * @returns 零点与小时
 */
export function localPoint(at: number, timeZone = ''): LocalPoint {
  const wall = wallClock(at, timeZone)
  return { midnight: midnightMs(wall, timeZone), hour: wall.hour + wall.minute / 60 }
}

/**
 * 两个时刻在指定时区里隔了几个日历日
 * @param from - 起始毫秒时间戳
 * @param to - 结束毫秒时间戳
 * @param timeZone - 时区名，留空跟随运行环境，认不出的名字也按运行环境算
 * @returns 日历日之差，一整天的长短随夏令时变，这里仍是整数
 */
export function localDayDiff(from: number, to: number, timeZone = ''): number {
  return dayNumber(wallClock(to, timeZone)) - dayNumber(wallClock(from, timeZone))
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
  const point = localPoint(at, tuning.timeZone)
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
  const wall = wallClock(at, tuning.timeZone)
  const dom = cycleAnchorDay(tuning)
  // 早于锚点日就取上个月那一天，月份越界由 Date.UTC 折到上一年
  const anchorMonth = wall.day < dom ? wall.month - 2 : wall.month - 1
  const anchor = Date.UTC(wall.year, anchorMonth, dom)
  const next = Date.UTC(wall.year, anchorMonth + 1, dom)
  const day = Math.round((Date.UTC(wall.year, wall.month - 1, wall.day) - anchor) / DAY_MS) + 1
  const len = Math.round((next - anchor) / DAY_MS)
  return { day, len, phase: phaseOf(day, tuning) }
}
