// 黑话：把群里学到的词记在本机一份文件里，只记词、意思与出处，不记整段对话

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'

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
}

/** 写词的结果 */
export type SlangWriteOutcome =
  | { ok: true; word: string; created: boolean }
  | { ok: false; code: string; reason: string; hint: string }

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
  return readSlangs(file).slice(0, Math.max(1, Math.floor(limit)))
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
  if (all.some(slang => slang.word === trimmed)) return { ok: true, word: trimmed, created: false }
  const next = [...all, { word: trimmed, meaning: meaning.trim(), from, at }]
  try {
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
    return { ok: true, word: trimmed, created: true }
  } catch {
    return { ok: false, code: 'slang.write_failed', reason: '词没存进去', hint: '看一下词表文件能不能写，别换个说法重复提交' }
  }
}
