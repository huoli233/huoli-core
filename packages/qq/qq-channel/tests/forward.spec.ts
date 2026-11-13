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
  data?: { name?: string; content?: string; uin?: number; id?: string }
}

/** 一次请求的样子 */
interface RawCall {
  action?: string
  params?: { messages?: ForwardMessage[] }
}

// 一次请求里各段的正文
function contentsOf(call: ReturnType<typeof forwardCallOf>): string[] {
  const messages = (call?.params['messages'] ?? []) as ForwardMessage[]
  return messages.map(item => item.data?.content ?? '')
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

  it('引用已有消息时节点只带编号，不改写成自己的话', () => {
    const call = forwardCallOf([
      { messageId: '-12345', name: '她', content: '' },
      { messageId: '-67890', name: '她', content: '' },
    ], 'group:123', '999')

    expect(call?.params.messages).toEqual([
      { type: 'node', data: { id: '-12345' } },
      { type: 'node', data: { id: '-67890' } },
    ])
  })

  it('引用节点与自写正文可以混在一张卡里', () => {
    const call = forwardCallOf([
      { messageId: '-12345', name: '她', content: '' },
      { name: '她', content: '这是我自己补的一句。' },
    ], 'group:123', '999')

    const messages = (call?.params.messages ?? []) as ForwardMessage[]
    expect(messages[0]?.data).toEqual({ id: '-12345' })
    expect(messages[1]?.data).toMatchObject({ uin: 999, content: '这是我自己补的一句。' })
  })
})

describe('卡片里的正文与单条发送同一个收口', () => {
  it('每段先去掉逗号句号', () => {
    const call = forwardCallOf([{ name: '她', content: '先说第一件事，再说第二件事。' }], 'group:123', '999')

    expect(contentsOf(call)).toEqual(['先说第一件事，再说第二件事。'])
  })

  it('markdown 链接只留文字，裸地址不留在卡片里', () => {
    const call = forwardCallOf(
      [
        { name: '她', content: '天气看[wttr.in](https://wttr.in/Hong+Kong)' },
        { name: '她', content: '这个地址 https://example.com/a 你翻翻' },
      ],
      'group:123',
      '999',
    )

    expect(contentsOf(call)).toEqual(['天气看wttr.in', '这个地址你翻翻'])
    expect(contentsOf(call).join('')).not.toContain('http')
  })

  it('收口后什么都不剩的段不进卡片', () => {
    const call = forwardCallOf(
      [{ name: '她', content: 'https://example.com/only' }, { name: '她', content: '第二段，带标点。' }],
      'group:123',
      '999',
    )

    expect(contentsOf(call)).toEqual(['第二段，带标点。'])
  })

  it('问号感叹号是语气，收口不删', () => {
    const call = forwardCallOf([{ name: '她', content: '真的吗？太好了！' }], 'group:123', '999')

    expect(contentsOf(call)).toEqual(['真的吗？太好了！'])
  })
})

