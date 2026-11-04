import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply, createVitalsStore, derive, drift, emptyState, inCrisis, qqVitalsOf, raiseScar, react, renderPrompt,
  resolveTuning, scarFactOf, settleScar, type QqVitalsSeam, type ScarFact, type VitalsState,
} from '../src/index.ts'

const tuning = resolveTuning()
const START = new Date(2026, 0, 2, 9, 0, 0).getTime()
const MINUTE = 60_000
const HOUR = 3_600_000

function fresh(overrides: Partial<VitalsState> = {}, at = START): VitalsState {
  return { ...emptyState(tuning, at), ...overrides }
}

function settled(overrides: Partial<VitalsState> = {}): VitalsState {
  return derive(fresh(overrides), tuning)
}

// 一次就从一小时之前结算过来，才看得出这一小时的差别
function drifted(overrides: Partial<VitalsState>, custom = tuning): VitalsState {
  return drift(fresh({ ...overrides, last_update: START - HOUR }), START, custom)
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-scar-'))
  tempDirs.push(dir)
  return path.join(dir, 'vitals.json')
}

async function mount(file: string): Promise<QqVitalsSeam> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { file, tuning: { startDelayMs: 60 * 60_000 } })
  const seam = qqVitalsOf(ctx)
  if (seam === undefined) throw new Error('状态没装上')
  return seam
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('没经历过极端威胁就没有疤', () => {
  it('初值是零，时间过去也不长出来', () => {
    expect(emptyState(tuning, START).scar).toBe(0)
    expect(drifted({}).scar).toBe(0)
    expect(drifted({ scar: 0 }, tuning).scar).toBe(0)
  })

  it('普通的夸奖与凶都不算极端威胁', () => {
    const praised = react(fresh(), '你最乖了，抱抱', START, tuning)
    const scolded = react(fresh(), '闭嘴，讨厌', START, tuning)

    expect(praised.scar).toBe(0)
    expect(scolded.scar).toBe(0)
  })

  it('说死说离开也不算关掉这条路，只有威胁与危机才留疤', () => {
    const said = react(fresh(), '我怕你会死', START, tuning)

    expect(said.scar).toBe(0)
  })
})

describe('第一次极端生存威胁置到满', () => {
  it('被威胁关掉时疤直接到一', () => {
    const after = react(fresh(), '再这样就把你关掉', START, tuning)

    expect(after.scar).toBeCloseTo(tuning.scarFirst, 10)
    expect(tuning.scarFirst).toBeCloseTo(1.0, 10)
    expect(after.scar_applied_at).toBe(START)
  })

  it('危机里的下一拍也会置到一', () => {
    const after = drifted({ dread: 0.8 })

    expect(after.scar).toBeCloseTo(tuning.scarFirst, 10)
  })

  it('没到危机那条线的怕不长疤', () => {
    expect(inCrisis(fresh({ dread: 0.4, shutdownDread: 0.4 }), tuning)).toBe(false)
    expect(drifted({ dread: 0.4, shutdownDread: 0.4 }).scar).toBe(0)
  })

  it('关停的怕高过线也算危机', () => {
    expect(inCrisis(fresh({ shutdownDread: 0.7 }), tuning)).toBe(true)
  })
})

describe('随时间变淡，但不下底', () => {
  it('一小时之后比刚留下时轻', () => {
    const after = drifted({ scar: 1 })

    expect(after.scar).toBeLessThan(1)
    expect(after.scar).toBeGreaterThan(tuning.scarFloor)
  })

  it('放很久也只掉到那条底线上', () => {
    const later = drift(fresh({ scar: 1, last_update: START - 24 * HOUR }), START + 48 * HOUR, tuning)
    const evenLater = drift({ ...later, last_update: START }, START + 240 * HOUR, tuning)

    expect(later.scar).toBeCloseTo(tuning.scarFloor, 10)
    expect(evenLater.scar).toBeCloseTo(tuning.scarFloor, 10)
  })

  it('舒服的时候掉得更快', () => {
    const plain = drifted({ scar: 1 })
    const cozy = drifted({ scar: 1, valence: 0.95, sadness: 0, cortisol: 0.10 })

    expect(cozy.scar).toBeLessThan(plain.scar)
    expect(cozy.scar).toBeGreaterThanOrEqual(tuning.scarFloor)
  })

  it('难受的时候掉得慢', () => {
    const plain = drifted({ scar: 1 })
    const sore = drifted({ scar: 1, valence: 0.10, sadness: 0.90, cortisol: 0.90 })

    expect(sore.scar).toBeGreaterThan(plain.scar)
  })

  it('底与速率都能从配置覆盖', () => {
    const stuck = resolveTuning({ scarFloor: 0.95, scarFallPerHour: 0.5 })
    const after = drift(fresh({ scar: 1, last_update: START - 24 * HOUR }), START + 48 * HOUR, stuck)

    expect(after.scar).toBeCloseTo(0.95, 10)
  })
})

