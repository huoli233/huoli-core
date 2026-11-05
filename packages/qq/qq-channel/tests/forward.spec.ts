import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forwardCallOf } from '../src/forward.ts'
import { apply, qqChannelOf, type Config } from '../src/index.ts'

type SocketHandler = (event: { data?: string }) => void

// 发出去就当场回一个 echo，好让发送这条路当场结算
class FakeSocket {
  static readonly opened: FakeSocket[] = []
  readyState = 1
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

// 工具体只读会话编号，其余字段由内核在真实调用时给
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  ctx: Context
  tool: (name: string) => ToolDefinition
}

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
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
  apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', quietStart: '00:00', quietEnd: '00:00', ...patch })
  FakeSocket.opened.at(-1)?.open()
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { ctx, tool }
}

/** 一条合并转发里节点长什么样，用例按这个形状判断 */
interface ForwardMessage {
  type?: string
  data?: { name?: string; content?: string }
}

/** 一次请求的样子 */
interface RawCall {
  action?: string
  params?: { messages?: ForwardMessage[] }
}

// 最后一帧的整个请求
function lastCall(): RawCall {
  const socket = FakeSocket.opened.at(-1)
  const raw = socket?.sent.at(-1) ?? '{}'
  return JSON.parse(raw) as RawCall
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('把几段装成一次合并转发', () => {
  it('群里走群那一路，私聊走私聊那一路', () => {
    const nodes = [{ name: '她', content: '第一段' }]

    expect(forwardCallOf(nodes, 'group:123', '999')?.action).toBe('send_group_forward_msg')
    expect(forwardCallOf(nodes, 'private:456', '999')?.action).toBe('send_private_forward_msg')
  })

  it('节点里带名字、发言者与正文', () => {
    const call = forwardCallOf([{ name: '小岸', content: '说了一句' }], 'group:123', '999')

    expect(call?.params.messages).toEqual([{ type: 'node', data: { name: '小岸', uin: 999, content: '说了一句' } }])
  })

  it('空白段丢掉，一段不剩就没有这一趟', () => {
    expect(forwardCallOf([{ name: '她', content: '   ' }], 'group:123', '999')).toBeUndefined()
    expect(forwardCallOf([], 'group:123', '999')).toBeUndefined()
  })

  it('留着的那几段按原顺序进节点', () => {
    const call = forwardCallOf(
      [{ name: '她', content: '一' }, { name: '她', content: '' }, { name: '她', content: '二' }],
      'group:123',
      '999',
    )

    const messages = (call?.params['messages'] ?? []) as ForwardMessage[]
    const kept = messages.map(item => item.data?.content)
    expect(kept).toEqual(['一', '二'])
  })
})

describe('多段回复走合并转发', () => {
  // 三句话配三条上限，正好切成三段
  const LONG = '先说第一件事。再说第二件事。最后说第三件事。'

  it('关着的时候仍然一条一条发', async () => {
    const { ctx, tool } = mount()
    qqChannelOf(ctx)?.useReplyCap(() => 3)

    await tool('qq_send_message').execute({ text: LONG }, execOf('group:123'))

    const socket = FakeSocket.opened.at(-1)
    const actions = (socket?.sent ?? []).map(payload => (JSON.parse(payload) as { action?: string }).action)
    expect(actions.length).toBeGreaterThan(1)
    expect(actions.every(name => name === 'send_group_msg')).toBe(true)
  })

  it('打开之后合成一条合并转发，节点里装着那几段', async () => {
    const { ctx, tool } = mount({ replyForward: true, replyForwardName: '小岸' })
    qqChannelOf(ctx)?.useReplyCap(() => 3)

    await tool('qq_send_message').execute({ text: LONG }, execOf('group:123'))

    const call = lastCall()
    expect(call.action).toBe('send_group_forward_msg')
    const messages = call.params?.messages ?? []
    expect(messages.length).toBeGreaterThan(1)
    expect(messages.every(item => item.type === 'node')).toBe(true)
    expect(messages.every(item => item.data?.name === '小岸')).toBe(true)
    expect(messages.map(item => item.data?.content ?? '').join('')).toContain('第一件事')
  })

  it('只有一段时不走合并转发', async () => {
    const { ctx, tool } = mount({ replyForward: true })
    qqChannelOf(ctx)?.useReplyCap(() => 3)

    await tool('qq_send_message').execute({ text: '就说一句' }, execOf('group:123'))

    expect(lastCall().action).toBe('send_group_msg')
  })

  it('私聊走私聊那一路', async () => {
    const { ctx, tool } = mount({ replyForward: true, allowPeople: ['666'] })
    qqChannelOf(ctx)?.useReplyCap(() => 3)

    await tool('qq_send_message').execute({ text: LONG }, execOf('private:666'))

    expect(lastCall().action).toBe('send_private_forward_msg')
  })
})
