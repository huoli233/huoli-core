// 语音转写：QQ 语音先转 16k 单声道 WAV，再走 OpenAI 兼容的 /audio/transcriptions。
// 只做“听”，不做 TTS；key 只在本进程读，不返回给模型。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCredentialRef } from './image-gen.ts'
import type SpeechToText from '@huoli/huoli-experimental-speech-to-text'
import type { SpeechRequest, SpeechSpec, Transcript } from '@huoli/huoli-experimental-speech-to-text/types'
import type { Config } from './types.ts'

/** 一段语音转写出来的事实 */
export interface VoiceTranscript {
  ok: true
  text: string
  /** SenseVoice 之类模型给的情绪标签，比如 HAPPY / SAD */
  emotion?: string
  /** 非语音声，比如 LAUGHTER / APPLAUSE */
  event?: string
  /** 语言标签，比如 zh / en */
  language?: string
  /** 音频秒数，拿不到就不填 */
  seconds?: number
}

/** 语音识别成功时的文字与线索，或不含音频正文的失败原因。 */
export type VoiceTranscriptOutcome = VoiceTranscript | { ok: false; reason: string }

/** 读 asr.json 与 profile 覆盖后真正要用的配置 */
export interface AsrSettings {
  enabled: boolean
  /** local = 本机识别；external = 显式选择的外部 API */
  mode: 'local' | 'external'
  /** managed = Huoli 本机识别器；openai-compatible = 明确配置的 HTTP 接口 */
  transport: 'managed' | 'openai-compatible'
  baseURL: string
  model: string
  key: string
  language: string
  timeoutMs: number
  maxSeconds: number
  ffmpegPath: string
  /** 本机服务没开时要不要按 asr.json 的 manage.start 拉起来 */
  autoStart: boolean
  startCommand: readonly string[]
  startWaitMs: number
}

/** 从 asr.json 读出来的原始字段 */
interface AsrFile {
  baseUrl?: unknown
  model?: unknown
  key?: unknown
  language?: unknown
  timeoutMs?: unknown
  maxSeconds?: unknown
  mode?: unknown
  manage?: { start?: unknown; waitMs?: unknown }
}

function asrFilePath(config: Config): string {
  if (typeof config.asrConfigFile === 'string' && config.asrConfigFile.trim() !== '') return config.asrConfigFile.trim()
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'asr.json')
}

