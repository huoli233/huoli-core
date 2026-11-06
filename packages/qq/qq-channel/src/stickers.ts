// 表情包：库放在本机一个文件里，工具只负责按标签列、按编号取，不替她挑

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'

/** 一张图 */
export type Sticker = {
  /** 编号，发的时候认它 */
  id: string
  /** 什么时候用得上，几个词 */
  tag: string
  /** 图放在哪 */
  file: string
}

/** 列图的结果 */
export type StickerListOutcome = { ok: true; stickers: Sticker[] } | StickerFailure

/** 取一张的结果 */
export type StickerPickOutcome = { ok: true; sticker: Sticker } | StickerFailure

/** 读图失败时给的东西 */
export type StickerFailure = { ok: false; code: string; reason: string; hint: string }

/**
 * 这一包默认把库放在哪
 * @param home 数据根目录，不给就按 HUOLI_HOME 定
 * @returns 库文件的绝对路径
 */
export function defaultStickerFile(home?: string): string {
  return join(resolveHuoliHome(home), 'data', 'qq-stickers.json')
}

/** 只认该认的字段，别让库里多出来的东西混进提示词 */
function asSticker(raw: unknown): Sticker | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.file !== 'string') return undefined
  if (row.id === '' || row.file === '') return undefined
  return { id: row.id, tag: typeof row.tag === 'string' ? row.tag : '', file: row.file }
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
