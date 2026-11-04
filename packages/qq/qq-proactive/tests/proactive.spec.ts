import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  cooldownMs,
  PROACTIVE_DEFAULTS,
  qqProactiveOf,
  runGates,
  type Candidate,
  type Config,
  type QqProactiveSeam,
} from '../src/index.ts'

// 两条候选的到达时间不同：晚到的这条各项都更好看，用来证明先后只看时间
const BASE = Date.now()

const CANDIDATES: Candidate[] = [
  {
    id: 'a',
    kind: 'share',
    why: '刚好想到一句',
    text: '刚看到楼下那家店换了招牌',
    confidence: 0.3,
    value: 0.2,
    risk: 0.6,
    source: 'thought',
    at: BASE - 60_000,
  },
  {
    id: 'b',
    kind: 'ask',
    why: '上次没问完',
    text: '周末那个游戏是哪个来着',
    confidence: 0.9,
    value: 0.9,
    risk: 0.05,
    source: 'thought',
    at: BASE,
  },
]

// 安静时段挪到不会被当前时刻命中的位置
const NO_QUIET = { quietStart: '00:00', quietEnd: '00:00' }

const tempDirs: string[] = []

function tempFile(name = 'proactive.json'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-proactive-'))
  tempDirs.push(dir)
  return path.join(dir, name)
}

function mount(config: Config): QqProactiveSeam {
  const ctx = new Context()
  apply(ctx, config)
  const seam = qqProactiveOf(ctx)
  if (seam === undefined) throw new Error('主动开口没有装配')
  return seam
}

interface Overrides {
  humanActive?: boolean
  hasChannel?: boolean
  history?: string[]
  candidates?: Candidate[]
}

function consider(seam: QqProactiveSeam, chatKey: string, overrides: Overrides = {}) {
  return seam.consider({
    chatKey,
    candidates: overrides.candidates ?? CANDIDATES,
    history: overrides.history ?? [],
    humanActive: overrides.humanActive ?? false,
    botBusy: false,
    hasChannel: overrides.hasChannel ?? true,
  })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('攒理由', () => {
  it('平常的时候把每条候选都攒住', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    expect(first.pending.map(item => item.text)).toEqual([CANDIDATES[0]?.text, CANDIDATES[1]?.text])
    expect(seam.preview('group:1')).toHaveLength(2)
  })

  it('攒住的时候一并说清为什么', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    for (const item of first.pending) expect(item.why.length).toBeGreaterThan(0)
  })

  it('攒住的只有事实，没有合出来的分数', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    for (const item of first.pending) {
      expect(Object.keys(item).sort()).toEqual(['chatKey', 'createdAt', 'expiresAt', 'facts', 'id', 'text', 'why'])
      expect(Object.keys(item.facts).sort()).toEqual(['at', 'confidence', 'kind', 'risk', 'source', 'value'])
    }
  })

  it('候选里不带任何能被拿去排序或比阈值的字段', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    for (const candidate of first.considered) {
      expect(Object.keys(candidate).sort()).toEqual(['at', 'confidence', 'id', 'kind', 'risk', 'source', 'text', 'value', 'why'])
      expect(Object.hasOwn(candidate, 'score')).toBe(false)
      expect(Object.hasOwn(candidate, 'weight')).toBe(false)
    }
  })

  it('按到达时间排，不按哪条更好看排', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    expect(first.considered.map(candidate => candidate.id)).toEqual(['a', 'b'])
    expect(first.considered.map(candidate => candidate.at)).toEqual([BASE - 60_000, BASE])
  })

  it('有人在聊就先听着', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const busyRoom = consider(seam, 'group:2', { humanActive: true })

    expect(busyRoom.pending).toHaveLength(0)
    expect(busyRoom.verdict.code).toBe('proactive.people_talking')
  })

  it('没有能发出去的通道就不攒', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const noChannel = consider(seam, 'group:3', { hasChannel: false })

    expect(noChannel.pending).toHaveLength(0)
    expect(noChannel.verdict.code).toBe('proactive.no_channel')
  })

  it('已经说过的话不会再攒出来', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const repeated = consider(seam, 'group:1', { history: ['刚看到楼下那家店换了招牌'] })

    expect(repeated.pending.map(item => item.text)).toEqual([CANDIDATES[1]?.text])
  })

  it('同一批里说法一样的只留一条', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    const copy = { ...CANDIDATES[0], id: 'c', at: BASE + 1_000 } as Candidate

    const first = consider(seam, 'group:1', { candidates: [CANDIDATES[0] as Candidate, copy] })

    expect(first.considered).toHaveLength(1)
    expect(first.pending).toHaveLength(1)
  })
})