function readAsrFile(file: string): AsrFile {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function textOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function numberOf(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback
}

/**
 * 合并 profile、asr.json 和凭证，算出这一轮要不要听、听什么
 * @param config - 组合包配置
 * @returns 关闭时返回 undefined
 */
export function resolveAsrSettings(config: Config): AsrSettings | undefined {
  const file = readAsrFile(asrFilePath(config))
  const enabled = config.asrEnabled ?? true
  const configuredMode = config.asrMode ?? textOf(file.mode)
  const mode: 'local' | 'external' = configuredMode === 'external' ? 'external' : 'local'
  const rawBase = textOf(config.asrBaseURL, mode === 'external' ? textOf(file.baseUrl) : '')
  const rawModel = textOf(config.asrModel, mode === 'external' ? textOf(file.model) : '')
  const isLoopbackURL = (value: string): boolean => {
    try {
      const url = new URL(value)
      return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
    } catch {
      return false
    }
  }
  if (!enabled) return undefined
  const hasEndpoint = rawBase !== '' || rawModel !== ''
  const transport = mode === 'local' && !hasEndpoint ? 'managed' : 'openai-compatible'
  if (transport === 'managed') {
    return {
      enabled: true,
      mode,
      transport,
      baseURL: '',
      model: '',
      key: '',
      language: textOf(config.asrLanguage, 'zh'),
      timeoutMs: numberOf(config.asrTimeoutMs, 120_000, 1_000, 120_000),
      maxSeconds: numberOf(config.asrMaxSeconds, 120, 1, 600),
      ffmpegPath: textOf(config.asrFfmpegPath, 'ffmpeg'),
      autoStart: false,
      startCommand: [],
      startWaitMs: numberOf(config.asrStartWaitMs, 8_000, 500, 120_000),
    }
  }
  if (rawBase === '' || rawModel === '') throw new Error('ASR 使用 HTTP 接口时必须同时配置 asrBaseURL 与 asrModel')
  if (mode === 'local' && !isLoopbackURL(rawBase)) throw new Error('本机 ASR 的 HTTP 地址必须指向 localhost、127.0.0.1 或 ::1')
  const baseURL = rawBase.replace(/\/+$/u, '')
  let key = ''
  // 本机服务不要求 key；外部 API 才读凭证
  if (mode === 'external') {
    if (typeof config.asrKeyRef === 'string' && config.asrKeyRef.trim() !== '') {
      try {
        key = readCredentialRef(config.asrKeyRef.trim(), config.asrCredentialFile ?? '')
      } catch {
        key = ''
      }
    }
    if (key === '') key = textOf(file.key)
  }
  const start = Array.isArray(config.asrStartCommand)
    ? config.asrStartCommand.map(String)
    : Array.isArray(file.manage?.start) ? file.manage.start.map(String) : []
  return {
    enabled: true,
    mode,
    transport,
    baseURL,
    model: rawModel,
    key,
    language: textOf(config.asrLanguage, textOf(file.language, 'zh')),
    timeoutMs: numberOf(config.asrTimeoutMs ?? file.timeoutMs, 15_000, 1_000, 60_000),
    maxSeconds: numberOf(config.asrMaxSeconds ?? file.maxSeconds, 120, 1, 600),
    ffmpegPath: textOf(config.asrFfmpegPath, 'ffmpeg'),
    autoStart: config.asrAutoStart ?? start.length > 0,
    startCommand: start,
    startWaitMs: numberOf(config.asrStartWaitMs ?? file.manage?.waitMs, 8_000, 500, 120_000),
  }
}

/** 从 SenseVoice 的文本中分离正文、情绪、声音事件与语言标签。
 * @param raw - ASR 返回的原始文字。
 * @returns 去除标签后的正文与识别到的线索。
 */
export function parseAsrText(raw: string): Pick<VoiceTranscript, 'text' | 'emotion' | 'event' | 'language'> {
  const tags = [...raw.matchAll(/<\|([A-Za-z_]+)\|>/gu)].map(match => match[1]?.toUpperCase() ?? '')
  const text = raw.replace(/<\|[A-Za-z_]+\|>/gu, '').replace(/\s+/gu, ' ').trim()
  const emotions = new Set(['HAPPY', 'SAD', 'ANGRY', 'NEUTRAL', 'FEARFUL', 'DISGUSTED', 'SURPRISED', 'EMO_AMBIGUOUS'])
  const events = new Set(['LAUGHTER', 'APPLAUSE', 'CRY', 'COUGH', 'SNEEZE', 'BREATH', 'SIGH', 'MUSIC', 'NOISE'])
  const languages = new Set(['ZH', 'EN', 'JA', 'KO', 'YUE'])
  const emotion = tags.find(tag => emotions.has(tag))
  const event = tags.find(tag => events.has(tag))
  const language = tags.find(tag => languages.has(tag))?.toLowerCase()
  return {
    text,
    ...emotion === undefined ? {} : { emotion },
    ...event === undefined ? {} : { event },
    ...language === undefined ? {} : { language },
  }
}

/** 将音频限时转为 16 kHz 单声道 WAV；ffmpeg 失败时返回原因。
 * @param data - 原始音频字节。
 * @param mediaType - 平台提供的媒体类型。
 * @param settings - ffmpeg 路径、时长与超时上限。
 * @returns WAV 字节或转码失败原因。
 */
export function convertToWav(
  data: Uint8Array,
  mediaType: string,
  settings: Pick<AsrSettings, 'ffmpegPath' | 'maxSeconds' | 'timeoutMs'>,
): Promise<{ ok: true; wav: Uint8Array } | { ok: false; reason: string }> {
  const suffix = mediaType.includes('amr') ? '.amr'
    : mediaType.includes('silk') ? '.silk'
      : mediaType.includes('mpeg') || mediaType.includes('mp3') ? '.mp3'
        : mediaType.includes('ogg') ? '.ogg'
          : mediaType.includes('wav') ? '.wav'
            : '.bin'
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-asr-'))
  const input = path.join(dir, `in${suffix}`)
  const output = path.join(dir, 'out.wav')
  fs.writeFileSync(input, data)
  return new Promise((resolve) => {
    let settled = false
    const done = (result: { ok: true; wav: Uint8Array } | { ok: false; reason: string }): void => {
      if (settled) return
      settled = true
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录清不掉不影响转写 */ }
      resolve(result)
    }
    let child
    try {
      child = spawn(settings.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', input,
        '-t', String(settings.maxSeconds),
        '-ar', '16000', '-ac', '1', '-f', 'wav', output,
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      done({ ok: false, reason: `ffmpeg 起不来：${String(error instanceof Error ? error.message : error)}` })
      return
    }
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-400) })
    let timedOut = false
    let processError: string | undefined
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, settings.timeoutMs)
    child.on('error', (error) => {
      processError = error.message
      if (child.pid === undefined) {
        clearTimeout(timer)
        done({ ok: false, reason: `找不到 ffmpeg：${error.message}` })
      }
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        done({ ok: false, reason: '转码超时' })
        return
      }
      if (processError !== undefined) {
        done({ ok: false, reason: `转码失败：${processError}` })
        return
      }
      if (code !== 0) {
        done({ ok: false, reason: `转码失败（${code}）：${stderr.trim()}` })
        return
      }
      try {
        done({ ok: true, wav: new Uint8Array(fs.readFileSync(output)) })
      } catch (error) {
        done({ ok: false, reason: `读不到转码结果：${String(error instanceof Error ? error.message : error)}` })
      }
    })
  })
}

