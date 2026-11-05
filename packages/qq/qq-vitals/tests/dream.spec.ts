import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply, createVitalsStore, dreamFactOf, dreamMoodOf, drawDream, drift, emptyState, qqVitalsOf, resolveTuning,
  type DreamFact, type DreamKind, type DreamMood, type QqVitalsSeam, type VitalsState,
  WORDS_PRESET,
} from '../src/index.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })

// 用例里的时刻一律写死，跑在哪一天、哪个时区都一样
function moment(day: number, hour: number, minute = 0): number {
  return new Date(2026, 0, day, hour, minute, 0).getTime()
}

function fresh(overrides: Partial<VitalsState> = {}, at = moment(1, 10)): VitalsState {
  return { ...emptyState(tuning, at), ...overrides }
}

// 固定随机源：每次抽签都拿同一个值，边界才好验
function constant(value: number): () => number {
  return () => value
}

// 一个梦已经记进状态但还没产成事实
function dreamed(overrides: Partial<VitalsState> = {}): VitalsState {
  return fresh({ dream_at: moment(1, 23), dream_kind: 'plain', dream_place: '天台', ...overrides })
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-dream-'))
  tempDirs.push(dir)
  return path.join(dir, 'vitals.json')
}

async function mount(file: string): Promise<{ ctx: Context; seam: QqVitalsSeam }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { file, tuning: { words: WORDS_PRESET, startDelayMs: 1 } })
  const seam = qqVitalsOf(ctx)
  if (seam === undefined) throw new Error('状态没装上')
  return { ctx, seam }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('入梦时的心情三档', () => {
  it('好坏偏低或想哭偏重算差', () => {
    expect(dreamMoodOf(fresh({ valence: 0.2 }), tuning)).toBe('bad')
    expect(dreamMoodOf(fresh({ valence: 0.5, sadness: 0.8 }), tuning)).toBe('bad')
  })

  it('好坏偏高且不难受算不错', () => {
    expect(dreamMoodOf(fresh({ valence: 0.7, sadness: 0.1 }), tuning)).toBe('good')
  })

  it('中间那一档算正常', () => {
    expect(dreamMoodOf(fresh({ valence: 0.5, sadness: 0.4 }), tuning)).toBe('normal')
    expect(dreamMoodOf(fresh({ valence: 0.6, sadness: 0.1 }), tuning)).toBe('normal')
    expect(dreamMoodOf(fresh({ valence: 0.7, sadness: 0.4 }), tuning)).toBe('normal')
  })
})

describe('三档心情的抽签边界', () => {
  const CASES: ReadonlyArray<readonly [DreamMood, number, DreamKind]> = [
    ['normal', 0, 'sweet'],
    ['normal', 0.049, 'sweet'],
    ['normal', 0.05, 'plain'],
    ['normal', 0.5, 'plain'],
    ['normal', 0.99, 'plain'],
    ['good', 0, 'sweet'],
    ['good', 0.099, 'sweet'],
    ['good', 0.1, 'plain'],
    ['good', 0.99, 'plain'],
    ['bad', 0, 'nightmare'],
    ['bad', 0.099, 'nightmare'],
    ['bad', 0.1, 'plain'],
    ['bad', 0.99, 'plain'],
  ]

  for (const [mood, roll, kind] of CASES) {
    it(`${mood} 心情抽到 ${roll} 时是 ${kind}`, () => {
      expect(drawDream(mood, constant(roll), tuning)).toBe(kind)
    })
  }

  it('正常与不错都做不出噩梦，差心情做不出美梦', () => {
    for (let step = 0; step < 100; step += 1) {
      const roll = step / 100
      expect(drawDream('normal', constant(roll), tuning)).not.toBe('nightmare')
      expect(drawDream('good', constant(roll), tuning)).not.toBe('nightmare')
      expect(drawDream('bad', constant(roll), tuning)).not.toBe('sweet')
    }
  })

  it('千次抽签落在配置的概率上', () => {
    const spread = (mood: DreamMood): DreamKind[] => {
      let step = 0
      const rolling = (): number => {
        const roll = step / 1000
        step += 1
        return roll
      }
      return Array.from({ length: 1000 }, () => drawDream(mood, rolling, tuning))
    }
    const count = (kinds: DreamKind[], kind: DreamKind): number => kinds.filter(one => one === kind).length

    const normal = spread('normal')
    expect(count(normal, 'sweet')).toBe(50)
    expect(count(normal, 'nightmare')).toBe(0)
    expect(count(normal, 'plain')).toBe(950)

    const good = spread('good')
    expect(count(good, 'sweet')).toBe(100)
    expect(count(good, 'plain')).toBe(900)

    const bad = spread('bad')
    expect(count(bad, 'nightmare')).toBe(100)
    expect(count(bad, 'plain')).toBe(900)
  })

  it('概率全在参数里，改一条就换个结果', () => {
    const allSweet = resolveTuning({ words: WORDS_PRESET, dreamSweetNormal: 1.0, dreamSweetBad: 1.0 })

    expect(drawDream('normal', constant(0.9), tuning)).toBe('plain')
    expect(drawDream('normal', constant(0.9), allSweet)).toBe('sweet')
  })
})

