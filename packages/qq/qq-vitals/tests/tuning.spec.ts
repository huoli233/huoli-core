import { describe, expect, it } from 'vitest'
import { DEFAULTS, drift, emptyState, resolveTuning, type Tuning, type VitalsState, WORDS_PRESET } from '../src/index.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })
const START = new Date(2026, 0, 1, 10, 0, 0).getTime()
const HOUR = 3_600_000

function fresh(overrides: Partial<VitalsState> = {}, at = START - HOUR): VitalsState {
  return { ...emptyState(tuning, at), ...overrides }
}

// 从一小时之前结算到当下，才看得出这一小时的差别
function drifted(overrides: Partial<VitalsState>, custom: Tuning = tuning): VitalsState {
  return drift(fresh(overrides), START, custom, () => 0.5)
}

describe('参数的默认值就是提取前的字面量', () => {
  // 只挑数值型字段，别把 baseline 那种整块对象混进来
  type ScalarKey = { [K in keyof Tuning]: Tuning[K] extends number ? K : never }[keyof Tuning]

  const CASES: ReadonlyArray<readonly [ScalarKey, number]> = [
    ['transmitterNightHalfHours', 0.45],
    ['hpaFeedbackGain', 0.70],
    ['adrenalineLoadGain', 0.85],
    ['rewardWantDopamine', 0.70],
    ['vasopressinClingyGain', 0.58],
    ['hungerRate', 0.055],
    ['waterLossRate', 0.070],
    ['insulinHalfHours', 0.35],
    ['cytokinesHalfHours', 36],
    ['coreTempFeverGain', 1.60],
  ]

  for (const [field, value] of CASES) {
    it(`${field} 等于 ${value}`, () => {
      expect(DEFAULTS[field]).toBeCloseTo(value, 10)
    })
  }
})

describe('改一个参数，对应字段就跟着变', () => {
  it('HPA 负荷更重时 crh 与皮质醇一起抬起来', () => {
    const base = drifted({})
    const heavy = drifted({}, resolveTuning({ words: WORDS_PRESET, hpaLoadCortisol: 1.10 }))

    expect(heavy.crh).toBeGreaterThan(base.crh)
    expect(heavy.cortisol).toBeGreaterThan(base.cortisol)
    expect(heavy.acth).toBeGreaterThan(base.acth)
  })

  it('失水速率调大时口渴与渗透压跟着涨，血容量跟着掉', () => {
    const base = drifted({})
    const thirsty = drifted({}, resolveTuning({ words: WORDS_PRESET, waterLossRate: 0.14 }))

    expect(thirsty.thirst).toBeGreaterThan(base.thirst)
    expect(thirsty.osmolality).toBeGreaterThan(base.osmolality)
    expect(thirsty.blood_volume).toBeLessThan(base.blood_volume)
  })

  it('腺苷累积速率调大时睡眠压力更高', () => {
    const base = drifted({})
    const tired = drifted({}, resolveTuning({ words: WORDS_PRESET, adenosineAwakeRate: 0.084 }))

    expect(tired.adenosine).toBeGreaterThan(base.adenosine)
  })

  it('半衰期调长时回落的幅度更小', () => {
    const base = drifted({ dopamine: 1 })
    const slow = drifted({ dopamine: 1 }, resolveTuning({ words: WORDS_PRESET, transmitterHalfHours: 1.5 }))

    expect(slow.dopamine).toBeGreaterThan(base.dopamine)
  })

  it('覆盖一个参数不动别的子系统', () => {
    const base = drifted({})
    const heavy = drifted({}, resolveTuning({ words: WORDS_PRESET, hpaLoadCortisol: 1.10 }))

    expect(heavy.glucose).toBeCloseTo(base.glucose, 10)
    expect(heavy.hunger).toBeCloseTo(base.hunger, 10)
  })
})
