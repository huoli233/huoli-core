import { describe, expect, it } from 'vitest'
import { derive, drift, emptyState, react, resolveTuning, WORDS_PRESET } from '../src/index.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })
const AT = new Date(2026, 10, 5, 10, 0, 0).getTime()
const HOUR = 3_600_000

// 说一句话并结算这些量：标签与算出来的量只有 derive 之后才是新的
function hit(text: string, at = AT) {
  return derive(react(emptyState(tuning, at), text, at, tuning), tuning)
}

describe('生病与疼痛的外部来源', () => {
  it('说感冒了就把细胞因子抬起来', () => {
    const after = hit('我好像感冒了')

    expect(after.cytokines).toBeGreaterThan(0)
  })

  it('说头疼就把疼痛抬起来', () => {
    const after = hit('头好疼')

    expect(after.pain).toBeGreaterThan(0)
  })

  it('不相干的话一点都不动', () => {
    const after = hit('今天天气不错')

    expect(after.cytokines).toBe(0)
    expect(after.pain).toBe(0)
  })

  it('抬到顶就夹在一，不会越界', () => {
    let state = emptyState(tuning, AT)
    for (let round = 0; round < 20; round += 1) state = react(state, '我感冒了还头疼', AT, tuning)

    expect(state.cytokines).toBeLessThanOrEqual(1)
    expect(state.pain).toBeLessThanOrEqual(1)
    expect(state.cytokines).toBe(1)
  })

  it('细胞因子抬起来之后，发烧会滞后跟上来', () => {
    const sick = hit('我发烧了')
    const later = derive(drift(sick, AT + HOUR, tuning, () => 0.5), tuning)

    expect(later.fever).toBeGreaterThan(0)
    expect(later.core_temp).toBeGreaterThan(tuning.coreTempBase)
  })

  it('没人提就自己衰减回去', () => {
    const sick = hit('我感冒了')
    const later = derive(drift(sick, AT + 48 * HOUR, tuning, () => 0.5), tuning)

    expect(later.cytokines).toBeLessThan(sick.cytokines)
    expect(later.pain).toBeLessThanOrEqual(sick.pain)
  })
})
