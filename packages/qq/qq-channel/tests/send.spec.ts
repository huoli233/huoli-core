import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

  deliver(raw: Record<string, unknown>): void {
    this.emit('message', JSON.stringify(raw))
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

// 工具体只读会话编号与取消信号，其余字段由内核在真实调用时给
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  ctx: Context
  tool: (name: string) => ToolDefinition
  hasTool: (name: string) => boolean
  events: OutboundEvent[]
  logs: string[]
}

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
const OPEN_HOURS = { quietStart: '00:00', quietEnd: '00:00' }
const NIGHT = new Date(2026, 2, 5, 3, 0, 0, 0)
const tempDirs: string[] = []

// 真正发上线的正文，按发出的先后
function sentTexts(): string[] {
  const socket = FakeSocket.opened.at(-1)
  return (socket?.sent ?? []).map(payload => (JSON.parse(payload) as { params?: { message?: string } }).params?.message ?? '')
}

function mount(patch: Partial<Config> = {}): Mounted {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-channel-send-'))
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
  const logs: string[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: ({ args }) => { logs.push(String(args[0])) } })
  apply(ctx, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    sentLedgerFile: path.join(dir, 'sent.json'),
    ...OPEN_HOURS,
    ...patch,
  })
  FakeSocket.opened.at(-1)?.open()
  const events: OutboundEvent[] = []
  qqChannelOf(ctx)?.onOutbound(event => events.push(event))
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { ctx, tool, hasTool: name => tools.has(name), events, logs }
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  FakeSocket.failAt = 0
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
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
    expect(events.at(-1)?.firstSentAt).toEqual(expect.any(Number))
    expect(events.at(-1)?.firstSentAt).toBeLessThanOrEqual(events.at(-1)?.at ?? 0)
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

describe('模型自己选择合并转发', () => {
  it('几段短话合成一张卡，发言者仍是机器人自己', async () => {
    const { tool } = mount({ forwardToolEnabled: true, replyForwardName: '小鲸鱼' })

    const result = await tool('qq_send_forward').execute({
      lines: ['第一句。', '第二句？？', '只有旁白会被丢掉（笑）'],
      mind: { move: 'reply', reason: '这几句适合放在一张记录卡里' },
    }, execOf('group:123')) as { parts: number; messageId: string }

    const payload = JSON.parse(FakeSocket.opened.at(-1)?.sent.at(-1) ?? '{}') as {
      action?: string
      params?: { messages?: Array<{ data?: { name?: string; uin?: number; content?: string } }> }
    }
    expect(result.parts).toBe(3)
    expect(payload.action).toBe('send_group_forward_msg')
    // 卡片里的每段与单条发送同一个收口：逗号句号去掉，问号保留
    expect(payload.params?.messages?.map(item => item.data?.content)).toEqual(['第一句。', '第二句？？', '只有旁白会被丢掉（笑）'])
    expect(payload.params?.messages?.every(item => item.data?.name === '小鲸鱼' && item.data.uin === 999)).toBe(true)
  })

  it('开关关掉时不挂这个工具，普通回复仍照常', () => {
    const { hasTool } = mount({ forwardToolEnabled: false })

    expect(hasTool('qq_send_forward')).toBe(false)
    expect(hasTool('qq_send_message')).toBe(true)
  })
})

