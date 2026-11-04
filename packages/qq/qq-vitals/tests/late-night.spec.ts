import { describe, expect, it } from 'vitest'
import { emptyState, react, resolveTuning, type Tuning, type VitalsState } from '../src/index.ts'

// 这一串时刻在上海是深夜、在 UTC 还是下午，同一句话用两个时区就能比出差别
const AT = Date.UTC(2026, 0, 1, 15, 0)
const PRAISE = '你最乖了，抱抱'

const shanghai = resolveTuning({ timeZone: 'Asia/Shanghai' })
const utc = resolveTuning({ timeZone: 'UTC' })

function praised(tuning: Tuning, at = AT): VitalsState {
  return react(emptyState(tuning, at), PRAISE, at, tuning)
}

describe('深夜被夸的加成', () => {
  it('同一句夸奖在深夜抬得比白天多', () => {
    const night = praised(shanghai)
    const day = praised(utc)

    expect(night.dopamine).toBeGreaterThan(day.dopamine)
    expect(night.oxytocin).toBeGreaterThan(day.oxytocin)
    expect(night.endorphin).toBeGreaterThan(day.endorphin)
  })

  it('默认一倍五，深夜与白天的差额正好是那一半', () => {
    const night = praised(shanghai)
    const day = praised(utc)

    expect(night.dopamine).toBeCloseTo(day.dopamine + shanghai.praiseDopamineGain * 0.5, 10)
    expect(night.oxytocin).toBeCloseTo(day.oxytocin + shanghai.praiseOxytocinGain * 0.5, 10)
    expect(night.endorphin).toBeCloseTo(day.endorphin + shanghai.praiseEndorphinGain * 0.5, 10)
  })

  it('除了兴奋那三项，别的写回量两刻一样', () => {
    const night = praised(shanghai)
    const day = praised(utc)

    expect(night.cortisol).toBeCloseTo(day.cortisol, 10)
    expect(night.soothe).toBeCloseTo(day.soothe, 10)
    expect(night.anger).toBeCloseTo(day.anger, 10)
    expect(night.resentment).toBeCloseTo(day.resentment, 10)
    expect(night.positive_heat).toBeCloseTo(day.positive_heat, 10)
  })

  it('阈值配到一以上时深夜不再加成', () => {
    const never = resolveTuning({ timeZone: 'Asia/Shanghai', lateNightFrom: 1.01 })

    expect(praised(never).dopamine).toBeCloseTo(praised(utc).dopamine, 10)
  })

  it('加成倍率能从参数改', () => {
    const doubled = resolveTuning({ timeZone: 'Asia/Shanghai', lateNightPraiseGain: 2 })

    expect(praised(doubled).dopamine).toBeCloseTo(0.5 + doubled.praiseDopamineGain * 2, 10)
  })
})
