import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import type { WsChannel } from '../src/ws.ts'
import { readForward, readHistory, readMembers, readMessage, textOf } from '../src/read.ts'
import { apply, qqChannelOf } from '../src/index.ts'

// 一个只回固定数据的假连接，问什么就答什么
function fake(reply: { ok: true; data: Record<string, unknown> } | { ok: false; code: string; reason: string; hint: string }): WsChannel {
  const channel = {
    ask: async () => reply,
  } as unknown as WsChannel
  return channel
}

const RAW_LINE = {
  message_id: 12345,
  user_id: 678,
  sender: { user_id: 678, nickname: '小鱼', card: '小鲸鱼' },
  time: 1_700_000_000,
  message: [{ type: 'text', data: { text: '今天有点累' } }, { type: 'image', data: { file: '一大串地址' } }],
}

// 一条会照着请求回数据的假连接
class ReadingSocket {
  static readonly opened: ReadingSocket[] = []
  readyState = 0
  private readonly handlers = new Map<string, ((event: { data?: string }) => void)[]>()

  constructor() {
    ReadingSocket.opened.push(this)
  }

  addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(payload: string): void {
    const sent = JSON.parse(payload) as { echo?: string; action?: string }
    const echo = sent.echo ?? ''
    const data = sent.action === 'get_group_msg_history'
      ? { messages: [RAW_LINE] }
      : sent.action === 'get_group_member_list'
        ? { members: [{ user_id: 678, card: '小鲸鱼', role: 'admin' }] }
        : RAW_LINE
    this.emit('message', JSON.stringify({ echo, retcode: 0, data }))
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

function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

describe('工具真的挂上了', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    ReadingSocket.opened.length = 0
  })

  it('三个读工具都在，问群记录能拿到整理过的条目', async () => {
    vi.stubGlobal('WebSocket', ReadingSocket)
    const ctx = new Context()
    const tools = new Map<string, ToolDefinition>()
    ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
    ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
    apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999' })
    ReadingSocket.opened.at(-1)?.open()

    expect([...tools.keys()]).toEqual(expect.arrayContaining(['qq_read_history', 'qq_read_members', 'qq_read_message', 'qq_read_forward']))
    const history = tools.get('qq_read_history')
    if (history === undefined) throw new Error('没挂上翻记录的工具')
    const result = await history.execute({ count: 5 }, execOf('group:750677335')) as { count: number; items: { messageId: string }[] }
    expect(result.count).toBe(1)
    expect(result.items[0]?.messageId).toBe('12345')
  })

  it('上线补回的群历史进入同一个入站出口', async () => {
    vi.stubGlobal('WebSocket', ReadingSocket)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-group-history-'))
    const ctx = new Context()
    ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
    ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
    apply(ctx, {
      url: 'ws://127.0.0.1:6700',
      selfId: '999',
      groupHistoryPollMs: 60_000,
      groupHistoryGroups: ['123'],
      groupHistoryMaxAgeMs: Number.MAX_SAFE_INTEGER,
      groupHistoryReplay: true,
      groupHistoryStatusFile: path.join(dir, 'history.jsonl'),
    })
    const seam = qqChannelOf(ctx)
    if (seam === undefined) throw new Error('通道没装上')
    const received: string[] = []
    seam.onIncoming(message => received.push(`${message.chatKey}:${message.history}`))
    ReadingSocket.opened.at(-1)?.open()

    await vi.waitFor(() => {
      expect(received).toEqual(['group:123:group'])
    })
    await ctx.fiber.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('把消息段收成一句话', () => {
  it('文字接起来，图片只留个记号', () => {
    expect(textOf(RAW_LINE.message)).toBe('今天有点累[image]')
  })

  it('整段文字就原样给', () => {
    expect(textOf('一句现成的话')).toBe('一句现成的话')
  })

  it('认不出来的不给东西', () => {
    expect(textOf(null)).toBe('')
    expect(textOf({})).toBe('')
  })
})

describe('翻群记录', () => {
  it('把回来的那几条从旧到新给出来，编号与人名都在', async () => {
    const channel = fake({ ok: true, data: { messages: [RAW_LINE] } })

    const outcome = await readHistory(channel, 'group:750677335', 10)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !('items' in outcome)) return
    expect(outcome.items).toHaveLength(1)
    expect(outcome.items[0]?.messageId).toBe('12345')
    expect(outcome.items[0]?.senderName).toBe('小鲸鱼')
    expect(outcome.items[0]?.text).toBe('今天有点累[image]')
  })

  it('要得再多也不超过三十条', async () => {
    const many = Array.from({ length: 50 }, (_unused, at) => ({ ...RAW_LINE, message_id: at + 1 }))
    const channel = fake({ ok: true, data: { messages: many } })

    const outcome = await readHistory(channel, 'group:1', 1000)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !('items' in outcome)) return
    expect(outcome.items).toHaveLength(30)
  })

  it('私聊不翻', async () => {
    const outcome = await readHistory(fake({ ok: true, data: {} }), 'private:3138039548', 10)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('channel.read_private')
    expect(outcome.hint).toBeTruthy()
  })

  it('对方不给数据就给空表，不抛', async () => {
    const outcome = await readHistory(fake({ ok: true, data: {} }), 'group:1', 10)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !('items' in outcome)) return
    expect(outcome.items).toEqual([])
  })

  it('问失败时把码与提示原样带回来', async () => {
    const outcome = await readHistory(fake({ ok: false, code: 'channel.timeout', reason: '等回话超时', hint: '等一下再问' }), 'group:1', 10)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('channel.timeout')
    expect(outcome.hint).toBe('等一下再问')
  })
})

