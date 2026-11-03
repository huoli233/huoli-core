import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqProactiveOf, type Candidate, type Config, type Drives, type QqProactiveSeam } from '../src/index.ts'

const CANDIDATES: Candidate[] = [
  {
    id: 'a',
    kind: 'share',
    why: '刚好想到一句',
    text: '刚看到楼下那家店换了招牌',
    confidence: 0.8,
    value: 0.6,
    risk: 0.1,
    source: 'thought',
  },
  {
    id: 'b',
    kind: 'ask',
    why: '上次没问完',
    text: '周末那个游戏是哪个来着',
    confidence: 0.7,
    value: 0.7,
    risk: 0.2,
    source: 'thought',
  },
]

const DRIVES: Drives = { bored: 0.8, curious: 0.6, lonely: 0.4 }

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
}

function consider(seam: QqProactiveSeam, chatKey: string, overrides: Overrides = {}) {
  return seam.consider({
    chatKey,
    candidates: CANDIDATES,
    drives: DRIVES,
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
  it('平常的时候能攒住一句', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    expect(first.pick).not.toBeNull()
    expect(first.pick?.text.length ?? 0).toBeGreaterThan(0)
  })

  it('攒住的时候一并说清为什么', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    expect(first.pick?.why.length ?? 0).toBeGreaterThan(0)
  })

  it('有人在聊就先听着', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const busyRoom = consider(seam, 'group:2', { humanActive: true })

    expect(busyRoom.pick).toBeNull()
    expect(busyRoom.verdict.code).toBe('proactive.people_talking')
  })

  it('没有能发出去的通道就不攒', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const noChannel = consider(seam, 'group:3', { hasChannel: false })

    expect(noChannel.pick).toBeNull()
    expect(noChannel.verdict.code).toBe('proactive.no_channel')
  })

  it('已经说过的话不会再攒出来', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })

    const repeated = consider(seam, 'group:1', { history: ['刚看到楼下那家店换了招牌'] })

    expect(repeated.pick?.text).not.toBe('刚看到楼下那家店换了招牌')
  })
})

describe('先给人看再发', () => {
  it('攒着的东西先能被看见', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    consider(seam, 'group:1')

    expect(seam.preview('group:1').length).toBeGreaterThanOrEqual(1)
  })

  it('投递能拿到那一条', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    consider(seam, 'group:1')

    const delivered = seam.deliver('group:1')

    expect(delivered).not.toBeNull()
    expect(delivered?.text.length ?? 0).toBeGreaterThan(0)
  })

  it('投递之后就不在待发里了', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    consider(seam, 'group:1')
    const preview = seam.preview('group:1')
    seam.deliver('group:1')

    expect(seam.preview('group:1')).toHaveLength(preview.length - 1)
  })

  it('刚说完不能马上再说', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    consider(seam, 'group:1')
    seam.deliver('group:1')

    const tooSoon = consider(seam, 'group:1')

    expect(tooSoon.pick).toBeNull()
    expect(tooSoon.verdict.code).toBe('proactive.too_soon')
  })

  it('今天说够了就停下', () => {
    const seam = mount({ file: tempFile(), enabled: true, dailyMax: 3, ...NO_QUIET })
    for (let at = 0; at < 5; at += 1) seam.timing.noteSpoken('group:9')

    const dayFull = consider(seam, 'group:9')

    expect(dayFull.pick).toBeNull()
    expect(dayFull.verdict.code === 'proactive.day_full' || dayFull.verdict.code === 'proactive.too_soon').toBe(true)
  })
})

describe('开关与安静时段', () => {
  it('关掉开关就不主动', () => {
    const seam = mount({ file: tempFile(), enabled: false, ...NO_QUIET })

    const off = consider(seam, 'group:5')

    expect(off.pick).toBeNull()
    expect(off.verdict.code).toBe('proactive.off')
  })

  it('安静时段会拦住并给出下次的时间', () => {
    const hour = new Date().getHours()
    const quietStart = `${String(hour).padStart(2, '0')}:00`
    const quietEnd = `${String((hour + 2) % 24).padStart(2, '0')}:00`
    const seam = mount({ file: tempFile('quiet.json'), enabled: true, quietStart, quietEnd })

    const quieted = consider(seam, 'group:6')

    expect(quieted.pick).toBeNull()
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

    expect(keptBefore).toBe(1)
    expect(again.preview('group:keep')).toHaveLength(1)
  })
})
