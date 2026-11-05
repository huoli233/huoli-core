// 接缝按根上下文存取：这里照 Loader 的挂法给每条插件行各起一个 fiber，验证组合包看得到别的包

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context, Service, type Plugin } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import * as attentionRow from '@huoli/huoli-qq-attention'
import * as channelRow from '@huoli/huoli-qq-channel'
import * as continuityRow from '@huoli/huoli-qq-continuity'
import * as materialRow from '@huoli/huoli-qq-material'
import * as memoryRow from '@huoli/huoli-qq-memory'
import * as pacingRow from '@huoli/huoli-qq-pacing'
import * as proactiveRow from '@huoli/huoli-qq-proactive'
import * as selfRow from '@huoli/huoli-qq-self'
import * as subjectRow from '@huoli/huoli-qq-subject'
import * as vitalsRow from '@huoli/huoli-qq-vitals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as bundleRow from '../src/index.ts'

const tuning = vitalsRow.resolveTuning()

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-seam-'))
  tempDirs.push(dir)
  return dir
}

// 工具只登记不执行：这几条行都注入 tools，这里要的是一个真能被解析到的服务
class FakeTools extends Service {
  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(): () => void {
    return () => {}
  }
}

// 一条插件行各自起一个 fiber：apply 拿到的是 extend 出来的新 ctx，跟组合包里一样
async function mountRow<C>(root: Context, row: Plugin<C>, config: C): Promise<void> {
  await root.plugin(row, config)
}

// 从另一个插件的 fiber 里读一次，再拿回来看：这就是组合包 apply 时手里的那种 ctx
async function fromOtherFiber<T>(root: Context, read: (ctx: Context) => T): Promise<T> {
  const seen: Array<{ value: T }> = []
  await root.plugin({
    name: 'seam-probe',
    apply(ctx: Context) {
      seen.push({ value: read(ctx) })
    },
  })
  const first = seen[0]
  if (first === undefined) throw new Error('探针没跑起来')
  return first.value
}

// 按 qq.patch.yml 的顺序挂起来：每行一个 fiber，组合包排在最后
async function mountStack(options: { vitals?: boolean } = {}): Promise<Context> {
  const dir = tempDir()
  const root = new Context()
  await root.plugin(SystemPrompt, {})
  await root.plugin(FakeTools)
  await mountRow(root, attentionRow, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  await mountRow(root, subjectRow, { file: path.join(dir, 'subject.json') })
  await mountRow(root, memoryRow, {
    file: path.join(dir, 'memory.json'),
    ledgerFile: path.join(dir, 'ledger.json'),
    healthLogFile: path.join(dir, 'health.log'),
    queueFile: path.join(dir, 'queue.json'),
  })
  await mountRow(root, pacingRow, { file: path.join(dir, 'pacing.json') })
  await mountRow(root, materialRow, { thoughtsFile: path.join(dir, 'thoughts.json') })
  await mountRow(root, proactiveRow, { file: path.join(dir, 'proactive.json'), enabled: false })
  await mountRow(root, continuityRow, { file: path.join(dir, 'continuity.json') })
  await mountRow(root, channelRow, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    quietStart: '00:00',
    quietEnd: '00:00',
    actionsFile: path.join(dir, 'actions.json'),
    publicMinStage: 'P0',
  })
  if (options.vitals ?? true) {
    const file = path.join(dir, 'vitals.json')
    vitalsRow.createVitalsStore({ file, tuning }).write({
      ...vitalsRow.emptyState(tuning, Date.now() - 60_000),
      oxytocin: 1,
      endorphin: 1,
    })
    await mountRow(root, vitalsRow, { file, tuning: { startDelayMs: 60 * 60_000 } })
  }
  // 停手开关写下就一直在，自检时它读的是这一份文件
  fs.mkdirSync(path.join(dir, 'self'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'self', 'PAUSE'), '')
  await mountRow(root, selfRow, { dir: path.join(dir, 'self'), enabled: false, settings: { stage: 'P3' } })
  await mountRow(root, bundleRow, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(dir, 'decisions.jsonl') })
  return root
}

// 发出去就当场结算的假连接，动态那一路不真连网
class FakeSocket {
  readyState = 0
  private readonly handlers = new Map<string, Array<() => void>>()

  addEventListener(type: string, handler: () => void): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(): void {}

