import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent, PreStepDecision } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention } from '@huoli/huoli-qq-attention'
import { apply as applyChannel } from '@huoli/huoli-qq-channel'
import { apply as applyMemory } from '@huoli/huoli-qq-memory'
import { apply as applySubject } from '@huoli/huoli-qq-subject'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, qqBundleOf, type DecisionRecord } from '../src/index.ts'

type SocketHandler = (event: { data?: string }) => void

// 每次发出去都立刻回一个 echo，好让发送这条路当场结算
class FakeSocket {
  static readonly opened: FakeSocket[] = []
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, SocketHandler[]>()

  constructor() {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, handler: SocketHandler): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(payload: string): void {
    this.sent.push(payload)
    const echo = (JSON.parse(payload) as { echo?: string }).echo
    if (echo === undefined) return
    this.emit('message', JSON.stringify({ echo, retcode: 0, data: { message_id: this.sent.length } }))
  }

  close(): void {
    this.readyState = 3
  }

  open(): void {
    this.readyState = 1
    this.emit('open')
  }

  deliver(raw: Record<string, unknown>): void {
    this.emit('message', JSON.stringify(raw))
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

const CHAT = 'group:123'
const AGENT = { id: CHAT } as Agent

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-decisions-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  ctx: Context
  file: string
  socket: FakeSocket
  tool: (name: string) => ToolDefinition
  records(): DecisionRecord[]
}

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
async function mount(patch: { banned?: readonly string[] } = {}): Promise<Mounted> {
  const dir = tempDir()
  const file = path.join(dir, 'qq-decisions.jsonl')
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', {
    get: () => ({
      register: (definition: ToolDefinition) => {
        tools.set(definition.name, definition)
        return () => {}
      },
      guard: () => () => {},
    }),
  })
  await ctx.plugin(SystemPrompt, {})
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  // 队列与账本也落在临时目录里：每轮收尾会推一拍队列，别去碰主目录那份
  applyMemory(ctx, {
    file: path.join(dir, 'memory.json'),
    ledgerFile: path.join(dir, 'ledger.json'),
    healthLogFile: path.join(dir, 'health.log'),
    queueFile: path.join(dir, 'queue.json'),
  })
  applyChannel(ctx, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    quietStart: '00:00',
    quietEnd: '00:00',
    ...patch.banned === undefined ? {} : { banned: patch.banned },
  })
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: file })
  const socket = FakeSocket.opened.at(-1)
  if (socket === undefined) throw new Error('通道没有装起来')
  socket.open()
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { ctx, file, socket, tool, records: () => qqBundleOf(ctx)?.decisions(0, 100) ?? [] }
}

// 工具体只读会话编号与取消信号，其余执行字段由内核在真实调用时注入
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

const next = async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] })

function stepOf(step: number) {
  return {
    agent: AGENT,
    messages: [],
    turn: 1,
    step,
    signal: new AbortController().signal,
    modelSelection: { provider: 'test', model: 'test' },
  }
}

// 走一轮：进门、说一句、收尾
async function oneRound(seat: Mounted, text: string): Promise<void> {
  await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
  await seat.tool('qq_send_message').execute({ text }, execOf(CHAT))
  await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })
}

function groupMessage(text: string, id: number): Record<string, unknown> {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: 123,
    user_id: 555,
    sender: { card: '阿澈' },
    message: [{ type: 'text', data: { text } }],
    message_id: id,
    time: Math.floor(Date.now() / 1000),
  }
}

