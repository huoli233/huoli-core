import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention } from '@huoli/huoli-qq-attention'
import { apply as applyChannel } from '@huoli/huoli-qq-channel'
import { apply as applySubject } from '@huoli/huoli-qq-subject'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'

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

// 开过哪几条会话、每条被叫醒几次，全记在这里
interface Opened {
  sessionId: string
  woken: string[]
}

interface Mounted {
  ctx: Context
  socket: FakeSocket
  opened: Map<string, Opened>
  disposed: string[]
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-sessions-'))
  tempDirs.push(dir)
  return dir
}

async function mount(): Promise<Mounted> {
  const dir = tempDir()
  const ctx = new Context()
  contexts.push(ctx)
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyChannel(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999' })
  const opened = new Map<string, Opened>()
  const disposed: string[] = []
  // 只按会话编号造一个够用的躯壳：入站这条路只用得上 followup
  ctx.provide('agents', {
    create: (options: { sessionId: string }) => {
      const record: Opened = { sessionId: options.sessionId, woken: [] }
      opened.set(options.sessionId, record)
      const agent = {
        id: options.sessionId,
        followup: (message: { content: readonly { type: string; text?: string }[] }) => {
          record.woken.push(message.content[0]?.text ?? '')
        },
      }
      return Promise.resolve({
        agent,
        dispose: async () => {
          disposed.push(options.sessionId)
        },
      })
    },
  })
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(dir, 'decisions.jsonl') })
  const socket = FakeSocket.opened.at(-1)
  if (socket === undefined) throw new Error('通道没装起来')
  socket.open()
  return { ctx, socket, opened, disposed }
}

const second = (): number => Math.floor(Date.now() / 1000)

function groupMessage(groupId: number, text: string, messageId: number, time: number): Record<string, unknown> {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: groupId,
    user_id: 555,
    sender: { card: '阿澈' },
    message: [{ type: 'text', data: { text } }],
    message_id: messageId,
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

describe('一个群一条会话', () => {
  it('两个群各开一条，会话编号就是聊天键', async () => {
    const { opened, socket } = await mount()

    socket.deliver(groupMessage(123, '在吗', 1, second()))
    socket.deliver(groupMessage(456, '吃了没', 2, second()))

    await vi.waitFor(() => {
      expect([...opened.keys()]).toEqual(['group:123', 'group:456'])
    })
  })

  it('同一个群说两句只开一条会话', async () => {
    const { opened, socket } = await mount()

    socket.deliver(groupMessage(123, '在吗', 1, second()))
    await vi.waitFor(() => {
      expect(opened.size).toBe(1)
    })
    socket.deliver(groupMessage(123, '在不在', 2, second()))
    await vi.waitFor(() => {
      expect(opened.get('group:123')?.woken).toHaveLength(2)
    })

    expect(opened.size).toBe(1)
  })

  it('各群的消息叫醒各自那一条，不串门', async () => {
    const { opened, socket } = await mount()

    socket.deliver(groupMessage(123, '给 123 的话', 1, second()))
    socket.deliver(groupMessage(456, '给 456 的话', 2, second()))

    await vi.waitFor(() => {
      expect(opened.get('group:123')?.woken).toEqual(['给 123 的话'])
      expect(opened.get('group:456')?.woken).toEqual(['给 456 的话'])
    })
  })

  it('只有表情位置的那条不叫醒', async () => {
    const { opened, socket } = await mount()

    socket.deliver({
      post_type: 'message',
      message_type: 'group',
      group_id: 123,
      user_id: 555,
      sender: { card: '阿澈' },
      message: [{ type: 'face', data: {} }],
      message_id: 9,
      time: second(),
    })

    await vi.waitFor(() => {
      expect(opened.size).toBe(0)
    })
  })

  it('卸载时把开过的会话都收掉', async () => {
    const { ctx, opened, disposed, socket } = await mount()

    socket.deliver(groupMessage(123, '在吗', 1, second()))
    socket.deliver(groupMessage(456, '吃了没', 2, second()))
    await vi.waitFor(() => {
      expect(opened.size).toBe(2)
    })

    await ctx.fiber.dispose()

    expect([...disposed].sort()).toEqual(['group:123', 'group:456'])
  })
})