describe('列群成员', () => {
  it('只给编号、名字与身份，最多两百个', async () => {
    const list = Array.from({ length: 260 }, (_unused, at) => ({ user_id: at + 1, nickname: `第${at + 1}个`, role: 'member' }))
    const channel = fake({ ok: true, data: { members: list } })

    const outcome = await readMembers(channel, 'group:1', 1000)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !('members' in outcome)) return
    expect(outcome.members).toHaveLength(200)
    expect(outcome.members[0]).toEqual({ userId: '1', name: '第1个', role: 'member' })
  })

  it('回来的直接是数组也认', async () => {
    const channel = fake({ ok: true, data: {} })
    const direct = { ...channel, ask: async () => ({ ok: true, data: [{ user_id: 9, card: '群名片', role: 'admin' }] }) } as unknown as WsChannel

    const outcome = await readMembers(direct, 'group:1', 50)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !('members' in outcome)) return
    expect(outcome.members[0]?.name).toBe('群名片')
  })

  it('私聊不列成员', async () => {
    const outcome = await readMembers(fake({ ok: true, data: {} }), 'private:1', 10)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('channel.read_private')
  })
})

describe('看具体那一条', () => {
  it('按编号拿到那一条', async () => {
    const channel = fake({ ok: true, data: RAW_LINE })

    const outcome = await readMessage(channel, '12345')

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !('message' in outcome)) return
    expect(outcome.message.messageId).toBe('12345')
    expect(outcome.message.text).toBe('今天有点累[image]')
  })

  it('编号不是数字就拒', async () => {
    const outcome = await readMessage(fake({ ok: true, data: {} }), '随便一个')

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('channel.read_bad_id')
    expect(outcome.hint).toBeTruthy()
  })

  it('回来的东西没有编号就算没读到', async () => {
    const outcome = await readMessage(fake({ ok: true, data: { text: '只有一句话' } }), '12345')

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('channel.read_empty')
  })
})

describe('读合并转发', () => {
  it('按原顺序给出名字、时间和正文', async () => {
    const channel = fake({
      ok: true,
      data: {
        messages: [
          { message_id: 1, sender: { nickname: '甲' }, time: 1_700_000_000, content: [{ type: 'text', data: { text: '第一句' } }] },
          { message_id: 2, sender: { nickname: '乙' }, time: 1_700_000_001, content: [{ type: 'text', data: { text: '第二句' } }] },
        ],
      },
    })

    const outcome = await readForward(channel, 'forward-1')

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !('items' in outcome)) return
    expect(outcome.items.map(item => item.senderName)).toEqual(['甲', '乙'])
    expect(outcome.text).toContain('不是当前用户自述')
    expect(outcome.text).toContain('第一句')
  })

  it('嵌套转发受读取次数限制，截断会明说', async () => {
    let calls = 0
    const channel = {
      ask: async () => {
        calls += 1
        return {
          ok: true as const,
          data: {
            messages: [{
              sender: { nickname: '甲' },
              content: [{ type: 'forward', data: { id: `next-${calls}` } }],
            }],
          },
        }
      },
    } as unknown as WsChannel

    const outcome = await readForward(channel, 'root', { maxFetches: 2, maxDepth: 2 })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !('items' in outcome)) return
    expect(calls).toBe(2)
    expect(outcome.truncated).toBe(true)
    expect(outcome.text).toContain('已按读取上限截断')
  })

  it('第一条就超长时保留能放下的部分，不报成空内容', async () => {
    const channel = fake({
      ok: true,
      data: {
        messages: [{
          sender: { nickname: '甲' },
          content: [{ type: 'text', data: { text: '很长'.repeat(100) } }],
        }],
      },
    })

    const outcome = await readForward(channel, 'forward-1', { maxChars: 80 })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok || !('items' in outcome)) return
    expect(outcome.items).toHaveLength(1)
    expect(outcome.truncated).toBe(true)
    expect(outcome.text).toContain('已按读取上限截断')
  })
})
