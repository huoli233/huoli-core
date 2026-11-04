import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboundEvent } from '../src/events.ts'
import { apply, qqChannelOf, type Config } from '../src/index.ts'

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

describe('表情回应', () => {
  it('记成调过发送工具，但不占说的条数', async () => {
    const { tool, events } = mount()

    await tool('qq_send_reaction').execute({ messageId: '42', emoji: '128077' }, execOf('group:123'))

    expect(events.map(event => event.kind)).toEqual(['attempt'])
  })
})
