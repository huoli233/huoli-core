import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent, PreStepDecision } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention, qqAttentionOf } from '@huoli/huoli-qq-attention'
import { apply as applyChannel, qqChannelOf } from '@huoli/huoli-qq-channel'
import { apply as applyMemory, qqMemoryOf } from '@huoli/huoli-qq-memory'
import { apply as applyPacing } from '@huoli/huoli-qq-pacing'
import { apply as applySelf } from '@huoli/huoli-qq-self'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  resolveTuning,
  type VitalsState,
} from '@huoli/huoli-qq-vitals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, qqBundleOf } from '../src/index.ts'

interface Mounted {
  ctx: Context
  tools: number
}

const tuning = resolveTuning()

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-'))
  tempDirs.push(dir)
  return dir
}

// 工具只登记不执行，这里数的是各零件一共挂上去几个工具
async function mount(dir: string): Promise<Mounted> {
  const ctx = new Context()
  let tools = 0
  ctx.accessor('tools', {
    get: () => ({
      register: () => {
        tools += 1
        return () => {}
      },
    }),
  })
  await ctx.plugin(SystemPrompt, {})
  applyPacing(ctx, { file: path.join(dir, 'pacing.json') })
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  // 记忆的三个文件都落在临时目录里，队列与账本不去碰主目录那份
  applyMemory(ctx, {
    file: path.join(dir, 'memory.json'),
    ledgerFile: path.join(dir, 'ledger.json'),
    healthLogFile: path.join(dir, 'health.log'),
    queueFile: path.join(dir, 'queue.json'),
  })
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-dec-')), 'decisions.jsonl') })
  return { ctx, tools }
}

const STEP_AGENT = { id: 'group:1' } as Agent

function stepPayload(step: number) {
  return {
    agent: STEP_AGENT,
    messages: [],
    turn: 1,
    step,
    signal: new AbortController().signal,
    modelSelection: { provider: 'test', model: 'test' },
  }
}

const next = async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] })

// 一轮收尾，组合包在这一步落一行记录并给队列推一拍
async function stopTurn(ctx: Context, turn: number): Promise<void> {
  await ctx.serial('agent/turn-stopping', { agent: STEP_AGENT, turn, signal: new AbortController().signal })
}

// 先把一份身体写好，再按正式顺序装配：身体在前，组合包在后
async function mountWithBody(dir: string, body: Partial<VitalsState> = {}): Promise<Context> {
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, Date.now() - 60_000), ...body })
  const ctx = new Context()
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyPacing(ctx, { file: path.join(dir, 'pacing.json') })
  applyVitals(ctx, { file, tuning: { startDelayMs: 60 * 60_000 } })
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-dec-')), 'decisions.jsonl') })
  return ctx
}

// 取提示词里条数那一段
async function budgetText(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble()
  return assembly.sections.find(section => section.name === 'qq:reply-budget')?.text ?? ''
}

// 取提示词里身体那一句：身体包注册的是变量，装配之后才插值进那一段
async function vitalsText(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble()
  return assembly.variables.qq_vitals ?? ''
}

// 发出去就当场结算的假连接，动态那一路不真连网
class FakeSocket {
  static readonly opened: FakeSocket[] = []
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

  open(): void {
    this.readyState = 1
    for (const handler of this.handlers.get('open') ?? []) handler()
  }
}

// 通道与自我层都挂上，停手开关才接得到发布入口
async function mountWithChannel(dir: string): Promise<Context> {
  const ctx = new Context()
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyChannel(ctx, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    quietStart: '00:00',
    quietEnd: '00:00',
    actionsFile: path.join(dir, 'actions.json'),
  })
  FakeSocket.opened.at(-1)?.open()
  // 阶段停在能放行的那一档，这一组才看得到停手开关那一道
  applySelf(ctx, { dir: path.join(dir, 'self'), enabled: false, settings: { stage: 'P3' } })
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-dec-')), 'decisions.jsonl') })
  return ctx
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('说话规矩', () => {
  it('规矩进了提示词', async () => {
    const { ctx } = await mount(tempDir())

    const assembly = await ctx.systemPrompt.assemble()
    const rules = assembly.sections.find(section => section.name === 'qq:rules')

    expect(rules?.text).toContain('你是群里的一个人')
  })

  it('规矩压在提示词靠后的位置', async () => {
    const { ctx } = await mount(tempDir())

    const names = (await ctx.systemPrompt.assemble()).sections.map(section => section.name)

    expect(names.indexOf('qq:rules')).toBeGreaterThan(names.indexOf('deployment:persona-prefix'))
    expect(names.indexOf('qq:rules')).toBeLessThan(names.indexOf('deployment:persona-suffix'))
  })
})

