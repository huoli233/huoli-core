// 语音：库放在本机一个文件里，按编号取一段；发之前量一遍，发之后回读确认

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import type { PacingVerdict, VoiceLimits } from '@huoli/huoli-qq-pacing'

/** 一段声音 */
export type Voice = {
  /** 编号，发的时候认它 */
  id: string
  /** 什么时候用得上，几个词 */
  tag: string
  /** 声音放在哪 */
  file: string
  /** 记下来的时长，没量过就不填，发之前按文件现算 */
  durationMs?: number
}

/** 要量、要发的那一段，只要有文件与记下来的时长 */
export type VoiceSource = {
  /** 声音放在哪 */
  file: string
  /** 记下来的时长，没量过就不填，发之前按文件现算 */
  durationMs?: number
}

/** 列声音的结果 */
export type VoiceListOutcome = { ok: true; voices: Voice[] } | { ok: false; code: string; reason: string; hint: string }

/** 取一段的结果 */
export type VoicePickOutcome = { ok: true; voice: Voice } | { ok: false; code: string; reason: string; hint: string }

/** 量完这一段的结论 */
export interface VoiceInspection {
  ok: true
  /** 这一段多少秒，保留一位小数 */
  seconds: number
  /** 这一段多少字节 */
  bytes: number
  /** 时长是量出来的还是按字节估的 */
  measured: boolean
}

/** 量不通过时的结论 */
export type VoiceInspectOutcome = VoiceInspection | { ok: false; code: string; reason: string; hint: string }

/** 发完之后回读到的样子，只留有没有语音段 */
export type VoiceFetchOutcome =
  | { ok: true; hasRecord: boolean }
  | { ok: false; code: string; reason: string; hint: string }

/** 发一段语音要用的几样东西 */
export interface VoiceSendDeps {
  /** 量时长与字节的上限 */
  limits: VoiceLimits
  /** 真把那一段发出去，只回成功与否与消息编号 */
  send: (file: string) => Promise<{ ok: boolean; messageId?: string; code?: string; reason?: string }>
  /** 发完按消息编号回读那一条 */
  fetch: (messageId: string) => Promise<VoiceFetchOutcome>
  /** 语音自己那本账：发之前查一次，发出去之后记一次 */
  quota?: { check: () => PacingVerdict; spend: () => void }
}

/** 发一段语音的结论，只说确认与时长，不回传文件与播放地址 */
export type VoiceSendOutcome =
  | { ok: true; confirmed: boolean; seconds: number; messageId?: string; note?: string }
  | { ok: false; code: string; reason: string; hint: string }

// 一段 AMR 窄带音频每帧二十毫秒、帧头加数据三十二字节
const AMR_HEADER = '#!AMR\n'
const AMR_FRAME_BYTES = 32
const AMR_FRAME_MS = 20

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
  const durationMs = Number(row.durationMs)
  return {
    id: row.id,
    tag: typeof row.tag === 'string' ? row.tag : '',
    file: row.file,
    ...Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {},
  }
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
 * 把库列出来，哪段合适由模型自己挑，代码不按词猜
 * @param file 库文件在哪
 * @param limit 最多几段
 * @returns 列出来的几段
 */
export function listVoices(file: string, limit: number): VoiceListOutcome {
  const all = readVoices(file)
  const picked = all.slice(0, Math.max(1, Math.floor(limit)))
  return picked.length === 0
    ? { ok: false, code: 'voice.none', reason: '一段声音都没存', hint: '先往库里加几段' }
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

// 按 AMR 窄带的帧数算时长，认不出这个头就回 undefined
function amrMs(bytes: number, head: string): number | undefined {
  if (!head.startsWith(AMR_HEADER)) return undefined
  const frames = Math.floor((bytes - AMR_HEADER.length) / AMR_FRAME_BYTES)
  return frames > 0 ? frames * AMR_FRAME_MS : undefined
}

// 只读开头几个字节认格式，不把整段音频读进内存
function headOf(file: string): string {
  const handle = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(AMR_HEADER.length)
    const read = readSync(handle, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read).toString('latin1')
  } finally {
    closeSync(handle)
  }
}

