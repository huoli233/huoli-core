import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createVitalsStore, DEFAULTS, derive, emptyState, mixOf, react, renderPrompt, resolveTuning, type Tuning,
  type VitalsState,
} from '../src/index.ts'
import { DERIVED_FIELDS, NUMERIC_FIELDS } from '../src/defaults.ts'

const tuning = resolveTuning()
const START = new Date(2026, 0, 1, 10, 0, 0).getTime()

// 二十六个标签全在这，用来核对语气那一行里一个情绪名都不出现
const LABELS: readonly string[] = [
  '幸福', '开心', '安心', '满足', '心动', '兴奋', '害羞', '吃醋', '委屈', '低落', '焦虑', '惊慌', '恼火',
  '饿怒', '困倦', '想哭', '害怕', '担心', '恐惧', '生气', '冷战', '渴', '生病', '累坏', '经期', '经前',
]

// 生气与委屈同时成立：一头是火，另一头是低掌控与被冷落
const HOT_AND_HURT: Partial<VitalsState> = {
  anger: 0.9, cortisol: 0.7, dominance: 0.1, oxytocin: 0.1, negative_heat: 0.8, dopamine: 0.2,
}

function fresh(overrides: Partial<VitalsState> = {}): VitalsState {
  return { ...emptyState(tuning, START), ...overrides }
}

function settled(overrides: Partial<VitalsState> = {}, custom: Tuning = tuning): VitalsState {
  return derive(fresh(overrides), custom)
}

// 直接给混合层喂分数，不必先过标签打分
function scored(...pairs: [string, number][]): [string, number][] {
  return pairs
}

// 多出来的那一行照位置取
function extraLine(off: string, on: string): string {
  const offLines = off.split('\n')
  const onLines = on.split('\n')
  const at = onLines.findIndex((line, index) => offLines[index] !== line)
  return onLines[at] ?? ''
}

// 把多出来的那一行从渲染结果里摘掉，剩下的应当与关闭时逐行相同
function withoutExtraLine(off: string, on: string): string[] {
  const offLines = off.split('\n')
  const onLines = on.split('\n')
  const at = onLines.findIndex((line, index) => offLines[index] !== line)
  return onLines.filter((_, index) => index !== at)
}

describe('混合层', () => {
  it('两个标签同时成立时按分数归一，权重加起来是一', () => {
    const state = settled(HOT_AND_HURT, resolveTuning({ emotionBlendCount: 2 }))
    const weights = state.emotion_blend.map(entry => entry.weight)

    expect(state.emotion_candidates.slice(0, 2)).toEqual(['生气', '委屈'])
    expect(state.emotion_blend.map(entry => entry.key)).toEqual(['生气', '委屈'])
    expect(weights).toHaveLength(2)
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 9)
    expect(weights[0] ?? 0).toBeGreaterThan(weights[1] ?? 0)
  })

  it('权重按给的分数分，不是照条数平分', () => {
    const state = settled(HOT_AND_HURT)
    const mix = mixOf(scored(['生气', 3], ['委屈', 1]), state, tuning)

    expect(mix.blend.map(entry => entry.weight)).toEqual([0.75, 0.25])
  })

  it('原因取自这条标签的打分证据，抬分的字段换了来由跟着换', () => {
    const angry = mixOf(scored(['生气', 1]), settled(HOT_AND_HURT), tuning)
    const braced = mixOf(scored(['委屈', 1]), settled(HOT_AND_HURT), tuning)
    const leaning = mixOf(scored(['委屈', 1]), settled({ cortisol: 0.2, negative_heat: 0.9 }), tuning)

    // 生气那条打分里 anger 的权重最大，委屈那条里皮质醇先过线
    expect(angry.blend[0]?.why).toBe('有股火还没消')
    expect(braced.blend[0]?.why).toBe('一直绷着')
    // 皮质醇退回起点、负面热度过线时，同一条标签的来由换成另一项
    expect(leaning.blend[0]?.why).toBe('憋着的那股气还没散')
  })

  it('半衰期跟这条标签自己那条一致', () => {
    const hot = settled(HOT_AND_HURT)
    const slow = resolveTuning({ angerHalfHours: 2 })

    expect(mixOf(scored(['生气', 1]), hot, tuning).blend[0]?.half_min).toBe(30)
    expect(mixOf(scored(['担心', 1]), settled({ worry: 0.9 }), tuning).blend[0]?.half_min).toBe(48)
    expect(mixOf(scored(['冷战', 1]), settled({ resentment: 0.9 }), tuning).blend[0]?.half_min).toBe(48 * 60)
    // 没有自己那条半衰的标签不给数，回落交给漂移
    expect(mixOf(scored(['生病', 1]), settled({ cytokines: 0.8 }), tuning).blend[0]?.half_min).toBe(0)
    expect(mixOf(scored(['生气', 1]), hot, slow).blend[0]?.half_min).toBe(120)
  })

  it('只有一个标签时退化成单条', () => {
    const solo = settled({ anger: 0.95 }, resolveTuning({ labelThreshold: 0.9 }))

    expect(solo.emotion_candidates).toEqual(['生气'])
    expect(solo.emotion_blend).toEqual([{ key: '生气', weight: 1, half_min: 30, why: '有股火还没消' }])
    expect(solo.emotion_why).toBe('有股火还没消，生气')
  })

  it('几路掺在一起时那句说明串起来', () => {
    const state = settled(HOT_AND_HURT)

    expect(state.emotion_candidates).toEqual(['生气', '委屈', '想哭'])
    expect(state.emotion_why).toBe('有股火还没消，生气里带一点委屈，还有点想哭')
  })
})

