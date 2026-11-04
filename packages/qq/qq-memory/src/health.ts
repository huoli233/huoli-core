// 每天一行健康记录：条数、受保护的、遗忘的、注入上限、账本状态、待入账

import type { LedgerReport } from './ledger.ts'
import type { MemoryItem } from './types.ts'

/** 拼这一行要的东西 */
export interface HealthInput {
  /** 现在的全部记忆 */
  items: readonly MemoryItem[]
  /** 现在的时间 */
  now: number
  /** 每次召回注入的正文上限，从配置读 */
  injectCap: number
  /** 重要度到这条线以上算受保护 */
  protectLine: number
  /** 这次的对账结果 */
  ledger: LedgerReport
}

/** 一页记忆数出来的几个数 */
export interface HealthCounts {
  /** 一共多少条 */
  total: number
  /** 重要度在保护线以上的条数，已遗忘的不算 */
  pinned: number
  /** 已经遗忘的条数 */
  cold: number
  /** 还没入账的条数 */
  pending: number
}

// 两位补零
function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

// 本地时间的 yyyy-mm-dd hh:mm
function stamp(now: number): string {
  const at = new Date(now)
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return `${day} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * 数一遍这一行要的几个数
 * @param items - 现在的全部记忆
 * @param protectLine - 保护线
 * @param ledger - 对账结果
 * @returns 数出来的数
 */
export function healthCounts(items: readonly MemoryItem[], protectLine: number, ledger: LedgerReport): HealthCounts {
  let pinned = 0
  let cold = 0
  for (const item of items) {
    if (item.forgotten) {
      cold += 1
      continue
    }
    if (item.importance >= protectLine) pinned += 1
  }
  return { total: items.length, pinned, cold, pending: ledger.unrecorded.length }
}

/**
 * 拼每日健康一行，字段顺序固定，别处按空格切着读
 * @param input - 传进来的东西
 * @returns 拼好的话
 */
export function healthLine(input: HealthInput): string {
  const counts = healthCounts(input.items, input.protectLine, input.ledger)
  const fields = [
    `[memory] ${stamp(input.now)}`,
    `total=${counts.total}`,
    `pinned=${counts.pinned}`,
    `cold=${counts.cold}`,
    `inject_cap=${input.injectCap}`,
    `ledger=${input.ledger.ok ? 'OK' : 'FAIL'}`,
    `pending=${counts.pending}`,
  ]
  return fields.join(' ')
}
