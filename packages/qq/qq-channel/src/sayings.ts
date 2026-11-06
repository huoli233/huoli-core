// 说法：群里常听到的短句、口头禅、谚语，记下来给模型当语料，不替它决定用不用

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'

/** 一句说法 */
export type Saying = {
  /** 那句话 */
  text: string
  /** 大概什么时候用 */
  when: string
  /** 在哪儿听来的，只留会话键 */
  from: string
  /** 什么时候记的，毫秒 */
  at: number
}

/** 写一句说法的结果 */
export type SayingWriteOutcome =
  | { ok: true; text: string; created: boolean }
  | { ok: false; code: string; reason: string; hint: string }

/**
 * 这一包默认把说法库放在哪
 * @param home 数据根目录，不给就按 HUOLI_HOME 定
 * @returns 库文件的绝对路径
 */
export function defaultSayingFile(home?: string): string {
  return join(resolveHuoliHome(home), 'data', 'qq-sayings.json')
}

/** 只认该认的字段 */
function asSaying(raw: unknown): Saying | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  if (typeof row.text !== 'string' || row.text.trim() === '') return undefined
  return {
    text: row.text.trim(),
    when: typeof row.when === 'string' ? row.when : '',
    from: typeof row.from === 'string' ? row.from : '',
    at: typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : 0,
  }
}

/**
 * 把整份库读回来，坏了就当一句都没有
 * @param file 库文件在哪
 * @returns 记下来的说法，读不动时是空表
 */
export function readSayings(file: string): Saying[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asSaying).filter((row): row is Saying => row !== undefined)
  } catch {
    return []
  }
}

/**
 * 按字串找说法，句子里含这个字串就算命中
 * @param file 库文件在哪
 * @param query 想查什么，空串就列全部
 * @param limit 最多几句
 * @returns 命中的几句
 */
export function findSayings(file: string, query: string, limit: number): Saying[] {
  const wanted = query.trim()
  const all = readSayings(file)
  const picked = wanted === '' ? all : all.filter(saying => saying.text.includes(wanted) || saying.when.includes(wanted))
  return picked.slice(0, Math.max(1, Math.floor(limit)))
}

/**
 * 记一句说法，同一句只记一次
 * @param file 库文件在哪
 * @param text 那句话
 * @param when 大概什么时候用
 * @param from 在哪儿听来的
 * @param at 什么时候记的，毫秒
 * @returns 记成了没有，以及是不是新建的
 */
export function addSaying(file: string, text: string, when: string, from: string, at: number): SayingWriteOutcome {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, code: 'saying.empty', reason: '没有话可记', hint: '写清是哪一句' }
  if (trimmed.length > 60) return { ok: false, code: 'saying.too_long', reason: '这句太长了', hint: '只记短句、口头禅、谚语本身' }
  const all = readSayings(file)
  if (all.some(saying => saying.text === trimmed)) return { ok: true, text: trimmed, created: false }
  const next = [...all, { text: trimmed, when: when.trim(), from, at }]
  try {
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
    return { ok: true, text: trimmed, created: true }
  } catch {
    return { ok: false, code: 'saying.write_failed', reason: '这句没存进去', hint: '看一下库文件能不能写，别换个说法重复提交' }
  }
}
