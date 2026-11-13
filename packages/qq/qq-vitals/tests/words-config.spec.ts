import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { describe, expect, it } from 'vitest'
import { apply, emptyState, isDrink, qqVitalsOf, react, resolveTuning, WORDS_PRESET } from '../src/index.ts'

const AT = new Date(2026, 10, 5, 10, 0, 0).getTime()

describe('口语词表', () => {
  it('默认一张表都不装：不靠关键词，身体等模型报事件', () => {
    expect(isDrink('喝了点水')).toBe(false)
    expect(resolveTuning().words.drink).toEqual([])
  })

  it('显式给预设就认，换成自己那套就只认自己那套', () => {
    expect(isDrink('喝了点水', WORDS_PRESET)).toBe(true)

    const own = resolveTuning({ words: { drink: ['特调'], drinkHints: ['来一杯'] } }).words

    expect(isDrink('来一杯特调', own)).toBe(true)
    expect(isDrink('喝了点水', own)).toBe(false)
  })

  it('只换一张表时，别的表不会被清空成默认之外的东西', () => {
    const tuning = resolveTuning({ words: { ...WORDS_PRESET, praise: ['真行'] } })

    expect(tuning.words.praise).toEqual(['真行'])
    expect(tuning.words.drink).toEqual(WORDS_PRESET.drink)
  })

  it('换过的词表真的进到身体写回里', () => {
    const tuning = resolveTuning({ words: { meal: ['煲仔饭'], mealHints: ['做了'] } })
    const before = emptyState(tuning, AT)

    const after = react(before, '我做了煲仔饭', AT, tuning)

    expect(after.hunger).toBeLessThan(before.hunger)
  })

  it('词表空着时任何一句话都不动身体', () => {
    const tuning = resolveTuning()
    const before = emptyState(tuning, AT)

    const after = react(before, '我喝了水，也吃了饭', AT, tuning)

    expect(after.thirst).toBe(before.thirst)
    expect(after.hunger).toBe(before.hunger)
  })

  it('装配时显式打开预设词表，普通消息也会产生身体事实', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-words-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    apply(ctx, { file: path.join(dir, 'vitals.json'), wordPreset: true, tuning: { startDelayMs: 60 * 60_000 } })
    const seam = qqVitalsOf(ctx)
    if (seam === undefined) throw new Error('身体没装上')
    const before = seam.read()

    seam.react('抱抱你', AT)

    expect(seam.read().oxytocin).toBeGreaterThan(before.oxytocin)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
