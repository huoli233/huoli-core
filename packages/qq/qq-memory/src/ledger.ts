// 记忆记录表：每条记一份指纹，证明没丢过、正文没被改过；退役另记一态

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import type { MemoryItem } from './types.ts'

/** 记录表结构的版本戳，缺这个字段的旧记录表按 1 读 */
export const LEDGER_SCHEMA_VERSION = 1

/** 记录表里一条记录还持不持有正文 */
export type LedgerEntryState = 'held' | 'retired'

/** 记录表里一条记录：记进记录表时的指纹，加上退役标记 */
export interface LedgerEntry {
  /** 记进记录表时正文的 sha256 */
  sha256: string
  /** 记进记录表时正文的字数 */
  len: number
  /** held 还持有正文；retired 已退役，正文按规则清空 */
  state: LedgerEntryState
  /** 退役那一刻，还持有时没有这个字段 */
  retiredAt?: number
}

/** 一份正文的指纹 */
export interface Fingerprint {
  sha256: string
  len: number
}

/** 读记录表时的三种情况：读得出来、文件还没建过、文件坏了读不出来 */
export type LedgerReadStatus = 'ok' | 'absent' | 'broken'

/** 记录表文件的内容 */
export interface LedgerBook {
  schemaVersion: number
  entries: Record<string, LedgerEntry>
}

/** 正文变了的一条 */
export interface LedgerChange {
  id: string
  /** 记进记录表时的字数 */
  expectedLen: number
  /** 现在的字数 */
  actualLen: number
}

/** 核对结果 */
export interface LedgerReport {
  /** 读记录表时看到的情况，读不出来时后面的差异都不作数 */
  read: LedgerReadStatus
  /** 全部对上才算 true，记录表读不出来一律是 false */
  ok: boolean
  /** 对得上的条数，退役的也算对上 */
  held: number
  /** 其中已经退役的条数 */
  retired: number
  /** 记录表里有、现在没了 */
  lost: readonly string[]
  /** 还在，正文不一样了 */
  changed: readonly LedgerChange[]
  /** 现在有、记录表还没记 */
  unrecorded: readonly string[]
}

/** 记录表能做的三件事 */
export type LedgerAction = 'init' | 'sync' | 'verify'

/** 合并整理后，把已移除和已改写的旧指纹换成当前事实 */
export function reconcileMaintenanceBook(
  file: string,
  items: readonly MemoryItem[],
): LedgerRunResult {
  const current = readBook(file)
  if (current.status === 'broken') {
    return { action: 'sync', report: verifyBook(current.book, items, current.status), added: [], entries: 0 }
  }
  const present = new Set(items.map(item => item.id))
  const kept: Record<string, LedgerEntry> = {}
  for (const [id, entry] of Object.entries(current.book.entries)) {
    if (!present.has(id)) continue
    const item = items.find(one => one.id === id)
    if (item === undefined) continue
    kept[id] = item.state === 'forgotten' && entry.state === 'retired'
      ? entry
      : entryOf(item)
  }
  const synced = syncBook({ schemaVersion: current.book.schemaVersion, entries: kept }, items)
  const book = { schemaVersion: LEDGER_SCHEMA_VERSION, entries: synced.book.entries }
  writeBook(file, book)
  return { action: 'sync', report: verifyBook(book, items), added: synced.added, entries: countEntries(book) }
}

/** 跑一次记录表要的东西 */
export interface LedgerRunOptions {
  /** 记录表文件 */
  file: string
  /** 现在的全部记忆 */
  items: readonly MemoryItem[]
}

/** 跑一次记录表的结果 */
export interface LedgerRunResult {
  action: LedgerAction
  report: LedgerReport
  /** 这次新记上的编号 */
  added: readonly string[]
  /** 记录表现在有多少条 */
  entries: number
}

// 认得出是一个对象
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 条目自己记的退役态，写记录表与核对都以它为准
function isRetired(item: MemoryItem): boolean {
  return item.state === 'forgotten'
}

/**
 * 算一条正文的指纹
 * @param text - 正文
 * @returns 指纹
 */
