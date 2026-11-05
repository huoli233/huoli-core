import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply, createVitalsStore, cycleOf, cycleStartOf, emptyState, qqVitalsOf, resolveTuning,
  type CycleFact, type CycleStartFact, type QqVitalsSeam, type VitalsState,
  WORDS_PRESET,
} from '../src/index.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })
// 用例里的时刻一律写死，锚点取每月五号，四号是上月末、五号是开经当天
const BEFORE = new Date(2026, 0, 4, 9, 0, 0).getTime()
const ONSET = new Date(2026, 0, 5, 9, 0, 0).getTime()
const NEXT = new Date(2026, 1, 5, 9, 0, 0).getTime()

const roots: string[] = []
const contexts: Context[] = []

function fresh(overrides: Partial<VitalsState> = {}, at = BEFORE): VitalsState {
  return { ...emptyState(tuning, at), ...overrides }
}

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-cycle-'))
  roots.push(dir)
  return path.join(dir, 'vitals.json')
}

// 装配前先落一份上月末的状态，第一拍结算才真的跨到开经日
function seed(file: string): string {
  const state = fresh()
  createVitalsStore({ file, tuning }).write({ ...state, cycle_day: cycleOf(BEFORE, tuning).day })
  return file
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
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('开经日事实', () => {
  it('跨到开经那天给一条只有可核对字段的事实', () => {
    const fact = cycleStartOf(fresh({ cycle_day: 30, cycle_len: 31 }), fresh({ cycle_day: 1, cycle_len: 31 }, ONSET), ONSET, tuning)

    expect(fact).toEqual({ at: ONSET, day: 1, date: '2026-01-05' })
    expect(Object.keys(fact ?? {}).sort()).toEqual(['at', 'date', 'day'])
  })

  it('未到开经日不产，周期日还没算过也不产', () => {
    expect(cycleStartOf(fresh(), fresh({ cycle_day: 6, cycle_len: 31 }, ONSET), ONSET, tuning)).toBeUndefined()
    expect(cycleStartOf(fresh({ cycle_day: 0 }), fresh({ cycle_day: 1, cycle_len: 31 }, ONSET), ONSET, tuning)).toBeUndefined()
  })

  it('同一周期里标记还在就不重复产，下个周期又能产', () => {
    const marked = fresh({ cycle_day: 30, cycle_len: 31, cycle_start_applied_at: new Date(2025, 11, 20, 9, 0, 0).getTime() })

    expect(cycleStartOf(marked, fresh({ cycle_day: 1, cycle_len: 31 }, ONSET), ONSET, tuning)).toBeUndefined()
    expect(cycleStartOf(marked, fresh({ cycle_day: 1, cycle_len: 28 }, NEXT), NEXT, tuning)).toEqual({
      at: NEXT, day: 1, date: '2026-02-05',
    })
  })

  it('时区按当地日历给日期，不按运行环境猜', () => {
    const west = resolveTuning({ words: WORDS_PRESET, timeZone: 'America/New_York' })
    const east = resolveTuning({ words: WORDS_PRESET, timeZone: 'Asia/Shanghai' })
    const after = fresh({ cycle_day: 1, cycle_len: 31 }, ONSET)

    expect(cycleStartOf(fresh({ cycle_day: 30 }), after, ONSET, west)?.date).toBe('2026-01-04')
    expect(cycleStartOf(fresh({ cycle_day: 30 }), after, ONSET, east)?.date).toBe('2026-01-05')
  })
})

describe('装配层挂上', () => {
  it('跨日那一拍只产一次，同日再拍也不通知', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(ONSET - 1))
    const seam = await mount(seed(tempFile()))
    const heard: CycleFact[] = []
    seam.onCycle(fact => heard.push(fact))

    await vi.advanceTimersByTimeAsync(1)

    expect(heard).toEqual([{ at: ONSET, day: 1, date: '2026-01-05' }])
    expect(seam.read().cycle_start_applied_at).toBe(ONSET)

    await vi.advanceTimersByTimeAsync(tuning.beatMs)

    expect(heard).toHaveLength(1)
  })

  it('老挂上口收到同一条事实，取消之后不再收', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(ONSET - 1))
    const seam = await mount(seed(tempFile()))
    const heard: CycleStartFact[] = []
    const off = seam.onCycleStart(fact => heard.push(fact))
    off()

    await vi.advanceTimersByTimeAsync(1)

    expect(heard).toHaveLength(0)
    expect(seam.read().cycle_start_applied_at).toBe(ONSET)
  })

  it('没跨到开经日的那一拍不通知，标记也不写', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(BEFORE + 60_000))
    const seam = await mount(seed(tempFile()))
    const heard: CycleFact[] = []
    seam.onCycle(fact => heard.push(fact))

    await vi.advanceTimersByTimeAsync(1)

    expect(heard).toHaveLength(0)
    expect(seam.read().cycle_start_applied_at).toBe(0)
  })

  it('消息写回跨日也只产一次，冷却挡掉的重复不通知', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(ONSET))
    const seam = await mount(seed(tempFile()))
    const heard: CycleFact[] = []
    seam.onCycle(fact => heard.push(fact))

    seam.react('今天天气不错', ONSET)
    seam.react('今天天气不错', ONSET + 60_000)

    expect(heard).toEqual([{ at: ONSET, day: 1, date: '2026-01-05' }])
  })

  it('标记跟着状态落盘，重开也不再重复', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(ONSET - 1))
    const file = seed(tempFile())
    const seam = await mount(file)

    await vi.advanceTimersByTimeAsync(1)

    expect(createVitalsStore({ file, tuning }).read().cycle_start_applied_at).toBe(ONSET)
    expect(seam.read().cycle_day).toBe(1)
  })
})
