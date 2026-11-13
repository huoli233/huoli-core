import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { replyMindOf } from '@huoli/huoli-qq-channel'
import { apply as applyAttention, qqAttentionOf } from '@huoli/huoli-qq-attention'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals, createVitalsStore, emptyState, qqVitalsOf, resolveTuning, type QqVitalsSeam, type VitalsState,
} from '@huoli/huoli-qq-vitals'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'
import { applyReplyMind, replyMindImpactOf } from '../src/body-tools.ts'

const tuning = resolveTuning()
const AT = new Date(2026, 10, 5, 10, 0, 0).getTime()

const roots: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-body-event-'))
  roots.push(dir)
  return dir
}

interface Mounted {
  ctx: Context
  vitals: QqVitalsSeam
  tool: (name: string) => ToolDefinition
}

// 把挂上来的工具收下来，身体用一份种好的状态：口渴与饥饿都到一半
async function mount(body: Partial<VitalsState> = {}): Promise<Mounted> {
  const dir = tempDir()
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write({
    ...emptyState(tuning, Date.now() - 60_000),
    thirst: 0.5,
    hunger: 0.5,
    ...body,
  })
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', {
    get: () => ({
      register: (definition: ToolDefinition) => {
        tools.set(definition.name, definition)
        return () => {}
      },
    }),
  })
  await ctx.plugin(SystemPrompt, {})
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyVitals(ctx, { file, tuning: { startDelayMs: 60 * 60_000, sleepForceAfterMinutes: 24 * 60 } })
  applyBundle(ctx, {
    maxSteps: 5,
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    dailySweepAt: '04:00',
  })
  const vitals = qqVitalsOf(ctx)
  if (vitals === undefined) throw new Error('身体没装上')
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { ctx, vitals, tool }
}

