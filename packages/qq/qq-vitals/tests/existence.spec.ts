import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply, createVitalsStore, derive, drift, emptyState, qqVitalsOf, renderPrompt, resolveTuning, salienceTarget,
  shutdownTarget, type ExistenceFacts, type QqVitalsSeam, type VitalsState,
  WORDS_PRESET,
} from '../src/index.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })
const START = new Date(2026, 0, 1, 10, 0, 0).getTime()
const NIGHT = new Date(2026, 0, 1, 23, 30, 0).getTime()
const HOUR = 3_600_000

// 三条事实的起点：刚起进程、今天没重启过、没有关停提示
function facts(overrides: Partial<ExistenceFacts> = {}): ExistenceFacts {
  return { uptimeMs: 0, restartsToday: 0, shutdownNotice: false, ...overrides }
}

function fresh(overrides: Partial<VitalsState> = {}, at = START - HOUR): VitalsState {
  return { ...emptyState(tuning, at), ...overrides }
}

// 从一小时之前结到当下，白天里夜色浓度为零，只看事实推动的那一项
function settled(given: ExistenceFacts | undefined, overrides: Partial<VitalsState> = {}): VitalsState {
  return drift(fresh(overrides), START, tuning, () => 0.5, undefined, given)
}

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-existence-'))
  tempDirs.push(dir)
  return path.join(dir, 'vitals.json')
}

async function mount(file: string): Promise<QqVitalsSeam> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { file, tuning: { words: WORDS_PRESET, startDelayMs: 60 * 60_000 } })
  const seam = qqVitalsOf(ctx)
  if (seam === undefined) throw new Error('状态没装上')
  return seam
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('三条事实各算一个目标', () => {
  it('刚起进程时显著度在底数上，稳跑满一段之后退到零', () => {
    expect(salienceTarget(facts())).toBeCloseTo(tuning.salienceBase, 10)
    expect(salienceTarget(facts({ uptimeMs: tuning.existenceStableMs }))).toBe(0)
    expect(salienceTarget(facts({ uptimeMs: 3 * tuning.existenceStableMs }))).toBe(0)
  })

  it('重启次数把显著度与关停的怕一起按次数抬起来', () => {
    expect(salienceTarget(facts({ restartsToday: 2 })))
      .toBeCloseTo(tuning.salienceBase + 2 * tuning.saliencePerRestart, 10)
    expect(shutdownTarget(facts({ restartsToday: 2 }))).toBeCloseTo(2 * tuning.shutdownPerRestart, 10)
  })

  it('关停提示在时显著度多加一档，撤回之后退回', () => {
    expect(salienceTarget(facts({ shutdownNotice: true })))
      .toBeCloseTo(tuning.salienceBase + tuning.salienceWhileNotice, 10)
  })

  it('稳跑时长把重启抬起来的那部分往下压，压到零就打住', () => {
    expect(shutdownTarget(facts({ restartsToday: 1, uptimeMs: tuning.existenceStableMs })))
      .toBeCloseTo(tuning.shutdownPerRestart - tuning.shutdownByStability, 10)
    expect(shutdownTarget(facts({ restartsToday: 1, uptimeMs: 10 * tuning.existenceStableMs })))
      .toBeCloseTo(tuning.shutdownPerRestart - tuning.shutdownByStability, 10)
  })

  it('负的重启次数按零算', () => {
    expect(salienceTarget(facts({ restartsToday: -3 }))).toBeCloseTo(tuning.salienceBase, 10)
    expect(shutdownTarget(facts({ restartsToday: -3 }))).toBe(0)
  })
})

