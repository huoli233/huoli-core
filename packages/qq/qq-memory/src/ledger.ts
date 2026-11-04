// 记忆账本：每条记一份指纹，证明没丢过、正文没被改过

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import type { MemoryItem } from './types.ts'

/** 账本里一条记录的指纹 */
export interface LedgerEntry {
  /** 正文的 sha256 */
  sha256: string
  /** 正文的字数 */
  len: number
}

/** 账本文件的内容 */
export interface LedgerBook {
  version: 1
  entries: Record<string, LedgerEntry>
}

/** 正文变了的一条 */
export interface LedgerChange {
  id: string
  /** 入账时的字数 */
  expectedLen: number
  /** 现在的字数 */
  actualLen: number
}

/** 对账结果 */
export interface LedgerReport {
  ok: boolean
  /** 对得上的条数 */
  held: number
  /** 账本里有、现在没了 */
  lost: readonly string[]
  /** 还在，正文不一样了 */
  changed: readonly LedgerChange[]
  /** 现在有、账本还没记 */
  unrecorded: readonly string[]
}

/** 账本能做的三件事 */
export type LedgerAction = 'init' | 'sync' | 'verify'

/** 跑一次账本要的东西 */
export interface LedgerRunOptions {
  /** 账本文件 */
  file: string
  /** 现在的全部记忆 */
  items: readonly MemoryItem[]
}

/** 跑一次账本的结果 */
export interface LedgerRunResult {
  action: LedgerAction
  report: LedgerReport
  /** 这次新记上的编号 */
  added: readonly string[]
  /** 账本现在有多少条 */
  entries: number
}

/**
 * 算一条正文的指纹
 * @param text - 正文
 * @returns 指纹
 */
export function fingerprint(text: string): LedgerEntry {
  return { sha256: createHash('sha256').update(text, 'utf8').digest('hex'), len: text.length }
}

/**
 * 一本还没记过事的账本
 * @returns 空账本
 */
export function emptyBook(): LedgerBook {
  return { version: 1, entries: {} }
}

/**
 * 账本默认落在主目录的 data 下
 * @param home - 覆盖主目录，不给按环境变量定
 * @returns 账本文件的位置
 */
export function defaultLedgerFile(home?: string): string {
  return path.join(resolveHuoliHome(home), 'data', 'qq-memory-ledger.json')
}

/**
 * 给现在全部记忆建账
 * @param items - 现在的全部记忆
 * @returns 建好的账本
 */
export function initBook(items: readonly MemoryItem[]): LedgerBook {
  const entries: Record<string, LedgerEntry> = {}
  for (const item of items) entries[item.id] = fingerprint(item.text)
  return { version: 1, entries }
}

/**
 * 只补没记过的编号，老记录一个字都不覆盖
 * @param book - 现在的账本
 * @param items - 现在的全部记忆
 * @returns 补过之后的账本与新记上的编号
 */
export function syncBook(book: LedgerBook, items: readonly MemoryItem[]): { book: LedgerBook; added: readonly string[] } {
  const entries: Record<string, LedgerEntry> = { ...book.entries }
  const added: string[] = []
  for (const item of items) {
    if (entries[item.id] !== undefined) continue
    entries[item.id] = fingerprint(item.text)
    added.push(item.id)
  }
  return { book: { version: 1, entries }, added }
}

/**
 * 对账：账本里每条都还在、正文没被改，现在每条也都已入账
 * @param book - 账本
 * @param items - 现在的全部记忆
 * @returns 对账结果
 */
export function verifyBook(book: LedgerBook, items: readonly MemoryItem[]): LedgerReport {
  const byId = new Map<string, MemoryItem>()
  for (const item of items) byId.set(item.id, item)
  const lost: string[] = []
  const changed: LedgerChange[] = []
  let held = 0
  for (const [id, entry] of Object.entries(book.entries)) {
    const item = byId.get(id)
    if (item === undefined) {
      lost.push(id)
      continue
    }
    // 淡到底的记忆由这一包自己清空正文，不算被改
    if (item.forgotten && item.text === '') {
      held += 1
      continue
    }
    const now = fingerprint(item.text)
    if (now.sha256 === entry.sha256) {
      held += 1
      continue
    }
    changed.push({ id, expectedLen: entry.len, actualLen: now.len })
  }
  const unrecorded = items.filter(item => book.entries[item.id] === undefined).map(item => item.id)
  return { ok: lost.length === 0 && changed.length === 0 && unrecorded.length === 0, held, lost, changed, unrecorded }
}

/**
 * 把对账结果写成一句能看懂的话，哪一条被改了、哪一条丢了都点出来
 * @param report - 对账结果
 * @returns 拼好的话
 */
export function describeLedger(report: LedgerReport): string {
  if (report.ok) return `账本对得上，${report.held} 条`
  const parts: string[] = []
  if (report.lost.length > 0) parts.push(`丢了 ${report.lost.length} 条（${report.lost.join('、')}）`)
  if (report.changed.length > 0) {
    const detail = report.changed.map(one => `${one.id} ${one.expectedLen}→${one.actualLen} 字`).join('、')
    parts.push(`正文被改 ${report.changed.length} 条（${detail}）`)
  }
  if (report.unrecorded.length > 0) parts.push(`还没入账 ${report.unrecorded.length} 条（${report.unrecorded.join('、')}）`)
  return parts.join('；')
}

// 读账本，读不出来就当还没建过，靠随后的对账把话说清
function readBook(file: string): LedgerBook {
  try {
    if (!fs.existsSync(file)) return emptyBook()
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim() === '') return emptyBook()
    const parsed = JSON.parse(text) as Partial<LedgerBook>
    return { version: 1, entries: parsed.entries ?? {} }
  } catch {
    return emptyBook()
  }
}

// 先写临时文件再改名，半截文件不会留在原地
function writeBook(file: string, book: LedgerBook): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(book, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

// 账本里现在有多少条
function countEntries(book: LedgerBook): number {
  return Object.keys(book.entries).length
}

/**
 * 跑一次账本：建账、补新、对账
 * @param action - 做哪一件
 * @param options - 账本文件与现在的全部记忆
 * @returns 这次的结果
 */
export function runLedger(action: LedgerAction, options: LedgerRunOptions): LedgerRunResult {
  const current = readBook(options.file)
  if (action === 'verify') {
    return { action, report: verifyBook(current, options.items), added: [], entries: countEntries(current) }
  }
  const next = action === 'init'
    ? { book: initBook(options.items), added: options.items.map(item => item.id) }
    : syncBook(current, options.items)
  writeBook(options.file, next.book)
  return { action, report: verifyBook(next.book, options.items), added: next.added, entries: countEntries(next.book) }
}
