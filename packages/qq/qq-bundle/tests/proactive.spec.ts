import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention } from '@huoli/huoli-qq-attention'
import { apply as applyChannel } from '@huoli/huoli-qq-channel'
import { apply as applyMaterial, qqMaterialOf } from '@huoli/huoli-qq-material'
import { apply as applyProactive, qqProactiveOf, type QqProactiveSeam } from '@huoli/huoli-qq-proactive'
import { apply as applySubject } from '@huoli/huoli-qq-subject'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, qqBundleOf } from '../src/index.ts'

type SocketHandler = (event: { data?: string }) => void

// 只留住那一头的事件，测试自己决定什么时候把话送进来
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

interface Mounted {
  ctx: Context
  socket: FakeSocket
  proactive: QqProactiveSeam
  dir: string
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-proactive-wiring-'))
  tempDirs.push(dir)
  return dir
}

const NO_QUIET = { quietStart: '00:00', quietEnd: '00:00' }

async function mount(options: { enabled: boolean; throttleMs?: number }): Promise<Mounted> {
  const dir = tempDir()
  const ctx = new Context()
  contexts.push(ctx)
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyMaterial(ctx, { thoughtsFile: path.join(dir, 'thoughts.json') })
  applyProactive(ctx, { file: path.join(dir, 'proactive.json'), enabled: options.enabled, ...NO_QUIET })
  applyChannel(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999' })
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepHour: 4,
    decisionsFile: path.join(dir, 'qq-decisions.jsonl'),
    ...options.throttleMs !== undefined ? { proactiveThrottleMs: options.throttleMs } : {},
  })
  const socket = FakeSocket.opened.at(-1)
  const proactive = qqProactiveOf(ctx)
  if (socket === undefined || proactive === undefined) throw new Error('没装起来')
  socket.open()
  return { ctx, socket, proactive, dir }
}

const AGENT = { id: 'group:1' } as Agent

// 一轮收尾，组合包就是在这里问她要不要开口
async function endTurn(ctx: Context): Promise<void> {
  await ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })
}

function proactiveRecords(ctx: Context): Array<{ reason: string | null; chatKey: string }> {
  const seam = qqBundleOf(ctx)
  if (seam === undefined) throw new Error('组合包没装上')
  return seam.decisions(0, 50).filter(record => record.reason?.startsWith('proactive:') === true)
}

const second = (): number => Math.floor(Date.now() / 1000)

function groupMessage(text: string, id: number): Record<string, unknown> {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: 1,
    user_id: 555,
    sender: { card: '阿澈' },
    message: [{ type: 'text', data: { text } }],
    message_id: id,
    time: second(),
  }
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('关着的时候', () => {
  it('一次都不问，也不往盘上写', async () => {
    const { ctx, proactive, dir } = await mount({ enabled: false })
    const asking = vi.spyOn(proactive, 'consider')

    await endTurn(ctx)

    expect(asking).not.toHaveBeenCalled()
    expect(proactiveRecords(ctx)).toHaveLength(0)
    expect(fs.existsSync(path.join(dir, 'proactive.json'))).toBe(false)
  })
})

describe('开了以后', () => {
  it('攒住的候选当场摆出来，拿编号就能投出去', async () => {
    const { ctx, proactive } = await mount({ enabled: true })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('周末那个游戏叫什么来着', 'group:1')

    await endTurn(ctx)
    const shown = proactive.preview('group:1')
    const target = shown[0]
    if (target === undefined) throw new Error('没有攒住任何一条')

    const delivered = proactive.deliver('group:1', target.id)

    expect(shown.map(item => item.text)).toEqual(['周末那个游戏叫什么来着'])
    expect(delivered.ok).toBe(true)
    expect(delivered.item?.text).toBe('周末那个游戏叫什么来着')
  })

  it('没候选也落一条记录，但不产生待发', async () => {
    const { ctx, proactive } = await mount({ enabled: true })

    await endTurn(ctx)

    expect(proactive.preview('group:1')).toHaveLength(0)
    expect(proactiveRecords(ctx).map(record => record.reason)).toEqual(['proactive:no_candidate'])
  })

  it('每轮收尾各落一条，理由都是 proactive 开头', async () => {
    const { ctx } = await mount({ enabled: true })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('想说说楼下新开的店', 'group:1')

    await endTurn(ctx)
    await endTurn(ctx)

    const reasons = proactiveRecords(ctx).map(record => record.reason)
    expect(reasons).toHaveLength(2)
    for (const reason of reasons) expect(reason?.startsWith('proactive:')).toBe(true)
    expect(reasons[0]).toBe('proactive:preview_ready')
  })

  it('刚投过一条，下一轮立刻被冷却拦下并记下码', async () => {
    const { ctx, proactive } = await mount({ enabled: true })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('想说说楼下新开的店', 'group:1')
    await endTurn(ctx)
    const target = proactive.preview('group:1')[0]
    if (target === undefined) throw new Error('没有攒住任何一条')
    proactive.deliver('group:1', target.id)

    await endTurn(ctx)

    expect(proactiveRecords(ctx).map(record => record.reason)).toEqual(['proactive:preview_ready', 'proactive:too_soon'])
  })
})

describe('入站之后的节流', () => {
  it('节流窗口里再来一条不再问一次', async () => {
    const { ctx, socket } = await mount({ enabled: true, throttleMs: 60 * 60_000 })

    socket.deliver(groupMessage('在吗', 11))
    socket.deliver(groupMessage('在不在', 12))

    expect(proactiveRecords(ctx)).toHaveLength(1)
  })

  it('节流窗口为零时每来一条都问一次', async () => {
    const { ctx, socket } = await mount({ enabled: true, throttleMs: 0 })

    socket.deliver(groupMessage('在吗', 21))
    socket.deliver(groupMessage('在不在', 22))

    expect(proactiveRecords(ctx)).toHaveLength(2)
  })
})
