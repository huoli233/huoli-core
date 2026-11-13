import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createMediaBudget } from '../src/media-budget.ts'

const dirs: string[] = []
const NOW = 1_800_000_000_000

function file(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-media-budget-'))
  dirs.push(dir)
  return path.join(dir, 'budget.json')
}

function vitals(energy = 0.8, sleepState = 'awake') {
  return { read: () => ({ energy, sleep_state: sleepState }) } as never
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('媒体识别预算', () => {
  it('低精力、睡眠和小时额度都会阻止自动识别', () => {
    const low = createMediaBudget({ file: file(), config: {}, vitals: vitals(0.1), now: () => NOW })
    expect(low.consume({ kind: 'image', at: NOW, group: false })).toMatchObject({ ok: false, code: 'media.low_energy' })

    const sleeping = createMediaBudget({ file: file(), config: {}, vitals: vitals(0.8, 'sleeping'), now: () => NOW })
    expect(sleeping.consume({ kind: 'video', at: NOW, group: false })).toMatchObject({ ok: false, code: 'media.body_resting' })

    const limited = createMediaBudget({
      file: file(),
      config: { imageRecognitionsPerHour: 2 },
      vitals: vitals(),
      now: () => NOW,
    })
    expect(limited.consume({ kind: 'image', at: NOW, group: false }).ok).toBe(true)
    expect(limited.consume({ kind: 'image', at: NOW + 1, group: false }).ok).toBe(true)
    expect(limited.consume({ kind: 'image', at: NOW + 2, group: false })).toMatchObject({ ok: false, code: 'media.hour_full' })
  })

  it('群聊视频有独立小时额度，同一个追踪编号只记一次', () => {
    const budget = createMediaBudget({
      file: file(),
      config: { groupVideoRecognitionsPerHour: 1 },
      vitals: vitals(),
      now: () => NOW,
    })
    const input = { kind: 'video' as const, at: NOW, group: true, key: 'group:1#msg-1' }
    expect(budget.consume(input).ok).toBe(true)
    expect(budget.consume(input).ok).toBe(true)
    expect(budget.consume({ ...input, key: 'group:1#msg-2', at: NOW + 1 })).toMatchObject({ ok: false, code: 'media.hour_full' })
  })

  it('渲染模型可见的剩余额度和体力', () => {
    const budget = createMediaBudget({ file: file(), config: {}, vitals: vitals(0.62), now: () => NOW })
    const text = budget.prompt()
    expect(text).toContain('ENERGY: 0.62')
    expect(text).toContain('IMAGE_REMAINING: private_hour=12')
    expect(text).toContain('VIDEO_REMAINING: private_hour=3')
  })
})
