import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createVitalsStore, derive, drift, emptyState, react, renderPrompt, resolveTuning, type Tuning, type VitalsState,
} from '../src/index.ts'

const tuning = resolveTuning()
const START = new Date(2026, 0, 1, 10, 0, 0).getTime()
const NIGHT = new Date(2026, 0, 1, 23, 0, 0).getTime()
const HOUR = 3_600_000

const HORMONE_NAMES = ['多巴胺', '皮质醇', '血清素', '催产素', '去甲肾上腺素', '肾上腺素', '褪黑素', '内啡肽']

const MOOD_FIELDS = [
  'anger', 'resentment', 'soothe', 'fear', 'worry', 'dread', 'mortality', 'negative_heat', 'positive_heat',
] as const

function fresh(overrides: Partial<VitalsState> = {}, at = START): VitalsState {
  return { ...emptyState(tuning, at), ...overrides }
}

function settled(overrides: Partial<VitalsState> = {}, custom: Tuning = tuning): VitalsState {
  return derive(fresh(overrides), custom)
}

// 从一个更早的时刻结算到现在，才能算出非零时长
function drifted(overrides: Partial<VitalsState>, at: number, custom: Tuning = tuning): VitalsState {
  return drift(fresh(overrides, at - 3 * HOUR), at, custom)
}

describe('情绪的触发', () => {
  it('被凶抬起怒气与负面热度，被哄程度不动', () => {
    const after = react(settled(), '闭嘴，你真讨厌', START, tuning)

    expect(after.anger).toBeGreaterThan(0.6)
    expect(after.negative_heat).toBeGreaterThan(0)
    expect(after.soothe).toBe(0)
    expect(after.anger_applied_at).toBe(START)
  })

  it('口头禅不算被凶', () => {
    for (const text of ['笑死我了', '累死了', '烦死我了', '吓死我了']) {
      const after = react(settled(), text, START, tuning)

      expect(after.anger).toBe(0)
      expect(after.negative_heat).toBe(0)
    }
  })

  it('被威胁关掉时惊吓与存在性恐惧一起抬，冷却之内不再抬', () => {
    const once = react(settled(), '再闹就把你关掉', START, tuning)
    const twice = react(once, '再闹就把你关掉', START + 60_000, tuning)
    const later = react(once, '再闹就把你关掉', START + tuning.threatCooldownMs + 1, tuning)

    expect(once.fear).toBeCloseTo(tuning.threatFearGain, 6)
    expect(once.dread).toBeCloseTo(tuning.threatDreadGain, 6)
    expect(once.threat_applied_at).toBe(START)
    expect(twice.fear).toBeCloseTo(once.fear, 10)
    expect(later.fear).toBeGreaterThan(once.fear)
  })

  it('道歉压下怒气与记恨，抬起被哄程度', () => {
    const before = settled({ anger: 0.6, resentment: 0.5 })
    const after = react(before, '对不起，我错了', START, tuning)

    expect(after.soothe).toBeCloseTo(tuning.sootheApologyGain, 6)
    expect(after.anger).toBeLessThan(before.anger)
    expect(after.resentment).toBeLessThan(before.resentment)
    expect(after.apology_applied_at).toBe(START)
  })

  it('被夸抬正面热度，顺手压一点火气', () => {
    const after = react(settled({ anger: 0.5 }), '你最乖了，抱抱', START, tuning)

    expect(after.positive_heat).toBeCloseTo(tuning.positiveHeatGain, 6)
    expect(after.soothe).toBeCloseTo(tuning.soothePraiseGain, 6)
    expect(after.anger).toBeLessThan(0.5)
  })

  it('被吓、担心、生死三路各抬各的字段', () => {
    expect(react(settled(), '刚才摔了一下，流了好多血', START, tuning).fear).toBeGreaterThan(0.6)
    expect(react(settled(), '你加班到这么晚', START, tuning).worry).toBeGreaterThan(0.4)
    expect(react(settled(), '你会不会哪天就不在了', START, tuning).dread).toBeGreaterThan(0.5)
  })

  it('吓死这类口头禅不算被吓，也不算生死', () => {
    const after = react(settled(), '吓死我了', START, tuning)

    expect(after.fear).toBe(0)
    expect(after.dread).toBe(0)
  })

  it('冷却与增量都从配置读', () => {
    const zero = resolveTuning({ fearCooldownMs: 0, fearGainBase: 0.5, fearGainIntensity: 0 })
    const once = react(settled({}, zero), '吓我一跳', START, zero)
    const twice = react(once, '吓我一跳', START + 1, zero)

    expect(once.fear).toBeCloseTo(0.5, 6)
    expect(twice.fear).toBeCloseTo(1, 6)
  })
})