/** 本机 ASR 没开时按配置把它拉起来；只负责启动，不杀进程 */
function startLocalService(settings: AsrSettings): Promise<boolean> {
  const [command, ...args] = settings.startCommand
  if (command === undefined || command === '') return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (started: boolean): void => {
      if (settled) return
      settled = true
      resolve(started)
    }
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
      child.once('error', () => { finish(false) })
      child.once('spawn', () => {
        child.unref()
        finish(true)
      })
    } catch {
      finish(false)
    }
  })
}

/**
 * 向 OpenAI 兼容服务提交已经整理为 16 kHz 单声道的 WAV
 * @param wav 转换后的 WAV 字节
 * @param settings ASR 配置
 * @param fetchImpl 可替换的 HTTP 请求入口
 * @returns 转写事实或失败原因
 */
export async function transcribePreparedWav(
  wav: Uint8Array,
  settings: AsrSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceTranscriptOutcome> {
  if (wav.length === 0) return { ok: false, reason: '空音频' }
  if (settings.transport !== 'openai-compatible') return { ok: false, reason: '本机 ASR 必须通过 Huoli 语音识别服务调用' }
  const call = async (): Promise<Response> => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'voice.wav')
    form.append('model', settings.model)
    form.append('language', settings.language)
    return fetchImpl(`${settings.baseURL}/audio/transcriptions`, {
      method: 'POST',
      headers: settings.key === '' ? {} : { authorization: `Bearer ${settings.key}` },
      body: form,
      signal: AbortSignal.timeout(settings.timeoutMs),
    })
  }
  let response: Response
  try {
    response = await call()
  } catch (error) {
    // 本机服务常见情况：进程没开。按 asr.json 的 manage.start 拉一次，等它就绪再试
    if (settings.mode === 'local' && settings.autoStart && await startLocalService(settings)) {
      await new Promise(resolve => setTimeout(resolve, settings.startWaitMs))
      try {
        response = await call()
      } catch (retry) {
        return { ok: false, reason: `本机 ASR 没起来：${String(retry instanceof Error ? retry.message : retry)}` }
      }
    } else {
      return { ok: false, reason: `ASR 没连上：${String(error instanceof Error ? error.message : error)}` }
    }
  }
  const body = await response.json().catch(() => null) as { text?: unknown; error?: { message?: unknown } } | null
  if (!response.ok) {
    const why = typeof body?.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`
    return { ok: false, reason: `ASR 拒绝：${why}` }
  }
  const raw = typeof body?.text === 'string' ? body.text : ''
  const parsed = parseAsrText(raw)
  if (parsed.text === '') return { ok: false, reason: 'ASR 没返回文字' }
  return { ok: true, ...parsed }
}

/**
 * 把一段语音转成文字并提交到 OpenAI 兼容服务；失败只回原因，不抛
 * @param data - 原始音频字节
 * @param mediaType - 平台给的媒体类型
 * @param settings - ASR 配置
 * @param fetchImpl - 测试可替换
 * @param convertImpl - 测试可替换的音频转码器
 * @returns 转写事实或失败原因
 */
export async function transcribeVoice(
  data: Uint8Array,
  mediaType: string,
  settings: AsrSettings,
  fetchImpl: typeof fetch = fetch,
  convertImpl: typeof convertToWav = convertToWav,
): Promise<VoiceTranscriptOutcome> {
  if (data.length === 0) return { ok: false, reason: '空音频' }
  let converted: Awaited<ReturnType<typeof convertToWav>>
  try {
    converted = await convertImpl(data, mediaType, settings)
  } catch (error) {
    return { ok: false, reason: `音频转码失败：${String(error instanceof Error ? error.message : error)}` }
  }
  if (!converted.ok) return converted
  return transcribePreparedWav(converted.wav, settings, fetchImpl)
}

/** QQ 语音使用的本机识别服务方法。 */
export type LocalSpeechPort = Pick<SpeechToText, 'snapshot' | 'resolve' | 'transcribe' | 'prepare' | 'follow'>

/** Use the selected host-local provider without sending audio to an HTTP endpoint. */
async function transcribeWithLocalProvider(
  wav: Uint8Array,
  settings: AsrSettings,
  speech: LocalSpeechPort | undefined,
): Promise<VoiceTranscriptOutcome> {
  if (wav.length === 0) return { ok: false, reason: '空音频' }
  if (speech === undefined) return { ok: false, reason: 'Huoli 本机语音识别服务未加载' }
  const snapshot = speech.snapshot()
  const providerId = snapshot.selection.providerId
  const provider = snapshot.providers.find(item => item.id === providerId)
  if (provider === undefined) return { ok: false, reason: '配置的本机语音识别器未注册' }
  if (provider.location !== 'host-local') return { ok: false, reason: '当前语音识别器不是本机处理' }
  try {
    const request: SpeechRequest = { audio: wav, language: settings.language }
    const spec: SpeechSpec = speech.resolve(request)
    const transcript: Transcript = await speech.transcribe(spec, AbortSignal.timeout(settings.timeoutMs))
    const parsed = parseAsrText(transcript.text)
    if (parsed.text === '') return { ok: false, reason: 'ASR 没返回文字' }
    return { ok: true, ...parsed, seconds: transcript.audioSeconds }
  } catch (error) {
    return { ok: false, reason: `本机 ASR 失败：${String(error instanceof Error ? error.message : error)}` }
  }
}

/** 组合包拿到的转写入口 */
export interface AsrPort {
  /** 这段语音能不能听 */
  enabled: boolean
  /** 仅暴露传输方式、Provider 与准备阶段，不包含路径、音频或凭据 */
  status(): AsrStatus
  /** 转一段 */
  transcribe(data: Uint8Array, mediaType: string): Promise<VoiceTranscriptOutcome>
  /** 提交已经整理为 16 kHz 单声道的 WAV */
  transcribePreparedWav(data: Uint8Array): Promise<VoiceTranscriptOutcome>
  /** 停止后台 Provider 状态观察 */
  close(): void
}

/** Safe runtime facts for local operational diagnostics. */
export interface AsrStatus {
  transport: AsrSettings['transport']
  providerId?: string
  phase: string
}

/**
 * 按配置建一个转写入口；关闭时返回 undefined
 * @param config - 组合包配置
 * @param speech - Huoli 本机语音识别服务；本机模式使用
 * @param fetchImpl - 测试可替换
 * @param warn - 记录本机 Provider 缺失或启动失败
 * @returns 转写入口或 undefined
 */
export function createAsrPort(
  config: Config,
  speech: LocalSpeechPort | undefined,
  fetchImpl: typeof fetch = fetch,
  warn: (message: string) => void = () => {},
): AsrPort | undefined {
  const settings = resolveAsrSettings(config)
  if (settings === undefined) return undefined
  const lifetime = new AbortController()
  if (settings.transport === 'managed' && (config.asrPrepareOnStart ?? true)) {
    if (speech === undefined) warn('Huoli 本机语音识别服务未加载，QQ 语音转写不可用')
    else {
      void (async () => {
        let requested = false
        for await (const snapshot of speech.follow(lifetime.signal)) {
          const provider = snapshot.providers.find(item => item.id === snapshot.selection.providerId)
          if (provider === undefined) continue
          if (provider.location !== 'host-local') {
            warn('QQ 本机 ASR 选择的 Provider 不在本机，已跳过自动准备')
            return
          }
          const phase = provider.preparation.phase
          if (phase === 'ready') return
          if (phase === 'checking' || phase === 'downloading' || phase === 'loading' || phase === 'waking' || phase === 'cancelling') continue
          if (phase === 'failed' && requested) {
            warn(`Huoli 本机语音识别准备失败：${provider.preparation.message}`)
            return
          }
          if (!requested) {
            speech.prepare(snapshot.selection.providerId)
            requested = true
          }
        }
      })().catch((error: unknown) => {
        if (!lifetime.signal.aborted) warn(`Huoli 本机语音识别准备失败：${String(error instanceof Error ? error.message : error)}`)
      })
    }
  }
  const submitPrepared = (wav: Uint8Array): Promise<VoiceTranscriptOutcome> => settings.transport === 'managed'
    ? transcribeWithLocalProvider(wav, settings, speech)
    : transcribePreparedWav(wav, settings, fetchImpl)
  return {
    enabled: true,
    status: () => {
      if (settings.transport !== 'managed') return { transport: settings.transport, phase: 'external' }
      if (speech === undefined) return { transport: settings.transport, phase: 'service-unavailable' }
      try {
        const snapshot = speech.snapshot()
        const provider = snapshot.providers.find(item => item.id === snapshot.selection.providerId)
        return provider === undefined
          ? { transport: settings.transport, providerId: snapshot.selection.providerId, phase: 'provider-unavailable' }
          : { transport: settings.transport, providerId: provider.id, phase: provider.preparation.phase }
      } catch {
        return { transport: settings.transport, phase: 'unavailable' }
      }
    },
    transcribe: async (data, mediaType) => {
      if (data.length === 0) return { ok: false, reason: '空音频' }
      let converted: Awaited<ReturnType<typeof convertToWav>>
      try {
        converted = await convertToWav(data, mediaType, settings)
      } catch (error) {
        return { ok: false, reason: `音频转码失败：${String(error instanceof Error ? error.message : error)}` }
      }
      return converted.ok ? await submitPrepared(converted.wav) : converted
    },
    transcribePreparedWav: submitPrepared,
    close: () => { lifetime.abort(new Error('QQ ASR observer disposed')) },
  }
}
