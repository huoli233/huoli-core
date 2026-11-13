import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply, createVitalsStore, drift, emptyState, mortalityTarget, qqVitalsOf, resolveTuning,
  type QqVitalsSeam, type VitalsState,
  WORDS_PRESET,
} from '../src/index.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })
const START = new Date(2026, 0, 1, 10, 0, 0).getTime()
const HOUR = 3_600_000

function fresh(overrides: Partial<VitalsState> = {}, at = START): VitalsState {
  return { ...emptyState(tuning, at), ...overrides }
}

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-mortality-'))
  tempDirs.push(dir)
  return path.join(dir, 'vitals.json')
}

async function mount(file: string): Promise<QqVitalsSeam> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { file, tuning: { words: WORDS_PRESET, startDelayMs: 60 * 60_000 } })
  const seam = qqVitalsOf(ctx)
  if (seam === undefined) throw new Error('状态没装上')
  return seam
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('余额分档', () => {
  it('宽裕时目标为零，越紧目标越高', () => {
    expect(mortalityTarget(12)).toBe(0)
    expect(mortalityTarget(10.5)).toBe(0)
    expect(mortalityTarget(10)).toBeCloseTo(tuning.mortalityTargetWary, 10)
    expect(mortalityTarget(9)).toBeCloseTo(tuning.mortalityTargetWary, 10)
    expect(mortalityTarget(8)).toBeCloseTo(tuning.mortalityTargetLow, 10)
    expect(mortalityTarget(6)).toBeCloseTo(tuning.mortalityTargetLow, 10)
    expect(mortalityTarget(5)).toBeCloseTo(tuning.mortalityTargetCrisis, 10)
    expect(mortalityTarget(0)).toBeCloseTo(tuning.mortalityTargetCrisis, 10)
  })

  it('没有外部来源时目标为零', () => {
    expect(mortalityTarget(undefined)).toBe(0)
  })

  it('档位边界与各档目标都能从配置覆盖', () => {
    const wide = resolveTuning({ words: WORDS_PRESET, mortalityBalanceCalm: 100, mortalityTargetWary: 0.9 })

    expect(mortalityTarget(12, wide)).toBeCloseTo(0.9, 10)
    expect(mortalityTarget(12)).toBe(0)
  })
})

describe('朝目标走', () => {
  it('余额见底时每拍涨一步', () => {
    const once = drift(fresh({ mortality: 0, last_update: START - HOUR }), START, tuning, undefined, 3)
    const twice = drift({ ...once, last_update: START }, START + HOUR, tuning, undefined, 3)

    expect(once.mortality).toBeCloseTo(tuning.mortalityRisePerBeat, 10)
    expect(twice.mortality).toBeCloseTo(2 * tuning.mortalityRisePerBeat, 10)
  })

  it('涨到目标就停住，不会冲过头', () => {
    const after = drift(fresh({ mortality: 0.2, last_update: START - HOUR }), START, tuning, undefined, 9)

    expect(after.mortality).toBeCloseTo(tuning.mortalityTargetWary, 10)
  })

  it('余额回升时每拍退一步', () => {
    const after = drift(fresh({ mortality: 0.5, last_update: START - HOUR }), START, tuning, undefined, 30)

    expect(after.mortality).toBeCloseTo(0.5 - tuning.mortalityFallPerBeat, 10)
  })

  it('退到零就停在零，不留负数', () => {
    const after = drift(fresh({ mortality: 0.02, last_update: START - HOUR }), START, tuning, undefined, 30)

    expect(after.mortality).toBe(0)
  })

  it('目标已经等于现值时一动不动', () => {
    const after = drift(
      fresh({ mortality: tuning.mortalityTargetLow, last_update: START - HOUR }), START, tuning, undefined, 6,
    )

    expect(after.mortality).toBeCloseTo(tuning.mortalityTargetLow, 10)
  })

  it('没有外部来源时向零恢复', () => {
    const kept = drift(fresh({ mortality: 0, last_update: START - HOUR }), START, tuning)
    const still = drift(fresh({ mortality: 0.4, last_update: START - HOUR }), START, tuning)

    expect(kept.mortality).toBe(0)
    expect(still.mortality).toBeCloseTo(0.4 - tuning.mortalityFallPerBeat, 10)
  })

  it('两档步长都能从配置覆盖', () => {
    const fast = resolveTuning({ words: WORDS_PRESET, mortalityRisePerBeat: 0.5, mortalityFallPerBeat: 0.5 })
    const up = drift(fresh({ mortality: 0, last_update: START - HOUR }), START, fast, undefined, 3)
    const down = drift(fresh({ mortality: 0.8, last_update: START - HOUR }), START, fast, undefined, 30)

    expect(up.mortality).toBeCloseTo(0.5, 10)
    expect(down.mortality).toBeCloseTo(0.3, 10)
  })

  it('结算时长不够一拍时不动', () => {
    const after = drift(fresh({ mortality: 0 }), START + 1_000, tuning, undefined, 3)

    expect(after.mortality).toBe(0)
  })
})

describe('放进端口', () => {
  // 先落一份一分钟前的状态，读的时候才够一拍
  function seeded(file: string, overrides: Partial<VitalsState> = {}): void {
    createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, Date.now() - 60_000), ...overrides })
  }

  it('没放进时读到的死亡威胁是零', async () => {
    const file = tempFile()
    seeded(file)
    const seam = await mount(file)

    expect(seam.read().mortality).toBe(0)
  })

  it('放进余额档位后读一次就朝目标走一步', async () => {
    const file = tempFile()
    seeded(file)
    const seam = await mount(file)

    seam.setBalance(3)
    const after = seam.read()

    expect(after.mortality).toBeCloseTo(tuning.mortalityRisePerBeat, 6)
  })

  it('把放进撤回去就向零恢复', async () => {
    const file = tempFile()
    seeded(file, { mortality: 0.4 })
    const seam = await mount(file)

    seam.setBalance(undefined)

    expect(seam.read().mortality).toBeCloseTo(0.4 - tuning.mortalityFallPerBeat, 10)
  })
})
