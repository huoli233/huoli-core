import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyVitals, createVitalsStore, emptyState, qqVitalsOf, resolveTuning, WORDS_PRESET } from '../src/index.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })
const SEED = new Date(2026, 10, 3, 7, 30, 0).getTime()

const roots: string[] = []
const contexts: Context[] = []

async function mount(): Promise<Context> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-pairs-'))
  roots.push(dir)
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, SEED), adrenaline: 0.7, acetylcholine: 0.3 })
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  applyVitals(ctx, { file, tuning: { words: WORDS_PRESET, startDelayMs: 60 * 60_000 } })
  return ctx
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('五组双条', () => {
  it('正好五对，名字与两条读数都在', async () => {
    const seam = qqVitalsOf(await mount())
    if (seam === undefined) throw new Error('这一层没有装配')

    const pairs = seam.pairs()
    expect(pairs).toHaveLength(5)
    expect(pairs.map(pair => pair.name)).toEqual(['自主神经', '奖赏', '依恋', '应激', '血糖'])
  })

  it('读数取的是身体这一刻的值，不是写死的', async () => {
    const seam = qqVitalsOf(await mount())
    if (seam === undefined) throw new Error('这一层没有装配')

    const nerve = seam.pairs()[0]
    const state = seam.read()
    expect(nerve?.a).toBe('交感')
    expect(nerve?.b).toBe('副交感')
    // 与状态里同一个字段对得上：差的是两次结算之间的几毫秒
    expect(nerve?.av).toBeCloseTo(state.adrenaline, 2)
    expect(nerve?.bv).toBeCloseTo(state.acetylcholine, 2)
  })

  it('每一对的两条都落在零到一之间', async () => {
    const seam = qqVitalsOf(await mount())
    if (seam === undefined) throw new Error('这一层没有装配')

    for (const pair of seam.pairs()) {
      expect(pair.av).toBeGreaterThanOrEqual(0)
      expect(pair.av).toBeLessThanOrEqual(1)
      expect(pair.bv).toBeGreaterThanOrEqual(0)
      expect(pair.bv).toBeLessThanOrEqual(1)
    }
  })
})