export function fingerprint(text: string): Fingerprint {
  return { sha256: createHash('sha256').update(text, 'utf8').digest('hex'), len: text.length }
}

// 一条记忆此刻该在记录表里长什么样
function entryOf(item: MemoryItem): LedgerEntry {
  const mark = fingerprint(item.text)
  if (!isRetired(item)) return { ...mark, state: 'held' }
  return { ...mark, state: 'retired', retiredAt: item.retiredAt ?? item.at }
}

// 旧记录表缺的字段按默认补齐，缺 schemaVersion 就是 1
function entryOr(raw: Record<string, unknown>): LedgerEntry {
  const state: LedgerEntryState = raw.state === 'retired' ? 'retired' : 'held'
  const retiredAt = typeof raw.retiredAt === 'number' && Number.isFinite(raw.retiredAt) ? raw.retiredAt : undefined
  return {
    sha256: typeof raw.sha256 === 'string' ? raw.sha256 : '',
    len: typeof raw.len === 'number' && Number.isFinite(raw.len) ? raw.len : 0,
    state,
    ...retiredAt === undefined ? {} : { retiredAt },
  }
}

/**
 * 一本还没记过事的记录表
 * @returns 空记录表
 */
export function emptyBook(): LedgerBook {
  return { schemaVersion: LEDGER_SCHEMA_VERSION, entries: {} }
}

/**
 * 记录表默认落在主目录的 data 下
 * @param home - 覆盖主目录，不给按环境变量定
 * @returns 记录表文件的位置
 */
export function defaultLedgerFile(home?: string): string {
  return path.join(resolveHuoliHome(home), 'data', 'qq-memory-ledger.json')
}

/**
 * 给现在全部记忆建记录表，已经退役的记得就是退役态
 * @param items - 现在的全部记忆
 * @returns 建好的记录表
 */
export function initBook(items: readonly MemoryItem[]): LedgerBook {
  const entries: Record<string, LedgerEntry> = {}
  for (const item of items) entries[item.id] = entryOf(item)
  return { schemaVersion: LEDGER_SCHEMA_VERSION, entries }
}

/**
 * 只补没记过的编号，老记录的指纹与字数一个字都不覆盖；已退役的那条只补退役标记
 * @param book - 现在的记录表
 * @param items - 现在的全部记忆
 * @returns 补过之后的记录表与新记上的编号
 */
export function syncBook(book: LedgerBook, items: readonly MemoryItem[]): { book: LedgerBook; added: readonly string[] } {
  const entries: Record<string, LedgerEntry> = { ...book.entries }
  const added: string[] = []
  for (const item of items) {
    const kept = entries[item.id]
    if (kept === undefined) {
      entries[item.id] = entryOf(item)
      added.push(item.id)
      continue
    }
    // 退役是记录表里的一条记录，指纹留着记进记录表时的样子，只补上退役态与时刻
    if (isRetired(item) && kept.state === 'held') {
      entries[item.id] = { sha256: kept.sha256, len: kept.len, state: 'retired', retiredAt: item.retiredAt ?? item.at }
    }
  }
  return { book: { schemaVersion: LEDGER_SCHEMA_VERSION, entries }, added }
}

/**
 * 核对：记录表里每条都还在、正文没被改、退役的仍退役且没有正文，现在每条也都已进记录表
 * @param book - 记录表
 * @param items - 现在的全部记忆
 * @param read - 读这本记录表时看到的情况，记录表已经读出来时按默认值算
 * @returns 核对结果
 */
