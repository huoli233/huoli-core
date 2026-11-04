import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createVitalsStore, derive, emptyState, peakOf, renderPrompt, resolveTuning, type Tuning, type VitalsState,
} from '../src/index.ts'

const tuning = resolveTuning()
const START = new Date(2026, 0, 1, 10, 0, 0).getTime()

function fresh(overrides: Partial<VitalsState> = {}): VitalsState {
  return { ...emptyState(tuning, START), ...overrides }
}

function settled(overrides: Partial<VitalsState> = {}, custom: Tuning = tuning): VitalsState {
  return derive(fresh(overrides), custom)
}

// 幸福峰值该命中的那一份状态：想要、亲近、稳定、满足都高，压力低
const HAPPY: Partial<VitalsState> = {
  dopamine: 0.9, oxytocin: 0.9, serotonin: 0.95, endorphin: 0.9, cortisol: 0.1, adrenaline: 0, positive_heat: 0.5,
}

// 想哭低谷该命中的那一份状态：稳定少、压力大、亲近少
const SAD: Partial<VitalsState> = {
  serotonin: 0.05, cortisol: 0.95, oxytocin: 0.05, endorphin: 0.1, negative_heat: 0.9,
}

describe('幸福与想哭两个派生量', () => {
  it('默认状态落在零到一之间', () => {
    const state = settled()

    for (const value of [state.happiness, state.sadness]) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('想要、亲近、稳定都高时幸福往上走，压力与急性应激往下压', () => {
    const base = settled().happiness

    expect(settled(HAPPY).happiness).toBeGreaterThan(base)
    expect(settled({ ...HAPPY, cortisol: 0.9 }).happiness).toBeLessThan(settled(HAPPY).happiness)
    expect(settled({ ...HAPPY, adrenaline: 0.9 }).happiness).toBeLessThan(settled(HAPPY).happiness)
  })

  it('正面热度多补一点，负面热度只压想哭那一头', () => {
    expect(settled({ positive_heat: 1 }).happiness).toBeGreaterThan(settled().happiness)
    expect(settled({ positive_heat: 1 }).sadness).toBeCloseTo(settled().sadness, 10)
    expect(settled({ negative_heat: 1 }).sadness).toBeGreaterThan(settled().sadness)
  })

  it('稳定少、压力大、亲近少时想哭往上走', () => {
    const base = settled().sadness

    expect(settled(SAD).sadness).toBeGreaterThan(base)
    expect(settled({ ...SAD, serotonin: 0.95 }).sadness).toBeLessThan(settled(SAD).sadness)
    expect(settled({ ...SAD, cortisol: 0.05 }).sadness).toBeLessThan(settled(SAD).sadness)
  })

  it('四个量都拉满时幸福夹在一，想哭两头都夹得住', () => {
    const full = settled({
      dopamine: 1, oxytocin: 1, serotonin: 1, endorphin: 1, cortisol: 0, adrenaline: 0, positive_heat: 1,
    })
    const empty = settled({
      serotonin: 0, cortisol: 1, oxytocin: 0, endorphin: 0, negative_heat: 1,
    })

    expect(full.happiness).toBeCloseTo(1, 10)
    expect(empty.sadness).toBeGreaterThanOrEqual(0)
    expect(empty.sadness).toBeLessThanOrEqual(1)
  })

  it('两个派生量写进状态文件后原样读回来', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-peak-'))
    const file = path.join(dir, 'vitals.json')
    const saved = settled(HAPPY)

    createVitalsStore({ file, tuning }).write(saved)
    const back = createVitalsStore({ file, tuning }).read()

    expect(back.happiness).toBeCloseTo(saved.happiness, 10)
    expect(back.sadness).toBeCloseTo(saved.sadness, 10)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('峰值判定', () => {
  it('幸福峰值给 happy', () => {
    expect(peakOf(settled(HAPPY))).toBe('happy')
  })

  it('想哭低谷给 sad', () => {
    expect(peakOf(settled(SAD))).toBe('sad')
  })

  it('平常状态给 null', () => {
    expect(peakOf(settled())).toBeNull()
  })

  it('不当峰值时默认参数也能直接调用', () => {
    expect(peakOf(settled(), tuning)).toBeNull()
  })

  it('幸福这一路要四个下限一起达线', () => {
    expect(peakOf(settled({ ...HAPPY, dopamine: 0.5 }))).toBeNull()
    expect(peakOf(settled({ ...HAPPY, oxytocin: 0.4 }))).toBeNull()
    expect(peakOf(settled({ ...HAPPY, serotonin: 0.5 }))).toBeNull()
  })

  it('皮质醇高过上限就不算幸福峰值', () => {
    expect(peakOf(settled({ ...HAPPY, cortisol: 0.31 }))).toBeNull()
  })

  it('想哭这一路要稳定低、压力高', () => {
    expect(peakOf(settled({ ...SAD, serotonin: 0.5 }))).toBeNull()
    expect(peakOf(settled({ ...SAD, cortisol: 0.4 }))).toBeNull()
  })

  it('三个阈值都能从配置覆盖', () => {
    const strict = resolveTuning({ peakHappinessFrom: 0.95 })
    const loose = resolveTuning({ troughSadnessFrom: 0.20, troughSerotoninBelow: 0.70, troughCortisolFrom: 0.10 })

    expect(peakOf(settled(HAPPY), strict)).toBeNull()
    expect(peakOf(settled(), loose)).toBe('sad')
  })

  it('峰值只给事实，不产出该不该发的结论', () => {
    const state = settled(HAPPY)

    expect(peakOf(state)).toBe('happy')
    expect(state.emotion_candidates).toContain('幸福')
    expect('post_level' in state).toBe(false)
  })
})

describe('峰值进提示词', () => {
  it('幸福到峰值时多一句，不到线没有', () => {
    expect(renderPrompt(settled(HAPPY), tuning)).toContain('忍不住想笑')
    expect(renderPrompt(settled(), tuning)).not.toContain('忍不住想笑')
  })

  it('想哭到低谷时多一句，不到线没有', () => {
    expect(renderPrompt(settled(SAD), tuning)).toContain('眼里发酸')
    expect(renderPrompt(settled(), tuning)).not.toContain('眼里发酸')
  })

  it('这两句也没有数字与激素名', () => {
    const text = renderPrompt(settled({ ...HAPPY, ...SAD }), tuning)

    expect(/\d/u.test(text)).toBe(false)
  })
})
