// 发牢骚：驱力、事由、场合三条同时成立才放行，放行也只给事实与由头

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention, qqAttentionOf, type QqMessage } from '@huoli/huoli-qq-attention'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  resolveTuning,
  WORDS_PRESET,
} from '@huoli/huoli-qq-vitals'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle, BUNDLE_DEFAULTS } from '../src/index.ts'
import {
  COMPLAINT_DEFAULTS,
  complaintCandidateOf,
  complaintLineOf,
  complaintVerdict,
  resolveComplaintSettings,
  type ComplaintInput,
  type ComplaintNameCall,
} from '../src/complaint.ts'

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime()
const CHAT = 'group:1'
const settings = resolveComplaintSettings()

// 一条窗口里的真人消息
function msg(at: number, senderId: string, patch: Partial<QqMessage> = {}): QqMessage {
  return { seq: 1, chatKey: CHAT, senderId, text: '在吗', at, ...patch }
}

// 关系里记下的一个外号
function nameCall(patch: Partial<ComplaintNameCall> = {}): ComplaintNameCall {
  return {
    chatKey: CHAT,
    label: '大肥鱼',
    hits: 4,
    firstAt: NOW - 6 * 60_000,
    lastAt: NOW - 60_000,
    effectiveHits: 4,
    stance: 'cool',
    personId: '1001',
    personName: '张三',
    ...patch,
  }
}

// 同一个人连着点名叫人，凑够三回
function threeCalls(): QqMessage[] {
  return [
    msg(NOW - 3 * 60_000, '1001', { atMe: true, senderName: '张三' }),
    msg(NOW - 2 * 60_000, '1001', { atMe: true, senderName: '张三' }),
    msg(NOW - 60_000, '1001', { atMe: true, senderName: '张三' }),
  ]
}

describe('发牢骚的事实收口', () => {
  it('驱力低于事实收口线时一个字都不给', () => {
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.1, adenosine: 0.2 } }, settings)

    expect(verdict.allowed).toBe(true)
    expect(verdict.drive).toBeUndefined()
    expect(complaintLineOf(verdict)).toBe('')
  })

  it('过线时取最强的那一项读数', () => {
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.58, adenosine: 0.71 } }, settings)

    expect(verdict.drive?.key).toBe('adenosine')
    expect(verdict.drive?.value).toBe(0.71)
  })

  it('没力气、饿或渴也是身体牢骚，不要求单项负面激素先过线', () => {
    const verdict = complaintVerdict({
      now: NOW,
      body: { energy: 0, hunger: 1, thirst: 1, irritability: 0.2, cortisol: 0.2 },
    }, settings)

    expect(verdict.allowed).toBe(true)
    expect(verdict.solo).toBe(true)
    expect(verdict.drive).toMatchObject({ key: 'energy', value: 1 })
  })

  it('真正成立的身体牢骚能进入主动候选，候选只带事实不带正文', () => {
    const verdict = complaintVerdict({ now: NOW, body: { thirst: 0.9, energy: 0.5 } }, settings)
    const candidate = complaintCandidateOf(verdict, CHAT, NOW)

    expect(candidate).toMatchObject({ kind: 'share', source: 'self_state', text: '', at: NOW })
    expect(candidate?.why).toContain('渴')
  })

  it('隔了很久没说话也能成为一条具体由头', () => {
    const verdict = complaintVerdict({ now: NOW, lastHumanAt: NOW - 3 * 60 * 60_000 }, settings)
    const candidate = complaintCandidateOf(verdict, CHAT, NOW)

    expect(verdict.grounds[0]?.kind).toBe('idle')
    expect(candidate?.why).toContain('隔了有一阵')
  })

  it('没有具体事由时只保留事实，不替模型放行', () => {
    const strict = resolveComplaintSettings({ allowSelfStateGround: false })
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.8 } }, strict)

    expect(verdict.gates.grounds).toBe(false)
    expect(verdict.grounds).toEqual([])
    expect(verdict.allowed).toBe(true)
    expect(complaintCandidateOf(verdict, CHAT, NOW)).toBeUndefined()
    expect(complaintLineOf(verdict)).toContain('RECENT_OWN_LINES: 0')
  })

  it('事由条数不够时只少摆一条事实，不替模型放行', () => {
    const two = resolveComplaintSettings({ minGrounds: 2 })
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.8 } }, two)

    expect(verdict.grounds).toHaveLength(1)
    expect(verdict.allowed).toBe(true)
    expect(verdict.gates.grounds).toBe(false)
  })

  it('自己刚连着说了几条时，仍把连发条数当事实', () => {
    const verdict = complaintVerdict({ now: NOW, body: { loneliness: 0.9 }, selfStreak: 3 }, settings)

    expect(verdict.room.reason).toBe('just_spoke_repeatedly')
    expect(verdict.allowed).toBe(true)
    expect(complaintLineOf(verdict)).toContain('RECENT_OWN_LINES: 3')
  })

  it('连发还没到那条线时仍保留场合事实', () => {
    const verdict = complaintVerdict({ now: NOW, body: { loneliness: 0.9 }, selfStreak: 2 }, settings)

    expect(verdict.room.reason).toBe('room_ok')
    expect(verdict.allowed).toBe(true)
  })

  it('睡着时只记场合事实，发不发由模型决定', () => {
    const verdict = complaintVerdict({
      now: NOW,
      body: { irritability: 0.9, sleep_state: 'sleeping' },
    }, settings)

    expect(verdict.room.reason).toBe('asleep')
    expect(verdict.allowed).toBe(true)
    expect(complaintLineOf(verdict)).toContain('DRIVE_READING:')
  })
})

