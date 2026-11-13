import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, PACING_DEFAULTS, qqPacingOf, resolveVoiceLimits, type Config } from '../src/index.ts'
import { resolveQuotaLimits } from '../src/plan.ts'

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-voice-quota-'))
  tempDirs.push(dir)
  return path.join(dir, 'pacing.json')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function mount(config: Config = {}): NonNullable<ReturnType<typeof qqPacingOf>> {
  const ctx = new Context()
  apply(ctx, { file: tempFile(), ...config })
  const seam = qqPacingOf(ctx)
  if (seam === undefined) throw new Error('说话规矩没有装配')
  return seam
}

describe('语音自己一本账', () => {
  it('语音额度用满就发不出去，给码与下一步', () => {
    const seam = mount({ voicePerHour: 1 })

    expect(seam.voiceAllow().ok).toBe(true)
    seam.voiceSpend()

    const full = seam.voiceAllow()
    expect(full.ok).toBe(false)
    expect(full.code).toBe('pacing.voice_hour_full')
    expect(full.reason).not.toBe('')
    expect(full.hint).not.toBe('')
  })

  it('语音额度用满不占文本额度，文本额度用满不影响语音', () => {
    const seam = mount({ voicePerHour: 2, perHour: 1 })

    seam.spend('一句正文')
    seam.voiceSpend()
    seam.voiceSpend()

    expect(seam.allow('再来一句').code).toBe('pacing.hour_full')
    expect(seam.voiceAllow().code).toBe('pacing.voice_hour_full')
    // 文本那本账只有一句，语音两段没混进去
    expect(seam.used().hourCount).toBe(1)
    expect(seam.voiceUsed().hourCount).toBe(2)
  })

  it('一天的发语音额度也单独算', () => {
    const seam = mount({ voicePerHour: 9, voicePerDay: 1 })

    seam.voiceSpend()

    expect(seam.voiceAllow().code).toBe('pacing.voice_day_full')
  })

  it('语音计数落盘，重开还认得', () => {
    const file = tempFile()
    const ctx = new Context()
    apply(ctx, { file, voicePerHour: 5 })
    const before = qqPacingOf(ctx)
    if (before === undefined) throw new Error('说话规矩没有装配')
    before.voiceSpend()

    const again = new Context()
    apply(again, { file, voicePerHour: 5 })
    expect(qqPacingOf(again)?.voiceUsed().hourCount).toBe(1)
    expect(qqPacingOf(again)?.voiceUsed().dayCount).toBe(1)
  })

  it('配额解析带上语音两项，默认值保守', () => {
    expect(resolveQuotaLimits()).toMatchObject({
      voicePerHour: PACING_DEFAULTS.voicePerHour,
      voicePerDay: PACING_DEFAULTS.voicePerDay,
    })
    expect(resolveQuotaLimits({ voicePerHour: 2, voicePerDay: 6 })).toMatchObject({ voicePerHour: 2, voicePerDay: 6 })
    expect(PACING_DEFAULTS.voicePerHour).toBeLessThan(PACING_DEFAULTS.perHour)
    expect(PACING_DEFAULTS.voicePerDay).toBeLessThan(PACING_DEFAULTS.perDay)
  })
})

describe('发语音前要过的上限', () => {
  it('默认值来自同一张表，缺项取默认', () => {
    expect(resolveVoiceLimits()).toEqual({
      maxSeconds: PACING_DEFAULTS.voiceMaxSeconds,
      maxBytes: PACING_DEFAULTS.voiceMaxBytes,
      bytesPerSecond: PACING_DEFAULTS.voiceBytesPerSecond,
    })
  })

  it('配置能改这三项，取整且不为零', () => {
    expect(resolveVoiceLimits({ maxSeconds: 30, maxBytes: 2048, bytesPerSecond: 900 }))
      .toEqual({ maxSeconds: 30, maxBytes: 2048, bytesPerSecond: 900 })
    expect(resolveVoiceLimits({ maxSeconds: 0, maxBytes: 0, bytesPerSecond: 0 }))
      .toEqual({ maxSeconds: 1, maxBytes: 1, bytesPerSecond: 1 })
  })

  it('装配时把三项上限透出去，调用方照着量', () => {
    const seam = mount({ voiceMaxSeconds: 20, voiceMaxBytes: 4096, voiceBytesPerSecond: 800 })

    expect(seam.voiceLimits()).toEqual({ maxSeconds: 20, maxBytes: 4096, bytesPerSecond: 800 })
  })
})
