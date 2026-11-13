import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFloodGuard, FLOOD_HINT, type FloodTuning } from '../src/flood-guard.ts'
import { apply, qqChannelOf, type Config } from '../src/index.ts'
import { createOutboundCheck, OUTBOUND_DEFAULTS, type OutboundTuning } from '../src/outbound.ts'

const CHAT = 'group:668'
const OTHER_CHAT = 'group:669'
const T0 = 1_760_000_000_000

const TUNING: FloodTuning = {
  floodBurstCount: 3,
  floodBurstWindowMs: 60_000,
  floodReplyPerSender: 2,
  floodReplyWindowMs: 300_000,
  floodGuardEnabled: true,
}

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
const OPEN: OutboundTuning = { ...OUTBOUND_DEFAULTS, quietStart: '00:00', quietEnd: '00:00' }

function floodOf(patch: Partial<FloodTuning> = {}): ReturnType<typeof createFloodGuard> {
  return createFloodGuard({ ...TUNING, ...patch }, () => T0)
}

interface Clocked {
  check: ReturnType<typeof createOutboundCheck>
  at: (ms: number) => void
}

function outboundOf(patch: Partial<FloodTuning> = {}): Clocked {
  let clock = T0
  return {
    check: createOutboundCheck(
      { ...OPEN, ...TUNING, ...patch },
      () => clock,
    ),
    at: (ms) => {
      clock = ms
    },
  }
}

describe('同一个人连着刷', () => {
  it('连发超过上限就把这一条挡下，理由说清几条、下一步与下次时间都在', () => {
    const guard = floodOf()
    for (let index = 0; index < 3; index += 1) guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 + index })

    const verdict = guard.inspect({ chatKey: CHAT, at: T0 + 3 })

    expect(verdict?.code).toBe('outbound.flood_burst')
    expect(verdict?.reason).toBe('这个人刚连发了 3 条')
    expect(verdict?.hint).toBe(FLOOD_HINT)
    expect(verdict?.retryAt).toBe(T0 + 60_000)
  })

  it('没到上限就照常放行', () => {
    const guard = floodOf()
    guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 })

    expect(guard.inspect({ chatKey: CHAT, at: T0 + 1 })).toBeUndefined()
  })

  it('窗口外的旧触发不累加', () => {
    const guard = floodOf()
    for (let index = 0; index < 3; index += 1) guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 + index })

    expect(guard.inspect({ chatKey: CHAT, at: T0 + 61_000 })).toBeUndefined()
  })

  it('自己发出去的不算别人触发', () => {
    const guard = floodOf()
    for (let index = 0; index < 5; index += 1) {
      guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 + index, selfSent: true })
    }

    expect(guard.inspect({ chatKey: CHAT, at: T0 + 6 })).toBeUndefined()
  })
})

describe('不同人互不影响', () => {
  it('一个人在刷不会挡住回别人', () => {
    const guard = floodOf()
    for (let index = 0; index < 3; index += 1) guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 + index })
    guard.saw({ chatKey: CHAT, senderId: '2002', at: T0 + 4 })

    expect(guard.inspect({ chatKey: CHAT, at: T0 + 5 })).toBeUndefined()
    expect(guard.inspect({ chatKey: CHAT, at: T0 + 5, senderId: '1001' })?.code).toBe('outbound.flood_burst')
  })

  it('两个群各算各的', () => {
    const guard = floodOf()
    for (let index = 0; index < 3; index += 1) guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 + index })

    expect(guard.inspect({ chatKey: OTHER_CHAT, at: T0 + 4 })).toBeUndefined()
  })
})

