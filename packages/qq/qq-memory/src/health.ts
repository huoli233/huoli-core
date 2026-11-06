// 每天一行健康记录：条数、受保护的、退役与只剩印象的、每轮最多放几条、记录表状态、待写入

import fs from 'node:fs'
import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import type { AlertThresholds } from './defaults.ts'
import type { LedgerReport } from './ledger.ts'
import type { MemoryItem } from './types.ts'

/** 记录表这一栏的四档，除 OK 之外都算告警 */
export type LedgerLevel = 'OK' | 'DRIFT' | 'MISSING' | 'ERROR'

/** 行尾告警标记里能出现的四种原因 */
export type HealthAlert = 'ledger' | 'pending' | 'pinned' | 'cold' | 'full' | 'overflow'

/** 拼这一行要的东西 */
export interface HealthInput {
  /** 现在的全部记忆 */
  items: readonly MemoryItem[]
  /** 现在的时间 */
  now: number
  /** 放进整串的字数上限，从配置读 */
  injectMaxChars: number
  /** 重要度到这条线以上算受保护 */
  protectLine: number
  /** 这次的核对结果 */
  ledger: LedgerReport
  /** 已入队还没写进文件的条数，由装配层从队列取 */
  pending?: number
  /** 三个告警阈值，从配置读 */
  thresholds: AlertThresholds
}

/** 一页记忆数出来的几个数 */
export interface HealthCounts {
  /** 还没退役的条数 */
  total: number
  /** 重要度在保护线以上的条数，已退役的不算 */
  pinned: number
  /** 已退役的加上只剩印象的条数，两类都是快要记不住的事 */
  cold: number
  /** 已入队还没写进文件的条数 */
  pending: number
}

// 两位补零
function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

// 本地时间的 yyyy-mm-dd hh:mm
function stamp(now: number): string {
  const at = new Date(now)
  return `${localDay(now)} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * 本地日期，一天只整理一次的判据就比这个串
 * @param now - 现在的时间
 * @returns 形如 2026-11-04
 */
export function localDay(now: number): string {
  const at = new Date(now)
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * 数一遍这一行要的几个数
 * @param items - 现在的全部记忆
 * @param protectLine - 保护线
 * @param pending - 已入队还没写进文件的条数
 * @returns 数出来的数
 */
export function healthCounts(items: readonly MemoryItem[], protectLine: number, pending: number = 0): HealthCounts {
  let total = 0
  let pinned = 0
  let cold = 0
  for (const item of items) {
    if (item.state === 'forgotten') {
      cold += 1
      continue
    }
    total += 1
    if (item.importance >= protectLine) pinned += 1
    if (item.clarity === 'trace') cold += 1
  }
  // 待写入不由这一页数出来，它只认队列的长度，队列有多少就照实写多少
  return { total, pinned, cold, pending }
}

/**
 * 把核对结果折成四档，取值只由读记录表的情况与三类差异决定
 * @param report - 核对结果
 * @returns 四档之一
 */
export function ledgerLevel(report: LedgerReport): LedgerLevel {
  if (report.read === 'broken') return 'ERROR'
  // 记录表还没建过时一条都对不上，与条目丢了同一档
  if (report.read === 'absent' || report.lost.length > 0) return 'MISSING'
  if (report.changed.length > 0 || report.unrecorded.length > 0) return 'DRIFT'
  return 'OK'
}

/**
 * 这一行末尾要挂哪几个告警，按从要紧到缓的顺序排
 * @param counts - 数出来的数
 * @param level - 记录表这一栏的档
 * @param thresholds - 三个阈值
 * @returns 命中的告警，没命中就是空数组
 */
export function healthAlerts(
  counts: HealthCounts,
  level: LedgerLevel,
  thresholds: AlertThresholds,
): readonly HealthAlert[] {
  const alerts: HealthAlert[] = []
  if (level !== 'OK') alerts.push('ledger')
  if (counts.pending > thresholds.pendingAlert) alerts.push('pending')
  if (counts.pinned > thresholds.pinnedAlert) alerts.push('pinned')
  // 一条没退役过的都没有时分母为 0，这时按比例 0 算，不告警
  const coldRatio = counts.total === 0 ? 0 : counts.cold / counts.total
  if (coldRatio > thresholds.coldRatioAlert) alerts.push('cold')
  // 总量占上限：先提一句快满了，真满了再报超
  if (thresholds.totalCap > 0) {
    const fullRatio = counts.total / thresholds.totalCap
    if (fullRatio >= 1) alerts.push('overflow')
    else if (fullRatio >= thresholds.totalWarnAt) alerts.push('full')
  }
  return alerts
}

/**
 * 拼每日健康一行，字段顺序固定，别处按空格切着读
 * @param input - 传进来的东西
 * @returns 拼好的话
 */
export function healthLine(input: HealthInput): string {
  const counts = healthCounts(input.items, input.protectLine, input.pending)
  const level = ledgerLevel(input.ledger)
  const fields = [
    `[memory] ${stamp(input.now)}`,
    `total=${counts.total}`,
    `pinned=${counts.pinned}`,
    `cold=${counts.cold}`,
    `inject_cap=${input.injectMaxChars}`,
    `ledger=${level}`,
    `pending=${counts.pending}`,
  ]
  const alerts = healthAlerts(counts, level, input.thresholds)
  // 一条告警也只占行尾这一处，多出来的原因用逗号接在同一个标记里
  if (alerts.length > 0) fields.push(`alert=${alerts.join(',')}`)
  return fields.join(' ')
}

/**
 * 健康日志默认落在主目录的 data 下
 * @param home - 覆盖主目录，不给按环境变量定
 * @returns 日志文件的位置
 */
export function defaultHealthLogFile(home?: string): string {
  return path.join(resolveHuoliHome(home), 'data', 'qq-memory-health.log')
}

/**
 * 追加一行到健康日志；一次 write 交给操作系统的追加重排，历史行不会被改写
 * @param file - 日志文件
 * @param line - 要追加的那一行
 */
export function appendHealthLine(file: string, line: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 })
  } catch (error) {
    throw new Error(`memory.health_log_unwritable: 健康日志写不进去 ${file}｜下一步: 检查目录权限或改 healthLogFile`, { cause: error })
  }
}
