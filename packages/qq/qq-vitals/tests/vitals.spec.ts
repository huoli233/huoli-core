import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  createVitalsStore,
  derive,
  drift,
  emptyState,
  qqVitalsOf,
  react,
  renderPrompt,
  resolveTuning,
  thirstNote,
  type QqVitalsSeam,
  type VitalsState,
} from '../src/index.ts'

const tuning = resolveTuning()
const START = new Date(2026, 0, 1, 10, 0, 0).getTime()

const HORMONE_NAMES = ['多巴胺', '皮质醇', '血清素', '催产素', '去甲肾上腺素', '肾上腺素', '褪黑素', '内啡肽']

function fresh(overrides: Partial<VitalsState> = {}): VitalsState {
  return { ...emptyState(tuning, START), ...overrides }
}

function settled(overrides: Partial<VitalsState> = {}): VitalsState {
  return derive(fresh(overrides), tuning)
}

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-'))
  tempDirs.push(dir)
  return path.join(dir, 'vitals.json')
}

async function mount(file: string): Promise<{ ctx: Context; seam: QqVitalsSeam }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { file, tuning: { startDelayMs: 60 * 60_000 } })
  const seam = qqVitalsOf(ctx)
  if (seam === undefined) throw new Error('状态没装上')
  return { ctx, seam }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('一句话验收', () => {
  it('口渴零点五八时提示词里出现嗓子有点干', () => {
    const text = renderPrompt(settled({ thirst: 0.58 }), tuning)

    expect(text).toContain('嗓子有点干')
  })

  it('说一句喝水了，口渴掉零点五五，时间戳跟着更新', () => {
    const before = settled({ thirst: 0.58 })
    const at = START + 30_000
    const after = react(before, '喝水了', at, tuning)

    expect(after.thirst).toBeCloseTo(0.03, 6)
    expect(after.last_drink).toBe(at)
    expect(after.last_drink_at).toBe(at)
    expect(after.last_drink_name).toBe('水')
    expect(after.fluid_queue).toBeCloseTo(0.55, 6)
  })

  it('两次渲染不逐字相同，但都没有数字也没有激素名', () => {
    const state = settled({ thirst: 0.58 })
    const first = renderPrompt(state, tuning, 0)
    const second = renderPrompt(state, tuning, 1)

    expect(first).not.toBe(second)
    for (const text of [first, second]) {
      expect(/\d/u.test(text)).toBe(false)
      for (const name of HORMONE_NAMES) expect(text).not.toContain(name)
    }
  })
})

describe('提示词的边界', () => {
  it('最多三百字', () => {
    const states = [settled(), settled({ thirst: 1, hunger: 1, cytokines: 1, fever: 1, pain: 1, adenosine: 1 })]

    for (const state of states) expect(renderPrompt(state, tuning).length).toBeLessThanOrEqual(300)
  })

  it('不含激素名与数字', () => {
    const text = renderPrompt(settled({ thirst: 0.9, hunger: 0.9, cortisol: 0.8 }), tuning)

    expect(/\d/u.test(text)).toBe(false)
    for (const name of HORMONE_NAMES) expect(text).not.toContain(name)
  })

  it('口渴分级覆盖中间那几档', () => {
    expect(thirstNote(0.58)).toContain('嗓子有点干')
    expect(thirstNote(0.34)).toContain('嘴里有点干')
    expect(thirstNote(0.27)).toBe('')
    expect(thirstNote(0.03)).toContain('刚喝过水')
    expect(renderPrompt(settled({ thirst: 0.9 }), tuning)).toContain('渴得厉害')
  })

  it('口渴并进身体那一行，不单独占一行', () => {
    const text = renderPrompt(settled({ thirst: 0.5, hunger: 0.6 }), tuning)
    const bodyLine = text.split('\n').find(line => line.startsWith('身体：'))

    expect(bodyLine).toContain('想喝口水')
    expect(text).not.toContain('口渴：')
  })
})

