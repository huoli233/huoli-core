import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, qqChannelOf, type Config, type QqChannelSeam } from '../src/index.ts'

type SocketHandler = (event: { data?: string }) => void

// 每发一条就回一个 echo，发送这条路才会当场结算
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

  // 只看真正发出去的正文，不看心跳与回执
  bodies(): string[] {
    return this.sent
      .map(payload => JSON.parse(payload) as { action?: string; params?: { message?: unknown } })
      .filter(item => item.action === 'send_group_msg')
      .map(item => (typeof item.params?.message === 'string' ? item.params.message : ''))
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

const OPEN_HOURS = { quietStart: '00:00', quietEnd: '00:00' }
const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-stop-mid-'))
  tempDirs.push(dir)
  return dir
}

function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  tool: (name: string) => ToolDefinition
  seam: QqChannelSeam
  socket: FakeSocket
}

function mount(patch: Partial<Config> = {}): Mounted {
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
  apply(ctx, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    ...OPEN_HOURS,
    actionsFile: path.join(tempDir(), 'actions.json'),
    ...patch,
  })
  const socket = FakeSocket.opened.at(-1)
  if (socket === undefined) throw new Error('连接没建起来')
  socket.open()
  const seam = qqChannelOf(ctx)
  if (seam === undefined) throw new Error('通道没装上')
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没注册工具 ${name}`)
    return found
  }
  return { tool, seam, socket }
}

// 三句话，切开来是三条
const THREE = '第一句在这儿。第二句也在这儿。第三句还在这儿。'

beforeEach(() => {
  FakeSocket.opened.length = 0
  // 连接换成假的；不用假定时器，否则条与条之间的间隔永远等不到
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('发到一半被叫停', () => {
  it('上限三条、但说完第一条就该停：真的只发一条', async () => {
    const { tool, seam, socket } = mount()
    seam.useReplyCap(() => 3)
    seam.useStop(sent => sent >= 1)

    const result = await tool('qq_send_message').execute({ text: THREE }, execOf('group:1')) as { parts: number }

    expect(result.parts).toBe(1)
    expect(socket.bodies()).toHaveLength(1)
    expect(socket.bodies()[0]).toBe('第一句在这儿。')
  })

  it('没人叫停时三条都发出去，证明上面的停是它造成的', async () => {
    const { tool, seam, socket } = mount()
    seam.useReplyCap(() => 3)

    const result = await tool('qq_send_message').execute({ text: THREE }, execOf('group:1')) as { parts: number }

    expect(result.parts).toBe(3)
    expect(socket.bodies()).toHaveLength(3)
  })

  it('一开口就该停：一条都不发', async () => {
    const { tool, seam, socket } = mount()
    seam.useReplyCap(() => 3)
    seam.useStop(() => true)

    const result = await tool('qq_send_message').execute({ text: THREE }, execOf('group:1')) as { parts: number }

    expect(result.parts).toBe(0)
    expect(socket.bodies()).toHaveLength(0)
  })

  it('停下来的判定按已经发出去的条数走，不是按计划条数', async () => {
    const { tool, seam, socket } = mount()
    seam.useReplyCap(() => 3)
    const seen: number[] = []
    seam.useStop((sent) => {
      seen.push(sent)
      return sent >= 2
    })

    await tool('qq_send_message').execute({ text: THREE }, execOf('group:1'))

    // 切句那一遍按计划位问，发送那一遍按已发条数问，最后问的是 1
    expect(seen.at(-1)).toBe(1)
    expect(socket.bodies()).toHaveLength(2)
  })
})