describe('语气开关', () => {
  it('默认关闭', () => {
    const state = settled(HOT_AND_HURT)

    expect(DEFAULTS.emotionToneEnabled).toBe(false)
    expect(tuning.emotionToneEnabled).toBe(false)
    expect(state.emotion_blend.length).toBeGreaterThan(1)
    expect(renderPrompt(state, tuning, 0)).not.toContain('语气：')
  })

  it('关闭时与没有这一层时的渲染逐字相同', () => {
    const state = settled(HOT_AND_HURT)
    const plain: VitalsState = { ...state, emotion_blend: [], emotion_why: '' }

    expect(renderPrompt(plain, tuning, 0)).toBe(renderPrompt(state, tuning, 0))
  })

  it('开启时只多一行，不含情绪名与数字，也没超字数', () => {
    const state = settled(HOT_AND_HURT)
    const on = resolveTuning({ emotionToneEnabled: true })
    const offText = renderPrompt(state, tuning, 0)
    const onText = renderPrompt(state, on, 0)
    const extra = extraLine(offText, onText)

    expect(onText.split('\n')).toHaveLength(offText.split('\n').length + 1)
    expect(withoutExtraLine(offText, onText)).toEqual(offText.split('\n'))
    expect(extra.startsWith('语气：')).toBe(true)
    expect(/\d/u.test(extra)).toBe(false)
    for (const label of LABELS) expect(extra).not.toContain(label)
    for (const entry of state.emotion_blend) {
      expect(extra).not.toContain(entry.why)
      expect(extra).not.toContain(String(entry.weight))
    }
    // 混合层本身不进正文：权重与来由一个字都不出现
    expect(onText).not.toContain('带一点')
    expect(onText.length).toBeLessThanOrEqual(300)
  })

  it('一路压过其余时那一行换成话短的版本', () => {
    const one = resolveTuning({ emotionBlendCount: 1, emotionToneEnabled: true })
    const state = settled(HOT_AND_HURT, one)

    expect(state.emotion_blend).toHaveLength(1)
    expect(renderPrompt(state, one, 0)).toContain('不用解释')
  })

  it('没有混合层时开着也不多一行', () => {
    const calm = settled({}, resolveTuning({ labelThreshold: 0.99 }))
    const on = resolveTuning({ emotionToneEnabled: true })

    expect(calm.emotion_blend).toEqual([])
    expect(renderPrompt(calm, on, 0)).toBe(renderPrompt(calm, tuning, 0))
  })
})