// 只取那一条，没留下就直接判失败
function only(seat: Mounted): DecisionRecord {
  const [record] = seat.records()
  if (record === undefined) throw new Error('一条记录都没留下')
  return record
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('一轮一条记录', () => {
  it('被一条消息叫起来，说完一句就留下一条', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('在吗', 1))

    await oneRound(seat, '在的')

    const record = only(seat)
    expect(seat.records()).toHaveLength(1)
    expect(record.at).toBeGreaterThan(0)
    expect(record.chatKey).toBe(CHAT)
    expect(record.awake).toBe(true)
    expect(record.reason).toBe('incoming')
    expect(record.attempted).toBe(true)
    expect(record.sent).toBe(1)
    expect(record.blocked).toBeNull()
  })

  it('没被叫起来的一轮也留一条，awake 是假的', async () => {
    const seat = await mount()

    await oneRound(seat, '在的')

    const record = only(seat)
    expect(record.awake).toBe(false)
    expect(record.reason).toBeNull()
    expect(record.attempted).toBe(true)
    expect(record.sent).toBe(1)
  })

  it('戳一戳也算唤醒了，理由是 poke', async () => {
    const seat = await mount()
    seat.socket.deliver({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', target_id: 999, user_id: 555, group_id: 123 })

    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })

    const record = only(seat)
    expect(record.awake).toBe(true)
    expect(record.reason).toBe('poke')
  })
})

describe('被闸门拦下', () => {
  it('敏感词拦下时留下码与下次时间', async () => {
    const seat = await mount({ banned: ['加群'] })
    seat.socket.deliver(groupMessage('在吗', 1))

    await seat.ctx.waterfall('agent/pre-step', stepOf(1), next)
    await expect(seat.tool('qq_send_message').execute({ text: '你也来加群' }, execOf(CHAT))).rejects.toThrow(/outbound\.banned/u)
    await seat.ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })

    const record = only(seat)
    expect(record.attempted).toBe(true)
    expect(record.sent).toBe(0)
    expect(record.blocked?.code).toBe('outbound.banned')
    expect(record.blocked?.retryAt).toBeGreaterThan(0)
  })

  it('步数用满时留下一个码，没有下次时间', async () => {
    const seat = await mount()

    const late = await seat.ctx.waterfall('agent/pre-step', stepOf(6), next)

    expect(late.kind).toBe('reject')
    const record = only(seat)
    expect(record.blocked?.code).toBe('bundle.step_cap')
    expect(record.blocked?.retryAt).toBeNull()
  })
})

describe('记录只落文件，不带原文', () => {
  it('文件里没有用户原文，也没有模型要说的话', async () => {
    const seat = await mount()
    seat.socket.deliver(groupMessage('我们约一个只有我们知道的暗号', 1))

    await oneRound(seat, '这句话也不该出现在记录里')

    const text = fs.readFileSync(seat.file, 'utf8')
    expect(text).not.toContain('暗号')
    expect(text).not.toContain('这句话也不该出现')
    expect(text.trim().split('\n')).toHaveLength(1)
  })

  it('第二轮是追加，第一行原样留着', async () => {
    const seat = await mount()
    await oneRound(seat, '第一轮')
    const first = fs.readFileSync(seat.file, 'utf8')
    await oneRound(seat, '第二轮')
    const both = fs.readFileSync(seat.file, 'utf8')

    expect(both.startsWith(first)).toBe(true)
    expect(both.trim().split('\n')).toHaveLength(2)
  })

  it('记录不进提示词', async () => {
    const seat = await mount()
    await oneRound(seat, '在的')

    const assembly = await seat.ctx.systemPrompt.assemble()
    const text = assembly.sections.map(section => section.text).join('\n')

    expect(text).not.toContain('qq-decisions')
    expect(text).not.toContain('attempted')
  })
})

describe('排查用的入口', () => {
  it('按时刻筛，按条数截尾', async () => {
    const seat = await mount()
    await oneRound(seat, '第一轮')
    const first = only(seat)
    await oneRound(seat, '第二轮')

    const newest = qqBundleOf(seat.ctx)?.decisions(0, 1) ?? []
    const afterFirst = qqBundleOf(seat.ctx)?.decisions(first.at + 1, 100) ?? []

    expect(newest).toHaveLength(1)
    expect(newest[0]?.at).toBeGreaterThanOrEqual(first.at)
    expect(afterFirst.length).toBeLessThanOrEqual(1)
    expect(seat.records()).toHaveLength(2)
  })
})
