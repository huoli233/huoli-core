import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention } from '@huoli/huoli-qq-attention'
import { apply as applyChannel } from '@huoli/huoli-qq-channel'
import { apply as applySubject } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  qqVitalsOf,
  resolveTuning,
  type QqVitalsSeam,
} from '@huoli/huoli-qq-vitals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'

const tuning = resolveTuning()

type SocketHandler = (event: { data?: string }) => void

// 只留住那一头的事件，测试自己决定什么时候连上、什么时候把话送进来
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
  seam: QqVitalsSeam
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-incoming-'))
  tempDirs.push(dir)
  return dir
}

// 身体先跑了一分钟，消息上的时间才追得上它
function seed(file: string): void {
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, Date.now() - 60_000), thirst: 0.6 })
}

async function mount(): Promise<Mounted> {
  const dir = tempDir()
  const file = path.join(dir, 'vitals.json')
  seed(file)
  const ctx = new Context()
  contexts.push(ctx)
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyVitals(ctx, { file, tuning: { startDelayMs: 60 * 60_000 } })
  applyChannel(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999' })
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-dec-')), 'decisions.jsonl') })
  const socket = FakeSocket.opened.at(-1)
  const seam = qqVitalsOf(ctx)
  if (socket === undefined || seam === undefined) throw new Error('没装起来')
  socket.open()
  return { ctx, socket, seam }
}

const second = (): number => Math.floor(Date.now() / 1000)

function groupMessage(text: string, id: number, time: number): Record<string, unknown> {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: 123,
    user_id: 555,
    sender: { card: '阿澈' },
    message: [{ type: 'text', data: { text } }],
    message_id: id,
    time,
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

describe('群里的消息进到身体', () => {
  it('一条消息让口渴掉下去，喝水时间跟着更新', async () => {
    const { socket, seam } = await mount()
    const before = seam.read()
    const time = second()

    socket.deliver(groupMessage('喝水了', 777, time))
    const after = seam.read()

    expect(after.last_msg).toBeGreaterThan(before.last_msg)
    expect(after.last_user_text).toBe('喝水了')
    expect(after.last_drink).toBe(time * 1000)
    expect(before.thirst - after.thirst).toBeGreaterThan(0.5)
    expect(after.thirst).toBeLessThan(0.1)
  })

  it('同一条消息送两次只算一次', async () => {
    const { socket, seam } = await mount()
    const time = second()
    const raw = groupMessage('喝水了', 777, time)

    socket.deliver(raw)
    const once = seam.read()
    socket.deliver(raw)
    const twice = seam.read()

    expect(once.last_drink_at).toBe(time * 1000)
    expect(twice.last_drink_at).toBe(time * 1000)
    expect(twice.thirst).toBeCloseTo(once.thirst, 10)
  })
})

describe('私聊的消息也进到身体', () => {
  it('被抱一下，亲近涨一点', async () => {
    const { socket, seam } = await mount()
    const before = seam.read()
    const time = second()

    socket.deliver({
      post_type: 'message',
      message_type: 'private',
      user_id: 555,
      sender: { nickname: '阿澈' },
      message: [{ type: 'text', data: { text: '抱抱你' } }],
      message_id: 888,
      time,
    })
    const after = seam.read()

    expect(after.last_msg).toBe(time * 1000)
    expect(after.last_user_text).toBe('抱抱你')
    expect(after.oxytocin).toBeGreaterThan(before.oxytocin)
  })
})

describe('不是一句话的事件不动身体', () => {
  it('戳一戳不动', async () => {
    const { socket, seam } = await mount()
    const before = seam.read()

    socket.deliver({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', target_id: 999, user_id: 555, group_id: 123 })
    const after = seam.read()

    expect(after.last_msg).toBe(before.last_msg)
    expect(after.last_user_text).toBe(before.last_user_text)
    expect(after.thirst).toBeCloseTo(before.thirst, 6)
  })

  it('只有表情的消息不动', async () => {
    const { socket, seam } = await mount()
    const before = seam.read()

    socket.deliver({ ...groupMessage('', 900, second()), message: [{ type: 'face', data: {} }] })
    const after = seam.read()

    expect(after.last_msg).toBe(before.last_msg)
    expect(after.last_user_text).toBe(before.last_user_text)
    expect(after.thirst).toBeCloseTo(before.thirst, 6)
  })
})

describe('卸载之后', () => {
  it('再来消息也不动身体', async () => {
    const { ctx, socket, seam } = await mount()
    const before = seam.read()
    contexts.splice(contexts.indexOf(ctx), 1)
    await ctx.fiber.dispose()

    socket.deliver(groupMessage('喝水了', 991, second()))

    expect(seam.read().last_msg).toBe(before.last_msg)
    expect(seam.read().last_drink).toBe(before.last_drink)
  })
})
