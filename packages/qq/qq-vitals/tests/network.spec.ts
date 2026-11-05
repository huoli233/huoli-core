import { describe, expect, it } from 'vitest'
import {
  DEFAULTS, deltaOf, derive, describeNetwork, drift, emptyState, propagate, resolveTuning,
  type NetworkEdge, type Tuning, type VitalsState,
  WORDS_PRESET,
} from '../src/index.ts'
import { DERIVED_FIELDS, NUMERIC_FIELDS } from '../src/defaults.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })
// 关掉图的那一套参数，用来对照旧路径
const legacy = resolveTuning({ words: WORDS_PRESET, networkEnabled: false })
const START = new Date(2026, 0, 1, 10, 0, 0).getTime()
const HOUR = 3_600_000

function fresh(overrides: Partial<VitalsState> = {}, at = START): VitalsState {
  return { ...emptyState(tuning, at), ...overrides }
}

// 换一整张边表，用来只验一条边
function withEdges(edges: readonly NetworkEdge[], extra: Partial<Tuning> = {}): Tuning {
  return resolveTuning({ words: WORDS_PRESET, networkEdges: edges, ...extra })
}

// 从两小时之前结算到当下：白天醒着不碰睡眠与随机，两次结算必得同一结果
function settled(overrides: Partial<VitalsState>, custom: Tuning = tuning): VitalsState {
  return derive(drift(fresh(overrides, START - 2 * HOUR), START, custom, () => 0.5), custom)
}

function target(pass: ReturnType<typeof propagate>, field: Parameters<typeof deltaOf>[1]): number {
  return pass.targets.get(field) ?? Number.NaN
}

describe('按边表传播', () => {
  it('单边 push 抬目标，抬的量是权重乘源值', () => {
    const state = fresh({ cortisol: 0.5, irritability: 0.1 })
    const pass = propagate(state, withEdges([{ from: 'cortisol', to: 'irritability', weight: 0.4, mode: 'push', cap: 1 }]))

    expect(deltaOf(pass, 'irritability')).toBeCloseTo(0.2, 12)
    expect(target(pass, 'irritability')).toBeCloseTo(0.3, 12)
  })

  it('单边 pull 压目标，方向反过来幅度不变', () => {
    const state = fresh({ cortisol: 0.5, energy: 0.6 })
    const pass = propagate(state, withEdges([{ from: 'cortisol', to: 'energy', weight: 0.4, mode: 'pull', cap: 1 }]))

    expect(deltaOf(pass, 'energy')).toBeCloseTo(-0.2, 12)
    expect(target(pass, 'energy')).toBeCloseTo(0.4, 12)
  })

  it('cap 封住单拍影响，权重再大也只走这么多', () => {
    const state = fresh({ cortisol: 0.8 })
    const pass = propagate(state, withEdges([
      { from: 'cortisol', to: 'energy', weight: 0.9, mode: 'pull', cap: 0.1 },
      { from: 'cortisol', to: 'irritability', weight: 0.9, mode: 'push', cap: 0.1 },
    ]))

    expect(deltaOf(pass, 'energy')).toBeCloseTo(-0.1, 12)
    expect(deltaOf(pass, 'irritability')).toBeCloseTo(0.1, 12)
  })

  it('多轮传播一轮比一轮轻，收敛到不再动', () => {
    const state = fresh({ energy: 0.8 })
    const loop = withEdges([{ from: 'energy', to: 'energy', weight: 0.5, mode: 'pull', cap: 1 }])
    const first = target(propagate(state, loop), 'energy')
    const later = target(propagate(state, loop, 12), 'energy')
    const further = target(propagate(state, loop, 13), 'energy')

    expect(first).toBeCloseTo(0.4, 12)
    expect(later).toBeLessThan(0.001)
    expect(later).toBeGreaterThan(further)
    expect(later - further).toBeLessThan(2e-4)
  })

  it('每轮结果都夹在零到一之间', () => {
    const high = propagate(fresh({ cortisol: 0.9 }), withEdges([{ from: 'cortisol', to: 'irritability', weight: 2, mode: 'push', cap: 5 }]))
    const low = propagate(fresh({ cortisol: 0.9, energy: 0.1 }), withEdges([{ from: 'cortisol', to: 'energy', weight: 2, mode: 'pull', cap: 5 }]))

    expect(target(high, 'irritability')).toBe(1)
    expect(target(low, 'energy')).toBe(0)
  })

  it('空边表什么都不动', () => {
    const state = fresh({ cortisol: 0.7 })

    const pass = propagate(state, withEdges([]))

    expect(pass.targets.size).toBe(0)
    expect(pass.deltas.size).toBe(0)
    expect(deltaOf(pass, 'irritability')).toBe(0)
  })

  it('同输入必得同输出，也不动传进来的状态', () => {
    const state = fresh({ cortisol: 0.42, leptin: 0.66 })
    const before = structuredClone(state)

    const once = propagate(state, tuning)
    const twice = propagate(state, tuning)

    expect([...once.targets]).toEqual([...twice.targets])
    expect([...once.deltas]).toEqual([...twice.deltas])
    expect(state).toEqual(before)
  })
})