describe('具体事由', () => {
  it('同一个外号被连着叫几回算一条', () => {
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.7 }, nameCalls: [nameCall()] }, settings)

    expect(verdict.grounds[0]?.kind).toBe('called_out_repeatedly')
    expect(verdict.allowed).toBe(true)
    expect(complaintLineOf(verdict)).toContain('- 同一个外号连着叫了 4 回：大肥鱼')
  })

  it('窗口外的事由不算', () => {
    const verdict = complaintVerdict({
      now: NOW,
      body: { irritability: 0.7 },
      nameCalls: [nameCall({ lastAt: NOW - settings.windowMs - 60_000 })],
    }, settings)

    expect(verdict.grounds[0]?.kind).toBe('own_state')
  })

  it('外号没叫够次数不算', () => {
    const verdict = complaintVerdict({
      now: NOW,
      body: { irritability: 0.7 },
      nameCalls: [nameCall({ hits: 2, effectiveHits: 2, stance: 'tease' })],
    }, settings)

    expect(verdict.grounds[0]?.kind).toBe('own_state')
  })

  it('同一个人反复使唤算一条', () => {
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.7 }, recent: threeCalls() }, settings)

    expect(verdict.grounds[0]?.kind).toBe('ordered_around')
    expect(verdict.grounds[0]?.count).toBe(3)
  })

  it('说完没人接算一条', () => {
    const spokeAt = NOW - 4 * 60_000
    const verdict = complaintVerdict({
      now: NOW,
      body: { loneliness: 0.7 },
      lastSelfSpokeAt: spokeAt,
      recent: [msg(spokeAt + 60_000, '1001'), msg(spokeAt + 120_000, '1002')],
    }, settings)

    expect(verdict.grounds[0]?.kind).toBe('ignored')
    expect(complaintLineOf(verdict)).toContain('没有一条是回你的')
  })

  it('有人接着回了就不算没人接', () => {
    const spokeAt = NOW - 4 * 60_000
    const verdict = complaintVerdict({
      now: NOW,
      body: { loneliness: 0.7 },
      lastSelfSpokeAt: spokeAt,
      recent: [msg(spokeAt + 60_000, '1001'), msg(spokeAt + 120_000, '1002', { replyToBot: true })],
    }, settings)

    expect(verdict.grounds[0]?.kind).toBe('own_state')
  })

  it('只有自己的状态时只说自己的读数', () => {
    const verdict = complaintVerdict({ now: NOW, body: { adenosine: 0.9 } }, settings)

    expect(verdict.grounds[0]?.kind).toBe('own_state')
    expect(complaintLineOf(verdict)).toContain('你困得脑子发木')
  })
})

describe('不许指名', () => {
  it('默认只许指向现象，事由里留不下名字', () => {
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.7 }, recent: threeCalls() }, settings)

    expect(verdict.grounds[0]?.personId).toBeUndefined()
    expect(verdict.grounds[0]?.personName).toBeUndefined()
    const line = complaintLineOf(verdict)
    expect(line).not.toContain('张三')
    expect(line).toContain('RULE:')
  })

  it('打开 allowNamedTarget 才带上是哪个人', () => {
    const named = resolveComplaintSettings({ allowNamedTarget: true })
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.7 }, recent: threeCalls() }, named)

    expect(verdict.grounds[0]?.personName).toBe('张三')
    expect(complaintLineOf(verdict)).toContain('（张三）')
  })
})

describe('单靠牢骚主动开口不再由代码判定', () => {
  it('只把读数与事实摆出来，不写 SOLO_OPEN 许可', () => {
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.6 } }, settings)

    const line = complaintLineOf(verdict)
    expect(line).toContain('DRIVE_READING:')
    expect(line).toContain('you_decide_whether_to_mention_them')
    expect(line).not.toContain('SOLO_OPEN')
    expect(line).not.toContain('ALLOWED')
  })

  it('读数再高也不给「值得主动起一句」的判定', () => {
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.7 } }, settings)

    expect(complaintLineOf(verdict)).not.toContain('SOLO_OPEN')
    expect(complaintLineOf(verdict)).not.toContain('ALLOWED')
  })

  it('自己连说几条也只是事实，不再被拦下', () => {
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.9 }, selfStreak: 3 }, settings)

    expect(complaintLineOf(verdict)).toContain('RECENT_OWN_LINES: 3')
    expect(complaintLineOf(verdict)).not.toContain('STOP:')
  })
})

