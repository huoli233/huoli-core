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
  isDrink,
  isMeal,
  qqVitalsOf,
  react,
  renderPrompt,
  resolveTuning,
  type MealFact,
  type QqVitalsSeam,
  type VitalsState,
} from '../src/index.ts'

const tuning = resolveTuning()
const START = new Date(2026, 0, 1, 10, 0, 0).getTime()

// 用例里的时刻一律写死，跑在哪一天、哪个时区都一样
function moment(hour: number, minute = 0): number {
  return new Date(2026, 0, 1, hour, minute, 0).getTime()
}

function fresh(overrides: Partial<VitalsState> = {}): VitalsState {
  return { ...emptyState(tuning, START), ...overrides }
}

function settled(overrides: Partial<VitalsState> = {}): VitalsState {
  return derive(fresh(overrides), tuning)
}

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-meal-'))
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

// 先落一份已经跑了一分钟的状态，消息时间才追得上它
function seeded(file: string, overrides: Partial<VitalsState> = {}): void {
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, Date.now() - 60_000), ...overrides })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('进食识别', () => {
  it('食物名加吃的动作都命中才算一顿', () => {
    expect(isMeal('我去吃饭了')).toBe(true)
    expect(isMeal('开饭了开饭了')).toBe(true)
    expect(isMeal('点了份炒饭')).toBe(true)
    expect(isMeal('吃了碗面')).toBe(true)
  })

  it('只有动作或者只有食物名都不算', () => {
    expect(isMeal('吃了亏')).toBe(false)
    expect(isMeal('这个梗好')).toBe(false)
    expect(isMeal('饭菜还没做好')).toBe(false)
  })

  it('饮品只算喝，不算吃了一顿', () => {
    expect(isDrink('喝点奶茶')).toBe(true)
    expect(isMeal('喝点奶茶')).toBe(false)
    expect(isMeal('喝杯奶茶')).toBe(false)
    expect(isMeal('喝点水')).toBe(false)
    expect(isMeal('喝了口咖啡')).toBe(false)
  })
})

describe('一次只记一顿', () => {
  it('同一条消息进来两次只生效一次', () => {
    const before = settled({ hunger: 0.6 })
    const once = react(before, '我去吃饭了', START, tuning)
    const twice = react(once, '我去吃饭了', START, tuning)

    expect(once.meal_applied_at).toBe(START)
    expect(twice.meal_applied_at).toBe(START)
    expect(twice.last_meal).toBe(START)
    expect(twice.hunger).toBeCloseTo(once.hunger, 10)
    expect(twice.glucose).toBeCloseTo(once.glucose, 10)
    expect(twice.insulin).toBeCloseTo(once.insulin, 10)
  })

  it('三十分钟内的第二顿不记', () => {
    const before = settled({ hunger: 0.6 })
    const first = react(before, '我去吃饭了', START, tuning)
    const second = react(first, '又吃了碗面', START + 20 * 60_000, tuning)

    expect(second.last_meal).toBe(first.last_meal)
    expect(second.hunger).toBeCloseTo(first.hunger, 10)
    expect(second.leptin).toBeCloseTo(first.leptin, 10)
  })

  it('过了冷却再吃一顿就记', () => {
    const before = settled({ hunger: 0.6 })
    const first = react(before, '我去吃饭了', START, tuning)
    const later = react(first, '又吃了碗面', START + 31 * 60_000, tuning)

    expect(later.last_meal).toBe(START + 31 * 60_000)
    expect(later.meal_applied_at).toBe(START + 31 * 60_000)
    expect(later.hunger).toBeLessThan(first.hunger)
    expect(later.ghrelin).toBeLessThan(first.ghrelin)
  })
})

describe('一顿饭的写回', () => {
  it('五个量各走一步，都留在零到一之间', () => {
    const before = settled({ hunger: 0.7, ghrelin: 0.6, leptin: 0.4, glucose: 0.5, insulin: 0.1, last_meal: START - 5 * 3_600_000 })
    const at = START + 60_000
    const after = react(before, '我去吃饭了', at, tuning)

    expect(after.hunger).toBeLessThan(before.hunger)
    expect(after.ghrelin).toBeLessThan(before.ghrelin)
    expect(after.leptin).toBeGreaterThan(before.leptin)
    expect(after.glucose).toBeGreaterThan(before.glucose)
    expect(after.insulin).toBeGreaterThan(before.insulin)
    for (const value of [after.hunger, after.ghrelin, after.leptin, after.glucose, after.insulin]) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(after.last_meal).toBe(at)
  })

  it('已经顶到上界时也不越界', () => {
    const before = settled({ hunger: 0, ghrelin: 0, leptin: 1, glucose: 1, insulin: 1 })
    const after = react(before, '我去吃饭了', START, tuning)

    expect(after.hunger).toBe(0)
    expect(after.ghrelin).toBe(0)
    expect(after.leptin).toBe(1)
    expect(after.glucose).toBe(1)
    expect(after.insulin).toBe(1)
  })

  it('越饿抬起的血糖越多', () => {
    const hungry = react(settled({ hunger: 0.9, glucose: 0.5 }), '我去吃饭了', START, tuning)
    const full = react(settled({ hunger: 0.2, glucose: 0.5 }), '我去吃饭了', START, tuning)

    expect(hungry.glucose).toBeGreaterThan(full.glucose)
  })

  it('写回之后血糖照漂移那套双向调节回落', () => {
    const before = settled({ hunger: 0.7, glucose: 0.55, insulin: 0.12, last_meal: START - 5 * 3_600_000 })
    const eaten = react(before, '我去吃饭了', START, tuning)
    const later = drift(eaten, START + 3 * 3_600_000, tuning)

    expect(later.glucose).toBeLessThan(eaten.glucose)
    expect(later.last_meal).toBe(START)
  })
})

