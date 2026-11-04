import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, qqChannelOf, type Config, type QqChannelSeam } from '../src/index.ts'

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

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
const OPEN_HOURS = { quietStart: '00:00', quietEnd: '00:00' }

// 本地中午，离日界够远
const NOON = new Date(2026, 2, 5, 12, 0, 0, 0).getTime()

// 私信允许名单里那一个对象
const PEER = 'u-1'

const ALL_TOOLS = ['qq_comment_post', 'qq_send_private', 'qq_confirm_action', 'qq_request_confirm']

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-action-tools-'))
  tempDirs.push(dir)
  return dir
}

// 工具体只读会话编号与取消信号，其余执行字段由内核在真实调用时注入
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  tool: (name: string) => ToolDefinition
  names: string[]
  seam: QqChannelSeam
  sent: string[]
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
    privateAllowPeers: [PEER],
    ...patch,
  })
  const socket = FakeSocket.opened.at(-1)
  socket?.open()
  const seam = qqChannelOf(ctx)
  if (seam === undefined) throw new Error('通道没装配上')
  // 这一组用例看的是工具与确认票，阶段统一停在能放行的那一档
  seam.useStage(() => 'P3')
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { tool, names: [...tools.keys()], seam, sent: socket?.sent ?? [] }
}

// 把被拒的原话抓出来，好按「码: 原因｜下一步: 提示」逐段对
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('这次调用没被拒')
}