describe('默认边集复现原来写死的耦合', () => {
  const CASES: readonly Partial<VitalsState>[] = [
    { cortisol: 0.62, serotonin: 0.35, leptin: 0.85 },
    { cortisol: 0.15, serotonin: 0.80, leptin: 0.20 },
    { cortisol: 0.90, adrenaline: 0.50, glucose: 0.40, leptin: 0.60 },
  ]

  it('网络开与网络关对同一组状态逐字段一致', () => {
    for (const overrides of CASES) {
      const routed = settled(overrides, tuning)
      const old = settled(overrides, legacy)
      for (const field of [...NUMERIC_FIELDS, ...DERIVED_FIELDS]) {
        expect(Math.abs(routed[field] - old[field])).toBeLessThanOrEqual(1e-9)
      }
    }
  })

  it('默认边表里三处耦合都在出影响', () => {
    const names = describeNetwork(DEFAULTS).map(edge => `${edge.from}->${edge.to}:${edge.mode}`)
    const pass = propagate(settled({ cortisol: 0.60, leptin: 0.80 }), tuning)

    expect(names).toEqual(['cortisol->irritability:push', 'cortisol->energy:pull', 'leptin->acetylcholine:push'])
    expect(deltaOf(pass, 'irritability')).toBeGreaterThan(0)
    expect(deltaOf(pass, 'energy')).toBeLessThan(0)
    expect(deltaOf(pass, 'acetylcholine')).toBeGreaterThan(0)
  })

  it('瘦素抬副交感这条走图：权重翻倍后漂移出的乙酰胆碱更高', () => {
    const heavy = DEFAULTS.networkEdges.map(edge =>
      edge.to === 'acetylcholine' ? { ...edge, weight: 0.44, cap: 0.44 } : edge)

    expect(settled({ leptin: 0.80 }, resolveTuning({ words: WORDS_PRESET, networkEdges: heavy })).acetylcholine)
      .toBeGreaterThan(settled({ leptin: 0.80 }).acetylcholine)
  })
})

describe('改参数就改图', () => {
  it('把一条边的权重加倍，压下去的那一份也加倍', () => {
    const state = fresh({ cortisol: 0.6 })
    const plain = derive(state, withEdges([])).energy
    const single = withEdges([{ from: 'cortisol', to: 'energy', weight: 0.14, mode: 'pull', cap: 1 }])
    const doubled = withEdges([{ from: 'cortisol', to: 'energy', weight: 0.28, mode: 'pull', cap: 1 }])

    expect(plain - derive(state, single).energy).toBeCloseTo(0.14 * 0.6, 10)
    expect(plain - derive(state, doubled).energy).toBeCloseTo(0.28 * 0.6, 10)
  })

  it('删掉一条边，那一处耦合就没了', () => {
    const state = fresh({ cortisol: 0.6 })
    const without = withEdges(DEFAULTS.networkEdges.filter(edge => edge.to !== 'energy'))
    const old = derive(state, legacy).energy

    expect(derive(state, without).energy).toBeCloseTo(old + 0.14 * 0.6, 12)
    expect(derive(state, tuning).energy).toBeCloseTo(old, 12)
  })
})

describe('边表可观测', () => {
  it('describeNetwork 报出当前边表', () => {
    const described = describeNetwork(tuning)

    expect(described).toHaveLength(DEFAULTS.networkEdges.length)
    expect(described).toHaveLength(3)
    expect(described[0]).toEqual({ from: 'cortisol', to: 'irritability', weight: 0.9, mode: 'push', cap: 0.9 })
  })

  it('关掉开关也照样能描述，拿到的是抄本', () => {
    const described = describeNetwork(legacy)

    expect(described).toHaveLength(3)
    described[0]!.weight = 9
    expect(DEFAULTS.networkEdges[0]?.weight).toBe(0.9)
  })
})
