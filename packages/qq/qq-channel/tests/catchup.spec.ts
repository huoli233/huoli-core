import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCatchup, type Catchup, type CatchupEvent, type CatchupOptions } from '../src/catchup.ts'
import type { IncomingMessage } from '../src/events.ts'
import { apply, qqChannelOf, type Config } from '../src/index.ts'
import type { AskReply } from '../src/ws.ts'

const SELF = '3763907983'
const GROUP = '668'
const CHAT = `group:${GROUP}`
const PEER = '10000001'
// 起点取整到秒，历史接口给的是秒
const BASE = 1_760_000_000_000
const MINUTE = 60_000

interface Request {
  action: string
  params: Record<string, unknown>
}

function historyReply(messages: Record<string, unknown>[]): AskReply {
  return { ok: true, data: { messages } }
}

// 历史上的一条，time 是秒
function row(id: number, text: string, at: number, sender = 12345): Record<string, unknown> {
  return {
    message_id: id,
    sender_id: sender,
    sender_name: sender === Number(SELF) ? '她' : '某人',
    time: at / 1000,
    message: [{ type: 'text', data: { text } }],
  }
}

function incoming(chatKey: string, text: string, at: number, messageId = ''): IncomingMessage {
  return {
    chatKey,
    senderId: '12345',
    senderName: '某人',
    text,
    at,
    atMe: false,
    isPoke: false,
    replyToBot: false,
    messageId,
    attachments: [],
    traceId: `trace-${messageId}`,
    selfSent: false,
  }
}

interface Rig {
  catchup: Catchup
  emitted: string[]
  reports: CatchupEvent[]
  logs: string[]
  requests: Request[]
  at: (ms: number) => void
}

// 补读只认 ask 与时钟，不用建连接；没给回复时按「没连上」处理
function rig(
  replies: Array<AskReply | (() => Promise<AskReply>)> = [],
  patch: Partial<CatchupOptions> = {},
): Rig {
  let clock = BASE
  const emitted: string[] = []
  const reports: CatchupEvent[] = []
  const logs: string[] = []
  const requests: Request[] = []
  let calls = 0
  const catchup = createCatchup({
    chats: () => [CHAT],
    ask: async (action, params) => {
      requests.push({ action, params })
      const next = replies[Math.min(calls, replies.length - 1)]
      calls += 1
      if (next === undefined) return { ok: false, code: 'channel.offline', reason: '还没连上', hint: '等连上再问' }
      if (typeof next === 'function') return next()
      return next
    },
    sentIds: () => new Set(),
    emit: (message) => { emitted.push(message.text) },
    selfId: SELF,
    now: () => clock,
    log: (message) => { logs.push(message) },
    report: (event) => { reports.push(event) },
    ...patch,
  })
  return {
    catchup,
    emitted,
    reports,
    logs,
    requests,
    at: (ms) => {
      clock = ms
    },
  }
}

