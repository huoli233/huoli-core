import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
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
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    expect(first.pending.map(item => item.text)).toEqual([CANDIDATES[0]?.text, CANDIDATES[1]?.text])
    expect(seam.preview('group:1')).toHaveLength(2)
  })

  it('攒住的时候一并说清为什么', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    for (const item of first.pending) expect(item.why.length).toBeGreaterThan(0)
  })

  it('攒住的只有事实，没有合出来的分数', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    for (const item of first.pending) {
      expect(Object.keys(item).sort()).toEqual(['chatKey', 'createdAt', 'expiresAt', 'facts', 'id', 'text', 'why'])
      expect(Object.keys(item.facts).sort()).toEqual(['at', 'confidence', 'kind', 'risk', 'source', 'value'])
    }
  })

  it('候选里不带任何能被拿去排序或比阈值的字段', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    for (const candidate of first.considered) {
      expect(Object.keys(candidate).sort()).toEqual(['at', 'confidence', 'id', 'kind', 'risk', 'source', 'text', 'value', 'why'])
      expect(Object.hasOwn(candidate, 'score')).toBe(false)
      expect(Object.hasOwn(candidate, 'weight')).toBe(false)
    }
  })

  it('按到达时间排，不按哪条更好看排', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const first = consider(seam, 'group:1')

    expect(first.considered.map(candidate => candidate.id)).toEqual(['a', 'b'])
    expect(first.considered.map(candidate => candidate.at)).toEqual([BASE - 60_000, BASE])
  })

  it('有人在聊也只是现场事实，不替她拒掉这一轮', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const busyRoom = consider(seam, 'group:2', { humanActive: true })

    expect(busyRoom.verdict.code).not.toBe('proactive.people_talking')
  })

  it('没有能发出去的通道就不攒', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const noChannel = consider(seam, 'group:3', { hasChannel: false })

    expect(noChannel.pending).toHaveLength(0)
    expect(noChannel.verdict.code).toBe('proactive.no_channel')
  })

  it('已经说过的话不会再攒出来', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const repeated = consider(seam, 'group:1', { history: ['刚看到楼下那家店换了招牌'] })

    expect(repeated.pending.map(item => item.text)).toEqual([CANDIDATES[1]?.text])
  })

  it('同一批里说法一样的只留一条', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    const copy = { ...CANDIDATES[0], id: 'c', at: BASE + 1_000 } as Candidate

    const first = consider(seam, 'group:1', { candidates: [CANDIDATES[0] as Candidate, copy] })

    expect(first.considered).toHaveLength(1)
    expect(first.pending).toHaveLength(1)
  })
})

