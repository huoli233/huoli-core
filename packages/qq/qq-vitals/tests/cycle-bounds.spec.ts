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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-bounds-'))
  roots.push(dir)
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write(emptyState(tuning, SEED))
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

describe('周期分界露给面板', () => {
  it('四个分界按参数表交出去，面板才能切五段', async () => {
    const ctx = await mount()
    const seam = qqVitalsOf(ctx)
    if (seam === undefined) throw new Error('这一层没有装配')

    expect(seam.cycleBounds()).toEqual([
      tuning.cycleMenstrualEnd,
      tuning.cycleFollicularEnd,
      tuning.cycleOvulationEnd,
      tuning.cycleLutealEnd,
    ])
  })

  it('改过参数之后分界跟着变，不是写死的四个数', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-bounds2-'))
    roots.push(dir)
    const file = path.join(dir, 'vitals.json')
    createVitalsStore({ file, tuning }).write(emptyState(tuning, SEED))
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt, {})
    applyVitals(ctx, { file, tuning: { words: WORDS_PRESET, startDelayMs: 60 * 60_000, cycleMenstrualEnd: 4 } })

    expect(qqVitalsOf(ctx)?.cycleBounds()[0]).toBe(4)
  })
})
