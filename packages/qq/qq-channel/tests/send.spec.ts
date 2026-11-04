import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboundEvent } from '../src/events.ts'
import { apply, qqChannelOf, type Config } from '../src/index.ts'

type SocketHandler = (event: { data?: string }) => void

// 每次发出去都立刻回一个 echo，好让发送这条路当场结算
class FakeSocket {
  static readonly opened: FakeSocket[] = []
  // 第几次发送要回一个失败码，零表示每次都成功
  static failAt = 0
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
    const failed = FakeSocket.failAt > 0 && this.sent.length === FakeSocket.failAt
    this.emit('message', JSON.stringify({ echo, retcode: failed ? 100 : 0, data: { message_id: this.sent.length } }))
  }

  close(): void {
    this.readyState = 3
  }

  open(): void {
    this.readyState = 1
    this.emit('open')
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

// 工具体只读会话编号与取消信号，其余执行字段由内核在真实调用时注入
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  ctx: Context
  tool: (name: string) => ToolDefinition
  events: OutboundEvent[]
  logs: string[]
}

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
const OPEN_HOURS = { quietStart: '00:00', quietEnd: '00:00' }

// 真正发上线的正文，按发出的先后
function sentTexts(): string[] {
  const socket = FakeSocket.opened.at(-1)
  return (socket?.sent ?? []).map(payload => (JSON.parse(payload) as { params?: { message?: string } }).params?.message ?? '')
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
  const logs: string[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: ({ args }) => { logs.push(String(args[0])) } })
  apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', ...OPEN_HOURS, ...patch })
  FakeSocket.opened.at(-1)?.open()
  const events: OutboundEvent[] = []
  qqChannelOf(ctx)?.onOutbound(event => events.push(event))
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { ctx, tool, events, logs }
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  FakeSocket.failAt = 0
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('名单外的会话发不出去', () => {
  it('不在名单的群被拒，理由与下次时间都在提示里', async () => {
    const { tool, events } = mount({ allowGroups: ['999'] })

    await expect(tool('qq_send_message').execute({ text: '在的' }, execOf('group:123')))
      .rejects.toThrow(/outbound\.not_allowed: .+｜下一步: .+/u)
    const blocked = events.find(event => event.kind === 'blocked')
    expect(blocked?.code).toBe('outbound.not_allowed')
    expect(blocked?.retryAt).toBeGreaterThan(0)
  })

  it('不在名单的人被拒', async () => {
    const { tool } = mount({ allowPeople: ['555'] })

    await expect(tool('qq_send_message').execute({ text: '在的' }, execOf('private:666')))
      .rejects.toThrow(/outbound\.not_allowed/u)
  })

  it('名单里的群能发', async () => {
    const { tool, events } = mount({ allowGroups: ['123'] })

    const result = await tool('qq_send_message').execute({ text: '在的' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(1)
    expect(events.map(event => event.kind)).toEqual(['attempt', 'sent'])
    expect(events.at(-1)?.count).toBe(1)
  })

  it('名单空着就放行，并在启动时各打印一次提示', () => {
    const { logs } = mount()

    expect(logs.filter(line => line.includes('群白名单为空'))).toHaveLength(1)
    expect(logs.filter(line => line.includes('人白名单为空'))).toHaveLength(1)
  })

  it('名单不空时不多话', () => {
    const { logs } = mount({ allowGroups: ['123'], allowPeople: ['555'] })

    expect(logs.filter(line => line.includes('白名单为空'))).toHaveLength(0)
  })
})

describe('内容那几道闸', () => {
  it('敏感词命中就拒，且不记成已发送', async () => {
    const { tool, events } = mount({ banned: ['加群'] })

    await expect(tool('qq_send_message').execute({ text: '你也来加群吧' }, execOf('group:123')))
      .rejects.toThrow(/outbound\.banned/u)
    expect(events.some(event => event.kind === 'sent')).toBe(false)
    expect(events.at(-1)?.kind).toBe('blocked')
  })

  it('超长发不出去', async () => {
    const { tool } = mount({ maxChars: 3 })

    await expect(tool('qq_send_message').execute({ text: '一二三四' }, execOf('group:123')))
      .rejects.toThrow(/outbound\.too_long/u)
  })

  it('一分钟发满了就拒', async () => {
    const { tool } = mount({ perMinute: 1 })

    await tool('qq_send_message').execute({ text: '第一句' }, execOf('group:123'))

    await expect(tool('qq_send_message').execute({ text: '第二句' }, execOf('group:123')))
      .rejects.toThrow(/outbound\.rate/u)
  })

  it('拒绝里带着下一步与几点之后再来', async () => {
    const { tool } = mount({ banned: ['加群'] })

    const failed = tool('qq_send_message').execute({ text: '加群吗' }, execOf('group:123'))

    await expect(failed).rejects.toThrow(/下一步: .+（\d{2}:\d{2} 之后再来）/u)
  })
})

describe('按这一轮的条数上限分条发', () => {
  it('上限两条时把三段话并成两条，正文连得上', async () => {
    const { ctx, tool } = mount()
    qqChannelOf(ctx)?.useReplyCap(() => 2)

    const result = await tool('qq_send_message').execute({ text: '第一句。第二句。第三句。' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(2)
    expect(sentTexts()).toHaveLength(2)
    expect(sentTexts().join('')).toBe('第一句。第二句。第三句。')
  })

  it('条与条之间留出停顿', async () => {
    const { ctx, tool } = mount()
    qqChannelOf(ctx)?.useReplyCap(() => 2)

    const openedAt = Date.now()
    const result = await tool('qq_send_message').execute({ text: '第一句。第二句。' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(2)
    expect(Date.now() - openedAt).toBeGreaterThanOrEqual(800)
  })

  it('拿不到上限时只发一条', async () => {
    const { tool } = mount()

    const result = await tool('qq_send_message').execute({ text: '第一句。第二句。第三句。' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(1)
    expect(sentTexts()).toEqual(['第一句。第二句。第三句。'])
  })

  it('上限是一时也只发一条', async () => {
    const { ctx, tool } = mount()
    qqChannelOf(ctx)?.useReplyCap(() => 1)

    const result = await tool('qq_send_message').execute({ text: '第一句。第二句。' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(1)
    expect(sentTexts()).toHaveLength(1)
  })

  it('第二条发不出去时报已发一条卡在第二条，且不重发第一条', async () => {
    const { ctx, tool, events } = mount()
    qqChannelOf(ctx)?.useReplyCap(() => 2)
    FakeSocket.failAt = 2

    const failed = tool('qq_send_message').execute({ text: '第一句。第二句。' }, execOf('group:123'))

    await expect(failed).rejects.toThrow(/已发 1 条，卡在第 2 条/u)
    expect(sentTexts().filter(text => text === '第一句。')).toHaveLength(1)
    expect(sentTexts()).toHaveLength(2)
    expect(events.map(event => event.kind)).toEqual(['attempt', 'sent', 'blocked'])
    expect(events.find(event => event.kind === 'sent')?.count).toBe(1)
  })
})

describe('表情回应', () => {
  it('记成调过发送工具，但不占说的条数', async () => {
    const { tool, events } = mount()

    await tool('qq_send_reaction').execute({ messageId: '42', emoji: '128077' }, execOf('group:123'))

    expect(events.map(event => event.kind)).toEqual(['attempt'])
  })
})
