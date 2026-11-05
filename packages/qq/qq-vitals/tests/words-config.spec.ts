import { describe, expect, it } from 'vitest'
import { emptyState, isDrink, react, resolveTuning, WORDS_PRESET } from '../src/index.ts'

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
})