describe('回同一个人的条数', () => {
  it('回过够多就不再往同一个人身上加', () => {
    const guard = floodOf({ floodBurstCount: 99 })
    guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 })
    guard.noteReply(CHAT, T0 + 10)
    guard.noteReply(CHAT, T0 + 20)

    const verdict = guard.inspect({ chatKey: CHAT, at: T0 + 30 })

    expect(verdict?.code).toBe('outbound.flood_reply')
    expect(verdict?.reason).toBe('你已经回过他 2 条')
    expect(verdict?.retryAt).toBe(T0 + 10 + 300_000)
  })

  it('窗口外的回话不累加', () => {
    const guard = floodOf({ floodBurstCount: 99 })
    guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 })
    guard.noteReply(CHAT, T0 + 10)
    guard.noteReply(CHAT, T0 + 20)

    expect(guard.inspect({ chatKey: CHAT, at: T0 + 10 + 300_001 })).toBeUndefined()
  })
})

describe('开关与文案', () => {
  it('关掉开关就一条都不挡', () => {
    const guard = floodOf({ floodGuardEnabled: false })
    for (let index = 0; index < 20; index += 1) guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 + index })

    expect(guard.inspect({ chatKey: CHAT, at: T0 + 21 })).toBeUndefined()
  })

  it('理由里只有条数，不带路径也不带正文', () => {
    const guard = floodOf({ floodBurstCount: 2 })
    guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 })
    guard.saw({ chatKey: CHAT, senderId: '1001', at: T0 + 1 })

    const verdict = guard.inspect({ chatKey: CHAT, at: T0 + 2 })

    expect(verdict?.reason).toBe('这个人刚连发了 2 条')
    expect(verdict?.reason).not.toMatch(/[\\/]|token|C:|Users|http/u)
    expect(verdict?.hint).toBe(FLOOD_HINT)
  })
})

