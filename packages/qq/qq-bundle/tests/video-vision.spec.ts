import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { analyzeVideo, type VideoVisionSettings } from '../src/video-vision.ts'

const settings: VideoVisionSettings = {
  ffmpegPath: 'ffmpeg-test',
  timeoutMs: 1_000,
  maxSeconds: 24,
  frameIntervalSeconds: 6,
  maxFrames: 4,
  maxFrameDimension: 480,
  maxFrameBytes: 1024,
}

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('视频画面与音轨分析', () => {
  it('按时间顺序限量抽帧并把音轨交给 ASR', async () => {
    const calls: string[][] = []
    const asr = vi.fn(async (data: Uint8Array, mediaType: string) => {
      expect(data).toEqual(new Uint8Array([7, 8]))
      expect(mediaType).toBe('audio/wav')
      return { ok: true as const, text: '小心台阶', language: 'zh' }
    })
    const result = await analyzeVideo(new Uint8Array([1, 2, 3]), 'video/mp4', settings, asr, async (_command, args) => {
      calls.push([...args])
      const output = args.at(-1) ?? ''
      if (output.endsWith('.jpg')) {
        const directory = path.dirname(output)
        directories.push(directory)
        for (const index of [1, 2, 3, 4, 5]) {
          fs.writeFileSync(path.join(directory, `frame-${String(index).padStart(3, '0')}.jpg`), Buffer.from([index]))
        }
      } else if (output.endsWith('audio.wav')) {
        fs.writeFileSync(output, Buffer.from([7, 8]))
      }
      return { ok: true }
    })

    expect(result.frames).toHaveLength(4)
    expect(result.frames.map(frame => frame.timestampMs)).toEqual([0, 6_000, 12_000, 18_000])
    expect(result.transcript).toEqual({ ok: true, text: '小心台阶', language: 'zh' })
    expect(asr).toHaveBeenCalledOnce()
    const frameCall = calls[0]
    expect(frameCall).toBeDefined()
    if (frameCall === undefined) throw new Error('没有运行抽帧命令')
    expect(frameCall).toContain('24')
    expect(frameCall).toContain('4')
    expect(frameCall.join(' ')).toContain('scale=w=')
  })

  it('并行抽取画面和音轨，控制首答前的视频准备耗时', async () => {
    let active = 0
    let maxActive = 0
    const asr = vi.fn(async () => ({ ok: true as const, text: '前方有台阶' }))
    const result = await analyzeVideo(new Uint8Array([1]), 'video/mp4', settings, asr, async (_command, args) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      const output = args.at(-1) ?? ''
      if (output.endsWith('.jpg')) {
        fs.writeFileSync(output.replace(/frame-%03d\.jpg$/u, 'frame-001.jpg'), Buffer.from([1]))
      } else {
        fs.writeFileSync(output, Buffer.from([7, 8]))
      }
      active -= 1
      return { ok: true }
    })

    expect(maxActive).toBe(2)
    expect(result.frames).toHaveLength(1)
    expect(result.transcript).toEqual({ ok: true, text: '前方有台阶' })
    expect(asr).toHaveBeenCalledOnce()
  })

  it('抽帧失败仍运行音轨识别并报告画面降级', async () => {
    const result = await analyzeVideo(new Uint8Array([1]), 'video/mp4', settings, async () => ({
      ok: false,
      reason: '本机 ASR 不可用',
    }), async (_command, args) => {
      if (args.at(-1)?.endsWith('.jpg')) return { ok: false, reason: '找不到 ffmpeg' }
      return { ok: false, reason: '没有音轨' }
    })

    expect(result.frames).toEqual([])
    expect(result.frameFailure).toBe('找不到 ffmpeg')
    expect(result.audioFailure).toBe('没有音轨')
  })
})
