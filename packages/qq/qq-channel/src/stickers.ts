// 表情包：库放在本机一个文件里，工具只负责按标签列、按编号取，不替她挑

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'

/** 一张图 */
export type Sticker = {
  /** 编号，发的时候认它 */
  id: string
  /** 什么时候用得上，几个词 */
  tag: string
  /** 结构化的适用场景 */
  tags: string[]
  /** 适合带出的情绪 */
  emotions: string[]
  /** 情绪强度，零到一；没标就是空 */
  intensity: number | null
  /** 一句使用说明 */
  usage: string
  /** 图放在哪 */
  file: string
}

/** 列图的结果 */
export type StickerListOutcome = { ok: true; stickers: Sticker[] } | StickerFailure

/** 取一张的结果 */
export type StickerPickOutcome = { ok: true; sticker: Sticker } | StickerFailure

/** 读图失败时给的东西 */
export type StickerFailure = { ok: false; code: string; reason: string; hint: string }

/** 表情包的使用反馈 */
export interface StickerUsage {
  useCount: number
  successCount: number
  failureCount: number
  lastUsedAt: number
}

/** 一次候选匹配 */
export interface StickerMatch {
  sticker: Sticker
  score: number
  reasons: string[]
  usage: StickerUsage
}

/** 候选匹配结果 */
export type StickerMatchOutcome = { ok: true; stickers: StickerMatch[] } | StickerFailure

/** 眼前这一轮的处境，只用来算分 */
export interface StickerSituation {
  /** 此刻的情绪，一个词 */
  emotion?: string
  /** 眼下的场景，用当时的话说 */
  context?: string
  /** 情绪强度，零到一 */
  intensity?: number
}

/** 顺手推给模型的一张候选 */
export interface StickerCandidate {
  /** 编号，发的时候认它 */
  id: string
  /** 为什么适合，逐条写清 */
  reasons: string[]
  /** 库里那句使用说明 */
  usage: string
}

/** 自动候选的结果 */
export type StickerSuggestOutcome =
  | { ok: true; candidates: StickerCandidate[]; librarySize: number; fallback?: boolean }
  | { ok: false; code: string; reason: string }

/**
 * 这一包默认把库放在哪
 * @param home 数据根目录，不给就按 HUOLI_HOME 定
 * @returns 库文件的绝对路径
 */
export function defaultStickerFile(home?: string): string {
  return join(resolveHuoliHome(home), 'data', 'qq-stickers.json')
}

/**
 * 使用反馈默认放在哪
 * @param home 数据根目录
 * @returns 使用反馈文件路径
 */
export function defaultStickerUsageFile(home?: string): string {
  return join(resolveHuoliHome(home), 'data', 'qq-sticker-usage.json')
}

/** 只认该认的字段，别让库里多出来的东西混进提示词 */
function asSticker(raw: unknown): Sticker | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.file !== 'string') return undefined
  if (row.id === '' || row.file === '') return undefined
  const tag = typeof row.tag === 'string' ? row.tag : ''
  const tags = Array.isArray(row.tags)
    ? row.tags.filter(value => typeof value === 'string')
    : tag.split(/[\s,，、]+/u).filter(value => value !== '')
  const emotions = Array.isArray(row.emotions)
    ? row.emotions.filter(value => typeof value === 'string')
    : []
  const intensity = typeof row.intensity === 'number' && Number.isFinite(row.intensity)
    ? Math.min(1, Math.max(0, row.intensity))
    : null
  return {
    id: row.id,
    tag,
    tags,
    emotions,
    intensity,
    usage: typeof row.usage === 'string' ? row.usage : '',
    file: row.file,
  }
}

/**
 * 把整份库读回来，坏了就当一份都没有
 * @param file 库文件在哪
 * @returns 一份图，读不动时是空表
 */
export function readStickers(file: string): Sticker[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asSticker).filter((row): row is Sticker => row !== undefined)
  } catch {
    return []
  }
}

/**
 * 把库列出来，哪张合适由模型自己挑，代码不按词猜
 * @param file 库文件在哪
 * @param limit 最多几张
 * @returns 列出来的几张
 */
export function listStickers(file: string, limit: number): StickerListOutcome {
  const all = readStickers(file)
  const picked = all.slice(0, Math.max(1, Math.floor(limit)))
  return picked.length === 0
    ? { ok: false, code: 'sticker.none', reason: '一份图都没存', hint: '先往库里加几张' }
    : { ok: true, stickers: picked }
}

/**
 * 按编号取一张
 * @param file 库文件在哪
 * @param id 图的编号
 * @returns 那一张，或带码与提示的失败
 */
export function stickerOf(file: string, id: string): StickerPickOutcome {
  const found = readStickers(file).find(sticker => sticker.id === id)
  return found === undefined
    ? { ok: false, code: 'sticker.unknown', reason: '库里没有这个编号', hint: '先用 qq_list_stickers 列一遍，照它给的编号挑' }
    : { ok: true, sticker: found }
}