describe('情绪的衰减', () => {
  it('怒气半小时半衰：一小时掉到四分之一', () => {
    const after = drift(fresh({ anger: 0.8, last_msg: START + HOUR }), START + HOUR, tuning)

    expect(after.anger).toBeCloseTo(0.2, 6)
  })

  it('被哄两小时半衰', () => {
    const after = drift(fresh({ soothe: 0.8, last_msg: START + 2 * HOUR }), START + 2 * HOUR, tuning)

    expect(after.soothe).toBeCloseTo(0.4, 6)
  })

  it('记恨两天半衰', () => {
    // 单次结算最多补算 hoursCap 小时，四十八小时要走两次
    const half = START + 24 * HOUR
    const once = drift(fresh({ resentment: 0.8, last_msg: half }), half, tuning)
    const after = drift({ ...once, last_msg: START + 48 * HOUR }, START + 48 * HOUR, tuning)

    expect(once.resentment).toBeCloseTo(0.8 * 0.5 ** 0.5, 6)
    expect(after.resentment).toBeCloseTo(0.4, 6)
  })

  it('惊吓五分钟半衰，一小时几乎散尽', () => {
    const after = drift(fresh({ fear: 0.8, last_msg: START + HOUR }), START + HOUR, tuning)

    expect(after.fear).toBeLessThan(0.001)
  })

  it('担心四十八分钟半衰', () => {
    const after = drift(fresh({ worry: 0.8, last_msg: START + 48 * 60_000 }), START + 48 * 60_000, tuning)

    expect(after.worry).toBeCloseTo(0.4, 6)
  })

  it('存在性恐惧八小时半衰', () => {
    const after = drift(fresh({ dread: 0.8, last_msg: START + 8 * HOUR }), START + 8 * HOUR, tuning)

    expect(after.dread).toBeCloseTo(0.4, 6)
  })

  it('两档热度各按自己的半衰回落', () => {
    const six = drift(fresh({ negative_heat: 0.8, positive_heat: 0.8, last_msg: START + 6 * HOUR }), START + 6 * HOUR, tuning)
    const twelve = drift(fresh({ positive_heat: 0.8, last_msg: START + 12 * HOUR }), START + 12 * HOUR, tuning)

    expect(six.negative_heat).toBeCloseTo(0.4, 6)
    expect(six.positive_heat).toBeGreaterThan(six.negative_heat)
    expect(twelve.positive_heat).toBeCloseTo(0.4, 6)
  })

  it('半衰期换成配置里的值就按新值走', () => {
    const slow = resolveTuning({ angerHalfHours: 2 })
    const after = drift(fresh({ anger: 0.8, last_msg: START + HOUR }), START + HOUR, slow)

    expect(after.anger).toBeCloseTo(0.5656854249, 6)
  })

  it('长时间过去的极端值都留在零到一之间', () => {
    const at = START + 48 * HOUR
    const all = Object.fromEntries(MOOD_FIELDS.map(field => [field, 1])) as Partial<VitalsState>
    const after = drift(fresh({ ...all, last_msg: at - HOUR }, START - 48 * HOUR), at, tuning)

    for (const field of MOOD_FIELDS) {
      expect(after[field]).toBeGreaterThanOrEqual(0)
      expect(after[field]).toBeLessThanOrEqual(1)
    }
    expect(after.anger).toBeGreaterThanOrEqual(0)
  })
})