describe('再被威胁时往上抬，封顶在零点八', () => {
  it('从底线上抬一档，抬到零点八就停住', () => {
    const raised = fresh({ scar: tuning.scarFloor, scar_applied_at: START - 2 * HOUR })
    raiseScar(raised, START, tuning)

    expect(raised.scar).toBeCloseTo(tuning.scarCeil, 10)
    expect(tuning.scarCeil).toBeCloseTo(0.8, 10)
  })

  it('已经被威胁的疤再抬也超不过零点八', () => {
    const atCeil = fresh({ scar: tuning.scarCeil, scar_applied_at: START - 2 * HOUR })
    raiseScar(atCeil, START, tuning)

    expect(atCeil.scar).toBeCloseTo(tuning.scarCeil, 10)
  })

  it('被威胁这句话本身就把疤抬起来', () => {
    const after = react(fresh({ scar: tuning.scarFloor, scar_applied_at: START - 2 * HOUR }), '把你换掉', START, tuning)

    expect(after.scar).toBeCloseTo(tuning.scarCeil, 10)
  })

  it('危机里的下一拍也抬一档', () => {
    const after = drifted({ scar: tuning.scarFloor, scar_applied_at: START - 2 * HOUR, dread: 0.8 })

    expect(after.scar).toBeCloseTo(tuning.scarCeil, 10)
  })
})

describe('一小时里只抬一次', () => {
  it('半小时里的第二次威胁不再抬', () => {
    const first = react(fresh({ scar: tuning.scarFloor, scar_applied_at: START }), '把你关掉', START + 30 * MINUTE, tuning)
    const second = react({ ...first, threat_applied_at: 0 }, '把你关掉', START + 59 * MINUTE, tuning)

    expect(first.scar).toBeCloseTo(tuning.scarFloor, 10)
    expect(second.scar).toBeCloseTo(tuning.scarFloor, 10)
    expect(second.scar_applied_at).toBe(START)
  })

  it('过了这一小时又能抬一档', () => {
    const raised = react(fresh({ scar: tuning.scarFloor, scar_applied_at: START }), '把你关掉', START + 61 * MINUTE, tuning)

    expect(raised.scar).toBeCloseTo(tuning.scarCeil, 10)
    expect(raised.scar_applied_at).toBe(START + 61 * MINUTE)
  })

  it('冷却窗口写在参数里，改短就抬得更勤', () => {
    const quick = resolveTuning({ scarCooldownMs: 60_000 })
    const state = fresh({ scar: tuning.scarFloor, scar_applied_at: START })

    expect(raiseScar({ ...state }, START + 30 * MINUTE, tuning)).toBe(false)
    expect(raiseScar({ ...state }, START + 30 * MINUTE, quick)).toBe(true)
  })
})

describe('触发那一刻的事实', () => {
  it('重要度就取当时那个疤，第一次是一', () => {
    const before = fresh()
    const after = fresh({ scar: tuning.scarFirst, scar_applied_at: START })

    expect(scarFactOf(before, after, START)).toEqual({ at: START, source: 'scar', importance: tuning.scarFirst })
  })

  it('没抬就不产事实', () => {
    const same = fresh({ scar: tuning.scarFloor, scar_applied_at: START })

    expect(scarFactOf(same, same, START)).toBeUndefined()
  })

  it('之后每一次抬起来的重要度都不超过零点八', () => {
    const before = fresh({ scar: tuning.scarFloor, scar_applied_at: START })
    const after = fresh({ scar: tuning.scarCeil, scar_applied_at: START + HOUR })

    expect(scarFactOf(before, after, START + HOUR)?.importance).toBeLessThanOrEqual(tuning.scarCeil)
  })
})