/**
 * 发之前量一遍：多长、多大，超上限就当场拒绝
 * 时长优先用库里记的，其次按 AMR 帧数量，认不出格式就按字节估
 * @param voice 要发的那一段
 * @param limits 时长与字节的上限
 * @returns 量出来的结论，或带码与提示的失败
 */
export function inspectVoice(voice: VoiceSource, limits: VoiceLimits): VoiceInspectOutcome {
  let size = 0
  let head = ''
  try {
    size = statSync(voice.file).size
    head = headOf(voice.file)
  } catch (readError) {
    // 读不到就是这一段不在了，别把本机路径写进结论
    void readError
    return { ok: false, code: 'voice.missing', reason: '这一段在本机找不到了', hint: '重新往库里放一段，或者换别的编号' }
  }
  if (size > limits.maxBytes) {
    const limitMb = (limits.maxBytes / 1_048_576).toFixed(1)
    return {
      ok: false,
      code: 'voice.too_big',
      reason: `这一段 ${(size / 1_048_576).toFixed(1)} MB，超过 ${limitMb} MB 的上限`,
      hint: '换一段小的，或者把它压一压再放回库里',
    }
  }
  const recorded = voice.durationMs !== undefined && voice.durationMs > 0 ? voice.durationMs : undefined
  const fromAmr = recorded === undefined ? amrMs(size, head) : undefined
  const estimated = recorded === undefined && fromAmr === undefined
  const ms = recorded ?? fromAmr ?? (size / limits.bytesPerSecond) * 1000
  const seconds = Math.round(ms / 100) / 10
  if (seconds > limits.maxSeconds) {
    return {
      ok: false,
      code: 'voice.too_long',
      reason: `这一段 ${seconds} 秒，超过 ${limits.maxSeconds} 秒的上限`,
      hint: '换一段短的，或者把这段剪短再放回库里',
    }
  }
  return { ok: true, seconds, bytes: size, measured: !estimated }
}

/**
 * 发一段语音：先量、再过语音自己的额度、发出去、按编号回读确认
 * 回读里没有语音段时只报原因，不回传文件与播放地址
 * @param voice 要发的那一段
 * @param deps 发送、回读与额度
 * @returns 确认与时长；失败时给码、原因与下一步
 */
export async function sendVoice(voice: VoiceSource, deps: VoiceSendDeps): Promise<VoiceSendOutcome> {
  const inspection = inspectVoice(voice, deps.limits)
  if (!inspection.ok) return inspection
  const verdict = deps.quota?.check()
  if (verdict !== undefined && !verdict.ok) {
    return {
      ok: false,
      code: verdict.code ?? 'pacing.voice_full',
      reason: verdict.reason ?? '语音额度用完了',
      hint: verdict.hint ?? '这一轮改用文字',
    }
  }
  const sent = await deps.send(voice.file)
  if (!sent.ok) {
    return {
      ok: false,
      code: sent.code ?? 'voice.send_failed',
      reason: sent.reason ?? '这一段没发出去',
      hint: '等一下再试，别连着发同一段',
    }
  }
  // 发出去了就记一笔语音额度：回读不到也不能当没发，免得被重复刷
  deps.quota?.spend()
  const messageId = sent.messageId
  if (messageId === undefined || messageId === '') {
    return { ok: true, confirmed: false, seconds: inspection.seconds, note: '发出去了，但没拿到消息编号，没法回读确认' }
  }
  const fetched = await deps.fetch(messageId)
  if (!fetched.ok) {
    return { ok: true, confirmed: false, seconds: inspection.seconds, messageId, note: `发出去了，但回读没成：${fetched.reason}` }
  }
  if (!fetched.hasRecord) {
    return { ok: true, confirmed: false, seconds: inspection.seconds, messageId, note: '发出去了，但回读里没看到语音段，可能被网关换成了别的' }
  }
  return { ok: true, confirmed: true, seconds: inspection.seconds, messageId }
}