// 工具体只读会话编号与取消信号，其余字段由内核在真实调用时给
function execOf(chatKey = 'group:1'): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('身体事件由模型报', () => {
  it('身体提示要求先辨认对象与语气，再记录确实发生的反应', async () => {
    const { ctx } = await mount()

    const section = (await ctx.systemPrompt.assemble()).sections.find(item => item.name === 'qq:body-events')

    expect(section?.text).toContain('[SYSTEM_LOAD] QQ_BODY_EVENT')
    expect(section?.text).toContain('ACTION: call_qq_body_event_once')
    expect(section?.text).toContain('EVENTS: drank|ate|praised|apologized|scolded|threatened|scared|worried|dreaded|sick|hurt')
    expect(section?.text).toContain('BOUNDARY_EVENTS: threatened+scolded')
    expect(section?.text).toContain('SERIOUS_BOUNDARY: short_refusal_with_visible_attitude')
  })

  it('报被威胁会同时涨 fear、dread 和 anger', async () => {
    const { vitals, tool } = await mount()
    const before = vitals.read()

    await tool('qq_body_event').execute({ events: [{ kind: 'threatened' }, { kind: 'scolded' }] }, execOf())

    const after = vitals.read()
    expect(after.fear).toBeGreaterThan(before.fear)
    expect(after.dread).toBeGreaterThan(before.dread)
    expect(after.anger).toBeGreaterThan(0)
  })

  it('报喝了就掉口渴，名字也记下来', async () => {
    const { vitals, tool } = await mount()
    const before = vitals.read()

    await tool('qq_body_event').execute({ events: [{ kind: 'drank', name: '奶茶' }] }, execOf())

    const after = vitals.read()
    expect(after.thirst).toBeLessThan(before.thirst)
    expect(after.last_drink_name).toBe('奶茶')
  })

  it('报吃了就掉饥饿', async () => {
    const { vitals, tool } = await mount()
    const before = vitals.read()

    const result = await tool('qq_body_event').execute({ events: [{ kind: 'ate' }] }, execOf())

    expect(vitals.read().hunger).toBeLessThan(before.hunger)
    expect(result).toEqual({ ok: true, applied: 1 })
  })

  it('报被凶就把怒气抬起来', async () => {
    const { vitals, tool } = await mount()
    const before = vitals.read()

    const result = await tool('qq_body_event').execute({ events: [{ kind: 'scolded' }] }, execOf())

    expect(vitals.read().anger).toBeGreaterThan(before.anger)
    expect(result).toMatchObject({ ok: true, applied: 1 })
    expect(String((result as { tone?: string }).tone)).toContain('visible_attitude_if_opening')
  })

  it('私聊里被凶会同时降低对那个人的好感与信任', async () => {
    const { ctx, tool } = await mount()

    await tool('qq_body_event').execute({ events: [{ kind: 'scolded' }] }, execOf('private:555'))

    const person = qqSubjectOf(ctx)?.relations.get('555')
    expect(person?.affection).toBeLessThan(0.5)
    expect(person?.trust).toBeLessThan(0.5)
    expect(person?.annoyance).toBeGreaterThan(0.05)
  })

  it('被道歉会同时往修补方向拉回关系', async () => {
    const { ctx, tool } = await mount()

    await tool('qq_body_event').execute({ events: [{ kind: 'scolded' }] }, execOf('private:555'))
    const hurt = qqSubjectOf(ctx)?.relations.get('555')
    await tool('qq_body_event').execute({ events: [{ kind: 'apologized' }] }, execOf('private:555'))
    const repaired = qqSubjectOf(ctx)?.relations.get('555')

    expect(repaired?.trust).toBeGreaterThan(hurt?.trust ?? 0)
    expect(repaired?.annoyance).toBeLessThan(hurt?.annoyance ?? 1)
  })

  it('一次报好几件事，按顺序都做', async () => {
    const { vitals, tool } = await mount()
    const before = vitals.read()

    await tool('qq_body_event').execute({
      events: [{ kind: 'drank' }, { kind: 'ate' }, { kind: 'praised' }],
    }, execOf())

    const after = vitals.read()
    expect(after.thirst).toBeLessThan(before.thirst)
    expect(after.hunger).toBeLessThan(before.hunger)
    expect(after.dopamine).toBeGreaterThan(before.dopamine)
  })

  it('不认识的事一律拒，并说清下一步', async () => {
    const { tool } = await mount()

    await expect(tool('qq_body_event').execute({ events: [{ kind: '被绿了' }] }, execOf()))
      .rejects.toThrow(/invalid arguments|body\.unknown_kind/u)
  })

  it('什么都没报也拒', async () => {
    const { tool } = await mount()

    await expect(tool('qq_body_event').execute({ events: [] }, execOf()))
      .rejects.toThrow(/body\.no_events/u)
  })

  it('不调这个工具时，光发一句话不动身体：不吃关键词', async () => {
    const { vitals } = await mount()

    // 词表默认空着：这一句谁也认不出来，身体只会随时间走，不会因为这句话掉下去
    vitals.react('我喝了奶茶，还吃了面', AT)
    const after = vitals.read()

    expect(after.thirst).toBeGreaterThan(0.5)
    expect(after.hunger).toBeGreaterThan(0.5)
  })

  it('有把握的判读会同时改关系和身体，不只是留一句参数', async () => {
    const { ctx, vitals } = await mount()
    applyAttention(ctx, { file: path.join(tempDir(), 'attention.json') })
    const attention = qqAttentionOf(ctx)
    if (attention === undefined) throw new Error('注意力没有装上')
    attention.inbox.push('private:555', { senderId: '555', text: '你怎么又没听懂', at: AT })
    const mind = replyMindOf({
      affect: {
        target: 'robot',
        valence: -0.7,
        relationalValence: -0.8,
        arousal: 0.8,
        intensity: 0.8,
        confidence: 0.9,
        playfulness: 0.1,
        hostility: 0.9,
        correction: 0.4,
        evidence: [{ messageId: 'm1', text: '你怎么又没听懂' }],
        explanation: '这句在责备我',
      },
    })

    applyReplyMind(mind, 'private:555', {
      relations: qqSubjectOf(ctx)?.relations,
      vitals,
      attention,
      minConfidence: 0.55,
      evidenceFrom: 0.55,
      hostilityFrom: 0.55,
      praiseFrom: 0.55,
      at: AT,
    })

    expect(vitals.read().anger).toBeGreaterThan(0)
    const person = qqSubjectOf(ctx)?.relations.get('555')
    expect(person?.affection).toBeLessThan(0.5)
    expect(person?.trust).toBeLessThan(0.5)
    expect(person?.annoyance).toBeGreaterThan(0.05)
    expect(qqSubjectOf(ctx)?.relations.feelings({
      personId: '555',
      chatKey: 'private:555',
      at: AT,
    })[0]?.evidence[0]?.text).toBe('你怎么又没听懂')
  })

  it('判读出被威胁时，即使 hostility 不高也让身体进入应激', async () => {
    const { ctx, vitals } = await mount()
    applyAttention(ctx, { file: path.join(tempDir(), 'attention.json') })
    const attention = qqAttentionOf(ctx)
    if (attention === undefined) throw new Error('注意力没有装上')
    attention.inbox.push('private:555', { senderId: '555', text: '我要往你身上装一堆插件', at: AT })
    const mind = replyMindOf({
      affect: {
        target: 'robot',
        valence: -0.6,
        arousal: 0.8,
        intensity: 0.7,
        confidence: 0.9,
        playfulness: 0.1,
        hostility: 0.4,
        emotions: ['恐惧'],
        evidence: [{ messageId: 'm1', text: '我要往你身上装一堆插件' }],
        explanation: '这句在拿我的身体做实验',
      },
    })

    applyReplyMind(mind, 'private:555', {
      relations: qqSubjectOf(ctx)?.relations,
      vitals,
      attention,
      minConfidence: 0.55,
      evidenceFrom: 0.55,
      hostilityFrom: 0.55,
      praiseFrom: 0.55,
      at: AT,
    })

    expect(vitals.read().fear).toBeGreaterThan(0)
    expect(vitals.read().dread).toBeGreaterThan(0)
  })

  it('自主选择等待会收一点话痨度，主动插话会轻微调高', async () => {
    const { ctx } = await mount()
    applyAttention(ctx, { file: path.join(tempDir(), 'attention.json') })
    const attention = qqAttentionOf(ctx)
    if (attention === undefined) throw new Error('注意力没有装上')
    const impact = replyMindImpactOf(undefined, undefined, attention)
    const initial = attention.talkativeness('group:1')

    const waiting = replyMindOf({ move: 'wait' })
    const interjecting = replyMindOf({ move: 'interject' })
    if (waiting === undefined || interjecting === undefined) throw new Error('判读没有解析出来')
    impact(waiting, 'group:1', Date.now())
    const restrained = attention.talkativeness('group:1')
    impact(interjecting, 'group:1', Date.now() + 1)

    expect(restrained).toBeLessThan(initial)
    expect(attention.talkativeness('group:1')).toBeGreaterThan(restrained)
  })

  it('编造的原话或别人的原话不会保存成当前人的情绪印象', async () => {
    const { ctx, vitals } = await mount()
    applyAttention(ctx, { file: path.join(tempDir(), 'attention.json') })
    const attention = qqAttentionOf(ctx)
    if (attention === undefined) throw new Error('注意力没有装上')
    attention.inbox.push('group:1', { senderId: '777', text: '你怎么又没听懂', at: AT - 1 })
    attention.inbox.push('group:1', { senderId: '555', text: '我在说刚才那件事', at: AT })
    const mind = replyMindOf({
      affect: {
        target: 'robot',
        valence: -0.7,
        confidence: 0.9,
        hostility: 0.8,
        evidence: [
          { messageId: 'm1', text: '你怎么又没听懂' },
          { messageId: 'm2', text: '其实你完全没有听我说' },
        ],
      },
    })

    applyReplyMind(mind, 'group:1', {
      relations: qqSubjectOf(ctx)?.relations,
      vitals,
      attention,
      minConfidence: 0.55,
      evidenceFrom: 0.55,
      hostilityFrom: 0.55,
      praiseFrom: 0.55,
      at: AT,
    })

    expect(qqSubjectOf(ctx)?.relations.feelings({ personId: '555', chatKey: 'group:1', at: AT })).toEqual([])
  })

  it('冲着别人或没有把握的判读不会改当前这个人的关系', async () => {
    const { ctx, vitals } = await mount()
    const mind = replyMindOf({
      affect: {
        target: 'other',
        valence: -0.9,
        confidence: 0.9,
        hostility: 0.9,
      },
    })

    applyReplyMind(mind, 'private:555', {
      relations: qqSubjectOf(ctx)?.relations,
      vitals,
      attention: undefined,
      minConfidence: 0.55,
      evidenceFrom: 0.55,
      hostilityFrom: 0.55,
      praiseFrom: 0.55,
      at: AT,
    })

    expect(vitals.read().anger).toBe(0)
    expect(qqSubjectOf(ctx)?.relations.get('555')).toBeUndefined()
  })
})
