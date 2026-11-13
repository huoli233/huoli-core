import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendStateLine } from '../src/action-store.ts'
import { apply, qqChannelOf, type Config, type QqChannelSeam } from '../src/index.ts'

type SocketHandler = (event?: { data?: string }) => void

const CHAT = 'group:123'
const OTHER = 'private:666'

// 回话可以指定等多久：慢的那一次还没回来时，别的调用会不会挤进来就看这里
class QueuedSocket {
  static readonly opened: QueuedSocket[] = []
  // 第几次发出去等多久才回话，没写的按零算
  static delays: number[] = []
  // 前几次发出去回失败码，零表示每次都成
  static failCount = 0
  // 失败时对方附带给的说法，用来验证带路径的说法不会被记下来
  static wording = ''
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, SocketHandler[]>()

  constructor() {
    QueuedSocket.opened.push(this)
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
    const at = this.sent.length
    const failed = at <= QueuedSocket.failCount
    const delay = Math.max(0, QueuedSocket.delays[at - 1] ?? 0)
    const wording = QueuedSocket.wording
    const reply = {
      echo,
      retcode: failed ? 100 : 0,
      data: { message_id: at },
      ...failed && wording !== '' ? { wording } : {},
    }
    setTimeout(() => {
      this.emit('message', JSON.stringify(reply))
    }, delay)
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

// 工具体只读会话编号与取消信号，其余字段由内核在真实调用时给
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  ctx: Context
  channel: QqChannelSeam
  tool: (name: string) => ToolDefinition
}

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
const OPEN_HOURS = { quietStart: '00:00', quietEnd: '00:00' }
const tempDirs: string[] = []

// 真落出去的那几条，按落地的先后：正文原样给出，消息段给个短标记
function landed(): string[] {
  const socket = QueuedSocket.opened.at(-1)
  return (socket?.sent ?? []).map((payload) => {
    const call = JSON.parse(payload) as { action?: string; params?: { message?: unknown } }
    if (call.action === 'delete_msg') return '撤回'
    const body = call.params?.message
    if (typeof body === 'string') return body
    if (!Array.isArray(body)) return ''
    return body.map((part) => {
      const segment = part as { type?: string; data?: { text?: string } }
      if (segment.type === 'text') return segment.data?.text ?? ''
      if (segment.type === 'at') return ''
      if (segment.type === 'image') return '表情包'
      if (segment.type === 'record') return '语音'
      return segment.type ?? ''
    }).join('')
  })
}

// 发上线的调用按落下先后给动作名
function actions(): string[] {
  const socket = QueuedSocket.opened.at(-1)
  return (socket?.sent ?? []).map(payload => (JSON.parse(payload) as { action?: string }).action ?? '')
}

function mount(patch: Partial<Config> = {}): Mounted {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-send-chain-'))
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
    sendStateFile: path.join(dir, 'send-state.json'),
    ...OPEN_HOURS,
    ...patch,
  })
  QueuedSocket.opened.at(-1)?.open()
  const channel = qqChannelOf(ctx)
  if (channel === undefined) throw new Error('通道没有装配上')
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { ctx, channel, tool }
}