describe('每轮的步数上限', () => {
  it('步数没超就照常进入这一步', async () => {
    const { ctx } = await mount(tempDir())

    const early = await ctx.waterfall('agent/pre-step', stepPayload(3), next)

    expect(early.kind).toBe('enter')
  })

  it('步数超了就停下', async () => {
    const { ctx } = await mount(tempDir())

    const late = await ctx.waterfall('agent/pre-step', stepPayload(6), next)

    expect(late.kind).toBe('reject')
  })
})

describe('零件都装上了', () => {
  it('注意力装上了', async () => {
    const { ctx } = await mount(tempDir())

    expect(qqAttentionOf(ctx)).toBeDefined()
  })

  it('状态装上了', async () => {
    const { ctx } = await mount(tempDir())

    expect(qqSubjectOf(ctx)).toBeDefined()
  })

  it('记忆装上了', async () => {
    const { ctx } = await mount(tempDir())

    expect(qqMemoryOf(ctx)).toBeDefined()
  })

  it('各零件的工具都登记了', async () => {
    const { tools } = await mount(tempDir())

    expect(tools).toBeGreaterThanOrEqual(5)
  })
})

describe('这一轮最多说几句', () => {
  it('装配一轮后提示词里能看到条数上限', async () => {
    const ctx = await mountWithBody(tempDir())

    expect(await budgetText(ctx)).toContain('最多说')
  })

  it('特别黏又孤独的身体给到四条', async () => {
    const ctx = await mountWithBody(tempDir(), { oxytocin: 1, endorphin: 1 })

    expect(await budgetText(ctx)).toContain('最多说 4 条')
  })

  it('身体没装上时按中性算，上限照样给', async () => {
    const { ctx } = await mount(tempDir())

    expect(await budgetText(ctx)).toContain('最多说 2 条')
  })

  it('只说上限，不说该不该回', async () => {
    const text = await budgetText(await mountWithBody(tempDir()))

    for (const word of ['该不该', '要不要回', '回不回', '必须回', '不该']) expect(text).not.toContain(word)
  })

  it('条数那段排在身体之后、规矩之前', async () => {
    const ctx = await mountWithBody(tempDir())
    const names = (await ctx.systemPrompt.assemble()).sections.map(section => section.name)

    expect(names.indexOf('qq:reply-budget')).toBeGreaterThan(names.indexOf('qq:vitals'))
    expect(names.indexOf('qq:reply-budget')).toBeLessThan(names.indexOf('qq:rules'))
  })
})

describe('动态的发布入口', () => {
  beforeEach(() => {
    FakeSocket.opened.length = 0
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('条数那一段里写了把动态交给发布入口，人设没动', async () => {
    const text = await budgetText(await mountWithBody(tempDir()))

    expect(text).toContain('发布入口')
    expect(text).toContain('最多说')
  })

  it('停手开关开着时发布入口一条都不发', async () => {
    const dir = tempDir()
    fs.mkdirSync(path.join(dir, 'self'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'self', 'PAUSE'), '')
    const ctx = await mountWithChannel(dir)

    const result = await qqChannelOf(ctx)?.publish('post', '今天吃了面', { chatKey: 'group:1', level: 'routine', topic: '吃喝' })

    expect(result?.code).toBe('post.paused')
  })
})

describe('队列节拍', () => {
  it('每轮收尾走一拍', async () => {
    const { ctx } = await mount(tempDir())
    const memory = qqMemoryOf(ctx)
    if (memory === undefined) throw new Error('记忆没装上')
    const ticking = vi.spyOn(memory, 'tick')

    for (const turn of [1, 2, 3]) await stopTurn(ctx, turn)

    expect(ticking).toHaveBeenCalledTimes(3)
  })

  it('记忆那一头失手只记一行日志，不拦这一轮', async () => {
    const { ctx } = await mount(tempDir())
    const memory = qqMemoryOf(ctx)
    if (memory === undefined) throw new Error('记忆没装上')
    const failing = vi.spyOn(memory, 'tick').mockImplementation(() => {
      throw new Error('队列坏了')
    })
    await ctx.waterfall('agent/pre-step', stepPayload(1), next)

    await expect(stopTurn(ctx, 1)).resolves.toBeUndefined()

    expect(failing).toHaveBeenCalledTimes(1)
    expect(qqBundleOf(ctx)?.decisions(0, 10)).toHaveLength(1)
  })
})

describe('身体那一段真的进了提示词', () => {
  it('装配之后 prompt 里有 qq:vitals 这一段，内容是这一会儿的身体', async () => {
    const ctx = await mountWithBody(tempDir(), { thirst: 0.6 })

    const text = await vitalsText(ctx)

    expect(text).not.toBe('')
    expect(text).toContain('嗓子有点干')
  })

  it('身体没接上时这一段就不在，不留一个空壳', async () => {
    const { ctx } = await mount(tempDir())

    expect(await vitalsText(ctx)).toBe('')
  })
})