describe('每一次入睡入一次梦', () => {
  it('夜里睡着那一拍就把这一场梦记进状态', () => {
    const state = fresh({ adenosine: 0.6, valence: 0.7, sadness: 0.1, last_update: moment(1, 22, 59) })

    const next = drift(state, moment(1, 23), tuning, constant(0.02))

    expect(next.sleep_state).toBe('sleeping')
    expect(next.dream_at).toBe(moment(1, 23))
    expect(next.dream_kind).toBe('sweet')
    expect(next.dream_place.length).toBeGreaterThan(0)
    expect(next.dream_repeat).toBe(false)
  })

  it('同一个夜里睡着之后不再入梦', () => {
    const asleep = fresh({
      adenosine: 0.6,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      wake_after: moment(2, 7, 30),
      dream_at: moment(1, 23),
      dream_kind: 'plain',
      dream_place: '海边',
      last_update: moment(1, 23),
    })

    const next = drift(asleep, moment(1, 23, 30), tuning, constant(0.02))

    expect(next.dream_at).toBe(moment(1, 23))
    expect(next.dream_place).toBe('海边')
  })

  it('醒着不入梦', () => {
    const next = drift(fresh({ last_update: moment(1, 9, 59) }), moment(1, 10), tuning, constant(0.02))

    expect(next.sleep_state).toBe('awake')
    expect(next.dream_at).toBe(0)
    expect(dreamFactOf(next, tuning)).toBeUndefined()
  })

  it('午睡也算一次入梦', () => {
    const state = fresh({ adenosine: 0.4, last_update: moment(1, 12, 29) })

    const next = drift(state, moment(1, 12, 30), tuning, constant(0))

    expect(next.sleep_kind).toBe('nap')
    expect(next.dream_at).toBe(moment(1, 12, 30))
  })
})

describe('一场梦只产一条事实', () => {
  it('记进状态的这一场给事实，已经产过的同一场不再给', () => {
    const one = dreamFactOf(dreamed(), tuning)
    const already = dreamFactOf(dreamed({ dream_applied_at: moment(1, 23) }), tuning)

    expect(one).toBeDefined()
    expect(already).toBeUndefined()
  })

  it('没入过梦的身体不给事实', () => {
    expect(dreamFactOf(fresh(), tuning)).toBeUndefined()
    expect(dreamFactOf(fresh({ dream_at: moment(1, 23) }), tuning)).toBeUndefined()
  })

  it('事实带时刻、类型、地点与一句文本，没有多余字段', () => {
    const fact = dreamFactOf(dreamed({ dream_kind: 'sweet' }), tuning)

    expect(Object.keys(fact ?? {}).sort()).toEqual(['at', 'importance', 'kind', 'place', 'publishable', 'text'])
    expect(fact?.at).toBe(moment(1, 23))
    expect(fact?.kind).toBe('sweet')
    expect(fact?.place).toBe('天台')
    expect(fact?.text.length).toBeGreaterThan(0)
    expect(/\d/u.test(fact?.text ?? '')).toBe(false)
  })
})

describe('只有美梦与噩梦能发布', () => {
  it('平淡梦不可发布，美梦与噩梦可发布', () => {
    expect(dreamFactOf(dreamed({ dream_kind: 'plain' }), tuning)?.publishable).toBe(false)
    expect(dreamFactOf(dreamed({ dream_kind: 'sweet' }), tuning)?.publishable).toBe(true)
    expect(dreamFactOf(dreamed({ dream_kind: 'nightmare' }), tuning)?.publishable).toBe(true)
  })

  it('三种梦的文本各不相同', () => {
    const texts = (['sweet', 'nightmare', 'plain'] as const)
      .map(kind => dreamFactOf(dreamed({ dream_kind: kind }), tuning)?.text)

    expect(new Set(texts).size).toBe(3)
  })
})