describe('正文和内心分开', () => {
  it('发送工具带本轮想法，但只把正文送出去', async () => {
    const { tool } = mount()

    await tool('qq_send_message').execute({
      text: '（先停一下）\n我没不理你。',
      mind: {
        reason: '对方在等我回话',
        focus: '那句不理人',
        tone: '有点别扭',
        inner: '其实想解释清楚',
        next: '下次先把话说完整',
      },
    }, execOf('private:666'))

    expect(sentTexts()).toEqual(['我没不理你。'])
    const fields = (tool('qq_send_message').parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(fields)).toContain('mind')
    expect(JSON.stringify(fields.mind).length).toBeLessThan(1200)
    expect(tool('qq_send_message').description).toContain('必须继续调用读取或查看工具')
  })

  it('正文只有括号旁白时拒发', async () => {
    const { tool } = mount()

    await expect(tool('qq_send_message').execute({ text: '（不理。）' }, execOf('private:666')))
      .rejects.toThrow(/channel\.inner_only/u)
    expect(sentTexts()).toEqual([])
  })

  it('好友私聊只写单字时拒发，让同一轮补具体反应', async () => {
    const { tool } = mount()

    await expect(tool('qq_send_message').execute({ text: '嗯' }, execOf('private:666')))
      .rejects.toThrow(/channel\.empty_reply/u)
    expect(sentTexts()).toEqual([])
  })

  it('一串标点不算一句话，单个标点是模型选的语气', async () => {
    const { tool } = mount()

    await expect(tool('qq_send_message').execute({ text: '？？？' }, execOf('group:123')))
      .rejects.toThrow(/channel\.inner_only/u)
    const result = await tool('qq_send_message').execute({ text: '？' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(1)
    expect(sentTexts()).toEqual(['？'])
  })

  it('群里只回一个应声仍是正常聊天', async () => {
    const { tool } = mount()

    const result = await tool('qq_send_message').execute({ text: '嗯' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(1)
    expect(sentTexts()).toEqual(['嗯'])
  })

  it('普通文本兜底写进好友私聊时也拦下单字', async () => {
    const { ctx } = mount()

    const result = await qqChannelOf(ctx)?.send('嗯', 'private:666', true)

    expect(result).toMatchObject({ ok: false, code: 'channel.empty_reply' })
    expect(sentTexts()).toEqual([])
  })

  it('群里能明确决定先不说，并留下这轮想法', async () => {
    const { tool } = mount()

    const result = await tool('qq_stay_quiet').execute({
      mind: {
        reason: '他们正在聊自己的事',
        focus: '没有需要我接的话',
        tone: '安静听着',
        inner: '这会儿插进去反而打断他们',
        next: '等有人问起再看',
      },
    }, execOf('group:123'))

    expect(result).toMatchObject({ ok: true, quiet: true })
    expect(sentTexts()).toEqual([])
  })

  it('好友私聊不能拿先不说躲开回话', async () => {
    const { tool } = mount()

    await expect(tool('qq_stay_quiet').execute({
      mind: { reason: '不想回', inner: '先放着' },
    }, execOf('private:666'))).rejects.toThrow(/quiet\.private_needs_reply/u)
  })
})

describe('夜间回复与主动出站分开判定', () => {
  it('静默时段允许回复用户，但仍拒绝普通出站消息', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NIGHT)
    try {
      const { ctx, tool } = mount({ quietStart: '23:30', quietEnd: '07:30' })
      qqChannelOf(ctx)?.useReplyContext(chatKey => chatKey === 'group:123')

      const result = await tool('qq_send_message').execute({ text: '收到' }, execOf('group:123')) as { parts: number }
      const proactive = await qqChannelOf(ctx)?.send('主动消息', 'group:123')

      expect(result.parts).toBe(1)
      expect(proactive).toMatchObject({ ok: false, code: 'outbound.quiet' })
      expect(sentTexts()).toEqual(['收到'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('没有入站回复上下文时不绕过静默时段', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NIGHT)
    try {
      const { tool } = mount({ quietStart: '23:30', quietEnd: '07:30' })

      await expect(tool('qq_send_message').execute({ text: '主动消息' }, execOf('group:123')))
        .rejects.toThrow(/outbound\.quiet/u)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('好友私聊回复与公共频控拆开', () => {
  it('一分钟额度发满后仍能回复下一条好友私聊', async () => {
    const { ctx, tool } = mount({ perMinute: 1 })
    qqChannelOf(ctx)?.useReplyContext(chatKey => chatKey === 'private:666')

    await tool('qq_send_message').execute({ text: '第一句' }, execOf('private:666'))
    const second = await tool('qq_send_message').execute({ text: '第二句' }, execOf('private:666')) as { parts: number }

    expect(second.parts).toBe(1)
    expect(sentTexts()).toEqual(['第一句', '第二句'])
  })
})

describe('群聊点名', () => {
  it('按成员编号发出真正的艾特消息段', async () => {
    const { tool } = mount({ allowGroups: ['123'] })

    const result = await tool('qq_mention').execute({
      user_id: '555',
      text: '（认真）你来一下',
      mind: { reason: '需要叫清是谁', focus: '让他过来', tone: '直接' },
    }, execOf('group:123')) as { ok: boolean; userId: string }
    const socket = FakeSocket.opened.at(-1)
    if (socket === undefined) throw new Error('通道没有启动')
    const payload = JSON.parse(socket.sent.at(-1) ?? '{}') as { params?: { message?: unknown } }

    expect(result).toMatchObject({ ok: true, userId: '555' })
    expect(payload.params?.message).toEqual([
      { type: 'at', data: { qq: '555' } },
      { type: 'text', data: { text: '你来一下' } },
    ])
  })

  it('好友私聊不能用点名工具', async () => {
    const { tool } = mount()

    await expect(tool('qq_mention').execute({ user_id: '555', text: '你来一下' }, execOf('private:666')))
      .rejects.toThrow(/mention\.private/u)
    await expect(tool('qq_reply').execute({ message_id: '88', mention_user_id: '555', text: '你来一下' }, execOf('private:666')))
      .rejects.toThrow(/reply\.private_mention/u)
    expect(sentTexts()).toEqual([])
  })

  it('引用回复可以顺带点名，三段一起发', async () => {
    const { tool } = mount({ allowGroups: ['123'] })

    await tool('qq_reply').execute({
      message_id: '88',
      mention_user_id: '555',
      text: '这里接你上面那句',
    }, execOf('group:123'))
    const socket = FakeSocket.opened.at(-1)
    if (socket === undefined) throw new Error('通道没有启动')
    const payload = JSON.parse(socket.sent.at(-1) ?? '{}') as { params?: { message?: unknown } }

    expect(payload.params?.message).toEqual([
      { type: 'reply', data: { id: '88' } },
      { type: 'at', data: { qq: '555' } },
      { type: 'text', data: { text: '这里接你上面那句' } },
    ])
  })
})

describe('全局急停', () => {
  it('打开后所有发送工具都被底层拦住', async () => {
    const { ctx, tool } = mount()
    qqChannelOf(ctx)?.useEmergencyStop(() => '人工急停')

    await expect(tool('qq_send_message').execute({ text: '收到' }, execOf('group:123')))
      .rejects.toThrow(/channel\.emergency_stop/u)
    expect(sentTexts()).toEqual([])
  })

  it('解除后可以继续发送', async () => {
    const { ctx, tool } = mount()
    const channel = qqChannelOf(ctx)
    channel?.useEmergencyStop(() => '人工急停')
    channel?.useEmergencyStop(undefined)

    const result = await tool('qq_send_message').execute({ text: '恢复' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(1)
    expect(sentTexts()).toEqual(['恢复'])
  })
})

describe('收到引用消息', () => {
  it('真实发送后的引用能认出，读取消息返回的编号不算自己发过', async () => {
    const { ctx } = mount()
    const channel = qqChannelOf(ctx)
    const socket = FakeSocket.opened.at(-1)
    if (channel === undefined || socket === undefined) throw new Error('通道没有启动')
    const received: boolean[] = []
    channel.onIncoming(message => received.push(message.replyToBot))

    await channel.channel.send('你好', 'group:123')
    await channel.channel.ask('get_msg', { message_id: 2 })
    const message = (id: number) => ({
      post_type: 'message',
      message_type: 'group',
      group_id: 123,
      user_id: 555,
      message_id: 10 + id,
      message: [{ type: 'reply', data: { id } }, { type: 'text', data: { text: '收到' } }],
    })
    socket.deliver(message(1))
    socket.deliver(message(2))

    expect(received).toEqual([true, false])
  })

  it('合并转发发送成功后的编号也能识别', async () => {
    const { ctx } = mount()
    const channel = qqChannelOf(ctx)
    const socket = FakeSocket.opened.at(-1)
    if (channel === undefined || socket === undefined) throw new Error('通道没有启动')
    const received: boolean[] = []
    channel.onIncoming(message => received.push(message.replyToBot))

    await channel.channel.sendForward([{ name: '自己', content: '第一段' }], 'group:123')
    socket.deliver({
      post_type: 'message',
      message_type: 'group',
      group_id: 123,
      user_id: 555,
      message_id: 12,
      message: [{ type: 'reply', data: { id: 1 } }, { type: 'text', data: { text: '收到' } }],
    })

    expect(received).toEqual([true])
  })

  it('重连后仍能认出引用自己重启前发过的消息', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-channel-ledger-'))
    tempDirs.push(dir)
    const ledger = path.join(dir, 'shared-sent.json')
    const first = mount({ sentLedgerFile: ledger })
    const firstChannel = qqChannelOf(first.ctx)
    if (firstChannel === undefined) throw new Error('第一次通道没有启动')
    await firstChannel.channel.send('重启前那句', 'group:123')

    const second = mount({ sentLedgerFile: ledger })
    const secondChannel = qqChannelOf(second.ctx)
    const socket = FakeSocket.opened.at(-1)
    if (secondChannel === undefined || socket === undefined) throw new Error('第二次通道没有启动')
    const received: boolean[] = []
    secondChannel.onIncoming(message => received.push(message.replyToBot))

    socket.deliver({
      post_type: 'message',
      message_type: 'group',
      group_id: 123,
      user_id: 555,
      message_id: 21,
      message: [{ type: 'reply', data: { id: 1 } }, { type: 'text', data: { text: '接着刚才说' } }],
    })

    expect(received).toEqual([true])
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

  it('机器人被禁言时发送前就拒绝，解除后恢复', async () => {
    const { ctx, tool } = mount()
    const socket = FakeSocket.opened.at(-1)
    if (socket === undefined) throw new Error('没接上连接')
    socket.deliver({
      post_type: 'notice',
      notice_type: 'group_ban',
      sub_type: 'ban',
      group_id: 1,
      user_id: 999,
      duration: 60,
    })

    expect(qqChannelOf(ctx)?.mute('group:1')).toMatchObject({ muted: true })
    await expect(tool('qq_send_message').execute({ text: '在的' }, execOf('group:1')))
      .rejects.toThrow(/outbound\.muted/u)

    socket.deliver({
      post_type: 'notice',
      notice_type: 'group_ban',
      sub_type: 'lift_ban',
      group_id: 1,
      user_id: 999,
    })
    expect(qqChannelOf(ctx)?.mute('group:1')).toBeUndefined()
    const sent = await tool('qq_send_message').execute({ text: '在的' }, execOf('group:1')) as {
      messageIds?: readonly string[]
    }
    expect(Array.isArray(sent.messageIds)).toBe(true)
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
  it('配置要求聊天口吻时先分段，再收掉逗号句号并保留问号', async () => {
    const { ctx, tool } = mount({
      replySingleMessage: false,
      replyPartMaxChars: 90,
      replyStripWrittenPunctuation: true,
    })
    qqChannelOf(ctx)?.useReplyCap(() => 4)

    await tool('qq_send_message').execute({
      text: '今天这件事我先说第一句，第二句还是要讲清楚，第三句最后再问你要不要听？',
    }, execOf('group:123'))

    const texts = sentTexts().filter(text => text !== '')
    expect(texts.length).toBeGreaterThan(1)
    expect(texts.join('')).not.toMatch(/[，。]/u)
    expect(texts.at(-1)).toContain('？')
  })

  it('配置优先一条时，几个短句仍合成一条发', async () => {
    const { ctx, tool } = mount({ replySingleMessage: true, replyPartMaxChars: 300 })
    qqChannelOf(ctx)?.useReplyCap(() => 4)

    const result = await tool('qq_send_message').execute({
      text: '第一句。第二句。第三句。',
    }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(1)
    expect(sentTexts()).toEqual(['第一句。第二句。第三句。'])
  })

  it('长回复按聊天级短段拆开，不塞成一整条', async () => {
    const { ctx, tool } = mount({ replyPartMaxChars: 20 })
    qqChannelOf(ctx)?.useReplyCap(() => 4)

    await tool('qq_send_message').execute({
      text: '今天这件事我先说结论。中间还有一点需要解释。最后再补一句我自己的看法。',
    }, execOf('group:123'))

    const texts = sentTexts().filter(text => text !== '')
    expect(texts.length).toBeGreaterThan(1)
    for (const text of texts) expect(text.length).toBeLessThanOrEqual(20)
  })

  it('几个短句按分句拆成短气泡', async () => {
    const { ctx, tool } = mount()
    qqChannelOf(ctx)?.useReplyCap(() => 2)

    const result = await tool('qq_send_message').execute({ text: '第一句。第二句。第三句。' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(2)
    expect(sentTexts().length).toBe(2)
  })

  it('短句分段时长停顿仍受配置上限夹住', async () => {
    const { ctx, tool } = mount()
    qqChannelOf(ctx)?.useReplyCap(() => 2)

    const openedAt = Date.now()
    const result = await tool('qq_send_message').execute({ text: '第一句。第二句。' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(2)
    expect(Date.now() - openedAt).toBeLessThan(3000)
  })

  it('拿不到上限时只发一条', async () => {
    const { tool } = mount()

    const result = await tool('qq_send_message').execute({ text: '第一句。第二句。第三句。' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(1)
    expect(sentTexts()).toEqual(['第一句。第二句。第三句。'])
  })

  it('模型在正文里换行就发成几个气泡，问号感叹号保留语气', async () => {
    const { ctx, tool, events } = mount({ replySingleMessage: true, replyPartMaxChars: 300 })
    qqChannelOf(ctx)?.useReplyCap(() => 4)

    const result = await tool('qq_send_message').execute({
      text: '第一句。\n第二句？\n第三句',
    }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(3)
    expect(sentTexts()).toEqual(['第一句。', '第二句？', '第三句'])
    const sent = events.find(event => event.kind === 'sent')
    expect(sent?.firstSentAt).toEqual(expect.any(Number))
    expect(sent?.firstSentAt).toBeLessThanOrEqual(sent?.at ?? 0)
  })

  it('上限是一时也只发一条', async () => {
    const { ctx, tool } = mount()
    qqChannelOf(ctx)?.useReplyCap(() => 1)

    const result = await tool('qq_send_message').execute({ text: '第一句。第二句。' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(1)
    expect(sentTexts()).toHaveLength(1)
  })

  it('长话里中文之间的空格当成几个气泡发，段里不再留空格', async () => {
    const { ctx, tool } = mount()
    qqChannelOf(ctx)?.useReplyCap(() => 3)

    const result = await tool('qq_send_message').execute({
      text: '两亿年没改过设计 咬合力逆天 张嘴却没劲 全靠省电活着',
    }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBeGreaterThan(1)
    const texts = sentTexts().filter(text => text !== '')
    for (const text of texts) expect(text).not.toMatch(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/u)
  })

  it('短话里的中文空格也能分成两个气泡', async () => {
    const { ctx, tool } = mount()
    qqChannelOf(ctx)?.useReplyCap(() => 3)

    const result = await tool('qq_send_message').execute({ text: '凑肥鱼 你是手抖还是嘴瓢' }, execOf('group:123')) as { parts: number }

    expect(result.parts).toBe(2)
    expect(sentTexts()).toEqual(['凑肥鱼', '你是手抖还是嘴瓢'])
  })

  it('第二条发不出去时报已发一条卡在第二条，且不重发第一条', async () => {
    const { ctx, tool, events } = mount({ replyPartMaxChars: 20 })
    qqChannelOf(ctx)?.useReplyCap(() => 2)
    FakeSocket.failAt = 2

    const failed = tool('qq_send_message').execute({
      text: '这是一句需要分开的较长内容这是一句需要分开的较长内容',
    }, execOf('group:123'))

    await expect(failed).rejects.toThrow(/已发 1 条，卡在第 2 条/u)
    expect(sentTexts()).toHaveLength(2)
    expect(events.map(event => event.kind)).toEqual(['attempt', 'sent', 'blocked'])
    expect(events[1]?.firstSentAt).toEqual(expect.any(Number))
    expect(events[1]?.firstSentAt).toBeLessThanOrEqual(events[1]?.at ?? 0)
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

// 通道自己不留档，发不出去时日志是唯一线索
describe('发不出去要留一行日志', () => {
  it('连接不在时记下是哪一次动作', async () => {
    const { tool, logs } = mount()
    const socket = FakeSocket.opened.at(-1)
    if (socket !== undefined) socket.readyState = 3

    await expect(tool('qq_send_message').execute({ text: '在的' }, execOf('group:123')))
      .rejects.toThrow(/卡在第 1 条：还没连上/u)
    expect(logs.filter(line => line.includes('发不出去：连接不在时收到 send_group_msg'))).toHaveLength(1)
  })

  it('对方回非零码时记下码与原文', async () => {
    const { tool, logs } = mount()
    FakeSocket.failAt = 1

    await expect(tool('qq_send_message').execute({ text: '在的' }, execOf('group:123')))
      .rejects.toThrow(/卡在第 1 条/u)
    expect(logs.filter(line => line.startsWith('发不出去：对方回 100'))).toHaveLength(1)
  })
})