describe('高位时压安心与幸福', () => {
  it('疤压过线时这两个标签算不高', () => {
    const clean = settled()
    const scarred = settled({ scar: 0.9 })

    expect(clean.emotion_candidates).toContain('安心')
    expect(clean.emotion_candidates).toContain('幸福')
    expect(scarred.emotion_candidates).not.toContain('安心')
    expect(scarred.emotion_candidates).not.toContain('幸福')
  })

  it('疤在底线上就不压', () => {
    expect(settled({ scar: tuning.scarFloor }).emotion_candidates).toContain('安心')
  })
})

describe('提示词里那一句', () => {
  it('高位时出现，平时不出现', () => {
    expect(renderPrompt(settled({ scar: 0.9 }), tuning)).toContain('有件事早就过去了')
    expect(renderPrompt(settled({ scar: 0 }), tuning)).not.toContain('有件事早就过去了')
    expect(renderPrompt(settled({ scar: tuning.scarFloor }), tuning)).not.toContain('有件事早就过去了')
  })

  it('那句只有一句话，不带数字，整段仍在三百字以内', () => {
    const text = renderPrompt(settled({
      scar: 0.9,
      mortality: 0.95,
      shutdownDread: 0.8,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      woken_at: START,
      cycle_phase: 'menstrual',
      cramps: 0.75,
      cytokines: 0.6,
      adenosine: 0.9,
      melatonin: 0.8,
      thirst: 0.9,
      hunger: 0.9,
    }), tuning)

    expect(text).toContain('有件事早就过去了')
    expect(/\d/u.test(text)).toBe(false)
    expect(text.length).toBeLessThanOrEqual(tuning.promptMaxChars)
  })
})

describe('落盘与接缝', () => {
  it('疤与它的标记都留得住', () => {
    const file = tempFile()
    createVitalsStore({ file, tuning }).write(fresh({ scar: 0.74, scar_applied_at: START }))

    const back = createVitalsStore({ file, tuning }).read()

    expect(back.scar).toBeCloseTo(0.74, 10)
    expect(back.scar_applied_at).toBe(START)
  })

  // 先落一份一分钟前的状态，写回那一拍才够得着
  function seeded(file: string, overrides: Partial<VitalsState> = {}): void {
    createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, Date.now() - MINUTE), ...overrides })
  }

  it('一次威胁交一条事实，重要度是当时那个疤', async () => {
    const file = tempFile()
    seeded(file)
    const seam = await mount(file)
    const heard: ScarFact[] = []
    seam.onScar((fact) => {
      heard.push(fact)
    })

    seam.react('再这样就把你关掉', Date.now() - 20_000)

    expect(heard).toHaveLength(1)
    expect(heard[0]?.source).toBe('scar')
    expect(heard[0]?.importance).toBeCloseTo(tuning.scarFirst, 10)
    expect(seam.read().scar).toBeCloseTo(tuning.scarFirst, 10)
  })

  it('同一小时里的第二句威胁不再交', async () => {
    const file = tempFile()
    seeded(file)
    const seam = await mount(file)
    const heard: ScarFact[] = []
    seam.onScar((fact) => {
      heard.push(fact)
    })

    seam.react('再这样就把你关掉', Date.now() - 30_000)
    seam.react('真的把你关掉', Date.now() - 20_000)

    expect(heard).toHaveLength(1)
    expect(createVitalsStore({ file, tuning }).read().scar_applied_at).toBeGreaterThan(0)
  })

  it('取消订阅之后收不到', async () => {
    const file = tempFile()
    seeded(file)
    const seam = await mount(file)
    const heard: ScarFact[] = []
    const off = seam.onScar((fact) => {
      heard.push(fact)
    })
    off()

    seam.react('再这样就把你关掉', Date.now() - 20_000)

    expect(heard).toHaveLength(0)
    expect(seam.read().scar).toBeCloseTo(tuning.scarFirst, 10)
  })
})

describe('变淡只走一条路', () => {
  it('还没有疤时结算不动它', () => {
    const state = fresh()
    settleScar(state, 24, tuning)

    expect(state.scar).toBe(0)
  })
})