beforeEach(() => {
  QueuedSocket.opened.length = 0
  QueuedSocket.delays = []
  QueuedSocket.failCount = 0
  QueuedSocket.wording = ''
  vi.stubGlobal('WebSocket', QueuedSocket)
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('连着两次发送时气泡不交织', () => {
  it('不走队列的原始连接会交织，说明这条用例真能看出顺序', async () => {
    const { channel } = mount()
    QueuedSocket.delays = [30, 0, 0]
    const raw = channel.channel

    // 照普通回复与另一串连发各自逐段发的样子走，中间不排队
    const first = (async () => {
      await raw.send('甲一', CHAT)
      await raw.send('甲二', CHAT)
    })()
    const second = (async () => {
      await raw.send('乙一', CHAT)
    })()
    await Promise.all([first, second])

    expect(landed()).toEqual(['甲一', '乙一', '甲二'])
  })

  it('连发与改口各自成串，按调用的先后整串落地', async () => {
    const { tool } = mount()
    QueuedSocket.delays = [30, 0, 0, 0]

    const burst = tool('qq_send_burst').execute({ lines: '甲一\n甲二', gap_ms: 0 }, execOf(CHAT))
    const messy = tool('qq_send_messy').execute({
      steps: [{ kind: 'send', text: '乙一' }, { kind: 'send', text: '乙二' }],
      gap_ms: 0,
    }, execOf(CHAT))
    const [batched, corrected] = await Promise.all([burst, messy])

    expect(batched).toMatchObject({ ok: true, sent: 2 })
    expect(corrected).toMatchObject({ ok: true, sent: 2 })
    expect(landed()).toEqual(['甲一', '甲二', '乙一', '乙二'])
  })

  it('不同会话之间也排队，同一个号连发时本来就该排着来', async () => {
    const { channel, tool } = mount()
    QueuedSocket.delays = [30, 0, 0]

    const group = tool('qq_send_burst').execute({ lines: '群一\n群二', gap_ms: 0 }, execOf(CHAT))
    const privateChat = channel.send('私聊一句', OTHER)
    const [batched, sent] = await Promise.all([group, privateChat])

    expect(batched).toMatchObject({ ok: true, sent: 2 })
    expect(sent).toMatchObject({ ok: true })
    expect(landed()).toEqual(['群一', '群二', '私聊一句'])
  })

  it('表情包、语音那种一条就走的也排在同一条链上', async () => {
    const { tool } = mount()
    QueuedSocket.delays = [30, 0]

    const burst = tool('qq_send_burst').execute({ lines: '甲一\n甲二', gap_ms: 0 }, execOf(CHAT))
    const mentioned = tool('qq_mention').execute({ user_id: '555', text: '乙说一句' }, execOf(CHAT))
    const [batched, asked] = await Promise.all([burst, mentioned])

    expect(batched).toMatchObject({ ok: true, sent: 2 })
    expect(asked).toMatchObject({ ok: true })
    expect(landed()).toEqual(['甲一', '甲二', '乙说一句'])
  })
})

describe('一次失败不能卡住后面的', () => {
  it('前一条报错之后，后一条照样发出去', async () => {
    const { channel, tool } = mount()
    QueuedSocket.failCount = 1

    // 工具发不出去会抛错，队尾不能因此带着这段失败
    const failed = tool('qq_send_message').execute({ text: '第一句' }, execOf(CHAT))
    // 先接住这一段的拒绝，免得它在断言挂上之前被当成未处理拒绝
    const settled = failed.catch((error: unknown) => error)
    const sent = await channel.send('第二句', CHAT)
    const failure = await settled
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toMatch(/channel\.100/u)

    expect(sent).toMatchObject({ ok: true })
    expect(landed()).toEqual(['第一句', '第二句'])
  })

  it('前一条只是没发成，后一条也照样发出去', async () => {
    const { channel } = mount()
    QueuedSocket.failCount = 1

    const first = channel.send('第一句', CHAT)
    const second = channel.send('第二句', CHAT)
    const [failed, sent] = await Promise.all([first, second])

    expect(failed.ok).toBe(false)
    expect(sent.ok).toBe(true)
    expect(landed()).toEqual(['第一句', '第二句'])
  })

  it('连着失败两次之后仍然能发出去', async () => {
    const { channel } = mount()
    QueuedSocket.failCount = 2

    const first = channel.send('第一句', CHAT)
    const second = channel.send('第二句', CHAT)
    await Promise.all([first, second])
    const third = await channel.send('第三句', CHAT)

    expect(third.ok).toBe(true)
    expect(landed()).toEqual(['第一句', '第二句', '第三句'])
  })
})

describe('撤回排在它要撤的那条之后', () => {
  it('连发还没发完时调撤回，撤回排在后面而不是抢跑', async () => {
    const { tool } = mount()
    QueuedSocket.delays = [20, 0, 0]

    const burst = tool('qq_send_burst').execute({ lines: '一\n二', gap_ms: 0 }, execOf(CHAT))
    const undone = tool('qq_unsend').execute({ message_id: '2' }, execOf(CHAT))
    const [batched, recall] = await Promise.all([burst, undone])

    expect(batched).toMatchObject({ ok: true, sent: 2 })
    expect(recall).toMatchObject({ ok: true })
    expect(actions()).toEqual(['send_group_msg', 'send_group_msg', 'delete_msg'])
  })

  it('一批撤回按发出的顺序一条条撤', async () => {
    const { tool } = mount()
    QueuedSocket.delays = [20, 0, 0, 0]

    const burst = tool('qq_send_burst').execute({ lines: '一\n二', gap_ms: 0 }, execOf(CHAT))
    const undone = tool('qq_batch_unsend').execute({ message_ids: ['1', '2'] }, execOf(CHAT))
    const [batched, recall] = await Promise.all([burst, undone])

    expect(batched).toMatchObject({ ok: true, sent: 2 })
    expect(recall).toMatchObject({ ok: true, withdrawn: 2 })
    expect(actions()).toEqual(['send_group_msg', 'send_group_msg', 'delete_msg', 'delete_msg'])
  })

  it('改口里撤上一句那条，撤回仍排在他要撤的那条之后', async () => {
    const { tool } = mount()

    const result = await tool('qq_send_messy').execute({
      steps: [
        { kind: 'send', text: '打快了的半句' },
        { kind: 'replace', text: '改好的一句' },
      ],
      gap_ms: 0,
    }, execOf(CHAT))

    expect(result).toMatchObject({ ok: true, sent: 2 })
    expect(actions()).toEqual(['send_group_msg', 'delete_msg', 'send_group_msg'])
  })
})

describe('发不出去之后提示词里那一行', () => {
  it('失败之后这一段出现，带上码与对方给的说法', async () => {
    const { channel } = mount()
    QueuedSocket.failCount = 1
    QueuedSocket.wording = '对方服务器忙'

    await channel.send('没发出去的话', CHAT)
    const line = sendStateLine(channel.lastSend(CHAT))

    expect(line).toContain('[SYSTEM_LOAD] QQ_SEND_STATE')
    expect(line).toContain('STATE: send_failed')
    expect(line).toContain('CODE: channel.100')
    expect(line).toContain('对方服务器忙')
    expect(line).toContain('你上一条想发的话没发出去')
    expect(line).toContain('do_not_resend_the_same_text')
  })

  it('工具那条路发不出去，也照样留下状态', async () => {
    const { channel, tool } = mount()
    QueuedSocket.failCount = 1

    await expect(tool('qq_send_message').execute({ text: '没发出去的话' }, execOf(CHAT)))
      .rejects.toThrow(/channel\.100/u)

    expect(sendStateLine(channel.lastSend(CHAT))).toContain('STATE: send_failed')
  })

  it('发成了这一段就不出现', async () => {
    const { channel } = mount()

    await channel.send('这次发出去了', CHAT)

    expect(channel.lastSend(CHAT)).toMatchObject({ ok: true })
    expect(sendStateLine(channel.lastSend(CHAT))).toBe('')
  })

  it('后来的成功会把前面那次的失败盖掉', async () => {
    const { channel } = mount()
    QueuedSocket.failCount = 1

    await channel.send('没发出去的话', CHAT)
    expect(sendStateLine(channel.lastSend(CHAT))).not.toBe('')
    await channel.send('重说一次', CHAT)

    expect(sendStateLine(channel.lastSend(CHAT))).toBe('')
  })

  it('别的会话看不到这一条', async () => {
    const { channel } = mount()
    QueuedSocket.failCount = 1

    await channel.send('没发出去的话', CHAT)

    expect(channel.lastSend(OTHER)).toBeUndefined()
    expect(sendStateLine(channel.lastSend(OTHER))).toBe('')
  })

  it('带本机路径的说法不记下来，只留码', async () => {
    const { channel } = mount()
    QueuedSocket.failCount = 1
    QueuedSocket.wording = 'C:\\Users\\someone\\qq\\log.txt 打不开'

    await channel.send('没发出去的话', CHAT)
    const record = channel.lastSend(CHAT)

    expect(record?.code).toBe('channel.100')
    expect(record?.reason).toBeUndefined()
    expect(sendStateLine(record)).not.toContain('someone')
  })

  it('最近几条失败码留着，够看出是不是一直卡在同一处', async () => {
    const { channel } = mount()
    QueuedSocket.failCount = 3

    await channel.send('第一次', CHAT)
    await channel.send('第二次', CHAT)
    await channel.send('第三次', CHAT)
    const record = channel.lastSend(CHAT)

    expect(record?.failures).toHaveLength(3)
    expect(record?.failures.every(item => item.code === 'channel.100')).toBe(true)
    expect(sendStateLine(record)).toContain('REPEATED: 3')
  })

  it('重启之后仍然知道上一条没发出去', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-send-chain-restart-'))
    tempDirs.push(dir)
    const sendStateFile = path.join(dir, 'send-state.json')
    const before = mount({ sendStateFile })
    QueuedSocket.failCount = 1

    await before.channel.send('没发出去的话', CHAT)
    QueuedSocket.failCount = 0
    const after = mount({ sendStateFile })

    expect(sendStateLine(after.channel.lastSend(CHAT))).toContain('STATE: send_failed')
  })
})