describe('先给人看再发', () => {
  it('攒着的东西带着理由与风险一起能被看见', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
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
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    consider(seam, 'group:1')
    const later = seam.preview('group:1').find(item => item.text === CANDIDATES[1]?.text)
    if (later === undefined) throw new Error('晚到的那条没攒住')

    const delivered = seam.deliver('group:1', later.id)

    expect(delivered.ok).toBe(true)
    expect(delivered.item?.text).toBe(CANDIDATES[1]?.text)
  })

  it('投递之后就不在待发里了', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    consider(seam, 'group:1')
    const preview = seam.preview('group:1')
    const target = preview[0]
    if (target === undefined) throw new Error('没有攒住任何一条')

    seam.deliver('group:1', target.id)

    expect(seam.preview('group:1')).toHaveLength(preview.length - 1)
  })

  it('同一条候选不能同时被两次发送占用', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    consider(seam, 'group:1')
    const target = seam.preview('group:1')[0]
    if (target === undefined) throw new Error('没有攒住任何一条')

    expect(seam.claim('group:1', target.id).ok).toBe(true)
    expect(seam.claim('group:1', target.id).code).toBe('proactive.already_sending')
    expect(seam.timing.todayCount('group:1')).toBe(0)
  })

  it('发送失败会释放占用并保留候选，不消耗开口额度', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    consider(seam, 'group:1')
    const target = seam.preview('group:1')[0]
    if (target === undefined) throw new Error('没有攒住任何一条')
    seam.claim('group:1', target.id)

    expect(seam.settle('group:1', target.id, false).ok).toBe(false)
    expect(seam.claim('group:1', target.id).ok).toBe(true)
    expect(seam.pending.live('group:1')).toHaveLength(2)
    expect(seam.timing.todayCount('group:1')).toBe(0)
  })

  it('真实发送成功才移除候选并记额度', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    consider(seam, 'group:1')
    const target = seam.preview('group:1')[0]
    if (target === undefined) throw new Error('没有攒住任何一条')
    seam.claim('group:1', target.id)

    expect(seam.settle('group:1', target.id, true).ok).toBe(true)
    expect(seam.pending.live('group:1')).toHaveLength(1)
    expect(seam.timing.todayCount('group:1')).toBe(1)
  })

  it('刚说完也可以马上再说：时机交给模型', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    consider(seam, 'group:1')
    const target = seam.preview('group:1')[0]
    if (target === undefined) throw new Error('没有攒住任何一条')
    seam.deliver('group:1', target.id)

    expect(consider(seam, 'group:1').verdict.ok).toBe(true)
  })

  it('今天说够了也不再用硬上限拦住', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    for (let at = 0; at < 5; at += 1) seam.timing.noteSpoken('group:9')

    expect(consider(seam, 'group:9').verdict.ok).toBe(true)
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

describe('想开口的劲照原样带出去', () => {
  it('把身体给的数原样带出去', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const decision = seam.consider({
      chatKey: 'group:1',
      candidates: CANDIDATES,
      history: [],
      humanActive: false,
      botBusy: false,
      hasChannel: true,
      proactiveBias: 0.8,
    })

    expect(decision.facts.proactive_bias).toBe(0.8)
  })

  it('没给就留空，不自己编一个数', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    expect(consider(seam, 'group:1').facts.proactive_bias).toBeNull()
  })

  it('拦下来的时候也一样带出去', () => {
    const seam = mount({ file: tempFile(), enabled: false, ...NO_QUIET })

    const off = seam.consider({
      chatKey: 'group:1',
      candidates: CANDIDATES,
      history: [],
      humanActive: false,
      botBusy: false,
      hasChannel: true,
      proactiveBias: 0.4,
    })

    expect(off.verdict.code).toBe('proactive.off')
    expect(off.facts.proactive_bias).toBe(0.4)
  })

  it('数大数小都不改攒住的顺序与条数', () => {
    const low = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    const high = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    const withLow = low.consider({
      chatKey: 'group:1',
      candidates: CANDIDATES,
      history: [],
      humanActive: false,
      botBusy: false,
      hasChannel: true,
      proactiveBias: 0.05,
    })
    const withHigh = high.consider({
      chatKey: 'group:1',
      candidates: CANDIDATES,
      history: [],
      humanActive: false,
      botBusy: false,
      hasChannel: true,
      proactiveBias: 0.95,
    })

    expect(withLow.considered.map(candidate => candidate.id)).toEqual(withHigh.considered.map(candidate => candidate.id))
    expect(withLow.pending.map(item => item.id)).toEqual(withHigh.pending.map(item => item.id))
    for (const item of [...withLow.pending, ...withHigh.pending]) {
      expect(Object.hasOwn(item, 'proactive_bias')).toBe(false)
      expect(Object.hasOwn(item, 'score')).toBe(false)
    }
  })
})