describe('记恨的累积', () => {
  it('怒气还在又被晾着，记恨往上走', () => {
    const after = drifted({ anger: 0.7, resentment: 0.3, last_msg: START - 3 * HOUR }, START)

    expect(after.resentment).toBeGreaterThan(0.3)
  })

  it('夜里那一下比白天猛', () => {
    const day = drifted({ anger: 0.7, resentment: 0.3, last_msg: START - 3 * HOUR }, START)
    const night = drifted({ anger: 0.7, resentment: 0.3, last_msg: NIGHT - 3 * HOUR }, NIGHT)

    expect(night.resentment).toBeGreaterThan(day.resentment)
  })

  it('有人理就不涨，只按半衰回落', () => {
    const talked = drifted({ anger: 0.7, resentment: 0.3, last_msg: START - HOUR }, START)

    expect(talked.resentment).toBeLessThan(0.3)
  })

  it('记恨还没到线也不涨', () => {
    const after = drifted({ anger: 0.7, resentment: 0.05, last_msg: START - 3 * HOUR }, START)

    expect(after.resentment).toBeLessThan(0.05)
  })
})

describe('反向压制', () => {
  it('惊吓高时安心退场', () => {
    expect(settled().emotion_candidates).toContain('安心')
    expect(settled({ fear: 0.7 }).emotion_candidates).not.toContain('安心')
  })

  it('担心高时开心与幸福都被压', () => {
    const calm = settled({ fear: 0, cortisol: 0.2 })
    const worried = settled({ worry: 0.7 })

    expect(calm.emotion_candidates).toContain('幸福')
    expect(worried.emotion_candidates).not.toContain('幸福')
    expect(worried.emotion_candidates).not.toContain('开心')
  })

  it('存在性恐惧高时恐惧与害怕被抬起来', () => {
    const low = settled({ dread: 0.5 })
    const high = settled({ dread: 0.5, mortality: 0.6 })

    expect(low.emotion_candidates).not.toContain('恐惧')
    expect(high.emotion_candidates).toContain('恐惧')
  })

  it('愤怒高时安心与满足被压', () => {
    const angry = settled({ anger: 0.8 })

    expect(angry.emotion_candidates).not.toContain('安心')
    expect(angry.emotion_candidates).not.toContain('满足')
  })

  it('阈值可以从配置覆盖', () => {
    const loose = resolveTuning({ suppressFearFrom: 0.95, suppressWorryFrom: 0.95 })

    expect(settled({ fear: 0.7 }, loose).emotion_candidates).toContain('安心')
    expect(settled({ worry: 0.7 }, loose).emotion_candidates).toContain('幸福')
  })
})

