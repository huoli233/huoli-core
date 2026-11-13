// 黑话：把群里学到的词记在本机一份文件里，只记词、意思与出处，不记整段对话

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'

/** 一个词学没学会 */
export type SlangStatus = 'pending' | 'approved' | 'rejected'

/** 一个学到的词 */
export type Slang = {
  /** 词本身 */
  word: string
  /** 大概什么意思 */
  meaning: string
  /** 在哪儿听来的，只留会话键 */
  from: string
  /** 什么时候记的，毫秒 */
  at: number
  /** 候选、已通过或已拒绝 */
  status: SlangStatus
  /** 在几条消息里见过 */
  evidenceCount: number
  /** 最近一次见到 */
  lastSeenAt: number
  /** 拒绝原因，只留短语 */
  reason: string
}

/** 写词的结果 */
export type SlangWriteOutcome =
  | { ok: true; word: string; created: boolean; status: SlangStatus }
  | { ok: false; code: string; reason: string; hint: string }

/** 自动提取的候选 */
export interface SlangCandidate {
  word: string
  evidenceCount: number
}

/** 提取候选时能覆盖的数字 */
export interface SlangExtractionOptions {
  minWordChars?: number
  maxWordChars?: number
  minMessages?: number
  minOccurrences?: number
  maxCandidates?: number
}

/** 自动提取的默认值 */
export const SLANG_DEFAULTS = {
  minWordChars: 2,
  maxWordChars: 12,
  minMessages: 2,
  minOccurrences: 3,
  maxCandidates: 20,
  maxItems: 500,
} as const

/**
 * 这一包默认把词表放在哪
 * @param home 数据根目录，不给就按 HUOLI_HOME 定
 * @returns 词表文件的绝对路径
 */
export function defaultSlangFile(home?: string): string {
  return join(resolveHuoliHome(home), 'data', 'qq-slang.json')
}

/** 只认该认的字段 */
function asSlang(raw: unknown): Slang | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  if (typeof row.word !== 'string' || row.word.trim() === '') return undefined
  return {
    word: row.word.trim(),
    meaning: typeof row.meaning === 'string' ? row.meaning : '',
    from: typeof row.from === 'string' ? row.from : '',
    at: typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : 0,
    status: row.status === 'pending' || row.status === 'rejected' ? row.status : 'approved',
    evidenceCount: typeof row.evidenceCount === 'number' && Number.isFinite(row.evidenceCount)
      ? Math.max(1, Math.floor(row.evidenceCount))
      : 1,
    lastSeenAt: typeof row.lastSeenAt === 'number' && Number.isFinite(row.lastSeenAt) ? row.lastSeenAt : 0,
    reason: typeof row.reason === 'string' ? row.reason : '',
  }
}

/**
 * 把整份词表读回来，坏了就当一个词都没有
 * @param file 词表文件在哪
 * @returns 学到的词，读不动时是空表
 */
export function readSlangs(file: string): Slang[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asSlang).filter((row): row is Slang => row !== undefined)
  } catch {
    return []
  }
}

/**
 * 把词表列出来，哪个用得上由模型自己挑，代码不按字串猜
 * @param file 词表文件在哪
 * @param limit 最多几条
 * @returns 列出来的几条
 */
export function findSlangs(file: string, limit: number): Slang[] {
  return readSlangs(file)
    .filter(slang => slang.status === 'approved')
    .slice(0, Math.max(1, Math.floor(limit)))
}

/** 列出待审核候选 */
export function pendingSlangs(file: string, limit: number): Slang[] {
  return readSlangs(file)
    .filter(slang => slang.status === 'pending')
    .sort((left, right) => right.evidenceCount - left.evidenceCount || right.lastSeenAt - left.lastSeenAt)
    .slice(0, Math.max(1, Math.floor(limit)))
}

/**
 * 分词后找近期反复出现的词，只提候选，不直接学会
 * @param messages - 近期群消息正文
 * @param options - 长度、重复门槛与候选数量
 * @returns 按重复度排好的候选
 */
export function extractSlangCandidates(
  messages: readonly string[],
  options: SlangExtractionOptions = {},
): SlangCandidate[] {
  const minChars = Math.max(2, Math.floor(options.minWordChars ?? SLANG_DEFAULTS.minWordChars))
  const maxChars = Math.max(minChars, Math.floor(options.maxWordChars ?? SLANG_DEFAULTS.maxWordChars))
  const minMessages = Math.max(1, Math.floor(options.minMessages ?? SLANG_DEFAULTS.minMessages))
  const minOccurrences = Math.max(1, Math.floor(options.minOccurrences ?? SLANG_DEFAULTS.minOccurrences))
  const maxCandidates = Math.max(1, Math.floor(options.maxCandidates ?? SLANG_DEFAULTS.maxCandidates))
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
  const rows = new Map<string, { count: number; messages: Set<number> }>()
  messages.forEach((text, index) => {
    const body = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
    for (const segment of segmenter.segment(text)) {
      if (!segment.isWordLike) continue
      const word = segment.segment.trim().toLowerCase()
      if (word.length < minChars || word.length > maxChars || /^\d+$/u.test(word)) continue
      const kept = rows.get(word) ?? { count: 0, messages: new Set<number>() }
      kept.count += 1
      kept.messages.add(index)
      rows.set(word, kept)
    }
    // 分词认不出的新词也可能在几条消息里反复出现，再用二到四字片段补一遍
    for (let size = minChars; size <= Math.min(4, maxChars); size += 1) {
      for (let at = 0; at + size <= body.length; at += 1) {
        const word = body.slice(at, at + size)
        const kept = rows.get(word) ?? { count: 0, messages: new Set<number>() }
        kept.count += 1
        kept.messages.add(index)
        rows.set(word, kept)
      }
    }
  })
  return [...rows.entries()]
    .filter(([, value]) => value.count >= minOccurrences && value.messages.size >= minMessages)
    .map(([word, value]) => ({ word, evidenceCount: value.messages.size }))
    .sort((left, right) => right.evidenceCount - left.evidenceCount || right.word.length - left.word.length)
    .slice(0, maxCandidates)
}

