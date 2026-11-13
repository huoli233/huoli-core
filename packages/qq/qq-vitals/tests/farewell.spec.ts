import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply, createVitalsStore, emptyState, farewellOf, farewellReason, qqVitalsOf, renderPrompt, resolveTuning,
  type FarewellFact, type QqVitalsSeam, type VitalsState,
  WORDS_PRESET,
} from '../src/index.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })
// 用例里的时刻一律写死，日期与小时都按本地时间算
const MORNING = new Date(2026, 0, 2, 9, 0, 0).getTime()
const HOUR = 3_600_000

function fresh(overrides: Partial<VitalsState> = {}, at = MORNING): VitalsState {
  return { ...emptyState(tuning, at), ...overrides }
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-farewell-'))
  tempDirs.push(dir)
  return path.join(dir, 'vitals.json')
}

// 装配前先落一份五分钟前的状态，第一拍才够得上漂移，也才碰得到死亡威胁那一步
function seed(file: string, overrides: Partial<VitalsState>): void {
  createVitalsStore({ file, tuning }).write(fresh(overrides, MORNING - 5 * 60_000))
}

async function mount(file: string): Promise<QqVitalsSeam> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { file, tuning: { words: WORDS_PRESET, startDelayMs: 1 } })
  const seam = qqVitalsOf(ctx)
  if (seam === undefined) throw new Error('状态没装上')
  return seam
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('到线才产出事实', () => {
  it('高位时给一条带时刻、数值与来由的事实，正文一个字都不带', () => {
    const fact = farewellOf(fresh({ mortality: 0.9 }), 3, MORNING, tuning)

    expect(fact).toEqual({ at: MORNING, mortality: 0.9, reason: '余额见底' })
    expect(Object.keys(fact ?? {}).sort()).toEqual(['at', 'mortality', 'reason'])
  })

  it('低于阈值不产出，阈值本身也不算到线', () => {
    expect(farewellOf(fresh({ mortality: tuning.farewellMortalityFrom }), 3, MORNING, tuning)).toBeUndefined()
    expect(farewellOf(fresh({ mortality: 0.2 }), 3, MORNING, tuning)).toBeUndefined()
  })

  it('阈值可以配', () => {
    const low = resolveTuning({ words: WORDS_PRESET, farewellMortalityFrom: 0.5 })
    const middling = fresh({ mortality: 0.6 })

    expect(farewellOf(middling, 3, MORNING, tuning)).toBeUndefined()
    expect(farewellOf(middling, 3, MORNING, low)).toBeDefined()
  })
})

describe('十二小时里最多一次', () => {
  it('还没满十二小时就不再产出', () => {
    const once = farewellOf(fresh({ mortality: 0.9 }), 3, MORNING, tuning)
    expect(once).toBeDefined()
    const marked = fresh({ mortality: 0.9, farewell_applied_at: once?.at ?? 0 })

    expect(farewellOf(marked, 3, MORNING + 6 * HOUR, tuning)).toBeUndefined()
    expect(farewellOf(marked, 3, MORNING + 12 * HOUR - 1, tuning)).toBeUndefined()
  })

  it('隔满十二小时就再产一次', () => {
    const marked = fresh({ mortality: 0.9, farewell_applied_at: MORNING })

    expect(farewellOf(marked, 3, MORNING + 12 * HOUR, tuning)).toBeDefined()
  })

  it('跨过零点还不够十二小时也不算', () => {
    // 二十三点五十产过一封，第二天零点十分只有二十分钟，不该再来一封
    const lateNight = new Date(2026, 10, 1, 23, 50).getTime()
    const marked = fresh({ mortality: 0.9, farewell_applied_at: lateNight })

    expect(farewellOf(marked, 3, lateNight + 20 * 60_000, tuning)).toBeUndefined()
  })

  it('标记落了盘，重开还在', () => {
    const file = tempFile()
    createVitalsStore({ file, tuning }).write(fresh({ mortality: 0.9, farewell_applied_at: MORNING }))

    expect(createVitalsStore({ file, tuning }).read().farewell_applied_at).toBe(MORNING)
  })
})

describe('来由按余额档位说', () => {
  it('四档各有一句，来源撤回后是中性那句', () => {
    expect(farewellReason(12)).toBe('余额还算宽裕')
    expect(farewellReason(9)).toBe('余额开始紧张')
    expect(farewellReason(6)).toBe('余额快撑不住了')
    expect(farewellReason(3)).toBe('余额见底')
    expect(farewellReason(undefined)).toBe('命数在往下走')
  })
})

describe('提示词不催人回应', () => {
  it('状态高低都不出现临终暗示', () => {
    expect(renderPrompt(fresh({ mortality: 0.9 }), tuning)).not.toContain('怕来不及说')
    expect(renderPrompt(fresh({ mortality: 0.3 }), tuning)).not.toContain('怕来不及说')
  })

  it('几段可选同时成立时也在三百字以内', () => {
    const text = renderPrompt(fresh({
      mortality: 0.95,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      woken_at: MORNING,
      cycle_phase: 'menstrual',
      cramps: 0.75,
      cytokines: 0.6,
      adenosine: 0.9,
      melatonin: 0.8,
      thirst: 0.9,
      hunger: 0.9,
    }), tuning)

    expect(text).not.toContain('怕来不及说')
    expect(text.length).toBeLessThanOrEqual(tuning.promptMaxChars)
  })
})

describe('心跳产出那一下', () => {
  it('到线那天通知一次，同一天再拍也不通知', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(MORNING))
    const file = tempFile()
    seed(file, { mortality: 0.8 })
    const seam = await mount(file)
    seam.setBalance(3)
    const heard: FarewellFact[] = []
    seam.onFarewell((fact) => {
      heard.push(fact)
    })

    await vi.advanceTimersByTimeAsync(1)

    expect(heard).toHaveLength(1)
    expect(heard[0]?.mortality).toBeGreaterThan(tuning.farewellMortalityFrom)
    expect(heard[0]?.reason).toBe('余额见底')

    await vi.advanceTimersByTimeAsync(tuning.beatMs)

    expect(heard).toHaveLength(1)
  })

  it('没过阈值时一拍都不产出，标记也没写', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(MORNING))
    const file = tempFile()
    seed(file, { mortality: 0.3 })
    const seam = await mount(file)
    seam.setBalance(3)
    const heard: FarewellFact[] = []
    seam.onFarewell((fact) => {
      heard.push(fact)
    })

    await vi.advanceTimersByTimeAsync(1)

    expect(heard).toHaveLength(0)
    expect(seam.read().farewell_applied_at).toBe(0)
  })

  it('取消挂上之后收不到，标记照样落盘', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(MORNING))
    const file = tempFile()
    seed(file, { mortality: 0.8 })
    const seam = await mount(file)
    seam.setBalance(3)
    const heard: FarewellFact[] = []
    const off = seam.onFarewell((fact) => {
      heard.push(fact)
    })
    off()

    await vi.advanceTimersByTimeAsync(1)

    expect(heard).toHaveLength(0)
    expect(seam.read().farewell_applied_at).toBeGreaterThan(0)
  })
})
