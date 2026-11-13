import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  nextDayAt,
  nextHourAt,
  PACING_DEFAULTS,
  quotaVerdict,
  resolveQuotaLimits,
  type QuotaCeiling,
  type QuotaReading,
} from '../src/index.ts'
import { createPacingStore } from '../src/store.ts'

const NOON = new Date(2026, 10, 10, 12, 34, 56, 789).getTime()
const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-quota-'))
  tempDirs.push(dir)
  return path.join(dir, 'pacing.json')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const CEILING: QuotaCeiling = { perHour: 2, perDay: 5 }
const reading = (hourCount: number, dayCount: number): QuotaReading => ({ hourCount, dayCount })

describe('按小时与按天这一档怎么判', () => {
  it('没到上限就放行', () => {
    expect(quotaVerdict('text', reading(0, 0), CEILING, NOON).ok).toBe(true)
    expect(quotaVerdict('voice', reading(1, 4), CEILING, NOON).ok).toBe(true)
  })

  it('小时档拦下时给小时这一档的码，说清说了多少条', () => {
    const verdict = quotaVerdict('text', reading(2, 2), CEILING, NOON)

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('pacing.hour_full')
    expect(verdict.reason).toContain('2')
    expect(verdict.hint).toBeTruthy()
    expect(verdict.retryAt).toBe(nextHourAt(NOON))
    expect((verdict.retryAt ?? 0) - NOON).toBeLessThanOrEqual(3_600_000)
  })

  it('日档拦下时给日这一档的码，说清今天说了多少条', () => {
    const verdict = quotaVerdict('text', reading(1, 5), CEILING, NOON)

    expect(verdict.code).toBe('pacing.day_full')
    expect(verdict.reason).toContain('5')
    expect(verdict.retryAt).toBe(nextDayAt(NOON))
    expect((verdict.retryAt ?? 0) - NOON).toBeLessThanOrEqual(24 * 3_600_000)
  })

  it('小时档比日档先判：两档同时满时报小时', () => {
    expect(quotaVerdict('text', reading(9, 9), CEILING, NOON).code).toBe('pacing.hour_full')
  })

  it('语音换一本账、换一套码，规则还是同一套', () => {
    expect(quotaVerdict('voice', reading(2, 2), CEILING, NOON).code).toBe('pacing.voice_hour_full')
    expect(quotaVerdict('voice', reading(1, 5), CEILING, NOON).code).toBe('pacing.voice_day_full')
    expect(quotaVerdict('voice', reading(1, 5), CEILING, NOON).reason).toContain('段')
    expect(quotaVerdict('text', reading(1, 5), CEILING, NOON).reason).toContain('条')
  })

  it('下一个整点与明天零点都落在当前时刻之后', () => {
    expect(nextHourAt(NOON)).toBeGreaterThan(NOON)
    expect(nextDayAt(NOON)).toBeGreaterThan(NOON)
    expect(new Date(nextHourAt(NOON)).getMinutes()).toBe(0)
    expect(new Date(nextDayAt(NOON)).getHours()).toBe(0)
  })
})

describe('记录仓读同一处判据', () => {
  it('文本与语音两本账都从这一处出码', () => {
    const store = createPacingStore({ file: tempFile(), at: NOON, limits: { perHour: 1, perDay: 9, voicePerHour: 1, voicePerDay: 9 } })

    expect(store.quota().ok).toBe(true)
    store.record('第一句正文')
    store.voiceRecord()

    expect(store.quota().code).toBe('pacing.hour_full')
    expect(store.check('第二句正文').code).toBe('pacing.hour_full')
    expect(store.voiceCheck().code).toBe('pacing.voice_hour_full')
  })

  it('配额这一档不看重复，check 才看', () => {
    const store = createPacingStore({ file: tempFile(), at: NOON, limits: { perHour: 9, perDay: 9 } })
    store.record('这句刚说过')

    expect(store.quota().ok).toBe(true)
    expect(store.check('这句刚说过').code).toBe('pacing.repeated')
  })

  it('额度用满以后再问几次都不会重复累加', () => {
    const store = createPacingStore({ file: tempFile(), at: NOON, limits: { perHour: 1, perDay: 1 } })
    store.record('第一句正文')

    for (let round = 0; round < 5; round += 1) {
      expect(store.quota().ok).toBe(false)
      expect(store.check('第二句正文').ok).toBe(false)
      expect(store.voiceCheck().ok).toBe(true)
    }

    expect(store.used()).toMatchObject({ hourCount: 1, dayCount: 1 })
    expect(store.voiceUsed()).toMatchObject({ hourCount: 0, dayCount: 0 })
  })

  it('语音额度用满不动文本那本账', () => {
    const store = createPacingStore({ file: tempFile(), at: NOON, limits: { voicePerHour: 1 } })
    store.voiceRecord()

    expect(store.voiceCheck().ok).toBe(false)
    expect(store.quota().ok).toBe(true)
    expect(store.used()).toMatchObject({ hourCount: 0, dayCount: 0 })
  })

  it('默认上限只在一张表里，两档都够保守', () => {
    const limits = resolveQuotaLimits()

    expect(limits.perHour).toBe(PACING_DEFAULTS.perHour)
    expect(limits.perDay).toBe(PACING_DEFAULTS.perDay)
    expect(quotaVerdict('text', reading(limits.perHour, 0), limits, NOON).code).toBe('pacing.hour_full')
    expect(quotaVerdict('voice', reading(0, limits.voicePerDay), {
      perHour: limits.voicePerHour,
      perDay: limits.voicePerDay,
    }, NOON).code).toBe('pacing.voice_day_full')
  })
})