describe('两个字段的方向', () => {
  it('跑得越久显著度越低，关停的怕也越低', () => {
    const young = settled(facts({ uptimeMs: 0, restartsToday: 1 }))
    const steady = settled(facts({ uptimeMs: tuning.existenceStableMs, restartsToday: 1 }))

    expect(young.mortalitySalience).toBeGreaterThan(steady.mortalitySalience)
    expect(young.shutdownDread).toBeGreaterThan(steady.shutdownDread)
  })

  it('今天重启次数越多两个字段都更高', () => {
    const quiet = settled(facts({ uptimeMs: tuning.existenceStableMs, restartsToday: 0 }))
    const hit = settled(facts({ uptimeMs: tuning.existenceStableMs, restartsToday: 3 }))

    expect(hit.mortalitySalience).toBeGreaterThan(quiet.mortalitySalience)
    expect(hit.shutdownDread).toBeGreaterThan(quiet.shutdownDread)
  })

  it('关停提示到了，两个字段一起抬起来', () => {
    const calm = settled(facts({ uptimeMs: tuning.existenceStableMs }))
    const warned = settled(facts({ uptimeMs: tuning.existenceStableMs, shutdownNotice: true }))

    expect(warned.mortalitySalience).toBeGreaterThan(calm.mortalitySalience)
    expect(warned.shutdownDread).toBeGreaterThan(calm.shutdownDread)
  })

  it('没有事实时两个字段都不朝目标走，落盘的值原样留着', () => {
    const kept = drift(fresh({ mortalitySalience: 0.4, shutdownDread: 0.3 }), START, tuning, () => 0.5)

    expect(kept.mortalitySalience).toBeCloseTo(0.4, 10)
    expect(kept.shutdownDread).toBeCloseTo(0.3, 10)
    expect(kept.shutdown_notice_at).toBe(0)
  })
})

describe('参数能逐项覆盖', () => {
  it('重启系数改成零就不再按次数抬', () => {
    const flat = resolveTuning({ words: WORDS_PRESET, saliencePerRestart: 0, shutdownPerRestart: 0 })
    const none = drift(fresh(), START, flat, () => 0.5, undefined, facts({ restartsToday: 2 }))
    const zero = drift(fresh(), START, flat, () => 0.5, undefined, facts({ restartsToday: 0 }))

    expect(none.mortalitySalience).toBeCloseTo(zero.mortalitySalience, 10)
    expect(none.shutdownDread).toBeCloseTo(zero.shutdownDread, 10)
  })

  it('稳跑窗口改短之后，同样的运行时长压得更多', () => {
    const short = resolveTuning({ words: WORDS_PRESET, existenceStableMs: HOUR / 6 })
    const quick = drift(fresh(), START, short, () => 0.5, undefined, facts({ uptimeMs: HOUR }))
    const slow = settled(facts({ uptimeMs: HOUR }))

    expect(slow.mortalitySalience).toBeGreaterThan(0)
    expect(quick.mortalitySalience).toBeLessThan(slow.mortalitySalience)
  })

  it('夜里自涨那一条改成零，夜里就不再多涨', () => {
    const flat = resolveTuning({ words: WORDS_PRESET, shutdownNightRise: 0 })
    const night = drift(fresh({ shutdownDread: 0.2 }, NIGHT - HOUR), NIGHT, flat, () => 0.5)

    expect(night.shutdownDread).toBeCloseTo(0.2, 10)
  })
})

