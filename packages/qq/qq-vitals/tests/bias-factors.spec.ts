import { describe, expect, it } from 'vitest'
import { biasUnit, derive, emptyState, resolveTuning, type Tuning, type VitalsState, WORDS_PRESET } from '../src/index.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })
const START = new Date(2026, 0, 1, 10, 0, 0).getTime()

function settled(overrides: Partial<VitalsState> = {}, custom: Tuning = tuning): VitalsState {
  return derive({ ...emptyState(tuning, START), ...overrides }, custom)
}

// 幸福峰值该命中的那一份状态：想要、亲近、稳定、满足都高，压力低
const HAPPY: Partial<VitalsState> = {
  dopamine: 0.9, oxytocin: 0.9, serotonin: 0.95, endorphin: 0.9, cortisol: 0.1, adrenaline: 0, positive_heat: 0.5,
}

const base = settled().proactive_bias

describe('想开口的劲：新接的七条', () => {
  it('害怕过线就收着，劲头低于中性', () => {
    expect(settled({ fear: 0.9 }).proactive_bias).toBeLessThan(base)
  })

  it('担心过线也收着', () => {
    expect(settled({ worry: 0.9 }).proactive_bias).toBeLessThan(base)
  })

  it('存在性恐惧过线更收着', () => {
    expect(settled({ dread: 0.9 }).proactive_bias).toBeLessThan(base)
  })

  it('冷战那口气让劲头往上走，越气越不出声', () => {
    expect(settled({ anger: 0.9 }).proactive_bias).toBeGreaterThan(base)
  })

  it('记恨同样压着不肯先开口', () => {
    expect(settled({ resentment: 0.9 }).proactive_bias).toBeGreaterThan(base)
  })

  it('幸福峰值时不必找人，劲头低于中性', () => {
    expect(settled(HAPPY).proactive_bias).toBeLessThan(base)
  })

  it('余额见底时硬压到上限，比任何一条单因子都低', () => {
    const broke = settled({ mortality: 0.9 }).proactive_bias

    expect(broke).toBeLessThan(base)
    expect(broke).toBeCloseTo(biasUnit(tuning.biasBroke, tuning), 6)
  })

  it('没过线的一条都不乘，读数与中性一致', () => {
    expect(settled({ fear: 0.1, worry: 0.1, dread: 0.1, anger: 0.1, resentment: 0.1 }).proactive_bias)
      .toBeCloseTo(base, 6)
  })
})