describe('先预览再投递', () => {
  it('没先给人看就投，被拒并给出码与下一步', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    const first = consider(seam, 'group:1')
    const target = first.pending[0]
    if (target === undefined) throw new Error('没有攒住任何一条')

    const delivered = seam.deliver('group:1', target.id)

    expect(delivered.ok).toBe(false)
    expect(delivered.code).toBe('proactive.not_previewed')
    expect(delivered.reason).not.toBe('')
    expect(delivered.hint).not.toBe('')
    expect(seam.preview('group:1')).toHaveLength(2)
  })

  it('摆出来看过的那一条就能投出去', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    const first = consider(seam, 'group:1')
    const target = first.pending[0]
    if (target === undefined) throw new Error('没有攒住任何一条')
    seam.preview('group:1')

    const delivered = seam.deliver('group:1', target.id)

    expect(delivered.ok).toBe(true)
    expect(delivered.item?.text).toBe(target.text)
    expect(seam.timing.lastSpokenAt('group:1')).toBeGreaterThan(0)
  })

  it('投过的编号再投一次不认', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    const first = consider(seam, 'group:1')
    const target = first.pending[0]
    if (target === undefined) throw new Error('没有攒住任何一条')
    seam.preview('group:1')
    seam.deliver('group:1', target.id)

    const again = seam.deliver('group:1', target.id)

    expect(again.ok).toBe(false)
    expect(again.code).toBe('proactive.unknown_item')
  })

  it('别的会话摆出来的编号在另一处投不了', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    const first = consider(seam, 'group:1')
    const target = first.pending[0]
    if (target === undefined) throw new Error('没有攒住任何一条')
    seam.preview('group:1')

    expect(seam.deliver('group:2', target.id).code).toBe('proactive.unknown_item')
  })

  it('攒到候选时给出可以投的状态码', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    expect(consider(seam, 'group:1').verdict.code).toBe('proactive.preview_ready')
  })

  it('没攒到候选时给出没候选的状态码，也带出劲头', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const empty = consider(seam, 'group:1', { candidates: [] })

    expect(empty.pending).toHaveLength(0)
    expect(empty.verdict.code).toBe('proactive.no_candidate')
    expect(seam.preview('group:1')).toHaveLength(0)
  })
})

describe('睡着与刚被吵醒', () => {
  const WAKE = BASE + 3 * 60 * 60_000
  const OPEN = { enabled: true, quietStart: '00:00', quietEnd: '00:00' }

  const asleepAt = (wakeAfter?: number) => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    return seam.consider({
      chatKey: 'group:sleep',
      candidates: CANDIDATES,
      history: [],
      humanActive: false,
      botBusy: false,
      hasChannel: true,
      asleep: true,
      ...wakeAfter !== undefined ? { wakeAfter } : {},
    })
  }

  it('睡着时一条候选都不攒，下次就是醒点', () => {
    const decision = asleepAt(WAKE)

    expect(decision.verdict.ok).toBe(false)
    expect(decision.verdict.code).toBe('proactive.asleep')
    expect(decision.verdict.reason).not.toBe('')
    expect(decision.verdict.retryAt).toBe(WAKE)
    expect(decision.considered).toHaveLength(0)
    expect(decision.pending).toHaveLength(0)
  })

  it('睡着时待发条数不变，盘上一条都不写', () => {
    const file = tempFile()
    const seam = mount({ file, enabled: true, ...NO_QUIET })

    seam.consider({
      chatKey: 'group:sleep',
      candidates: CANDIDATES,
      history: [],
      humanActive: false,
      botBusy: false,
      hasChannel: true,
      asleep: true,
      wakeAfter: WAKE,
    })

    expect(seam.pending.all()).toHaveLength(0)
    expect(fs.existsSync(file)).toBe(false)
    expect(seam.preview('group:sleep')).toHaveLength(0)
  })

  it('睡着但没排醒点时就只给码，不自己编一个时刻', () => {
    const decision = asleepAt()

    expect(decision.verdict.code).toBe('proactive.asleep')
    expect(decision.verdict.retryAt).toBeUndefined()
  })

  it('身体需要休息时主动开口先停，过一阵再看', () => {
    const decision = runGates({
      now: BASE,
      config: OPEN,
      botBusy: false,
      hasChannel: true,
      resting: true,
    })

    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('proactive.resting')
    expect(decision.retryAt).toBe(BASE + PROACTIVE_DEFAULTS.restRetryMs)
  })

  it('刚被吵醒也只是一份现场事实，不替她延后', () => {
    const verdict = runGates({
      now: BASE,
      config: OPEN,
      botBusy: false,
      hasChannel: true,
      asleep: false,
    })

    expect(verdict.code).not.toBe('proactive.waking')
  })

  it('醒着的时候照旧攒候选', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const decision = seam.consider({
      chatKey: 'group:awake',
      candidates: CANDIDATES,
      history: [],
      humanActive: false,
      botBusy: false,
      hasChannel: true,
      asleep: false,
      wakeAfter: 0,
    })

    expect(decision.verdict.code).toBe('proactive.preview_ready')
    expect(decision.pending).toHaveLength(2)
  })

  it('没接上身体就按醒着处理，不报错', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const decision = consider(seam, 'group:nobody')

    expect(decision.verdict.code).toBe('proactive.preview_ready')
    expect(decision.pending).toHaveLength(2)
  })

  it('关掉开关时睡着也只是没开', () => {
    const off = mount({ file: tempFile(), enabled: false, ...NO_QUIET }).consider({
      chatKey: 'group:off',
      candidates: CANDIDATES,
      history: [],
      humanActive: false,
      botBusy: false,
      hasChannel: true,
      asleep: true,
      wakeAfter: WAKE,
    })

    expect(off.verdict.code).toBe('proactive.off')
    expect(off.pending).toHaveLength(0)
  })
})