describe('心跳幂等', () => {
  it('同一分钟跑两次不再施加一次性效果', () => {
    const state = fresh({
      thirst: 0.6,
      fluid_queue: 0.55,
      fluid_applied_at: START - 2 * 3_600_000,
      last_update: START,
    })

    const once = drift(state, START, tuning)
    const twice = drift(once, START + 10_000, tuning)

    expect(once.fluid_queue).toBe(0)
    expect(twice.fluid_queue).toBe(once.fluid_queue)
    expect(twice.thirst).toBeCloseTo(once.thirst, 10)
    expect(twice.dopamine).toBeCloseTo(once.dopamine, 10)
  })

  it('水队列没到点不结算', () => {
    const state = fresh({ fluid_queue: 0.55, fluid_applied_at: START })
    const next = drift(state, START + 60_000, tuning)

    expect(next.fluid_queue).toBeCloseTo(0.55, 6)
  })

  it('两杯水挨太近只记一次', () => {
    const first = react(settled({ thirst: 0.58 }), '喝水了', START, tuning)
    const second = react(first, '又喝水了', START + 60_000, tuning)

    expect(second.thirst).toBeCloseTo(first.thirst, 10)
    expect(second.last_drink).toBe(first.last_drink)
  })

  it('只说天气不算喝水', () => {
    const state = settled({ thirst: 0.58 })
    const after = react(state, '今天天气不错', START, tuning)

    expect(after.thirst).toBeCloseTo(0.58, 10)
  })
})

describe('派生量与标签', () => {
  it('皮质醇调高后易怒上升，安心被压下去', () => {
    const calm = settled()
    const stressed = settled({ cortisol: 0.9 })

    expect(stressed.irritability).toBeGreaterThan(calm.irritability)
    expect(calm.emotion_candidates).toContain('安心')
    expect(stressed.emotion_candidates).not.toContain('安心')
  })

  it('六个派生量都在零到一之间，掌控可以到负数', () => {
    const state = settled()

    for (const value of [state.energy, state.valence, state.irritability, state.clinginess, state.loneliness]) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(state.dominance).toBeGreaterThanOrEqual(-1)
    expect(state.dominance).toBeLessThanOrEqual(1)
  })

  it('被夸与被凶各改一面', () => {
    const praised = react(settled(), '你最乖了，抱抱', START, tuning)
    const scolded = react(settled(), '闭嘴，讨厌', START, tuning)

    expect(praised.dopamine).toBeGreaterThan(settled().dopamine)
    expect(scolded.cortisol).toBeGreaterThan(settled().cortisol)
    expect(scolded.serotonin).toBeLessThan(settled().serotonin)
  })
})

describe('重启后接着走', () => {
  it('状态从文件恢复', () => {
    const file = tempFile()
    const store = createVitalsStore({ file, tuning })
    store.write({ ...emptyState(tuning, START), thirst: 0.7, last_drink_name: '水' })

    const restarted = createVitalsStore({ file, tuning })
    const state = restarted.read()

    expect(state.thirst).toBeCloseTo(0.7, 6)
    expect(state.last_drink_name).toBe('水')
  })

  it('文件坏了退回默认值，备份还在', () => {
    const file = tempFile()
    const store = createVitalsStore({ file, tuning })
    store.write(emptyState(tuning, START))
    store.write({ ...emptyState(tuning, START), thirst: 0.4 })
    fs.writeFileSync(file, '半截的 JSON')

    const state = createVitalsStore({ file, tuning }).read()

    expect(fs.existsSync(`${file}.bak`)).toBe(true)
    expect(state.thirst).toBeCloseTo(0.25, 6)
  })
})

describe('接到提示词上', () => {
  it('身体那一段进了提示词', async () => {
    const { ctx } = await mount(tempFile())

    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(entry => entry.name === 'qq:vitals')

    expect(section?.text).toContain('{{qq_vitals}}')
  })

  it('读出来的是同一份事实', async () => {
    const { seam } = await mount(tempFile())

    const state = seam.read()

    expect(state.core_temp).toBeGreaterThan(36)
    expect(state.emotion_level.length).toBeGreaterThan(0)
  })

  it('连着渲染两次不逐字相同', async () => {
    const { seam } = await mount(tempFile())

    expect(seam.render()).not.toBe(seam.render())
  })
})