  close(): void {
    this.readyState = 3
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('跨 fiber 取接缝', () => {
  it('组合包那条链上六个接缝都看得到', async () => {
    const root = await mountStack()

    const kinds = await fromOtherFiber(root, ctx => ({
      vitals: typeof vitalsRow.qqVitalsOf(ctx),
      subject: typeof subjectRow.qqSubjectOf(ctx),
      memory: typeof memoryRow.qqMemoryOf(ctx),
      attention: typeof attentionRow.qqAttentionOf(ctx),
      channel: typeof channelRow.qqChannelOf(ctx),
      self: typeof selfRow.qqSelfOf(ctx),
      pacing: typeof pacingRow.qqPacingOf(ctx),
      material: typeof materialRow.qqMaterialOf(ctx),
      proactive: typeof proactiveRow.qqProactiveOf(ctx),
      continuity: typeof continuityRow.qqContinuityOf(ctx),
      bundle: typeof bundleRow.qqBundleOf(ctx),
    }))

    expect(kinds).toEqual({
      vitals: 'object',
      subject: 'object',
      memory: 'object',
      attention: 'object',
      channel: 'object',
      self: 'object',
      pacing: 'object',
      material: 'object',
      proactive: 'object',
      continuity: 'object',
      bundle: 'object',
    })
  })

  it('取到的接缝能真的读到值', async () => {
    const root = await mountStack()

    const seams = await fromOtherFiber(root, ctx => ({
      vitals: vitalsRow.qqVitalsOf(ctx),
      subject: subjectRow.qqSubjectOf(ctx),
      memory: memoryRow.qqMemoryOf(ctx),
      attention: attentionRow.qqAttentionOf(ctx),
      channel: channelRow.qqChannelOf(ctx),
      self: selfRow.qqSelfOf(ctx),
    }))
    const { vitals, subject, memory, attention, channel, self } = seams
    if (vitals === undefined || subject === undefined || memory === undefined) throw new Error('零件没接上')
    if (attention === undefined || channel === undefined || self === undefined) throw new Error('零件没接上')

    // 身体读出来是一份完整状态，不是空对象
    const body = vitals.read()
    expect(body).toBeTypeOf('object')
    expect(typeof body.post_want).toBe('number')

    subject.store.setActive('group:1')
    expect(subject.store.read().lastActive).toBe('group:1')

    memory.remember('今天喝了豆浆', 'group:1')
    expect(memory.store.all()).toHaveLength(1)

    attention.inbox.push('group:1', { senderId: 'u1', text: '在吗' })
    expect(attention.inbox.recent('group:1', 5)).toHaveLength(1)

    expect(self.stage()).toBe('P3')
    expect(self.isPaused()).toBe(true)

    // 发送闸门拿同一份接缝判一次：停手开关经组合包接到通道上，这一条就不该发出去
    const verdict = await channel.publish('post', '今天吃了面', { chatKey: 'group:1', level: 'routine', topic: '吃喝' })
    expect(verdict).toMatchObject({ ok: false, code: 'post.paused' })
  })

  it('组合包按身体给出的条数走的是同一条路', async () => {
    const root = await mountStack()

    const assembly = await root.systemPrompt.assemble()
    const budget = assembly.sections.find(section => section.name === 'qq:reply-budget')?.text ?? ''

    expect(budget).toContain('最多说 4 条')
  })

  it('没装身体时取到的是 undefined', async () => {
    const root = await mountStack({ vitals: false })

    const kind = await fromOtherFiber(root, ctx => typeof vitalsRow.qqVitalsOf(ctx))
    const assembly = await root.systemPrompt.assemble()
    const budget = assembly.sections.find(section => section.name === 'qq:reply-budget')?.text ?? ''

    expect(kind).toBe('undefined')
    // 身体缺席时条数退回中性那档，跟装上时是两条不同的路
    expect(budget).toContain('最多说 2 条')
  })

  it('同一个 ctx 直接装配的老写法照样取得到', async () => {
    const dir = tempDir()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})

    vitalsRow.apply(ctx, { file: path.join(dir, 'vitals.json'), tuning: { startDelayMs: 60 * 60_000 } })

    expect(vitalsRow.qqVitalsOf(ctx)).toBeDefined()
    expect(vitalsRow.qqVitalsOf(ctx)?.read()).toBeTypeOf('object')
  })
})