// 外面递来的那条：想发动态时由身体那边攒出来，正文还没有
const SHARE_WANT: Candidate = {
  id: 'post-want:2026-11-4',
  kind: 'share',
  why: '想发一条动态的劲压不住了',
  text: '',
  postWant: 0.62,
  source: 'post_want',
  at: BASE + 120_000,
}

function considerWith(seam: QqProactiveSeam, chatKey: string, external: Candidate[]) {
  return seam.consider({
    chatKey,
    candidates: CANDIDATES,
    external,
    history: [],
    humanActive: false,
    botBusy: false,
    hasChannel: true,
  })
}

describe('外面递来的候选', () => {
  it('并进候选表，带的事实原样留着', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const decision = considerWith(seam, 'group:share', [SHARE_WANT])

    expect(decision.considered.map(candidate => candidate.id)).toEqual(['a', 'b', SHARE_WANT.id])
    const kept = decision.pending.find(item => item.facts.postWant !== undefined)
    expect(kept?.why).toBe(SHARE_WANT.why)
    expect(kept?.facts.postWant).toBe(0.62)
    expect(kept?.facts.kind).toBe('share')
    expect(kept?.facts.source).toBe('post_want')
    expect(seam.preview('group:share')).toHaveLength(3)
  })

  it('不给外部候选时行为与原来一模一样', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })

    const decision = consider(seam, 'group:none')

    expect(decision.considered.map(candidate => candidate.id)).toEqual(['a', 'b'])
    for (const item of decision.pending) expect(Object.hasOwn(item.facts, 'postWant')).toBe(false)
  })

  it('外部候选照样先过关卡：关着就一条都不攒', () => {
    const seam = mount({ file: tempFile(), enabled: false, ...NO_QUIET })

    const decision = considerWith(seam, 'group:share', [SHARE_WANT])

    expect(decision.verdict.code).toBe('proactive.off')
    expect(decision.pending).toHaveLength(0)
  })

  it('外部候选也先给人看，才许投递', () => {
    const seam = mount({ file: tempFile(), enabled: true, ...NO_QUIET })
    considerWith(seam, 'group:share', [SHARE_WANT])
    const kept = seam.pending.live('group:share').find(item => item.facts.postWant !== undefined)
    if (kept === undefined) throw new Error('外部候选没攒住')

    const early = seam.deliver('group:share', kept.id)
    const shown = seam.preview('group:share')
    const delivered = seam.deliver('group:share', kept.id)

    expect(early.ok).toBe(false)
    expect(early.code).toBe('proactive.not_previewed')
    expect(shown).toHaveLength(3)
    expect(delivered.ok).toBe(true)
    expect(delivered.item?.facts.postWant).toBe(0.62)
  })
})
