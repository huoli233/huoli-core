import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  qqVitalsOf,
  resolveTuning,
  type DrinkFact,
  type QqVitalsSeam,
} from '../src/index.ts'

const tuning = resolveTuning()
const SEED = new Date(2026, 10, 3, 7, 30, 0).getTime()
const MINUTE = 60_000

const roots: string[] = []
const contexts: Context[] = []

async function mount(): Promise<QqVitalsSeam> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-drink-'))
  roots.push(dir)
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write(emptyState(tuning, SEED))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  applyVitals(ctx, { file, tuning: { startDelayMs: 60 * 60_000 } })
  const seam = qqVitalsOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return seam
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('喝水那一条事实', () => {
  it('真喝下去才通知一次，带时刻与饮品名', async () => {
    const seam = await mount()
    const seen: DrinkFact[] = []
    seam.onDrink(fact => seen.push(fact))

    seam.react('喝水了', SEED + MINUTE)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.name).toBe('水')
    expect(seen[0]?.at).toBeGreaterThan(SEED)
  })

  it('冷却挡掉的第二杯不通知，免得同一杯被记两次', async () => {
    const seam = await mount()
    const seen: DrinkFact[] = []
    seam.onDrink(fact => seen.push(fact))

    seam.react('喝水了', SEED + MINUTE)
    seam.react('喝水了', SEED + 2 * MINUTE)

    expect(seen).toHaveLength(1)
  })

  it('没说喝水的那句话不产事实', async () => {
    const seam = await mount()
    const seen: DrinkFact[] = []
    seam.onDrink(fact => seen.push(fact))

    seam.react('今天天气不错', SEED + MINUTE)

    expect(seen).toHaveLength(0)
  })

  it('取消订阅之后不再收', async () => {
    const seam = await mount()
    const seen: DrinkFact[] = []
    const off = seam.onDrink(fact => seen.push(fact))
    off()

    seam.react('喝水了', SEED + MINUTE)

    expect(seen).toHaveLength(0)
  })
})
