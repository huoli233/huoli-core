import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { apply, qqChannelOf } from '../src/index.ts'

class RecallSocket {
  static readonly opened: RecallSocket[] = []
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, ((event: { data?: string }) => void)[]>()

  constructor() {
    RecallSocket.opened.push(this)
  }

  addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(payload: string): void {
    this.sent.push(payload)
    const parsed = JSON.parse(payload) as { echo?: string; action?: string }
    const echo = parsed.echo ?? ''
    // 撤回不回编号，其余按发出去几条给一个编号
    const data = parsed.action === 'delete_msg' ? {} : { message_id: this.sent.length }
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

function mount(): { tools: Map<string, ToolDefinition>; notes: { wrong: string; better: string }[] } {
  vi.stubGlobal('WebSocket', RecallSocket)
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
  ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
  apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', quietStart: '00:00', quietEnd: '00:00' })
  RecallSocket.opened.at(-1)?.open()
  const notes: { wrong: string; better: string }[] = []
  qqChannelOf(ctx)?.useCorrectionNote((wrong, better) => { notes.push({ wrong, better }) })
  return { tools, notes }
}

async function sendOne(tools: Map<string, ToolDefinition>): Promise<string> {
  const send = tools.get('qq_send_message')
  if (send === undefined) throw new Error('没挂上发送工具')
  const result = await send.execute({ text: '说错的一句' }, execOf('group:1')) as { messageIds?: string[] }
  return result.messageIds?.[0] ?? ''
}

describe('撤回与改口', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    RecallSocket.opened.length = 0
  })

  it('撤回、看最近发过什么、改口三个工具都挂上了', () => {
    const { tools } = mount()

    expect([...tools.keys()]).toEqual(expect.arrayContaining(['qq_unsend', 'qq_recent_sends', 'qq_correct']))
  })

  it('发出去的编号能被列出来', async () => {
    const { tools } = mount()
    const id = await sendOne(tools)
    const recent = tools.get('qq_recent_sends')
    if (recent === undefined) throw new Error('没挂上看最近的工具')

    const result = await recent.execute({}, execOf('group:1')) as { count: number; items: { messageId: string; chatKey: string }[] }

    expect(result.count).toBe(1)
    expect(result.items[0]?.messageId).toBe(id)
    expect(result.items[0]?.chatKey).toBe('group:1')
  })

  it('撤回自己刚发的那一条，撤完就不再列着了', async () => {
    const { tools } = mount()
    const id = await sendOne(tools)
    const unsend = tools.get('qq_unsend')
    if (unsend === undefined) throw new Error('没挂上撤回工具')

    const result = await unsend.execute({ message_id: id }, execOf('group:1'))

    expect(result).toHaveProperty('ok', true)
    const payload = RecallSocket.opened.at(-1)?.sent.at(-1) ?? ''
    const parsed = JSON.parse(payload) as { action?: string }
    expect(parsed.action).toBe('delete_msg')
    const recent = tools.get('qq_recent_sends')
    const after = await recent?.execute({}, execOf('group:1')) as { count: number }
    expect(after.count).toBe(0)
  })

  it('不是自己发的编号不给撤', async () => {
    const { tools } = mount()
    const unsend = tools.get('qq_unsend')
    if (unsend === undefined) throw new Error('没挂上撤回工具')

    await expect(unsend.execute({ message_id: '999999' }, execOf('group:1'))).rejects.toThrow(/unsend.not_mine/u)
  })

  it('改口一次里做了撤回、更正、记一笔三件事', async () => {
    const { tools, notes } = mount()
    const id = await sendOne(tools)
    const correct = tools.get('qq_correct')
    if (correct === undefined) throw new Error('没挂上改口工具')

    const result = await correct.execute({ message_id: id, text: '不对，我是想说另一件事' }, execOf('group:1')) as { ok: boolean; withdrawn: boolean }

    expect(result.ok).toBe(true)
    expect(result.withdrawn).toBe(true)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.better).toBe('不对，我是想说另一件事')
    const last = JSON.parse(RecallSocket.opened.at(-1)?.sent.at(-1) ?? '{}') as { params?: { message?: unknown } }
    expect(last.params?.message).toEqual([
      { type: 'reply', data: { id } },
      { type: 'text', data: { text: '不对，我是想说另一件事' } },
    ])
  })

  it('只更正不撤时不带引用段', async () => {
    const { tools } = mount()
    const correct = tools.get('qq_correct')
    if (correct === undefined) throw new Error('没挂上改口工具')

    const result = await correct.execute({ text: '补一句，刚才没说清' }, execOf('group:1')) as { withdrawn: boolean }

    expect(result.withdrawn).toBe(false)
    const last = JSON.parse(RecallSocket.opened.at(-1)?.sent.at(-1) ?? '{}') as { params?: { message?: unknown } }
    expect(last.params?.message).toEqual([{ type: 'text', data: { text: '补一句，刚才没说清' } }])
  })
})