function readUsage(file: string): Record<string, StickerUsage> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, StickerUsage> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      const row = value as Record<string, unknown>
      out[id] = {
        useCount: Math.max(0, Math.round(typeof row.useCount === 'number' ? row.useCount : 0)),
        successCount: Math.max(0, Math.round(typeof row.successCount === 'number' ? row.successCount : 0)),
        failureCount: Math.max(0, Math.round(typeof row.failureCount === 'number' ? row.failureCount : 0)),
        lastUsedAt: typeof row.lastUsedAt === 'number' && Number.isFinite(row.lastUsedAt) ? row.lastUsedAt : 0,
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 记一次表情发送结果
 * @param file - 使用反馈文件
 * @param id - 表情编号
 * @param ok - 是否发出
 * @param at - 发送时刻
 */
export function recordStickerUse(file: string, id: string, ok: boolean, at: number): void {
  const usage = readUsage(file)
  const current = usage[id] ?? { useCount: 0, successCount: 0, failureCount: 0, lastUsedAt: 0 }
  usage[id] = {
    useCount: current.useCount + 1,
    successCount: current.successCount + (ok ? 1 : 0),
    failureCount: current.failureCount + (ok ? 0 : 1),
    lastUsedAt: at,
  }
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(usage, null, 2)}\n`, { mode: 0o600 })
  // 改名由调用方同一线程完成，失败只影响反馈统计
  try {
    renameSync(temporary, file)
  } catch {
    // 反馈写不完时保留原文件
  }
}

/** 一张图对这次处境的打分 */
interface StickerScore {
  sticker: Sticker
  score: number
  reasons: string[]
  usage: StickerUsage
  emotionHit: boolean
}

/** 还没用过的那份反馈 */
function noUsage(): StickerUsage {
  return { useCount: 0, successCount: 0, failureCount: 0, lastUsedAt: 0 }
}

// 列候选与自动候选都用这一处打分，免得两套分数对不上
function scoreOf(sticker: Sticker, situation: StickerSituation, stats: StickerUsage): StickerScore {
  const emotion = situation.emotion?.trim().toLowerCase() ?? ''
  const context = situation.context?.trim().toLowerCase() ?? ''
  const reasons: string[] = []
  let score = 0
  const emotionHit = emotion !== '' && sticker.emotions.some(item => item.toLowerCase() === emotion)
  if (emotionHit) {
    score += 5
    reasons.push(`情绪匹配：${emotion}`)
  }
  const tagHits = sticker.tags.filter(tag => context.includes(tag.toLowerCase()) || emotion.includes(tag.toLowerCase()))
  if (tagHits.length > 0) {
    score += Math.min(3, tagHits.length)
    reasons.push(`场景相近：${tagHits.join('、')}`)
  }
  if (situation.intensity !== undefined && sticker.intensity !== null) {
    const gap = Math.abs(Math.min(1, Math.max(0, situation.intensity)) - sticker.intensity)
    score += Math.max(0, 1 - gap)
    reasons.push(`强度相差 ${gap.toFixed(2)}`)
  }
  if (stats.useCount > 0) {
    score += (stats.successCount - stats.failureCount) / stats.useCount
    reasons.push(`以前用过 ${stats.useCount} 次`)
  }
  return { sticker, score, reasons, usage: stats, emotionHit }
}

// 分高的在前，同分先用过的在前，再按编号
function byScore(left: StickerScore, right: StickerScore): number {
  return right.score - left.score
    || right.usage.lastUsedAt - left.usage.lastUsedAt
    || left.sticker.id.localeCompare(right.sticker.id)
}

/**
 * 按情绪、场景和成功反馈给候选排序，最终选哪张仍由模型决定
 * @param file - 表情库
 * @param usageFile - 使用反馈
 * @param situation - 情绪、场景和强度
 * @param limit - 最多几张
 * @returns 排好序的候选
 */
export function matchStickers(
  file: string,
  usageFile: string,
  situation: StickerSituation,
  limit: number,
): StickerMatchOutcome {
  const usage = readUsage(usageFile)
  const cards = readStickers(file)
  if (cards.length === 0) return { ok: false, code: 'sticker.none', reason: '一份图都没存', hint: '先往库里加几张' }
  const rows = cards
    .map(card => scoreOf(card, situation, usage[card.id] ?? noUsage()))
    .sort(byScore)
    .slice(0, Math.max(1, Math.floor(limit)))
  return {
    ok: true,
    stickers: rows.map(row => ({ sticker: row.sticker, score: row.score, reasons: row.reasons, usage: row.usage })),
  }
}

/**
 * 这一轮适合配哪张：分数跟列候选同一套，只在真有信号时给，刚在这一处发过就不推
 * @param file - 表情库
 * @param usageFile - 使用反馈
 * @param situation - 此刻的情绪、场景与强度
 * @param options - 现在几点、最多几张、这一处上次发图的时刻与窗口
 * @returns 候选、空库，或刚发过的码
 */
export function suggestStickers(
  file: string,
  usageFile: string,
  situation: StickerSituation,
  options: { at: number; limit: number; recentSentAt: number; recentWindowMs: number },
): StickerSuggestOutcome {
  const cards = readStickers(file)
  if (cards.length === 0) return { ok: true, candidates: [], librarySize: 0 }
  const window = Math.max(0, options.recentWindowMs)
  if (options.recentSentAt > 0 && options.at - options.recentSentAt < window) {
    return { ok: false, code: 'sticker.just_sent', reason: '这一处刚发过一张表情包' }
  }
  const usage = readUsage(usageFile)
  // 没要情绪时只认算出来的信号；要了情绪时先找真对上的，没有再给最接近的几张
  const wanted = situation.emotion?.trim() ?? ''
  const rows = cards
    .map(card => scoreOf(card, situation, usage[card.id] ?? noUsage()))
    .filter(row => row.score > 0)
  let picked = rows.filter(row => wanted === '' || row.emotionHit).sort(byScore)
  let fallback = false
  if (picked.length === 0 && wanted !== '') {
    picked = rows.slice().sort(byScore)
    fallback = picked.length > 0
  }
  const candidates = picked
    .slice(0, Math.max(1, Math.floor(options.limit)))
    .map(row => ({ id: row.sticker.id, reasons: row.reasons, usage: row.sticker.usage }))
  return { ok: true, candidates, librarySize: cards.length, ...fallback ? { fallback: true } : {} }
}