describe('不变性', () => {
  const text = '闭嘴，你真讨厌'

  it('开关只改提示词，状态里的生理字段完全一致', () => {
    const off = resolveTuning({ emotionToneEnabled: false })
    const on = resolveTuning({ emotionToneEnabled: true })
    const offState = derive(react(fresh(), text, START, off), off)
    const onState = derive(react(fresh(), text, START, on), on)

    for (const field of [...NUMERIC_FIELDS, ...DERIVED_FIELDS]) expect(onState[field]).toBe(offState[field])
    expect(onState.emotion_blend).toEqual(offState.emotion_blend)
    expect(onState.emotion_why).toBe(offState.emotion_why)
  })

  it('同一次事件只扣一次：重放一次不叠加，再算一遍派生也不掉值', () => {
    const once = derive(react(fresh(), text, START, tuning), tuning)
    const replay = derive(react(react(fresh(), text, START, tuning), text, START, tuning), tuning)
    const twice = derive(once, tuning)

    expect(once.anger).toBeGreaterThan(0)
    expect(once.emotion_blend.length).toBeGreaterThan(0)
    expect(replay.anger).toBe(once.anger)
    for (const field of NUMERIC_FIELDS) expect(twice[field]).toBe(once[field])
    expect(twice.emotion_blend).toEqual(once.emotion_blend)
  })
})

describe('参数可覆盖', () => {
  it('条数决定取几条', () => {
    const three = settled(HOT_AND_HURT, resolveTuning({ emotionBlendCount: 3 }))
    const two = settled(HOT_AND_HURT, resolveTuning({ emotionBlendCount: 2 }))
    const one = settled(HOT_AND_HURT, resolveTuning({ emotionBlendCount: 1 }))

    expect(three.emotion_blend.map(entry => entry.key)).toEqual(['生气', '委屈', '想哭'])
    expect(two.emotion_blend.map(entry => entry.key)).toEqual(['生气', '委屈'])
    expect(one.emotion_blend).toHaveLength(1)
    expect(one.emotion_blend[0]?.weight).toBe(1)
  })

  it('权重下限把掺得少的挤掉，剩下的重新归一', () => {
    const state = settled(HOT_AND_HURT)
    const strict = resolveTuning({ emotionBlendWeightFrom: 0.9 })
    const mix = mixOf(scored(['生气', 6], ['委屈', 3], ['低落', 1]), state, strict)

    expect(mix.blend.map(entry => entry.key)).toEqual(['生气'])
    expect(mix.blend[0]?.weight).toBe(1)
    // 下限放低时三条都留，权重照原来的比例
    const loose = mixOf(scored(['生气', 6], ['委屈', 3], ['低落', 1]), state, resolveTuning({ emotionBlendWeightFrom: 0.05 }))
    const weights = loose.blend.map(entry => entry.weight)

    expect(weights).toHaveLength(3)
    expect(weights[0]).toBeCloseTo(0.6, 9)
    expect(weights[1]).toBeCloseTo(0.3, 9)
    expect(weights[2]).toBeCloseTo(0.1, 9)
  })

  it('那一行的字数上限从参数读', () => {
    const state = settled(HOT_AND_HURT)
    const full = renderPrompt(state, resolveTuning({ emotionToneEnabled: true }), 0)
    const clipped = renderPrompt(state, resolveTuning({ emotionToneEnabled: true, emotionToneMaxChars: 20 }), 0)
    const fullLine = extraLine(renderPrompt(state, tuning, 0), full)
    const clippedLine = extraLine(renderPrompt(state, tuning, 0), clipped)

    expect(clippedLine.length).toBeLessThanOrEqual(20)
    expect(fullLine.startsWith(clippedLine)).toBe(true)
  })
})

describe('落盘', () => {
  it('混合层写盘之后原样读回来，坏的一条被丢掉', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-blend-'))
    const file = path.join(dir, 'vitals.json')
    const state = settled(HOT_AND_HURT)
    const broken = { version: 1, state: { ...state, emotion_blend: [...state.emotion_blend, { key: '生气' }, '坏的一条'] } }

    fs.writeFileSync(file, JSON.stringify(broken))
    const back = createVitalsStore({ file, tuning }).read()

    expect(back.emotion_blend).toEqual(state.emotion_blend)
    expect(back.emotion_why).toBe(state.emotion_why)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
