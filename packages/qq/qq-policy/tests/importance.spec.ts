import { describe, expect, it } from 'vitest'
import {
  IMPORTANCE_DECAY,
  importanceAfterDrop,
  importanceAfterRecall,
  importanceDailyDrop,
  importanceDecayRate,
  quantizeImportance,
} from '../src/importance.ts'

// 保护线拉到表顶，单看显著度这一项
const UNPROTECTED = 100

function daysToFloor(importance: number, drop: number): number {
  return (importance - IMPORTANCE_DECAY.importanceFloor) / drop
}

describe('每日跌幅', () => {
  it('速率按基础率乘显著度、复习次数与情绪', () => {
    const plain = { recallCount: 0, emotional: 0 }

    expect(importanceDecayRate({ importance: 20, ...plain })).toBeCloseTo(0.8)
    expect(importanceDecayRate({ importance: 50, ...plain })).toBeCloseTo(1)
    expect(importanceDecayRate({ importance: 75, ...plain })).toBeCloseTo(1.28)
    expect(importanceDecayRate({ importance: 50, recallCount: 0, emotional: 1 })).toBeCloseTo(1.4)
  })

  it('高显著度掉得慢，按还剩多少与到底天数算', () => {
    const warm = { importance: 75, recallCount: 0, emotional: 0 }
    const faint = { importance: 20, recallCount: 0, emotional: 0 }
    const warmDrop = importanceDailyDrop(warm, UNPROTECTED)
    const faintDrop = importanceDailyDrop(faint, UNPROTECTED)

    expect(warmDrop / warm.importance).toBeLessThan(faintDrop / faint.importance)
    expect(daysToFloor(warm.importance, warmDrop)).toBeGreaterThan(daysToFloor(faint.importance, faintDrop))
  })

  it('单日跌幅再大也封顶', () => {
    const fast = { ...IMPORTANCE_DECAY, decayBase: 100 }

    const drop = importanceDailyDrop({ importance: 50, recallCount: 0, emotional: 1 }, UNPROTECTED, fast)

    expect(drop).toBe(IMPORTANCE_DECAY.decayDailyCap)
  })

  it('保护线以上一分都不掉，线上下一分照常掉', () => {
    const atLine = { importance: IMPORTANCE_DECAY.salienceHighAt, recallCount: 0, emotional: 0 }

    expect(importanceDailyDrop(atLine, IMPORTANCE_DECAY.salienceHighAt)).toBe(0)
    expect(importanceDailyDrop({ ...atLine, importance: atLine.importance - 1 }, IMPORTANCE_DECAY.salienceHighAt)).toBeGreaterThan(0)
  })

  it('掉到地板就停在地板', () => {
    expect(importanceAfterDrop(6, 3, 5)).toBe(5)
    expect(importanceAfterDrop(5, 3, 5)).toBe(5)
    expect(importanceAfterDrop(10, 0.8, 5)).toBe(9.2)
  })

  it('重要度记到一位小数，掉落进度不会丢', () => {
    expect(quantizeImportance(29.68)).toBe(29.7)
    expect(quantizeImportance(Number.NaN)).toBe(1)
  })
})

describe('复习次数', () => {
  it('被召回过几次就少掉几分，减到封顶次数为止', () => {
    const at0 = importanceDecayRate({ importance: 50, recallCount: 0, emotional: 0 })
    const atCap = importanceDecayRate({ importance: 50, recallCount: IMPORTANCE_DECAY.reviewCap, emotional: 0 })
    const pastCap = importanceDecayRate({ importance: 50, recallCount: IMPORTANCE_DECAY.reviewCap + 5, emotional: 0 })

    expect(atCap).toBeLessThan(at0)
    expect(pastCap).toBeCloseTo(atCap)
  })

  it('从未被召回的条目掉得最快', () => {
    const quiet = importanceDailyDrop({ importance: 45, recallCount: 0, emotional: 0 }, UNPROTECTED)
    const recalled = importanceDailyDrop({ importance: 45, recallCount: 3, emotional: 0 }, UNPROTECTED)

    expect(recalled).toBeLessThan(quiet)
  })
})

describe('召回回升', () => {
  it('被召回一次回升一小截', () => {
    expect(importanceAfterRecall(40, IMPORTANCE_DECAY.salienceHighAt)).toBe(42)
  })

  it('回升封在表顶，不越过保护线', () => {
    const recoverLine = IMPORTANCE_DECAY.salienceHighAt
    const generous = { ...IMPORTANCE_DECAY, recallRecover: 20, recoverCeiling: 90 }

    expect(importanceAfterRecall(67, recoverLine)).toBe(IMPORTANCE_DECAY.recoverCeiling)
    expect(importanceAfterRecall(60, recoverLine, generous)).toBe(recoverLine - 1)
  })

  it('已经比表顶高时不会被压低', () => {
    expect(importanceAfterRecall(69, IMPORTANCE_DECAY.salienceHighAt)).toBe(69)
    expect(importanceAfterRecall(100, IMPORTANCE_DECAY.salienceHighAt)).toBe(100)
  })
})
