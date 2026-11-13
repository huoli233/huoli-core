// 每天这一步的日志：镜像前后各核一次记录表，判据三四的违规也一并写进去

import fs from 'node:fs'
import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { localDay, type LedgerReport, type QqMemorySeam } from '@huoli/huoli-qq-memory'
import type { LedgerViolation, QqSelfSeam, SelfMirrorPort } from '@huoli/huoli-qq-self'

/** 拼这一行要的事实 */
export interface MaintenanceFacts {
  /** 现在的时间 */
  now: number
  /** 镜像前那次核对 */
  before: LedgerReport
  /** 镜像后那次核对 */
  after: LedgerReport
  /** 判据三与判据四查出来的违规 */
  violations: readonly LedgerViolation[]
}

/** 跑一次每日维护要用的零件 */
export interface MaintenanceInput {
  /** 现在的时间 */
  at: number
  /** 记忆仓，没装上时整步不做，也不写日志 */
  memory: QqMemorySeam | undefined
  /** 自我层，没装上时不镜像，也没有记录表判据可查 */
  self: QqSelfSeam | undefined
  /** 关系仓，每天让关系分数向中性回落一次 */
  relations?: { maintain(at?: number): number } | undefined
  /** 日志写进哪个文件 */
  logFile: string
}

// 两位补零
function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

/**
 * 一份核对结果的说法：对得上几条，对不上时把三类差异接在后头
 * @param report - 核对结果
 * @returns 这一份结果的一句话
 */
export function ledgerPart(report: LedgerReport): string {
  if (report.read === 'broken') return '账本读不出来'
  const parts = [`${report.held} 条一致`]
  if (report.lost.length > 0) parts.push(`丢了 ${report.lost.length} 条`)
  if (report.changed.length > 0) parts.push(`正文被改 ${report.changed.length} 条`)
  if (report.unrecorded.length > 0) parts.push(`还没入账 ${report.unrecorded.length} 条`)
  return parts.join('、')
}

/**
 * 当日维护那一行：日期、镜像前后各一次核对，再加判据三四的违规
 * @param facts - 前后两次核对与违规清单
 * @returns 拼好的一行
 */
export function maintenanceLine(facts: MaintenanceFacts): string {
  const at = new Date(facts.now)
  const mirror = `镜像前 ${ledgerPart(facts.before)} / 镜像后 ${ledgerPart(facts.after)}`
  const audit = facts.violations.length === 0 ? '判据三、四都没违规' : facts.violations.map(one => one.text).join('；')
  return `[maintenance] ${localDay(facts.now)} ${pad2(at.getHours())}:${pad2(at.getMinutes())} ${mirror}；${audit}`
}

/**
 * 维护日志默认落在主目录的 data 下
 * @param home - 覆盖主目录，不给按环境变量定
 * @returns 日志文件的位置
 */
export function defaultMaintenanceLogFile(home?: string): string {
  return path.join(resolveHuoliHome(home), 'data', 'qq-maintenance.log')
}

/**
 * 追加一行到维护日志；一次 write 交给操作系统的追加重排，历史行不会被改写
 * @param file - 日志文件
 * @param line - 要追加的那一行
 */
export function appendMaintenanceLine(file: string, line: string): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 })
  } catch (error) {
    throw new Error(`bundle.maintenance_log_unwritable: 维护日志写不进去 ${file}｜下一步: 检查目录权限或改 maintenanceLogFile`, { cause: error })
  }
}

/**
 * 把记忆仓包成镜像那一面要的三件事
 * @param memory - 记忆仓
 * @returns 镜像端口
 */
export function mirrorPortOf(memory: QqMemorySeam): SelfMirrorPort {
  return {
    mirroredSelfIds: () => memory.mirroredSelfIds(),
    // 证据回查只认库里现役的编号
    memoryIds: () => memory.store.all().map(item => item.id),
    rememberSelf: (entry, at) => memory.rememberSelf(entry, at),
  }
}

/**
 * 每天这一步：镜像前核一次，整理并镜像，写入后记进记录表再核一次，两次结果与判据三四的违规写进当日日志
 * @param input - 零件与日志位置
 * @returns 写进日志的那一行，记忆仓没装上时是空串
 */
export function runMaintenance(input: MaintenanceInput): string {
  input.relations?.maintain(input.at)
  if (input.memory === undefined) return ''
  // 镜像前那次核对：这一趟之前库里本来就对得上几条
  const before = input.memory.ledger('verify').report
  input.memory.maintain(input.at)
  // 关着的那一层不写，镜像入口自己会返回没写
  const mirrored = input.self?.mirror(input.at)
  // 维护可能合并已有正文；镜像也可能写库，整理完统一补账再核对
  input.memory.ledger('sync')
  void mirrored
  const after = input.memory.ledger('verify').report
  // 判据三四只在自我层那本账上查，自我层没装上时一条都查不到
  const violations = input.self?.audit(input.at) ?? []
  const line = maintenanceLine({ now: input.at, before, after, violations })
  appendMaintenanceLine(input.logFile, line)
  return line
}
