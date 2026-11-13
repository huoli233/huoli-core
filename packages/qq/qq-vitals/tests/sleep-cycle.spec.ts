import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createVitalsStore,
  cycleOf,
  derive,
  drift,
  emptyState,
  react,
  renderPrompt,
  resolveTuning,
  type VitalsState,
  WORDS_PRESET,
} from '../src/index.ts'

const tuning = resolveTuning({ words: WORDS_PRESET })

// 用例里的时刻一律写死，跑在哪一天、哪个时区都一样
function moment(day: number, hour: number, minute = 0): number {
  return new Date(2026, 0, day, hour, minute, 0).getTime()
}

function fresh(overrides: Partial<VitalsState> = {}): VitalsState {
  return { ...emptyState(tuning, moment(1, 10)), ...overrides }
}

function settled(overrides: Partial<VitalsState> = {}): VitalsState {
  return derive(fresh(overrides), tuning)
}

const NO_JITTER = (): number => 0.5
const ZERO = (): number => 0
const CERTAIN = (): number => 0.99

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-sleep-'))
  tempDirs.push(dir)
  return path.join(dir, 'vitals.json')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('夜间睡眠', () => {
  it('到点入睡，醒来时刻落在次日七点半', () => {
    const state = fresh({ adenosine: 0.6, last_update: moment(1, 22, 59) })

    const next = drift(state, moment(1, 23), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('sleeping')
    expect(next.asleep).toBe(true)
    expect(next.sleep_kind).toBe('night')
    expect(next.wake_after).toBe(moment(2, 7, 30))
  })

  it('睡眠压力不够时不睡', () => {
    const state = fresh({ adenosine: 0.3, last_update: moment(1, 22, 59) })

    const next = drift(state, moment(1, 23), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('awake')
    expect(next.sleep_kind).toBe('')
  })

  it('进入睡眠窗口过了宽限，压力不够也睡', () => {
    const state = fresh({ adenosine: 0.2, last_update: moment(1, 23, 29) })

    const next = drift(state, moment(1, 23, 30), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('sleeping')
    expect(next.asleep).toBe(true)
  })

  it('刚被消息叫醒的十五分钟内不立刻强制睡回去', () => {
    const state = fresh({ adenosine: 0.2, woken_at: moment(2, 30), last_update: moment(2, 30) })

    const next = drift(state, moment(2, 31), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('awake')
  })

  it('白天进不了夜睡', () => {
    const state = fresh({ adenosine: 0.9, last_update: moment(1, 9, 59) })

    const next = drift(state, moment(1, 10), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('awake')
  })

  it('到了醒来时刻就醒，并留一小段迷糊', () => {
    const state = fresh({
      adenosine: 0.5,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      wake_after: moment(2, 7),
      last_update: moment(2, 6, 59),
    })

    const next = drift(state, moment(2, 7), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('waking')
    expect(next.asleep).toBe(false)
    expect(next.groggy_until).toBe(moment(2, 7) + tuning.groggyMinutes * 60_000)
  })

  it('白天里睡眠压力回落到低位也醒', () => {
    const state = fresh({
      adenosine: 0.2,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      wake_after: moment(2, 9),
      last_update: moment(2, 7, 59),
    })

    const next = drift(state, moment(2, 8), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('waking')
  })

  it('夜里不会因为钟点到了就醒', () => {
    const state = fresh({
      adenosine: 0.9,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      wake_after: moment(2, 7, 30),
      last_update: moment(1, 23, 29),
    })

    const next = drift(state, moment(1, 23, 30), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('sleeping')
  })

  it('白天最晚那个钟点必醒', () => {
    const state = fresh({
      adenosine: 0.5,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      wake_after: moment(2, 13),
      last_update: moment(2, 10, 59),
    })

    const next = drift(state, moment(2, 11), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('waking')
  })

  it('睡着时睡眠压力往下掉，醒着往上走', () => {
    const asleep = fresh({
      adenosine: 0.6,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      wake_after: moment(2, 7, 30),
      last_update: moment(2, 0),
    })
    const awake = fresh({ adenosine: 0.2, woken_at: moment(2, 1), last_update: moment(2, 0, 59) })

    const slept = drift(asleep, moment(2, 1), tuning, NO_JITTER)
    const stayed = drift(awake, moment(2, 1), tuning, NO_JITTER)

    expect(slept.sleep_state).toBe('sleeping')
    expect(slept.adenosine).toBeCloseTo(0.6 - tuning.sleepAdenosineDrop, 6)
    expect(stayed.sleep_state).toBe('awake')
    expect(stayed.adenosine).toBeGreaterThan(0.2)
  })

  it('迷糊窗口过完就回到醒着', () => {
    const state = fresh({ sleep_state: 'waking', groggy_until: moment(1, 7, 10), last_update: moment(1, 7, 9) })

    const next = drift(state, moment(1, 7, 20), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('awake')
  })
})

describe('午睡', () => {
  it('午后睡眠压力够了会睡着，时长在二十到五十分钟之间', () => {
    const state = fresh({ adenosine: 0.4, last_update: moment(1, 12, 29) })

    const next = drift(state, moment(1, 12, 30), tuning, ZERO)

    expect(next.sleep_state).toBe('sleeping')
    expect(next.sleep_kind).toBe('nap')
    expect(next.wake_after).toBe(moment(1, 12, 30) + tuning.napMinMinutes * 60_000)
    expect(next.wake_after - moment(1, 12, 30)).toBeLessThanOrEqual(tuning.napMaxMinutes * 60_000)
  })

  it('没抽到那一下就不睡', () => {
    const state = fresh({ adenosine: 0.4, last_update: moment(1, 12, 29) })

    const next = drift(state, moment(1, 12, 30), tuning, CERTAIN)

    expect(next.sleep_state).toBe('awake')
  })

  it('上午不睡午觉', () => {
    const state = fresh({ adenosine: 0.9, last_update: moment(1, 10, 59) })

    const next = drift(state, moment(1, 11), tuning, ZERO)

    expect(next.sleep_state).toBe('awake')
  })

  it('一天最多一次：当天睡过就不再睡', () => {
    const state = fresh({ adenosine: 0.5, nap_at: moment(1, 12, 5), last_update: moment(1, 13, 59) })

    const next = drift(state, moment(1, 14), tuning, ZERO)

    expect(next.sleep_state).toBe('awake')
  })

  it('昨天睡过不算今天', () => {
    const state = fresh({ adenosine: 0.5, nap_at: moment(1, 12, 5), last_update: moment(2, 12, 29) })

    const next = drift(state, moment(2, 12, 30), tuning, ZERO)

    expect(next.sleep_kind).toBe('nap')
  })

  it('午睡只看到点这条，白天最晚那条不参与', () => {
    const state = fresh({
      adenosine: 0.5,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'nap',
      nap_at: moment(1, 12, 40),
      wake_after: moment(1, 13, 20),
      last_update: moment(1, 12, 59),
    })

    const next = drift(state, moment(1, 13), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('sleeping')
    expect(next.sleep_kind).toBe('nap')
  })

  it('午睡醒后迷糊五分钟', () => {
    const state = fresh({
      adenosine: 0.3,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'nap',
      wake_after: moment(1, 12, 50),
      last_update: moment(1, 12, 51),
    })

    const next = drift(state, moment(1, 12, 52), tuning, NO_JITTER)

    expect(next.sleep_state).toBe('waking')
    expect(next.groggy_until).toBe(moment(1, 12, 52) + tuning.napGroggyMinutes * 60_000)
  })

  it('睡着一觉时另一套醒来规则不会插进来', () => {
    const napping = fresh({
      adenosine: 0.5,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'nap',
      wake_after: moment(1, 23, 50),
      last_update: moment(1, 23, 29),
    })
    const night = fresh({
      adenosine: 0.8,
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      wake_after: moment(2, 7, 30),
      last_update: moment(1, 23, 29),
    })

    const napLater = drift(napping, moment(1, 23, 30), tuning, NO_JITTER)
    const nightLater = drift(night, moment(1, 23, 30), tuning, NO_JITTER)

    expect(napLater.sleep_kind).toBe('nap')
    expect(napLater.wake_after).toBe(moment(1, 23, 50))
    expect(nightLater.sleep_kind).toBe('night')
    expect(nightLater.wake_after).toBe(moment(2, 7, 30))
  })
})

// 两个状态之间只允许这几个字段变，别的变一个都算多写了
const WAKE_ONLY = ['last_msg', 'last_user_text', 'woken_at']

function changedKeys(before: VitalsState, after: VitalsState): string[] {
  const keys = Object.keys(before) as (keyof VitalsState)[]
  return keys.filter(key => before[key] !== after[key]).sort()
}

describe('睡着时收到消息', () => {
  it('只记一笔被吵醒，身体一个字段都不动', () => {
    const before = settled({
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      wake_after: moment(2, 7, 30),
      last_update: moment(1, 23, 40),
    })
    const at = moment(1, 23, 41)

    const after = react(before, '喝水了，你睡了吗', at, tuning)

    expect(changedKeys(before, after)).toEqual([...WAKE_ONLY].sort())
    expect(after.woken_at).toBe(at)
    expect(after.thirst).toBeCloseTo(before.thirst, 10)
    expect(after.dopamine).toBeCloseTo(before.dopamine, 10)
    expect(after.last_drink).toBe(before.last_drink)
  })

  it('刚被消息叫醒时提示词说明要简短回复', () => {
    const at = moment(1, 23, 41)
    const woken = react(settled({ sleep_state: 'sleeping', asleep: true, sleep_kind: 'night', last_update: at }), '喂', at, tuning)

    const text = renderPrompt(derive(woken, tuning), tuning)

    expect(text).toContain('刚被消息叫醒')
    expect(text).toContain('简短回完再继续休息')
    expect(text).not.toContain('你正在睡觉')
  })
})

describe('周期相位', () => {
  it('锚点当天是第一天', () => {
    const facts = cycleOf(moment(5, 10), tuning)

    expect(facts.day).toBe(1)
    expect(facts.len).toBe(31)
    expect(facts.phase).toBe('menstrual')
  })

  it('今天早于锚点就取上月的这一天', () => {
    const facts = cycleOf(moment(4, 10), tuning)

    expect(facts.day).toBe(31)
    expect(facts.len).toBe(31)
    expect(facts.phase).toBe('premenstrual')
  })

  it('第六天起是卵泡期', () => {
    expect(cycleOf(moment(10, 10), tuning).phase).toBe('follicular')
  })

  it('第十五天是排卵期', () => {
    expect(cycleOf(moment(19, 10), tuning).phase).toBe('ovulation')
  })

  it('第十八天是黄体期', () => {
    expect(cycleOf(moment(22, 10), tuning).phase).toBe('luteal')
  })

  it('周期末段是经前期', () => {
    expect(cycleOf(moment(30, 10), tuning).phase).toBe('premenstrual')
  })

  it('相位写进状态，雌激素与痛经跟着变', () => {
    const first = drift(fresh({ last_update: moment(5, 9, 59) }), moment(5, 10), tuning)
    const last = drift(fresh({ last_update: moment(9, 9, 59) }), moment(9, 10), tuning)

    expect(first.cycle_day).toBe(1)
    expect(first.estrogen).toBeCloseTo(tuning.cycleEstrogenMenstrual, 6)
    expect(first.cramps).toBeCloseTo(tuning.cycleCrampsStart, 6)
    expect(last.cramps).toBeCloseTo(tuning.cycleCrampsEnd, 6)
    expect(last.cramps).toBeLessThan(first.cramps)
  })

  it('周期字段落了盘，重开还在', () => {
    const file = tempFile()
    createVitalsStore({ file, tuning }).write({
      ...emptyState(tuning, moment(20, 10)),
      cycle_day: 16,
      cycle_len: 31,
      cycle_phase: 'luteal',
      cramps: 0.3,
    })

    const back = createVitalsStore({ file, tuning }).read()

    expect(back.cycle_day).toBe(16)
    expect(back.cycle_len).toBe(31)
    expect(back.cycle_phase).toBe('luteal')
    expect(back.cramps).toBeCloseTo(0.3, 6)
  })
})

describe('算出来的量里的周期项', () => {
  it('经期与经前都让易怒上升、好坏下降', () => {
    const plain = settled()
    const menstrual = settled({ cycle_phase: 'menstrual' })
    const premenstrual = settled({ cycle_phase: 'premenstrual' })

    expect(menstrual.irritability).toBeGreaterThan(plain.irritability)
    expect(premenstrual.irritability).toBeGreaterThan(plain.irritability)
    expect(menstrual.valence).toBeLessThan(plain.valence)
    expect(premenstrual.valence).toBeLessThan(plain.valence)
  })

  it('黄体期与经前期都在扣精力，卵泡期把好坏抬一点', () => {
    const plain = settled()

    expect(settled({ cycle_phase: 'luteal' }).energy).toBeLessThan(plain.energy)
    expect(settled({ cycle_phase: 'premenstrual' }).energy).toBeLessThan(plain.energy)
    expect(settled({ cycle_phase: 'follicular' }).valence).toBeGreaterThan(plain.valence)
  })

  it('痛经本身也压精力、抬易怒', () => {
    const plain = settled()
    const cramping = settled({ cramps: 0.8 })

    expect(cramping.energy).toBeLessThan(plain.energy)
    expect(cramping.irritability).toBeGreaterThan(plain.irritability)
  })
})

describe('提示词里的六段可选', () => {
  const CASES = [
    { text: '你正在睡觉', patch: { sleep_state: 'sleeping', asleep: true, sleep_kind: 'night' } },
    { text: '刚醒', patch: { sleep_state: 'waking' } },
    { text: '在经期', patch: { cycle_phase: 'menstrual' } },
    { text: '经前那几天', patch: { cycle_phase: 'premenstrual' } },
    { text: '不舒服', patch: { cytokines: 0.6 } },
    { text: '太困了', patch: { adenosine: 0.8 } },
  ] as const

  it('每段只在条件成立时出现', () => {
    for (const one of CASES) {
      const text = renderPrompt(settled(one.patch), tuning)

      expect(text).toContain(one.text)
      for (const other of CASES) {
        if (other.text === one.text) continue
        expect(text).not.toContain(other.text)
      }
    }
  })

  it('一个条件都不成立时不多写这一行', () => {
    const text = renderPrompt(settled(), tuning)

    expect(text).not.toContain('眼下的情况')
    for (const one of CASES) expect(text).not.toContain(one.text)
  })

  it('几段同时成立也在三百字以内', () => {
    const text = renderPrompt(settled({
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      woken_at: moment(1, 10),
      cycle_phase: 'menstrual',
      cramps: 0.75,
      cytokines: 0.6,
      adenosine: 0.9,
      melatonin: 0.8,
      thirst: 0.9,
      hunger: 0.9,
    }), tuning)

    expect(text.length).toBeLessThanOrEqual(tuning.promptMaxChars)
    expect(text).toContain('刚被消息叫醒')
    expect(text).toContain('太困了')
  })
})

describe('睡眠落盘', () => {
  it('睡着的状态从文件恢复', () => {
    const file = tempFile()
    createVitalsStore({ file, tuning }).write({
      ...emptyState(tuning, moment(1, 23, 10)),
      sleep_state: 'sleeping',
      asleep: true,
      sleep_kind: 'night',
      wake_after: moment(2, 7, 30),
    })

    const back = createVitalsStore({ file, tuning }).read()

    expect(back.sleep_state).toBe('sleeping')
    expect(back.asleep).toBe(true)
    expect(back.sleep_kind).toBe('night')
    expect(back.wake_after).toBe(moment(2, 7, 30))
  })

  it('睡着那个布尔跟着三态走，不各存一份', () => {
    const file = tempFile()
    createVitalsStore({ file, tuning }).write({
      ...emptyState(tuning, moment(1, 10)),
      sleep_state: 'awake',
      asleep: true,
    })

    expect(createVitalsStore({ file, tuning }).read().asleep).toBe(false)
  })
})
