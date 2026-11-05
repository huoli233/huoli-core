// 叙事五章：首次补一份底稿，之后只有显式调用才动它；满一个日历月才提醒写一次

import fs from 'node:fs'
import { FILES } from './files.ts'
import type { SelfStore } from './store.ts'
import type { NarrativeState, NarrativeTick, SelfSettings, WriteOutcome } from './types.ts'

/** 五章标题，次序固定 */
export const NARRATIVE_CHAPTERS: readonly string[] = ['我是谁', '我做过什么', '我在意什么', '我答应过什么', '我还在学什么']

// 章节标题的前缀
const HEADING = '## '

// 这一章还没写时留的位置
const BLANK = '（待写）'

// 两格时刻都没记过
const NO_STATE: NarrativeState = { lastUpdateAt: 0, lastDueAt: 0 }

// 超长就截断，字段本身不丢
function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

// 取时刻，取不到或不是正数给零
function stampOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

// 认得出是一个对象
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

// 读回来的一份时间账，坏文件与缺格都按空账算
function parseState(text: string): NarrativeState {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // 半截的文件当没记过，下一次写就盖掉
    void error
    return NO_STATE
  }
  const record = asRecord(parsed)
  if (record === undefined) return NO_STATE
  return { lastUpdateAt: stampOf(record.lastUpdateAt), lastDueAt: stampOf(record.lastDueAt) }
}

/**
 * 读叙事的那本时间账
 * @param store - 目录读写口
 * @returns 两格时刻；还没有时间账时按叙事文件原有的修改时间当上次更新
 */
export function narrativeStateOf(store: SelfStore): NarrativeState {
  const text = store.readText(FILES.narrativeState)
  if (text !== undefined) return parseState(text)
  if (store.readText(FILES.narrative) === undefined) return NO_STATE
  try {
    return { lastUpdateAt: Math.round(fs.statSync(store.pathOf(FILES.narrative)).mtimeMs), lastDueAt: 0 }
  } catch (error) {
    // 文件刚被挪走，就当作没写过
    void error
    return NO_STATE
  }
}

// 时间账整份重写，只写这一份文件
function writeState(store: SelfStore, state: NarrativeState): void {
  store.writeText(FILES.narrativeState, `${JSON.stringify(state)}\n`)
}

// 正文一改就把上次更新记成这一刻，到期判断只看这一格
function noteUpdate(store: SelfStore, at: number): void {
  writeState(store, { lastUpdateAt: at, lastDueAt: narrativeStateOf(store).lastDueAt })
}

// 一个日历月之后：下个月的同一号，那一号不存在就取那个月的月末
function monthAfter(at: number): number {
  const from = new Date(at)
  const next = new Date(at)
  next.setDate(1)
  next.setMonth(next.getMonth() + 1)
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(from.getDate(), lastDay))
  next.setHours(from.getHours(), from.getMinutes(), from.getSeconds(), from.getMilliseconds())
  return next.getTime()
}

// 同一个年月，本地时间算
function sameMonth(left: number, right: number): boolean {
  if (left === 0) return false
  const before = new Date(left)
  const after = new Date(right)
  return before.getFullYear() === after.getFullYear() && before.getMonth() === after.getMonth()
}

// 从上次更新起满一个日历月，从没写过算到期
function dueAt(lastUpdateAt: number, now: number): boolean {
  return lastUpdateAt === 0 || now >= monthAfter(lastUpdateAt)
}

/**
 * 叙事该不该重写了
 * @param store - 目录读写口
 * @param now - 判断的时刻
 * @returns 满一个月或从没写过为真
 */
export function narrativeDue(store: SelfStore, now: number): boolean {
  return dueAt(narrativeStateOf(store).lastUpdateAt, now)
}

/**
 * 月更提醒：到期才给出「该写叙事」的信号，并把这次到期时刻记进时间账，同一个月只提醒一次
 * @param store - 目录读写口
 * @param now - 判断的时刻
 * @returns 到期没有、这一次要不要提醒
 */