/**
 * 把自动提取的候选写进待审核区
 * @param file - 词表文件
 * @param candidates - 候选词
 * @param from - 哪个群
 * @param at - 什么时候提取
 * @param maxItems - 词表最多留几条
 * @returns 新写进去几条
 */
export function suggestSlangs(
  file: string,
  candidates: readonly SlangCandidate[],
  from: string,
  at: number,
  maxItems: number = SLANG_DEFAULTS.maxItems,
): number {
  if (candidates.length === 0) return 0
  const all = readSlangs(file)
  const byWord = new Map(all.map(slang => [slang.word, slang]))
  let created = 0
  for (const candidate of candidates) {
    const found = byWord.get(candidate.word)
    if (found !== undefined) {
      if (found.status === 'pending') {
        found.evidenceCount += Math.max(1, candidate.evidenceCount)
        found.lastSeenAt = Math.max(found.lastSeenAt, at)
      }
      continue
    }
    const next: Slang = {
      word: candidate.word,
      meaning: '',
      from,
      at,
      status: 'pending',
      evidenceCount: Math.max(1, candidate.evidenceCount),
      lastSeenAt: at,
      reason: '',
    }
    all.push(next)
    byWord.set(next.word, next)
    created += 1
  }
  if (created > 0) {
    const cap = Math.max(1, Math.floor(maxItems))
    const kept = all
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === 'approved' ? -1 : right.status === 'approved' ? 1 : 0
        return right.lastSeenAt - left.lastSeenAt
      })
      .slice(0, cap)
    writeSlangs(file, kept)
  }
  return created
}

/**
 * 审核一个候选
 * @param file - 词表文件
 * @param word - 候选词
 * @param decision - 通过或拒绝
 * @param meaning - 通过时补的意思
 * @param reason - 拒绝原因
 * @param at - 审核时刻
 * @returns 审核结果
 */
export function reviewSlang(
  file: string,
  word: string,
  decision: 'approve' | 'reject',
  meaning: string,
  reason: string,
  at: number,
): SlangWriteOutcome {
  const trimmed = word.trim()
  const all = readSlangs(file)
  const found = all.find(slang => slang.word === trimmed)
  if (found === undefined) return { ok: false, code: 'slang.unknown', reason: '词表里没有这个词', hint: '先看候选列表' }
  if (decision === 'approve') {
    const learned = meaning.trim()
    if (learned === '') return { ok: false, code: 'slang.meaning_required', reason: '还没写它的意思', hint: '先弄清意思再通过' }
    found.status = 'approved'
    found.meaning = learned
    found.reason = ''
    found.lastSeenAt = Math.max(found.lastSeenAt, at)
  } else {
    found.status = 'rejected'
    found.reason = reason.trim().slice(0, 120)
  }
  try {
    writeSlangs(file, all)
    return { ok: true, word: trimmed, created: false, status: found.status }
  } catch {
    return { ok: false, code: 'slang.write_failed', reason: '审核结果没存进去', hint: '看一下词表文件能不能写' }
  }
}

function writeSlangs(file: string, all: readonly Slang[]): void {
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`)
}

/**
 * 记一个词，同一个词只记一次，再提交就只回没新建
 * @param file 词表文件在哪
 * @param word 词本身
 * @param meaning 大概什么意思
 * @param from 在哪儿听来的
 * @param at 什么时候记的，毫秒
 * @returns 记成了没有，以及是不是新建的
 */
export function addSlang(file: string, word: string, meaning: string, from: string, at: number): SlangWriteOutcome {
  const trimmed = word.trim()
  if (trimmed === '') return { ok: false, code: 'slang.empty', reason: '没有词可记', hint: '写清是哪个词' }
  if (trimmed.length > 40) return { ok: false, code: 'slang.too_long', reason: '这个词太长了', hint: '只记词本身，别把一整句塞进来' }
  const all = readSlangs(file)
  const found = all.find(slang => slang.word === trimmed)
  if (found !== undefined) {
    if (found.status !== 'approved' && meaning.trim() !== '') {
      found.status = 'approved'
      found.meaning = meaning.trim()
      found.reason = ''
      found.lastSeenAt = Math.max(found.lastSeenAt, at)
      try {
        writeSlangs(file, all)
      } catch {
        return { ok: false, code: 'slang.write_failed', reason: '词没存进去', hint: '看一下词表文件能不能写' }
      }
    }
    return { ok: true, word: trimmed, created: false, status: found.status }
  }
  const next: Slang = {
    word: trimmed,
    meaning: meaning.trim(),
    from,
    at,
    status: 'approved',
    evidenceCount: 1,
    lastSeenAt: at,
    reason: '',
  }
  try {
    writeSlangs(file, [...all, next])
    return { ok: true, word: trimmed, created: true, status: 'approved' }
  } catch {
    return { ok: false, code: 'slang.write_failed', reason: '词没存进去', hint: '看一下词表文件能不能写，别换个说法重复提交' }
  }
}