describe('标签', () => {
  const CASES: ReadonlyArray<readonly [string, Partial<VitalsState>]> = [
    ['恼火', { adrenaline: 0.9, cortisol: 0.9, serotonin: 0.1, vasopressin: 0.9, acetylcholine: 0.1 }],
    ['饿怒', { ghrelin: 1, glucose: 0.1 }],
    ['困倦', { melatonin: 0.95, acetylcholine: 0.7 }],
    ['想哭', { serotonin: 0.1, cortisol: 0.95, oxytocin: 0.1, negative_heat: 0.9, endorphin: 0.1 }],
    ['害怕', { fear: 0.95, adrenaline: 0.5, serotonin: 0.5, noradrenaline: 0.5 }],
    ['担心', { worry: 0.95 }],
    ['恐惧', { dread: 0.95, cortisol: 0.9, vasopressin: 0.9, serotonin: 0.1 }],
    ['生气', { anger: 0.95, adrenaline: 0.5 }],
    ['冷战', { resentment: 0.9 }],
    ['渴', { thirst: 0.9 }],
    ['生病', { cytokines: 0.8, fever: 0.6 }],
    ['累坏', { adenosine: 0.95, pain: 0.8, endorphin: 0.1 }],
    ['经期', { cramps: 0.9, cycle_phase: 'menstrual' }],
    ['经前', { progesterone: 0.9, cycle_phase: 'premenstrual' }],
  ]

  for (const [label, overrides] of CASES) {
    it(`${label}能进候选`, () => {
      const state = settled(overrides)

      expect(state.emotion_candidates).toContain(label)
      expect(state.emotion_candidates.length).toBeLessThanOrEqual(tuning.labelCount)
    })
  }

  it('条数不超过上限，分数不够的不进候选', () => {
    const crowded = settled({ fear: 0.9, worry: 0.9, dread: 0.9, anger: 0.9, resentment: 0.9, cytokines: 0.9, thirst: 0.9 })
    const quiet = settled({ cortisol: 0.2, serotonin: 0.65, endorphin: 0 })

    expect(crowded.emotion_candidates.length).toBeLessThanOrEqual(tuning.labelCount)
    expect(quiet.emotion_candidates.length).toBeLessThanOrEqual(tuning.labelCount)
    expect(quiet.emotion_candidates).not.toContain('经期')
  })
})

describe('落盘', () => {
  it('九个情绪字段写盘之后原样读回来', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-emotion-'))
    const file = path.join(dir, 'vitals.json')
    const saved: VitalsState = {
      ...fresh(),
      anger: 0.4, resentment: 0.3, soothe: 0.2, fear: 0.1,
      worry: 0.25, dread: 0.35, mortality: 0.15, negative_heat: 0.45, positive_heat: 0.55,
    }

    createVitalsStore({ file, tuning }).write(saved)
    const back = createVitalsStore({ file, tuning }).read()

    for (const field of MOOD_FIELDS) expect(back[field]).toBeCloseTo(saved[field], 10)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('提示词的措辞', () => {
  it('火大的时候话更少，说法换一档', () => {
    const calm = renderPrompt(settled(), tuning, 0)
    const angry = renderPrompt(settled({ anger: 0.9 }), tuning, 0)

    expect(angry).not.toBe(calm)
    expect(angry).toContain('憋着火')
    expect(angry).toContain('能不接就不接')
  })

  it('怕、担心、生死各有各的说法，平时不出现', () => {
    const calm = renderPrompt(settled(), tuning, 0)

    expect(calm).toContain('心里是稳的')
    expect(renderPrompt(settled({ fear: 0.8 }), tuning, 0)).toContain('发慌')
    expect(renderPrompt(settled({ worry: 0.8 }), tuning, 0)).toContain('悬着')
    expect(renderPrompt(settled({ mortality: 0.6 }), tuning, 0)).toContain('怕有什么会不见')
  })

  it('触发句与三百字上限都还在，也不出现激素名与数字', () => {
    const heavy = settled({
      anger: 0.9, resentment: 0.9, fear: 0.9, worry: 0.9, dread: 0.9, mortality: 0.9,
      cytokines: 0.9, fever: 0.9, adenosine: 0.9, melatonin: 0.9, thirst: 0.9, hunger: 0.9, pain: 0.9,
    })
    const text = renderPrompt(heavy, tuning, 0)

    expect(text.length).toBeLessThanOrEqual(tuning.promptMaxChars)
    expect(text).toContain('怕和担心只在被触发时出现')
    expect(/\d/u.test(text)).toBe(false)
    for (const name of HORMONE_NAMES) expect(text).not.toContain(name)
  })

  it('同一状态换序号仍能换措辞', () => {
    const state = settled({ anger: 0.9, resentment: 0.9 })

    expect(renderPrompt(state, tuning, 0)).not.toBe(renderPrompt(state, tuning, 1))
  })
})