describe('提示词里的饭点', () => {
  const MEAL_SOON = '快到饭点了'
  const MEAL_JUST = '刚吃完'

  it('饭点前一句只在饭点前出现', () => {
    const soon = settled({ last_update: moment(10, 41) })
    const plain = settled({ last_update: moment(14, 0) })

    expect(renderPrompt(soon, tuning)).toContain(MEAL_SOON)
    expect(renderPrompt(plain, tuning)).not.toContain(MEAL_SOON)
  })

  it('刚吃过一句只认真的记过一顿', () => {
    const justAte = settled({ last_update: moment(14, 0), meal_applied_at: moment(14, 0) - 5 * 60_000 })
    const never = settled({ last_update: moment(14, 0) })
    const old = settled({ last_update: moment(14, 0), meal_applied_at: moment(14, 0) - 5 * 3_600_000 })

    expect(renderPrompt(justAte, tuning)).toContain(MEAL_JUST)
    expect(renderPrompt(never, tuning)).not.toContain(MEAL_JUST)
    expect(renderPrompt(old, tuning)).not.toContain(MEAL_JUST)
  })

  it('两句都成立时总长仍在三百字以内', () => {
    const state = settled({ last_update: moment(10, 41), meal_applied_at: moment(10, 41) - 4 * 60_000, thirst: 0.9, hunger: 0.9 })
    const text = renderPrompt(state, tuning)

    expect(text).toContain(MEAL_SOON)
    expect(text).toContain(MEAL_JUST)
    expect(text.length).toBeLessThanOrEqual(tuning.promptMaxChars)
  })
})

describe('冷却与幅度可被配置覆盖', () => {
  it('冷却缩到一秒，一分钟后的第二顿就记', () => {
    const quick = resolveTuning({ mealCooldownMs: 1000 })
    const before = derive(fresh({ hunger: 0.6 }), quick)
    const first = react(before, '我去吃饭了', START, quick)
    const second = react(first, '又吃了碗面', START + 60_000, quick)

    expect(second.last_meal).toBe(START + 60_000)
    expect(second.hunger).toBeLessThan(first.hunger)
  })

  it('幅度按配置走，饥饿掉的正是配的那个数', () => {
    const small = resolveTuning({ feedHungerDrop: 0.05, feedGlucoseRise: 0.10, feedInsulinRise: 0.02 })
    const before = derive(fresh({ hunger: 0.6, glucose: 0.5, insulin: 0.1 }), small)
    const after = react(before, '我去吃饭了', START, small)

    expect(after.hunger).toBeCloseTo(before.hunger - 0.05, 10)
    expect(after.glucose).toBeCloseTo(before.glucose + 0.10 * (0.6 + 0.4 * before.hunger), 10)
    expect(after.insulin).toBeCloseTo(before.insulin + 0.02, 10)
  })

  it('默认幅度下，一顿饭把血糖顶到常规水平之上', () => {
    const before = derive(fresh({ hunger: 0.35, glucose: 0.65 }), resolveTuning({}))
    const after = react(before, '我去吃饭了', START, resolveTuning({}))

    expect(after.glucose).toBeGreaterThanOrEqual(0.75)
  })
})

describe('接进装配层', () => {
  it('一条消息写进身体，进食回调收到这一顿', async () => {
    const file = tempFile()
    seeded(file, { hunger: 0.6 })
    const { seam } = await mount(file)
    const facts: MealFact[] = []
    seam.onMeal(fact => facts.push(fact))
    const before = seam.read()
    const at = Date.now() - 20_000

    seam.react('我去吃饭了', at)
    const after = seam.read()

    expect(after.hunger).toBeLessThan(before.hunger)
    expect(after.glucose).toBeGreaterThan(before.glucose)
    expect(after.last_meal).toBe(at)
    expect(after.meal_applied_at).toBe(at)
    expect(facts).toEqual([{ at, name: '饭' }])
  })

  it('同一条消息传两次只通知一次', async () => {
    const file = tempFile()
    seeded(file, { hunger: 0.6 })
    const { seam } = await mount(file)
    let calls = 0
    seam.onMeal(() => { calls += 1 })
    const at = Date.now() - 20_000

    seam.react('我去吃饭了', at)
    seam.react('我去吃饭了', at)

    expect(calls).toBe(1)
  })

  it('不吃饭的消息不通知，取消订阅之后也不再通知', async () => {
    const file = tempFile()
    seeded(file, { hunger: 0.6 })
    const { seam } = await mount(file)
    const facts: MealFact[] = []
    const stop = seam.onMeal(fact => facts.push(fact))

    seam.react('这个梗好', Date.now() - 30_000)
    expect(facts).toHaveLength(0)

    stop()
    seam.react('我去吃饭了', Date.now() - 10_000)
    expect(facts).toHaveLength(0)
  })

  it('冷却与幅度从 Config.tuning 进去，写的是文件里那一份', async () => {
    const file = tempFile()
    const base = Date.now() - 600_000
    seeded(file, { hunger: 0.6, last_update: base })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    apply(ctx, { file, tuning: { startDelayMs: 60 * 60_000, mealCooldownMs: 1000, feedHungerDrop: 0.05 } })
    const seam = qqVitalsOf(ctx)
    if (seam === undefined) throw new Error('状态没装上')
    const at = base + 120_000

    seam.react('我去吃饭了', at)
    seam.react('又吃了碗面', at + 60_000)
    const saved = createVitalsStore({ file, tuning: resolveTuning({ mealCooldownMs: 1000, feedHungerDrop: 0.05 }) }).read()

    expect(saved.last_meal).toBe(at + 60_000)
    expect(saved.meal_applied_at).toBe(at + 60_000)
  })
})