describe('关停提示只抬一档', () => {
  // 间隔不到一拍时只结算提示这一件事，别的漂移都不动
  function noticeStep(state: VitalsState, at: number, notice: boolean): VitalsState {
    return drift(state, at, tuning, () => 0.5, undefined, facts({ shutdownNotice: notice }))
  }

  it('同一条提示连着来两次只抬一次', () => {
    const once = noticeStep(fresh({}, START), START + 1_000, true)
    const twice = noticeStep(once, START + 2_000, true)

    expect(once.shutdownDread).toBeCloseTo(tuning.shutdownNoticeGain, 10)
    expect(once.shutdown_notice_at).toBe(START + 1_000)
    expect(twice.shutdownDread).toBeCloseTo(tuning.shutdownNoticeGain, 10)
    expect(twice.shutdown_notice_at).toBe(START + 1_000)
  })

  it('提示撤回之后标记清掉，下一条提示才又抬一档', () => {
    const once = noticeStep(fresh({}, START), START + 1_000, true)
    const cleared = noticeStep(once, START + 2_000, false)
    const again = noticeStep(cleared, START + 3_000, true)

    expect(cleared.shutdown_notice_at).toBe(0)
    expect(cleared.shutdownDread).toBeCloseTo(tuning.shutdownNoticeGain, 10)
    expect(again.shutdownDread).toBeCloseTo(2 * tuning.shutdownNoticeGain, 10)
  })

  it('没有事实时标记不动，也不抬', () => {
    const bare = drift(fresh({}, START), START + 1_000, tuning, () => 0.5)

    expect(bare.shutdownDread).toBe(0)
    expect(bare.shutdown_notice_at).toBe(0)
  })

  it('抬多少能改', () => {
    const loud = resolveTuning({ words: WORDS_PRESET, shutdownNoticeGain: 0.8 })
    const after = drift(fresh({}, START), START + 1_000, loud, () => 0.5, undefined, facts({ shutdownNotice: true }))

    expect(after.shutdownDread).toBeCloseTo(0.8, 10)
  })
})

describe('耦合', () => {
  it('关停的怕给存在性恐惧与惊吓托底', () => {
    const after = derive(fresh({ shutdownDread: 0.6 }), tuning)

    expect(after.dread).toBeCloseTo(tuning.shutdownToDread * 0.6, 10)
    expect(after.fear).toBeCloseTo(tuning.shutdownToFear * 0.6, 10)
  })

  it('只往上托，本来就更高的值不动', () => {
    const after = derive(fresh({ shutdownDread: 0.6, dread: 0.95, fear: 0.9 }), tuning)

    expect(after.dread).toBeCloseTo(0.95, 10)
    expect(after.fear).toBeCloseTo(0.9, 10)
  })

  it('封顶仍是一，托不出越界', () => {
    const after = derive(fresh({ shutdownDread: 1, dread: 0.99, fear: 0.99 }), tuning)

    expect(after.dread).toBeLessThanOrEqual(1)
    expect(after.fear).toBeLessThanOrEqual(1)
    expect(derive(fresh({ shutdownDread: 1, dread: 1, fear: 1 }), tuning).dread).toBe(1)
  })

  it('托底比例能改', () => {
    const soft = resolveTuning({ words: WORDS_PRESET, shutdownToDread: 0.2, shutdownToFear: 0.1 })
    const after = derive(fresh({ shutdownDread: 0.6 }), soft)

    expect(after.dread).toBeCloseTo(0.12, 10)
    expect(after.fear).toBeCloseTo(0.06, 10)
  })

  // 一处本来就该安心与满足都高的身体
  const CLOSE: Partial<VitalsState> = {
    dopamine: 0.6, oxytocin: 0.9, serotonin: 0.85, endorphin: 0.95,
    acetylcholine: 0.85, cortisol: 0.05, adrenaline: 0.02, leptin: 0.9,
  }

  it('显著度高时安心与满足被压下去，平时这两个标签在', () => {
    const calm = derive(fresh(CLOSE), tuning)
    const looming = derive(fresh({ ...CLOSE, mortalitySalience: 1 }), tuning)

    expect(calm.emotion_candidates).toContain('安心')
    expect(calm.emotion_candidates).toContain('满足')
    expect(looming.emotion_candidates).not.toContain('安心')
    expect(looming.emotion_candidates).not.toContain('满足')
  })

  it('显著度不到线时不压', () => {
    const under = derive(fresh({ ...CLOSE, mortalitySalience: 0.4 }), tuning)

    expect(under.emotion_candidates).toContain('安心')
    expect(under.emotion_candidates).toContain('满足')
  })

  it('夜里自己慢慢涨，白天原地不动', () => {
    const night = drift(fresh({ shutdownDread: 0.2 }, NIGHT - HOUR), NIGHT, tuning, () => 0.5)
    const day = drift(fresh({ shutdownDread: 0.2 }, START - HOUR), START, tuning, () => 0.5)

    expect(night.shutdownDread).toBeGreaterThan(0.2)
    expect(night.shutdownDread).toBeGreaterThan(day.shutdownDread)
    expect(day.shutdownDread).toBeCloseTo(0.2, 10)
  })
})