describe('重要度压在零点七以下', () => {
  it('美梦、噩梦、平淡梦各按文档取值', () => {
    expect(dreamFactOf(dreamed({ dream_kind: 'sweet' }), tuning)?.importance).toBeCloseTo(0.35, 10)
    expect(dreamFactOf(dreamed({ dream_kind: 'nightmare' }), tuning)?.importance).toBeCloseTo(0.45, 10)
    expect(dreamFactOf(dreamed({ dream_kind: 'plain' }), tuning)?.importance).toBeCloseTo(0.25, 10)
  })

  it('又梦到同一个地点时按重复地点算', () => {
    const fact = dreamFactOf(dreamed({ dream_kind: 'plain', dream_repeat: true }), tuning)

    expect(fact?.importance).toBeCloseTo(tuning.dreamImportancePlace, 10)
    expect(tuning.dreamImportancePlace).toBeCloseTo(0.52, 10)
  })

  it('哪一种都不许到零点七', () => {
    const kinds = ['sweet', 'nightmare', 'plain'] as const
    for (const kind of kinds) {
      for (const repeat of [false, true]) {
        const fact = dreamFactOf(dreamed({ dream_kind: kind, dream_repeat: repeat }), tuning)
        expect(fact?.importance).toBeLessThan(0.7)
      }
    }
  })

  it('连着两场落在同一个地点时第二场标记为重复', () => {
    const first = fresh({ last_update: moment(1, 22, 59), adenosine: 0.6 })
    const firstNight = drift(first, moment(1, 23), tuning, constant(0.02))
    const second = fresh({
      last_update: moment(2, 22, 59),
      adenosine: 0.6,
      dream_place: firstNight.dream_place,
      dream_at: firstNight.dream_at,
      dream_kind: 'plain',
    })

    const secondNight = drift(second, moment(2, 23), tuning, constant(0.02))

    expect(secondNight.dream_repeat).toBe(true)
    expect(dreamFactOf(secondNight, tuning)?.importance).toBeCloseTo(tuning.dreamImportancePlace, 10)
  })
})

describe('落盘', () => {
  it('这一场梦与产出的标记都留得住', () => {
    const file = tempFile()
    createVitalsStore({ file, tuning }).write(dreamed({ dream_applied_at: moment(1, 23), dream_repeat: true }))

    const back = createVitalsStore({ file, tuning }).read()

    expect(back.dream_at).toBe(moment(1, 23))
    expect(back.dream_kind).toBe('plain')
    expect(back.dream_place).toBe('天台')
    expect(back.dream_repeat).toBe(true)
    expect(back.dream_applied_at).toBe(moment(1, 23))
    expect(dreamFactOf(back, tuning)).toBeUndefined()
  })
})

describe('心跳把每一场梦交出去一次', () => {
  // 先落一份一分钟前的状态，第一拍才够得着入睡那一步
  function seed(file: string, overrides: Partial<VitalsState>): void {
    createVitalsStore({ file, tuning }).write(fresh(overrides, moment(1, 22, 59)))
  }

  it('入睡那一拍交出一条，之后同一场不再交', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(moment(1, 23)))
    const file = tempFile()
    seed(file, { adenosine: 0.6 })
    const { seam } = await mount(file)
    const heard: DreamFact[] = []
    seam.onDream((fact) => {
      heard.push(fact)
    })

    await vi.advanceTimersByTimeAsync(1)

    expect(heard).toHaveLength(1)
    expect(heard[0]?.at).toBeGreaterThanOrEqual(moment(1, 23))
    expect(heard[0]?.text.length).toBeGreaterThan(0)
    expect(heard[0]?.publishable).toBe(heard[0]?.kind !== 'plain')
    expect(seam.read().dream_applied_at).toBe(heard[0]?.at)

    await vi.advanceTimersByTimeAsync(tuning.beatMs)

    expect(heard).toHaveLength(1)
  })

  it('醒着的那些拍一条都不给', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(moment(1, 10)))
    const file = tempFile()
    createVitalsStore({ file, tuning }).write(fresh({ last_update: moment(1, 9, 59) }, moment(1, 9, 59)))
    const { seam } = await mount(file)
    const heard: DreamFact[] = []
    seam.onDream((fact) => {
      heard.push(fact)
    })

    await vi.advanceTimersByTimeAsync(tuning.beatMs)

    expect(heard).toHaveLength(0)
    expect(seam.read().dream_at).toBe(0)
  })

  it('重启之后同一场不会再交一次', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(moment(1, 23)))
    const file = tempFile()
    seed(file, { adenosine: 0.6 })
    const first = await mount(file)
    const heard: DreamFact[] = []
    first.seam.onDream((fact) => {
      heard.push(fact)
    })

    await vi.advanceTimersByTimeAsync(1)
    expect(heard).toHaveLength(1)
    await first.ctx.fiber.dispose()

    const second = await mount(file)
    second.seam.onDream((fact) => {
      heard.push(fact)
    })
    await vi.advanceTimersByTimeAsync(1)

    expect(heard).toHaveLength(1)
  })
})