describe('先给人看再发', () => {
  it('攒着的东西带着理由与风险一起能被看见', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    consider(seam, 'group:1')

    const shown = seam.preview('group:1')

    expect(shown).toHaveLength(2)
    for (const item of shown) {
      expect(item.why.length).toBeGreaterThan(0)
      expect(item.facts.risk).toBeGreaterThanOrEqual(0)
      expect(item.facts.confidence).toBeGreaterThanOrEqual(0)
    }
  })

  it('说哪一条由调用方定', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    consider(seam, 'group:1')
    const later = seam.preview('group:1').find(item => item.text === CANDIDATES[1]?.text)
    if (later === undefined) throw new Error('晚到的那条没攒住')

    const delivered = seam.deliver('group:1', later.id)

    expect(delivered?.text).toBe(CANDIDATES[1]?.text)
  })

  it('投递之后就不在待发里了', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    consider(seam, 'group:1')
    const preview = seam.preview('group:1')
    const target = preview[0]
    if (target === undefined) throw new Error('没有攒住任何一条')

    seam.deliver('group:1', target.id)

    expect(seam.preview('group:1')).toHaveLength(preview.length - 1)
  })

  it('同一批候选再看一次不会叠出第二条', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    const first = consider(seam, 'group:1')
    const again = consider(seam, 'group:1')

    expect(again.pending.map(item => item.id)).toEqual(first.pending.map(item => item.id))
    expect(seam.preview('group:1')).toHaveLength(2)
  })

  it('不认识的编号谁也不投递', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    consider(seam, 'group:1')

    const delivered = seam.deliver('group:1', 'not-a-number')

    expect(delivered).toBeNull()
    expect(seam.preview('group:1')).toHaveLength(2)
    expect(seam.timing.lastSpokenAt('group:1')).toBe(0)
  })

  it('刚说完不能马上再说', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    consider(seam, 'group:1')
    const target = seam.preview('group:1')[0]
    if (target === undefined) throw new Error('没有攒住任何一条')
    seam.deliver('group:1', target.id)

    const tooSoon = consider(seam, 'group:1')

    expect(tooSoon.pending).toHaveLength(0)
    expect(tooSoon.verdict.code).toBe('proactive.too_soon')
    expect(tooSoon.verdict.retryAt).toBe(seam.timing.lastSpokenAt('group:1') + cooldownMs(PROACTIVE_DEFAULTS))
  })

  it('今天说够了就停下', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    for (let at = 0; at < 5; at += 1) seam.timing.noteSpoken('group:9')

    const dayFull = consider(seam, 'group:9')

    expect(dayFull.pending).toHaveLength(0)
    expect(dayFull.verdict.code).toBe('proactive.day_full')
  })
})

describe('冷却', () => {
  const NOW = BASE
  const OPEN = { enabled: true, quietStart: '00:00', quietEnd: '00:00' }

  it('下一次可开口时刻是冷却区间中点，同样的输入算出同一个时刻', () => {
    const input = {
      now: NOW,
      config: OPEN,
      lastSpokenAt: NOW - 60_000,
      todayCount: 0,
      humanActive: false,
      botBusy: false,
      hasChannel: true,
    }

    const verdicts = [0, 1, 2, 3, 4].map(() => runGates(input))

    const retryAt = verdicts.map(verdict => verdict.retryAt)
    expect(new Set(retryAt).size).toBe(1)
    expect(verdicts[0]?.code).toBe('proactive.too_soon')
    expect(retryAt[0]).toBe(NOW - 60_000 + PROACTIVE_DEFAULTS.gapMinMs + (PROACTIVE_DEFAULTS.gapMaxMs - PROACTIVE_DEFAULTS.gapMinMs) / 2)
  })

  it('冷掉之后就能开口，边界那一刻算可以', () => {
    const gap = cooldownMs({ ...PROACTIVE_DEFAULTS, ...OPEN })
    const lastSpokenAt = NOW - gap

    const verdict = runGates({
      now: NOW,
      config: OPEN,
      lastSpokenAt,
      todayCount: 0,
      humanActive: false,
      botBusy: false,
      hasChannel: true,
    })

    expect(verdict.ok).toBe(true)
  })

  it('冷却区间的上下限能从配置改', () => {
    const config = { ...OPEN, gapMinMs: 10 * 60_000, gapMaxMs: 20 * 60_000 }

    const verdict = runGates({
      now: NOW,
      config,
      lastSpokenAt: NOW - 60_000,
      todayCount: 0,
      humanActive: false,
      botBusy: false,
      hasChannel: true,
    })

    expect(verdict.retryAt).toBe(NOW - 60_000 + 15 * 60_000)
  })
})

describe('开关与安静时段', () => {
  it('关掉开关就不主动', () => {
    const seam = mount({ file: tempFile(), enabled: false, ...NO_QUIET })

    const off = consider(seam, 'group:5')

    expect(off.pending).toHaveLength(0)
    expect(off.verdict.code).toBe('proactive.off')
  })

  it('安静时段会拦住并给出下次的时间', () => {
    const hour = new Date().getHours()
    const quietStart = `${String(hour).padStart(2, '0')}:00`
    const quietEnd = `${String((hour + 2) % 24).padStart(2, '0')}:00`
    const seam = mount({ file: tempFile('quiet.json'), enabled: true, quietStart, quietEnd })

    const quieted = consider(seam, 'group:6')

    expect(quieted.pending).toHaveLength(0)
    expect(quieted.verdict.code).toBe('proactive.quiet')
    expect(typeof quieted.verdict.retryAt).toBe('number')
  })
})

describe('关掉再开', () => {
  it('攒着的还在', () => {
    const file = tempFile()
    const first = mount({ file, enabled: true, ...NO_QUIET })
    consider(first, 'group:keep')
    const keptBefore = first.preview('group:keep').length

    const again = mount({ file, enabled: true, ...NO_QUIET })

    expect(keptBefore).toBe(2)
    expect(again.preview('group:keep')).toHaveLength(2)
  })
})