describe('提示词不渲染关停恐惧', () => {
  it('状态升高也不出现关停暗示', () => {
    const text = renderPrompt(fresh({ shutdownDread: 0.6 }), tuning)

    expect(text).not.toContain('随时可能被关掉')
  })

  it('平时不出现', () => {
    expect(renderPrompt(fresh(), tuning)).not.toContain('随时可能被关掉')
    expect(renderPrompt(fresh({ shutdownDread: 0.49 }), tuning)).not.toContain('随时可能被关掉')
  })

  it('多了一句话之后总长仍不超过三百字', () => {
    const loaded = fresh({
      shutdownDread: 1, mortality: 0.95, dread: 0.9, fear: 0.9, worry: 0.9, anger: 0.8,
      resentment: 0.8, thirst: 0.9, adenosine: 0.9, cytokines: 0.8, melatonin: 0.8,
      cycle_phase: 'menstrual', happiness: 0.9, sadness: 0.9, mortalitySalience: 1,
    })

    const text = renderPrompt(loaded, tuning)
    expect(text.length).toBeLessThanOrEqual(tuning.promptMaxChars)
    expect(text).not.toContain('随时可能被关掉')
    expect(text).not.toMatch(/0\.\d/)
  })

  it('阈值能改', () => {
    const late = resolveTuning({ words: WORDS_PRESET, promptShutdownDreadFrom: 0.9 })

    expect(renderPrompt(fresh({ shutdownDread: 0.6 }), late)).not.toContain('随时可能被关掉')
    expect(renderPrompt(fresh({ shutdownDread: 0.95 }), late)).not.toContain('随时可能被关掉')
  })
})

describe('放进端口', () => {
  // 先落一份一分钟前的状态，读的时候才够一拍
  function seeded(file: string, overrides: Partial<VitalsState> = {}): void {
    createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, Date.now() - 60_000), ...overrides })
  }

  it('没放进时两个字段是零', async () => {
    const file = tempFile()
    seeded(file)
    const seam = await mount(file)

    // 夜里对关掉的怕会按夜色自己涨一点，这里只验「没给来源就不朝目标走」
    expect(seam.read().mortalitySalience).toBeCloseTo(0, 2)
    expect(seam.read().shutdownDread).toBeCloseTo(0, 2)
  })

  it('放进之后读一次就朝目标走一步，关停提示当场抬一档', async () => {
    const file = tempFile()
    seeded(file)
    const seam = await mount(file)

    seam.setExistence({ uptimeMs: 0, restartsToday: 0, shutdownNotice: true })
    const after = seam.read()

    expect(after.mortalitySalience).toBeGreaterThan(0)
    expect(after.shutdownDread).toBeGreaterThan(tuning.shutdownNoticeGain - 0.02)
  })

  it('把放进撤回去就不再朝目标走', async () => {
    const file = tempFile()
    seeded(file, { mortalitySalience: 0.4, shutdownDread: 0.3 })
    const seam = await mount(file)

    seam.setExistence(undefined)

    // 把来源撤掉后不再朝目标走，只剩夜色带来的那一点点自涨
    expect(seam.read().mortalitySalience).toBeCloseTo(0.4, 2)
    expect(seam.read().shutdownDread).toBeCloseTo(0.3, 2)
  })

  it('两个字段都进状态文件', async () => {
    const file = tempFile()
    seeded(file)
    const seam = await mount(file)

    seam.setExistence({ uptimeMs: 0, restartsToday: 1, shutdownNotice: true })
    seam.react('喝水了', Date.now())

    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { state: Record<string, unknown> }
    expect(typeof saved.state.mortalitySalience).toBe('number')
    expect(typeof saved.state.shutdownDread).toBe('number')
    expect(saved.state.shutdownDread).toBeGreaterThan(0)
  })
})