export function verifyBook(book: LedgerBook, items: readonly MemoryItem[], read: LedgerReadStatus = 'ok'): LedgerReport {
  const byId = new Map<string, MemoryItem>()
  for (const item of items) byId.set(item.id, item)
  const lost: string[] = []
  const changed: LedgerChange[] = []
  let held = 0
  let retired = 0
  for (const [id, entry] of Object.entries(book.entries)) {
    const item = byId.get(id)
    if (item === undefined) {
      lost.push(id)
      continue
    }
    const now = fingerprint(item.text)
    if (entry.state === 'retired') {
      // 退役条目只认「仍是退役且没有正文」：改回 active 或长回正文都算被改
      if (isRetired(item) && item.text === '') {
        held += 1
        retired += 1
        continue
      }
      changed.push({ id, expectedLen: entry.len, actualLen: now.len })
      continue
    }
    if (now.sha256 === entry.sha256 && now.len === entry.len) {
      held += 1
      continue
    }
    changed.push({ id, expectedLen: entry.len, actualLen: now.len })
  }
  const unrecorded = items.filter(item => book.entries[item.id] === undefined).map(item => item.id)
  const matched = lost.length === 0 && changed.length === 0 && unrecorded.length === 0
  return {
    read,
    ok: read === 'ok' && matched,
    held,
    retired,
    lost,
    changed,
    unrecorded,
  }
}

/**
 * 把核对结果写成一句能看懂的话，哪一条被改了、哪一条丢了、退役了几条都点出来
 * @param report - 核对结果
 * @returns 拼好的话
 */
export function describeLedger(report: LedgerReport): string {
  // 读不出来时一条都没核对上，先说这一句，免得把空记录表当成对得上
  if (report.read === 'broken') return '账本读不出来，一条都没核对上'
  const retiredPart = `已退役 ${report.retired} 条`
  if (report.ok) return `账本对得上，${report.held} 条，其中${retiredPart}`
  const parts: string[] = []
  if (report.lost.length > 0) parts.push(`丢了 ${report.lost.length} 条（${report.lost.join('、')}）`)
  if (report.changed.length > 0) {
    const detail = report.changed.map(one => `${one.id} ${one.expectedLen}→${one.actualLen} 字`).join('、')
    parts.push(`正文被改 ${report.changed.length} 条（${detail}）`)
  }
  if (report.unrecorded.length > 0) parts.push(`还没入账 ${report.unrecorded.length} 条（${report.unrecorded.join('、')}）`)
  parts.push(retiredPart)
  return parts.join('；')
}

// 读记录表，读不出来要分两种：文件还没建过，与文件坏了读不出来
function readBook(file: string): { book: LedgerBook; status: LedgerReadStatus } {
  try {
    if (!fs.existsSync(file)) return { book: emptyBook(), status: 'absent' }
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim() === '') return { book: emptyBook(), status: 'absent' }
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) return { book: emptyBook(), status: 'broken' }
    const entries: Record<string, LedgerEntry> = {}
    if (isRecord(parsed.entries)) {
      for (const [id, value] of Object.entries(parsed.entries)) {
        if (isRecord(value)) entries[id] = entryOr(value)
      }
    }
    const version = parsed.schemaVersion
    const schemaVersion = typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : 1
    return { book: { schemaVersion, entries }, status: 'ok' }
  } catch {
    // 读不动的记录表连同解析失败一起报成坏记录表，由调用方按 ERROR 处理
    return { book: emptyBook(), status: 'broken' }
  }
}

// 先写临时文件再改名，半截文件不会留在原地
function writeBook(file: string, book: LedgerBook): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(book, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

// 记录表里现在有多少条
function countEntries(book: LedgerBook): number {
  return Object.keys(book.entries).length
}

/**
 * 跑一次记录表：建记录表、补新、核对
 * @param action - 做哪一件
 * @param options - 记录表文件与现在的全部记忆
 * @returns 这次的结果
 */
export function runLedger(action: LedgerAction, options: LedgerRunOptions): LedgerRunResult {
  const current = readBook(options.file)
  if (action === 'verify') {
    return { action, report: verifyBook(current.book, options.items, current.status), added: [], entries: countEntries(current.book) }
  }
  // 坏记录表一个字都不覆盖：补新或重建都会把原有指纹抹掉，等人工处理
  if (current.status === 'broken') {
    return { action, report: verifyBook(current.book, options.items, current.status), added: [], entries: countEntries(current.book) }
  }
  const next = action === 'init'
    ? { book: initBook(options.items), added: options.items.map(item => item.id) }
    : syncBook(current.book, options.items)
  writeBook(options.file, next.book)
  return { action, report: verifyBook(next.book, options.items), added: next.added, entries: countEntries(next.book) }
}