export function monthlyTick(store: SelfStore, now: number): NarrativeTick {
  const state = narrativeStateOf(store)
  if (!dueAt(state.lastUpdateAt, now)) {
    return { due: false, remind: false, at: now, lastUpdateAt: state.lastUpdateAt, reason: 'not_due' }
  }
  if (sameMonth(state.lastDueAt, now)) {
    return { due: true, remind: false, at: now, lastUpdateAt: state.lastUpdateAt, reason: 'already_reminded' }
  }
  writeState(store, { lastUpdateAt: state.lastUpdateAt, lastDueAt: now })
  return { due: true, remind: true, at: now, lastUpdateAt: state.lastUpdateAt }
}

/**
 * 五章底稿
 * @returns 五个标题加每章留一行位置
 */
export function narrativeSkeleton(): string {
  const blocks = NARRATIVE_CHAPTERS.map(chapter => `${HEADING}${chapter}\n${BLANK}`)
  return `${blocks.join('\n\n')}\n`
}

/**
 * 读叙事
 * @param store - 目录读写口
 * @returns 全文，没有这份文件时为空串
 */
export function readNarrative(store: SelfStore): string {
  return store.readText(FILES.narrative) ?? ''
}

/**
 * 首次生成叙事底稿，已有那份就不动
 * @param store - 目录读写口
 * @param at - 这次补底稿的时刻，记进时间账
 * @returns 这次写没写
 */
export function seedNarrative(store: SelfStore, at: number): boolean {
  if (store.readText(FILES.narrative) !== undefined) return false
  store.writeText(FILES.narrative, narrativeSkeleton())
  noteUpdate(store, at)
  return true
}

// 按章节标题切段，标题前的行不算任何一章
function sectionsOf(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of text.split('\n')) {
    if (line.startsWith(HEADING)) {
      current = []
      sections.set(line.slice(HEADING.length).trim(), current)
      continue
    }
    if (current === undefined) continue
    const trimmed = line.trim()
    if (trimmed !== '' && trimmed !== BLANK) current.push(trimmed)
  }
  return sections
}

// 按固定的五章次序拼回去，没写的章留位置
function renderSections(sections: Map<string, string[]>): string {
  const blocks = NARRATIVE_CHAPTERS.map((chapter) => {
    const body = sections.get(chapter) ?? []
    return `${HEADING}${chapter}\n${body.length === 0 ? BLANK : body.join('\n\n')}`
  })
  return `${blocks.join('\n\n')}\n`
}

/**
 * 换掉或续写一章
 * @param store - 目录读写口
 * @param settings - 参数表
 * @param chapter - 五章里的哪一章，写法要逐字相同
 * @param text - 换上的正文，一行一段
 * @param mode - 整章换掉还是接在后面，默认换掉
 * @param at - 这次改动的时刻，记进时间账
 * @returns 落没落盘
 */
export function updateNarrative(
  store: SelfStore,
  settings: SelfSettings,
  chapter: string,
  text: string,
  at: number,
  mode: 'replace' | 'append' = 'replace',
): WriteOutcome {
  if (!NARRATIVE_CHAPTERS.includes(chapter)) return { written: false, proposed: false, reason: 'unknown_chapter' }
  const paragraphs = text.split('\n').map(line => line.trim()).filter(line => line !== '')
  if (paragraphs.length === 0) return { written: false, proposed: false, reason: 'no_evidence' }
  const current = readNarrative(store)
  const sections = sectionsOf(current === '' ? narrativeSkeleton() : current)
  const kept = sections.get(chapter) ?? []
  const merged = (mode === 'append' ? [...kept, ...paragraphs] : paragraphs)
    .map(line => clip(line, settings.narrativeParaMaxChars))
    .slice(-settings.narrativeParasMax)
  sections.set(chapter, merged)
  store.writeText(FILES.narrative, renderSections(sections))
  noteUpdate(store, at)
  return { written: true, proposed: false }
}