describe('接到出站体检上', () => {
  it('连发超限时这一条被挡，别的关卡照旧', () => {
    const { check, at } = outboundOf()
    for (let index = 0; index < 3; index += 1) check.sawIncoming({ chatKey: CHAT, senderId: '1001', at: T0 + index })
    at(T0 + 3)

    const verdict = check.check({ chatKey: CHAT, text: '来了来了' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.flood_burst')
    expect(verdict.reason).toBe('这个人刚连发了 3 条')
    expect(verdict.retryAt).toBe(T0 + 60_000)
  })

  it('被挡下的那次不记账，到了下次时间就放行', () => {
    const { check, at } = outboundOf()
    for (let index = 0; index < 3; index += 1) check.sawIncoming({ chatKey: CHAT, senderId: '1001', at: T0 + index })
    at(T0 + 3)
    expect(check.check({ chatKey: CHAT, text: '先说一句' }).code).toBe('outbound.flood_burst')

    // 被挡的那次没有 record，所以回话条数还是零
    at(T0 + 60_000)
    expect(check.check({ chatKey: CHAT, text: '先说一句' }).ok).toBe(true)

    check.record(CHAT, T0 + 60_000)
    // 回话只记了一笔，没到上限，第二条照样能发
    expect(check.check({ chatKey: CHAT, text: '再接一句' }).ok).toBe(true)
  })

  it('回同一人太多也会被挡，理由说的是回过几条', () => {
    const { check, at } = outboundOf({ floodBurstCount: 99 })
    check.sawIncoming({ chatKey: CHAT, senderId: '1001', at: T0 })
    check.record(CHAT, T0 + 10)
    check.record(CHAT, T0 + 20)
    at(T0 + 30)

    const verdict = check.check({ chatKey: CHAT, text: '再说一句' })

    expect(verdict.code).toBe('outbound.flood_reply')
    expect(verdict.reason).toBe('你已经回过他 2 条')
  })

  it('换个人回就不受影响', () => {
    const { check, at } = outboundOf()
    for (let index = 0; index < 3; index += 1) check.sawIncoming({ chatKey: CHAT, senderId: '1001', at: T0 + index })
    check.sawIncoming({ chatKey: CHAT, senderId: '2002', at: T0 + 4 })
    at(T0 + 5)

    expect(check.check({ chatKey: CHAT, text: '回你' }).ok).toBe(true)
  })

  it('关掉开关之后照常发', () => {
    const { check, at } = outboundOf({ floodGuardEnabled: false })
    for (let index = 0; index < 20; index += 1) check.sawIncoming({ chatKey: CHAT, senderId: '1001', at: T0 + index })
    at(T0 + 21)

    expect(check.check({ chatKey: CHAT, text: '在的' }).ok).toBe(true)
  })

  it('用户消息触发的直接回复不受主动刷屏保护拦截', () => {
    const { check, at } = outboundOf()
    for (let index = 0; index < 3; index += 1) check.sawIncoming({ chatKey: CHAT, senderId: '1001', at: T0 + index })
    at(T0 + 3)

    expect(check.checkReply({ chatKey: CHAT, text: '来了' }).ok).toBe(true)
    expect(check.check({ chatKey: CHAT, text: '主动补一句' }).code).toBe('outbound.flood_burst')
  })
})

// 下面这条走真正装配起来的通道，确认入站真被喂进了这道闸
type SocketHandler = (event: { data?: string }) => void

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
    const parsed = JSON.parse(payload) as { echo?: string }
    if (parsed.echo === undefined) return
    this.emit('message', JSON.stringify({ echo: parsed.echo, retcode: 0, data: { message_id: this.sent.length, messages: [] } }))
  }

  close(): void {
    this.readyState = 3
    this.emit('close')
  }

  open(): void {
    this.readyState = 1
    this.emit('open')
  }

  // 群里某个人说了一句
  say(group: string, userId: string, messageId: number, text: string): void {
    this.emit('message', JSON.stringify({
      post_type: 'message',
      message_type: 'group',
      group_id: Number(group),
      user_id: Number(userId),
      sender: { user_id: Number(userId), nickname: '某人' },
      message_id: messageId,
      time: Math.floor(Date.now() / 1000),
      message: [{ type: 'text', data: { text } }],
      raw_message: text,
    }))
  }

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

const tempDirs: string[] = []

function mount(patch: Partial<Config> = {}): Context {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-flood-'))
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
    selfId: '999',
    sentLedgerFile: path.join(dir, 'sent.json'),
    actionsFile: path.join(dir, 'actions.json'),
    allowGroups: ['668'],
    quietStart: '00:00',
    quietEnd: '00:00',
    catchupEnabled: false,
    floodBurstCount: 3,
    floodBurstWindowMs: 60_000,
    floodReplyPerSender: 99,
    ...patch,
  })
  FakeSocket.opened.at(-1)?.open()
  return ctx
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('装配之后真的挡得住', () => {
  it('同一个人在群里连发三条之后，她这一条被挡下且真没发出去', async () => {
    const ctx = mount()
    const socket = FakeSocket.opened.at(-1)
    if (socket === undefined) throw new Error('连接没建起来')
    for (let index = 1; index <= 3; index += 1) socket.say('668', '1001', index, `在吗 ${index}`)

    const seam = qqChannelOf(ctx)
    if (seam === undefined) throw new Error('通道没装上')
    const sent = await seam.send('来了', 'group:668')

    expect(sent.ok).toBe(false)
    expect(sent.code).toBe('outbound.flood_burst')
    expect(sent.reason).toBe('这个人刚连发了 3 条')
    expect(sent.hint).toBe(FLOOD_HINT)
    expect(socket.bodies()).toEqual([])
    seam.channel.stop()
  })

  it('换一个人说话就不挡', async () => {
    const ctx = mount()
    const socket = FakeSocket.opened.at(-1)
    if (socket === undefined) throw new Error('连接没建起来')
    for (let index = 1; index <= 3; index += 1) socket.say('668', '1001', index, `在吗 ${index}`)
    socket.say('668', '2002', 9, '我说一句')

    const seam = qqChannelOf(ctx)
    if (seam === undefined) throw new Error('通道没装上')
    const sent = await seam.send('回你', 'group:668')

    expect(sent.ok).toBe(true)
    seam.channel.stop()
  })
})
