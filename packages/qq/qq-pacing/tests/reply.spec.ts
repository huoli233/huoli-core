import { describe, expect, it } from 'vitest'
import { REPLY_DEFAULTS, replyBudget, replyRange, type ReplyFacts } from '../src/index.ts'

// 一份中性的身体，各条用例只在它上面改被考察的那一项
const CALM: ReplyFacts = { tired: 0.2, annoyed: 0.1, energy: 0.5, clingy: 0.2, lonely: 0.2 }

describe('一轮说几条的下限', () => {
  it('累的时候上限不超过两条，下限还是一条', () => {
    const range = replyRange({ ...CALM, tired: 0.9 })

    expect(range.max).toBeLessThanOrEqual(2)
    expect(range.min).toBe(1)
  })

  it('烦的时候上限不超过两条，下限还是一条', () => {
    const range = replyRange({ ...CALM, annoyed: 0.9 })

    expect(range.max).toBeLessThanOrEqual(2)
    expect(range.min).toBe(1)
  })

  it('又累又烦只给一条，下限不越过它', () => {
    expect(replyRange({ ...CALM, tired: 0.9, annoyed: 0.9 })).toEqual({ min: 1, max: 1 })
  })

  it('精力高又想黏时下限至少两条', () => {
    expect(replyRange({ ...CALM, energy: 0.9, clingy: 0.7 }).min).toBeGreaterThanOrEqual(2)
  })

  it('特别黏又孤独时下限至少三条', () => {
    const range = replyRange({ ...CALM, clingy: 0.9, lonely: 0.9 })

    expect(range.min).toBeGreaterThanOrEqual(3)
    expect(range.max).toBeGreaterThanOrEqual(range.min)
  })

  it('下限永不超过上限，两条都是整数', () => {
    const scale = [0, 0.35, 0.62, 0.7, 0.8, 1]
    for (const tired of scale) {
      for (const annoyed of scale) {
        for (const energy of scale) {
          for (const clingy of scale) {
            for (const lonely of scale) {
              const range = replyRange({ tired, annoyed, energy, clingy, lonely })
              expect(range.min).toBeLessThanOrEqual(range.max)
              expect(Number.isInteger(range.min)).toBe(true)
              expect(Number.isInteger(range.max)).toBe(true)
              expect(range.min).toBeGreaterThanOrEqual(1)
              expect(range.max).toBeLessThanOrEqual(4)
            }
          }
        }
      }
    }
  })

  it('上限与只给上限的那个入口算出来一个数', () => {
    const scale = [0, 0.62, 0.7, 0.8, 1]
    for (const tired of scale) {
      for (const clingy of scale) {
        const facts = { ...CALM, tired, clingy, annoyed: tired }
        expect(replyRange(facts).max).toBe(replyBudget(facts))
      }
    }
  })

  it('上下限能从参数改', () => {
    const tight = { ...REPLY_DEFAULTS, maxCap: 3, minCap: 2 }

    expect(replyRange({ ...CALM, clingy: 0.9, lonely: 0.9 }, tight)).toEqual({ min: 3, max: 3 })
    expect(replyRange({ ...CALM, tired: 0.9, annoyed: 0.9 }, tight)).toEqual({ min: 2, max: 2 })
  })
})