describe('门槛配置', () => {
  it('不写就按默认那一档', () => {
    expect(resolveComplaintSettings()).toEqual({
      enabled: true,
      driveThreshold: 0.25,
      minGrounds: 1,
      windowMs: 10 * 60_000,
      maxRecentOwn: 3,
      repeatedNameHits: 3,
      repeatedCallHits: 3,
      ignoredAfter: 2,
      allowNamedTarget: false,
      allowSelfStateGround: true,
      soloDriveFloor: 0.25,
      idleGroundMinutes: 120,
    })
  })

  it('写坏了按默认收，窗口不小于一分钟', () => {
    const resolved = resolveComplaintSettings({ driveThreshold: 1.6, windowMs: 1_000, minGrounds: 0 })

    expect(resolved.driveThreshold).toBe(1)
    expect(resolved.windowMs).toBe(60_000)
    expect(resolved.minGrounds).toBe(1)
  })

  it('默认值表与代码里那份是同一处', () => {
    expect(BUNDLE_DEFAULTS.complaint).toBe(COMPLAINT_DEFAULTS)
  })

  it('门槛能从配置改', () => {
    const loose = resolveComplaintSettings({ driveThreshold: 0.2, minGrounds: 2 })
    const verdict = complaintVerdict({ now: NOW, body: { irritability: 0.25 } }, loose)

    expect(verdict.drive?.value).toBe(0.25)
    expect(verdict.gates.grounds).toBe(false)
  })
})

// 真实的装配：身体、注意力、关系都挂上，再看提示词里这一段
const tempDirs: string[] = []
const tuning = resolveTuning()

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-complaint-'))
  tempDirs.push(dir)
  return dir
}

async function mountComplaint(dir: string, complaint?: { enabled?: boolean }): Promise<Context> {
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning })
    // 疼痛是存下来的读数，写进去就是它；烦、闷那几项是算出来的，写进去会被重算
    .write({ ...emptyState(tuning, Date.now() - 60_000), pain: 0.8 })
  const ctx = new Context()
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小鲸鱼'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyVitals(ctx, {
    file,
    tuning: { words: WORDS_PRESET, startDelayMs: 60 * 60_000, sleepForceAfterMinutes: 24 * 60 },
  })
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepAt: '04:00',
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    ...complaint === undefined ? {} : { complaint },
  })
  return ctx
}

async function complaintText(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble({ agent: { id: CHAT } as Agent })
  return assembly.sections.find(section => section.name === 'qq:complaint')?.text ?? ''
}

// 往关系里记几回同一个外号：先按入站那样认下人，再记外号
function seedNameCall(ctx: Context, times: number): void {
  const relations = qqSubjectOf(ctx)?.relations
  const at = Date.now() - 1_000
  relations?.observe({ personId: '1001', name: '张三', chatKey: CHAT, at })
  for (let index = 0; index < times; index += 1) relations?.recordNameCall('1001', CHAT, '大肥鱼', at)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('装配后的那一段', () => {
  it('驱力过线就只把读数与事实写进提示词，不写可否判定', async () => {
    const ctx = await mountComplaint(tempDir())

    const text = await complaintText(ctx)
    expect(text).toContain('QQ_COMPLAINT')
    expect(text).toContain('DRIVE_READING:')
    expect(text).not.toContain('ALLOWED')
    expect(text).not.toContain('SOLO_OPEN')
  })

  it('关系里攒够外号次数时事由写得出具体那一条', async () => {
    const ctx = await mountComplaint(tempDir())
    seedNameCall(ctx, 4)

    expect(await complaintText(ctx)).toContain('同一个外号连着叫了 4 回：大肥鱼')
  })

  it('关掉这一路就一段都不出现', async () => {
    const ctx = await mountComplaint(tempDir(), { enabled: false })

    expect(await complaintText(ctx)).toBe('')
  })

  it('注意力里记着刚连发时只把条数当事实，不再拦下这一段', async () => {
    const ctx = await mountComplaint(tempDir())
    qqAttentionOf(ctx)?.noteSelfSpoke(CHAT, Date.now(), 3)

    const text = await complaintText(ctx)
    expect(text).toContain('RECENT_OWN_LINES: 3')
    expect(text).not.toContain('ALLOWED: no')
    expect(text).not.toContain('STOP:')
  })
})

describe('类型摆设', () => {
  it('输入只要身体那几项负向读数', () => {
    const input: ComplaintInput = { now: NOW, body: { irritability: 0.6 } }
    expect(complaintVerdict(input, settings).drive?.label).toBe('有点上火')
  })
})
