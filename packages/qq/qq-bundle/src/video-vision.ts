// 视频先在本机限量抽帧和提取音轨，再复用图片理解与 ASR

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { VoiceTranscriptOutcome } from './asr.ts'

export interface VideoFrame {
  data: Uint8Array
  timestampMs: number
}

export interface VideoAnalysis {
  frames: readonly VideoFrame[]
  transcript?: VoiceTranscriptOutcome
  frameFailure?: string
  audioFailure?: string
}

export interface VideoVisionSettings {
  ffmpegPath: string
  timeoutMs: number
  maxSeconds: number
  frameIntervalSeconds: number
  maxFrames: number
  maxFrameDimension: number
  maxFrameBytes: number
}

type ProcessRunner = (command: string, args: readonly string[], timeoutMs: number) => Promise<{ ok: true } | { ok: false; reason: string }>

function runProcess(command: string, args: readonly string[], timeoutMs: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, [...args], { windowsHide: true, stdio: 'ignore' })
    } catch (error) {
      resolve({ ok: false, reason: error instanceof Error ? error.message : String(error) })
      return
    }
    let settled = false
    let timedOut = false
    let processError: string | undefined
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    const finish = (result: { ok: true } | { ok: false; reason: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.once('error', (error) => {
      processError = error.message
      if (child.pid === undefined) finish({ ok: false, reason: error.message })
    })
    child.once('close', (code) => {
      if (timedOut) finish({ ok: false, reason: '处理超时' })
      else if (processError !== undefined) finish({ ok: false, reason: processError })
      else finish(code === 0 ? { ok: true } : { ok: false, reason: `ffmpeg 退出码 ${String(code)}` })
    })
  })
}

function extensionOf(mediaType: string): string {
  const subtype = mediaType.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/giu, '').slice(0, 8)
  return `.${subtype || 'mp4'}`
}

function bounded(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback
}

/** 在临时目录中限时提取时间有序的关键帧与单声道音轨。 */
export async function analyzeVideo(
  data: Uint8Array,
  mediaType: string,
  settings: VideoVisionSettings,
  asr?: (data: Uint8Array, mediaType: string) => Promise<VoiceTranscriptOutcome>,
  run: ProcessRunner = runProcess,
): Promise<VideoAnalysis> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-video-'))
  const input = path.join(dir, `input${extensionOf(mediaType)}`)
  const framePattern = path.join(dir, 'frame-%03d.jpg')
  const audioFile = path.join(dir, 'audio.wav')
  const maxSeconds = bounded(settings.maxSeconds, 60, 1, 600)
  const timeoutMs = bounded(settings.timeoutMs, 15_000, 500, 60_000)
  const interval = bounded(settings.frameIntervalSeconds, 5, 1, 60)
  const maxFrames = bounded(settings.maxFrames, 6, 1, 24)
  const dimension = bounded(settings.maxFrameDimension, 640, 160, 1280)
  const maxFrameBytes = bounded(settings.maxFrameBytes, 1_048_576, 16_384, 4_194_304)
  try {
    fs.writeFileSync(input, data)
    const frameWork = run(settings.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
      '-t', String(maxSeconds), '-vf', `fps=1/${interval},scale=w='min(${dimension},iw)':h=-2`,
      '-frames:v', String(maxFrames), '-q:v', '5', framePattern,
    ], timeoutMs)
    const audioWork = asr === undefined
      ? Promise.resolve(undefined)
      : run(settings.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
        '-t', String(maxSeconds), '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', audioFile,
      ], timeoutMs)
    const [frameResult, audioResult] = await Promise.all([frameWork, audioWork])
    const frames: VideoFrame[] = []
    if (frameResult.ok) {
      const files = fs.readdirSync(dir).filter(file => /^frame-\d+\.jpg$/u.test(file)).sort()
      for (const [index, file] of files.slice(0, maxFrames).entries()) {
        const frame = fs.readFileSync(path.join(dir, file))
        if (frame.byteLength > maxFrameBytes) continue
        const frameNumber = Number(file.match(/\d+/u)?.[0] ?? index + 1)
        frames.push({ data: new Uint8Array(frame), timestampMs: Math.max(0, frameNumber - 1) * interval * 1000 })
      }
    }
    let transcript: VoiceTranscriptOutcome | undefined
    let audioFailure: string | undefined
    if (audioResult !== undefined) {
      if (!audioResult.ok) audioFailure = audioResult.reason
      else if (asr !== undefined) {
        try {
          transcript = await asr(new Uint8Array(fs.readFileSync(audioFile)), 'audio/wav')
          if (!transcript.ok) audioFailure = transcript.reason
        } catch (error) {
          audioFailure = error instanceof Error ? error.message : String(error)
        }
      }
    }
    return {
      frames,
      ...transcript === undefined ? {} : { transcript },
      ...frames.length === 0 ? { frameFailure: frameResult.ok ? '没有提取到视频画面' : frameResult.reason } : {},
      ...audioFailure === undefined ? {} : { audioFailure },
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 临时文件清理失败不影响已保存的原视频 */ }
  }
}