describe('断线之后补读', () => {
  it('补回断线期间错过的消息', async () => {
    const rigged = rig([historyReply([row(1, '中间说的第一句', BASE + 30_000)])])
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.emitted).toEqual(['中间说的第一句'])
    expect(rigged.reports.some(event => event.kind === 'missed' && event.messageId === '1')).toBe(true)
    expect(rigged.requests[0]).toEqual({
      action: 'get_group_msg_history',
      params: { group_id: Number(GROUP), count: 20, message_seq: 0 },
    })
  })

  it('水位在读数之前取：读的期间来的实时消息不会把错过的顶成太旧', async () => {
    const holder: { catchup?: Catchup } = {}
    const rigged = rig([
      async () => {
        // 读历史的这一刻刚好有实时消息进来，水位被顶到「现在」
        holder.catchup?.seen(incoming(CHAT, '实时进来的', BASE + MINUTE, 'live-1'))
        return historyReply([row(1, '断线期间说的', BASE + 30_000)])
      },
    ])
    holder.catchup = rigged.catchup
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.catchup.watermarkOf(CHAT)).toBe(BASE + MINUTE)
    expect(rigged.emitted).toEqual(['断线期间说的'])
  })

  it('水位之前的消息不补，水位之后的才补', async () => {
    const before = row(1, '断线之前就听过', BASE + 20_000)
    const after = row(2, '断线期间说的', BASE + 40_000)
    const rigged = rig([historyReply([before, after])])
    // 第二十分钟那条是实时听到的
    rigged.catchup.seen(incoming(CHAT, '断线之前就听过', BASE + 20_000, '1'))
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.emitted).toEqual(['断线期间说的'])
  })

  it('同一个消息编号不会补第二次', async () => {
    const rigged = rig([historyReply([row(1, '断线期间说的', BASE + 30_000)])])
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()
    await rigged.catchup.run()

    expect(rigged.emitted).toEqual(['断线期间说的'])
  })

  it('自己发过的旧消息只进已见，不当成未读', async () => {
    const own = row(1, '我自己说的', BASE + 30_000, Number(SELF))
    const rigged = rig([historyReply([own])])
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.emitted).toEqual([])
    // 进了已见：水位跟着往后走，下一次也不会再当成错过的
    expect(rigged.catchup.watermarkOf(CHAT)).toBe(BASE + 30_000)
  })

  it('未来时间戳不认', async () => {
    const rigged = rig([historyReply([row(1, '时间戳跑到前面去了', BASE + 10 * MINUTE)])])
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.emitted).toEqual([])
  })

  it('超出补读窗口的旧消息不补', async () => {
    const rigged = rig([historyReply([row(1, '一小时前的', BASE + 30_000)])], { windowMs: MINUTE })
    rigged.at(BASE + 60 * MINUTE)

    await rigged.catchup.run()

    expect(rigged.emitted).toEqual([])
  })

  it('一次最多补几条按参数来', async () => {
    const rows = [1, 2, 3, 4].map(index => row(index, `第 ${index} 句`, BASE + index * 1_000))
    const rigged = rig([historyReply(rows)], { maxMessages: 2 })
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.emitted).toEqual(['第 1 句', '第 2 句'])
    expect(rigged.requests[0]?.params.count).toBe(2)
  })

  it('只有图片的也补回去，跟实时那条一样算发生过的事', async () => {
    const picture = { message_id: 1, sender_id: 12345, time: (BASE + 30_000) / 1000, message: [{ type: 'image', data: { file: 'a.jpg' } }] }
    const rigged = rig([historyReply([picture])])
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.emitted).toEqual(['[图片]'])
  })

  it('好友私聊也走同一条补读', async () => {
    const rigged = rig([historyReply([row(1, '好友私聊里说的', BASE + 30_000, Number(PEER))])], {
      chats: () => [`private:${PEER}`],
    })
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.emitted).toEqual(['好友私聊里说的'])
    expect(rigged.requests[0]?.action).toBe('get_friend_msg_history')
  })
})

describe('开关与失败', () => {
  it('关掉开关之后一条都不读', async () => {
    const rigged = rig([historyReply([])], { enabled: false })
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.requests).toEqual([])
  })

  it('补读失败只记一行，不外抛', async () => {
    const rigged = rig([{ ok: false, code: 'channel.timeout', reason: '等回话超时', hint: '再试一次' }], { maxRetries: 0 })
    rigged.at(BASE + MINUTE)

    await expect(rigged.catchup.run()).resolves.toBeUndefined()
    expect(rigged.emitted).toEqual([])
    expect(rigged.logs.some(line => line.includes('断线补读失败'))).toBe(true)
    expect(rigged.reports.some(event => event.kind === 'error' && event.code === 'channel.timeout')).toBe(true)
  })

  it('失败之后按配置再试几次', async () => {
    const failed: AskReply = { ok: false, code: 'channel.timeout', reason: '等回话超时', hint: '再试一次' }
    const rigged = rig([failed, failed, historyReply([row(1, '第二次才读到', BASE + 30_000)])], {
      maxRetries: 2,
      retryMs: 0,
    })
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.requests).toHaveLength(3)
    expect(rigged.emitted).toEqual(['第二次才读到'])
  })

  it('对方回话说没连上就不再重试', async () => {
    const rigged = rig([], { maxRetries: 3 })
    rigged.at(BASE + MINUTE)

    await rigged.catchup.run()

    expect(rigged.requests).toHaveLength(1)
  })

  it('读历史抛错也只当成失败', async () => {
    const rigged = rig([
      async () => {
        throw new Error('连接被掐断')
      },
    ], { maxRetries: 0 })
    rigged.at(BASE + MINUTE)

    await expect(rigged.catchup.run()).resolves.toBeUndefined()
    expect(rigged.reports.some(event => event.kind === 'error')).toBe(true)
  })
})