// 一辆走完「要票、盖章」的动作，正文与品类都要对得上
function nodded(seam: QqChannelSeam, kind: 'comment' | 'private', text: string): string {
  const asked = seam.requestConfirm(kind, text, Date.now())
  if (asked.confirmId === undefined) throw new Error('没要到票')
  seam.confirm(asked.confirmId, Date.now())
  return asked.confirmId
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.useFakeTimers()
  vi.setSystemTime(NOON)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('工具清单', () => {
  it('四个工具都注册好了，能按名字取到', () => {
    const { names } = mount()

    for (const name of ALL_TOOLS) expect(names).toContain(name)
  })

  it('说明都不超过两百字，也不交代调用之后要汇报什么', () => {
    const { tool } = mount()

    for (const name of ALL_TOOLS) {
      const description = tool(name).description
      expect(description.length, name).toBeLessThanOrEqual(200)
      expect(description, name).not.toContain('请汇报')
      expect(description, name).not.toContain('调用成功')
    }
  })

  it('说明里写清了公开可见与只有对方看得见的差别，也写了先要票的顺序', () => {
    const { tool } = mount()
    const comment = tool('qq_comment_post').description
    const direct = tool('qq_send_private').description

    expect(comment).toContain('看得见')
    expect(comment).toContain('qq_send_private')
    expect(comment).toContain('qq_request_confirm')
    expect(direct).toContain('看不到')
    expect(direct).toContain('qq_comment_post')
    expect(direct).toContain('qq_confirm_action')
  })

  it('参数各就各位，票只发给要票的那两类动作', () => {
    const { tool } = mount()
    const fields = (name: string): string[] => Object.keys((tool(name).parameters as { properties: Record<string, unknown> }).properties)

    expect(fields('qq_comment_post')).toEqual(['text', 'topic'])
    expect(fields('qq_send_private')).toEqual(['peer', 'text'])
    expect(fields('qq_confirm_action')).toEqual(['confirmId'])
    const ask = JSON.stringify(tool('qq_request_confirm').parameters)
    expect(ask).toContain('"kind"')
    expect(ask).toContain('comment')
    expect(ask).toContain('private')
    expect(ask).not.toContain('routine')
  })
})

describe('公开评论', () => {
  it('没票就拒，提示里指名调哪个确认工具', async () => {
    const { tool } = mount()

    const message = await failure(tool('qq_comment_post').execute({ text: '这条我也想说说', topic: '吃喝' }, execOf('group:123')))

    expect(message).toMatch(/^comment\.needs_confirm: .+｜下一步: .+$/u)
    expect(message).toContain('qq_request_confirm')
    expect(message).toContain('qq_confirm_action')
  })

  it('拿票、盖章之后发得出去，正文真的送到了群里', async () => {
    const { tool, seam, sent } = mount()
    nodded(seam, 'comment', '这条我也想说说')

    const result = await tool('qq_comment_post').execute({ text: '这条我也想说说', topic: '吃喝' }, execOf('group:123')) as { ok: boolean; at: number; messageId: string }

    expect(result.ok).toBe(true)
    expect(result.at).toBe(NOON)
    expect(result.messageId).toBe('1')
    expect(sent.some(frame => frame.includes('send_group_msg') && frame.includes('这条我也想说说'))).toBe(true)
  })

  it('同一张票第二次发送被拒，还得重新要一张', async () => {
    const { tool, seam } = mount()
    nodded(seam, 'comment', '这条我也想说说')
    await tool('qq_comment_post').execute({ text: '这条我也想说说', topic: '吃喝' }, execOf('group:123'))

    const again = await failure(tool('qq_comment_post').execute({ text: '这条我也想说说', topic: '吃喝' }, execOf('group:123')))

    expect(again).toMatch(/^comment\.needs_confirm: /u)
  })

  it('话题不在预授权清单里就按发布入口给的码拒，工具不自己放行', async () => {
    const { tool, seam } = mount()
    nodded(seam, 'comment', '这条我也想说说')

    const message = await failure(tool('qq_comment_post').execute({ text: '这条我也想说说', topic: '工作' }, execOf('group:123')))

    expect(message).toMatch(/^comment\.topic_not_allowed: .+｜下一步: .+$/u)
  })

  it('空正文被拒，码是 comment.empty', async () => {
    const { tool } = mount()

    const message = await failure(tool('qq_comment_post').execute({ text: '   ', topic: '吃喝' }, execOf('group:123')))

    expect(message).toMatch(/^comment\.empty: .+｜下一步: .+$/u)
  })
})

describe('私信', () => {
  it('P0 阶段一条都发不出，码是 private.stage_blocked', async () => {
    const { tool, seam } = mount()
    seam.useStage(() => 'P0')
    nodded(seam, 'private', '问你一件事')

    const message = await failure(tool('qq_send_private').execute({ peer: PEER, text: '问你一件事' }, execOf(`private:${PEER}`)))

    expect(message).toMatch(/^private\.stage_blocked: .+｜下一步: .+$/u)
  })

  it('没票就拒，提示里指名调哪个确认工具', async () => {
    const { tool, seam } = mount()
    seam.useStage(() => 'P3')

    const message = await failure(tool('qq_send_private').execute({ peer: PEER, text: '问你一件事' }, execOf(`private:${PEER}`)))

    expect(message).toMatch(/^private\.needs_confirm: .+｜下一步: .+$/u)
    expect(message).toContain('qq_request_confirm')
  })

  it('对方不在允许名单里就拒，码是 private.peer_not_allowed', async () => {
    const { tool, seam } = mount()
    seam.useStage(() => 'P3')
    nodded(seam, 'private', '问你一件事')

    const message = await failure(tool('qq_send_private').execute({ peer: 'u-2', text: '问你一件事' }, execOf('private:u-2')))

    expect(message).toMatch(/^private\.peer_not_allowed: .+｜下一步: .+$/u)
  })

  it('阶段够了、名单里、票也盖了章就发出去，送到的是那个人', async () => {
    const { tool, seam, sent } = mount()
    seam.useStage(() => 'P3')
    nodded(seam, 'private', '问你一件事')

    const result = await tool('qq_send_private').execute({ peer: PEER, text: '问你一件事' }, execOf(`private:${PEER}`)) as { ok: boolean; peer: string; messageId: string }

    expect(result.ok).toBe(true)
    expect(result.peer).toBe(PEER)
    expect(result.messageId).toBe('1')
    expect(sent.some(frame => frame.includes('send_private_msg') && frame.includes('问你一件事'))).toBe(true)
  })

  it('缺对方编号就拒，码是 private.peer_required', async () => {
    const { tool, seam } = mount()
    seam.useStage(() => 'P3')
    nodded(seam, 'private', '问你一件事')

    const message = await failure(tool('qq_send_private').execute({ text: '问你一件事' }, execOf(`private:${PEER}`)))

    expect(message).toMatch(/^private\.peer_required: .+｜下一步: .+$/u)
  })

  it('空正文被拒，码是 private.empty', async () => {
    const { tool, seam } = mount()
    seam.useStage(() => 'P3')

    const message = await failure(tool('qq_send_private').execute({ peer: PEER, text: ' ' }, execOf(`private:${PEER}`)))

    expect(message).toMatch(/^private\.empty: .+｜下一步: .+$/u)
  })
})

describe('确认票', () => {
  it('要票回票号与失效时刻', async () => {
    const { tool } = mount()

    const asked = await tool('qq_request_confirm').execute({ kind: 'comment', text: '这条我也想说说' }, execOf('group:123')) as { ok: boolean; confirmId: string; expiresAt: number }

    expect(asked.ok).toBe(true)
    expect(asked.confirmId).toMatch(/^comment:\d+:[0-9a-f]{12}$/u)
    expect(asked.expiresAt).toBe(NOON + 30 * 60_000)
  })

  it('同一段正文重复要票被拒，码是 comment.confirm_duplicate', async () => {
    const { tool } = mount()
    await tool('qq_request_confirm').execute({ kind: 'comment', text: '这条我也想说说' }, execOf('group:123'))

    const message = await failure(tool('qq_request_confirm').execute({ kind: 'comment', text: '这条我也想说说' }, execOf('group:123')))

    expect(message).toMatch(/^comment\.confirm_duplicate: .+｜下一步: .+$/u)
  })

  it('没这个票号就拒，码是 confirm.unknown', async () => {
    const { tool } = mount()

    const message = await failure(tool('qq_confirm_action').execute({ confirmId: 'comment:none:000000000000' }, execOf('group:123')))

    expect(message).toMatch(/^confirm\.unknown: .+｜下一步: .+$/u)
  })

  it('过期之后盖章被拒，码带着品类', async () => {
    const { tool, seam } = mount()
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)

    vi.setSystemTime(NOON + 30 * 60_000)
    const message = await failure(tool('qq_confirm_action').execute({ confirmId: asked.confirmId ?? '' }, execOf('group:123')))

    expect(message).toMatch(/^comment\.confirm_expired: .+｜下一步: .+$/u)
  })

  it('空正文要不到票，码是 comment.empty', async () => {
    const { tool } = mount()

    const message = await failure(tool('qq_request_confirm').execute({ kind: 'comment', text: '' }, execOf('group:123')))

    expect(message).toMatch(/^comment\.empty: .+｜下一步: .+$/u)
  })
})