describe('多段回复走合并转发', () => {
  // 三句话配三条上限，正好切成三段
  const LONG = '先说第一件事。再说第二件事。最后说第三件事。'

  it('关着的时候仍然一条一条发', async () => {
    const { ctx, tool } = mount({ replySingleMessage: false })
    qqChannelOf(ctx)?.useReplyCap(() => 3)

    await tool('qq_send_message').execute({ text: LONG }, execOf('group:123'))

    const socket = FakeSocket.opened.at(-1)
    const actions = (socket?.sent ?? []).map(payload => (JSON.parse(payload) as { action?: string }).action)
    expect(actions.length).toBeGreaterThan(1)
    expect(actions.every(name => name === 'send_group_msg')).toBe(true)
  })

  it('打开之后合成一条合并转发，节点里装着那几段', async () => {
    const { ctx, tool } = mount({ replySingleMessage: false, replyForward: true, replyForwardName: '小岸' })
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
    const { ctx, tool } = mount({ replySingleMessage: false, replyForward: true })
    qqChannelOf(ctx)?.useReplyCap(() => 3)

    await tool('qq_send_message').execute({ text: '就说一句' }, execOf('group:123'))

    expect(lastCall().action).toBe('send_group_msg')
  })

  it('私聊走私聊那一路', async () => {
    const { ctx, tool } = mount({ replySingleMessage: false, replyForward: true, allowPeople: ['666'] })
    qqChannelOf(ctx)?.useReplyCap(() => 3)

    await tool('qq_send_message').execute({ text: LONG }, execOf('private:666'))

    expect(lastCall().action).toBe('send_private_forward_msg')
  })

  it('自动合并的卡片保留正常句号并去掉链接，段还是先按原文切好', async () => {
    const { ctx, tool } = mount({ replySingleMessage: false, replyForward: true, replyForwardName: '小岸' })
    qqChannelOf(ctx)?.useReplyCap(() => 3)

    await tool('qq_send_message').execute(
      { text: '先说第一件事。再看[wttr.in](https://wttr.in/Hong+Kong)。最后说第三件事。' },
      execOf('group:123'),
    )

    const call = lastCall()
    expect(call.action).toBe('send_group_forward_msg')
    const messages = call.params?.messages ?? []
    const contents = messages.map(item => item.data?.content ?? '')
    // 收口放在切段之后：先收口会把句子并回去，就只剩一段、走不成卡片
    expect(contents.length).toBeGreaterThan(1)
    expect(contents.join('')).not.toMatch(/[，,；;：:]/u)
    expect(contents.join('')).not.toContain('http')
    expect(messages.every(item => item.data?.name === '小岸')).toBe(true)
    expect(messages.every(item => item.data?.uin === 999)).toBe(true)
  })

  it('qq_send_forward 的每一段同样收口', async () => {
    const { tool } = mount()

    await tool('qq_send_forward').execute(
      { lines: ['先说第一句，再说第二句。', '看这个 https://example.com/a'] },
      execOf('group:123'),
    )

    const call = lastCall()
    expect(call.action).toBe('send_group_forward_msg')
    const messages = call.params?.messages ?? []
    expect(messages.map(item => item.data?.content)).toEqual(['先说第一句，再说第二句。', '看这个'])
    expect(messages.every(item => item.data?.name === '她')).toBe(true)
    expect(messages.every(item => item.data?.uin === 999)).toBe(true)
  })
})

describe('把别人的消息原样转出去', () => {
  it('给编号就按引用节点发，不改写成自己的话', async () => {
    const { tool } = mount()

    const result = await tool('qq_forward_message').execute(
      { message_ids: ['-12345', '-67890'] },
      execOf('group:123'),
    ) as { parts: number }

    expect(result.parts).toBe(2)
    const call = lastCall()
    expect(call.action).toBe('send_group_forward_msg')
    expect(call.params?.messages).toEqual([
      { type: 'node', data: { id: '-12345' } },
      { type: 'node', data: { id: '-67890' } },
    ])
  })

  it('没给编号就明确拒绝，不假装转成功', async () => {
    const { tool } = mount()

    await expect(tool('qq_forward_message').execute({ message_ids: [] }, execOf('group:123')))
      .rejects.toThrow(/forward\.no_id/u)
  })

  it('编号里的空白与空串被清掉，有序不重复', async () => {
    const { tool } = mount()

    await tool('qq_forward_message').execute(
      { message_ids: ['  -1  ', '', '   ', '-2'] },
      execOf('group:123'),
    )

    const messages = lastCall().params?.messages ?? []
    expect(messages.map(item => item.data?.id)).toEqual(['-1', '-2'])
  })

  it('私聊里转发走私聊那一路', async () => {
    const { tool } = mount({ allowPeople: ['666'] })

    await tool('qq_forward_message').execute({ message_ids: ['-1'] }, execOf('private:666'))

    expect(lastCall().action).toBe('send_private_forward_msg')
  })
})