// 下面这几个走真正装配起来的通道，确认接线也接上了
type SocketHandler = (event: { data?: string }) => void

class FakeSocket {
  static readonly opened: FakeSocket[] = []
  static readonly failed = new Map<string, number>()
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
    const parsed = JSON.parse(payload) as { echo?: string; action?: string }
    if (parsed.echo === undefined) return
    const retcode = FakeSocket.failed.get(parsed.action ?? '') ?? 0
    this.emit('message', JSON.stringify({
      echo: parsed.echo,
      retcode,
      data: { message_id: this.sent.length, messages: [] },
      ...retcode === 0 ? {} : { wording: '对方拒了' },
    }))
  }

  close(): void {
    this.readyState = 3
    this.emit('close')
  }

  open(): void {
    this.readyState = 1
    this.emit('open')
  }

  actions(): string[] {
    return this.sent.map(payload => (JSON.parse(payload) as { action?: string }).action ?? '')
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

const tempDirs: string[] = []
const OPEN_HOURS = { quietStart: '00:00', quietEnd: '00:00' }

// 补读是 async 的，断言之前把手上的微任务与定时器都跑完
async function flush(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  }
}

function mount(patch: Partial<Config> = {}): { ctx: Context; socket: FakeSocket } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-catchup-'))
  tempDirs.push(dir)
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
    selfId: SELF,
    sentLedgerFile: path.join(dir, 'sent.json'),
    actionsFile: path.join(dir, 'actions.json'),
    allowGroups: [GROUP],
    ...OPEN_HOURS,
    ...patch,
  })
  const socket = FakeSocket.opened.at(-1)
  if (socket === undefined) throw new Error('连接没建起来')
  socket.open()
  return { ctx, socket }
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  FakeSocket.failed.clear()
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('装配之后的接线', () => {
  it('连上之后按名单去读一次最近消息', async () => {
    const { socket } = mount()
    await Promise.resolve()

    expect(socket.actions()).toContain('get_group_msg_history')
  })

  it('关掉开关就不去读', async () => {
    const { socket } = mount({ catchupEnabled: false })
    await Promise.resolve()

    expect(socket.actions()).not.toContain('get_group_msg_history')
  })

  it('断线重连之后再补一次', async () => {
    const { ctx, socket } = mount()
    await flush()

    socket.close()
    socket.open()
    await flush()

    expect(socket.actions().filter(action => action === 'get_group_msg_history')).toHaveLength(2)
    qqChannelOf(ctx)?.channel.stop()
  })

  it('连接状态反复刷新不重复补', async () => {
    const { ctx, socket } = mount()
    await flush()

    socket.open()
    await flush()

    expect(socket.actions().filter(action => action === 'get_group_msg_history')).toHaveLength(1)
    qqChannelOf(ctx)?.channel.stop()
  })

  it('补读失败不影响正常发送', async () => {
    FakeSocket.failed.set('get_group_msg_history', 100)
    const { ctx, socket } = mount({ catchupMaxRetries: 0 })
    await Promise.resolve()

    const seam = qqChannelOf(ctx)
    if (seam === undefined) throw new Error('通道没装上')
    const sent = await seam.send('照样能发', `group:${GROUP}`)

    expect(sent.ok).toBe(true)
    expect(socket.actions()).toContain('send_group_msg')
  })
})
