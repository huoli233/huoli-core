// 语音：库放在本机一个文件里，按编号取一段发出去

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'

/** 一段声音 */
export type Voice = {
  /** 编号，发的时候认它 */
  id: string
  /** 什么时候用得上，几个词 */
  tag: string
  /** 声音放在哪 */
  file: string
}

/** 列声音的结果 */
export type VoiceListOutcome = { ok: true; voices: Voice[] } | { ok: false; code: string; reason: string; hint: string }

/** 取一段的结果 */
export type VoicePickOutcome = { ok: true; voice: Voice } | { ok: false; code: string; reason: string; hint: string }

/**
 * 这一包默认把库放在哪
 * @param home 数据根目录，不给就按 HUOLI_HOME 定
 * @returns 库文件的绝对路径
 */
export function defaultVoiceFile(home?: string): string {
  return join(resolveHuoliHome(home), 'data', 'qq-voices.json')
}

/** 只认该认的字段 */
function asVoice(raw: unknown): Voice | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.file !== 'string') return undefined
  if (row.id === '' || row.file === '') return undefined
  return { id: row.id, tag: typeof row.tag === 'string' ? row.tag : '', file: row.file }
}

/**
 * 把整份库读回来，坏了就当一份都没有
 * @param file 库文件在哪
 * @returns 一段段声音，读不动时是空表
 */
export function readVoices(file: string): Voice[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(asVoice).filter((row): row is Voice => row !== undefined)
  } catch {
    return []
  }
}

/**
 * 按标签列几段出来，标签空着就全列
 * @param file 库文件在哪
 * @param tag 想找哪个标签
 * @param limit 最多几段
 * @returns 列出来的几段
 */
export function listVoices(file: string, tag: string, limit: number): VoiceListOutcome {
  const all = readVoices(file)
  const wanted = tag.trim()
  const picked = (wanted === '' ? all : all.filter(voice => voice.tag.includes(wanted))).slice(0, Math.max(1, Math.floor(limit)))
  return picked.length === 0
    ? { ok: false, code: 'voice.none', reason: wanted === '' ? '一段声音都没存' : '没找到这个标签的声音', hint: '换个标签，或者先往库里加几段' }
    : { ok: true, voices: picked }
}

/**
 * 按编号取一段
 * @param file 库文件在哪
 * @param id 那段声音的编号
 * @returns 那一段，或带码与提示的失败
 */
export function voiceOf(file: string, id: string): VoicePickOutcome {
  const found = readVoices(file).find(voice => voice.id === id)
  return found === undefined
    ? { ok: false, code: 'voice.unknown', reason: '库里没有这个编号', hint: '先用 qq_list_voices 列一遍，照它给的编号挑' }
    : { ok: true, voice: found }
}
