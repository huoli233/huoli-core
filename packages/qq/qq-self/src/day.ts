// 每天三行：一天只写一条，跳过的那天也要留一条

import { FILES } from './files.ts'
import { newId, type SelfStore } from './store.ts'
import type { DayRow, SelfSettings, WriteOutcome } from './types.ts'

/** 每天固定几行 */
export const DAY_LINES = 3

// 超长就截断，字段本身不丢
function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

// 取时间，取不到给零
function stamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 本地日期，按天判重与算缺了几天都用它
 * @param at - 时刻
 * @returns 形如 2026-11-04
 */
export function localDay(at: number): string {
  const day = new Date(at)
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

// 这一天有没有落过一条，跳过的那条也算
function taken(store: SelfStore, at: number): boolean {
  const today = localDay(at)
  return store.records(FILES.day).some(record => localDay(stamp(record.at)) === today)
}

/**
 * 记当天的三行
 * @param store - 目录读写口
 * @param settings - 参数表
 * @param lines - 正好三行正文，空行不算
 * @param at - 记下的时刻
 * @returns 落没落盘
 */
export function recordDay(store: SelfStore, settings: SelfSettings, lines: readonly string[], at: number): WriteOutcome {
  const kept = lines.map(line => line.trim()).filter(line => line !== '')
  if (kept.length !== settings.dayLines) return { written: false, proposed: false, reason: 'bad_lines' }
  if (taken(store, at)) return { written: false, proposed: false, reason: 'duplicate' }
  store.append(FILES.day, {
    at,
    id: newId(at),
    lines: kept.map(line => clip(line, settings.dayLineMaxChars)),
    skipped: false,
    why: '',
  })
  return { written: true, proposed: false }
}

/**
 * 记一天跳过，三行留空，原因照写
 * @param store - 目录读写口
 * @param settings - 参数表
 * @param why - 为什么跳过，空着就不记
 * @param at - 记下的时刻
 * @returns 落没落盘
 */
export function skipDay(store: SelfStore, settings: SelfSettings, why: string, at: number): WriteOutcome {
  const reason = why.trim()
  if (reason === '') return { written: false, proposed: false, reason: 'no_evidence' }
  if (taken(store, at)) return { written: false, proposed: false, reason: 'duplicate' }
  store.append(FILES.day, {
    at,
    id: newId(at),
    lines: Array.from({ length: settings.dayLines }, () => ''),
    skipped: true,
    why: clip(reason, settings.dayLineMaxChars),
  })
  return { written: true, proposed: false }
}

/**
 * 某一刻之后的三行，按时间先后
 * @param store - 目录读写口
 * @param since - 从哪个时刻起算
 * @returns 这一段里的三行记录
 */
export function daysSince(store: SelfStore, since: number): DayRow[] {
  const rows: DayRow[] = []
  for (const record of store.records(FILES.day)) {
    const row = toDay(record)
    if (row === undefined || row.at <= since) continue
    rows.push(row)
  }
  return rows.sort((left, right) => left.at - right.at)
}

// 取字符串，取不到给空串
function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 读一条三行记录
 * @param record - 文件里的一行
 * @returns 缺字段或行数不对时为 undefined
 */
export function toDay(record: Record<string, unknown>): DayRow | undefined {
  const at = stamp(record.at)
  const id = str(record.id)
  const raw = Array.isArray(record.lines) ? record.lines : []
  const lines = raw.filter((line): line is string => typeof line === 'string')
  if (id === '' || at === 0 || lines.length !== raw.length) return undefined
  return { at, id, lines, skipped: record.skipped === true, why: str(record.why) }
}
