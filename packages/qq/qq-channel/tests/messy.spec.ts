import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { addSaying, defaultSayingFile, findSayings, readSayings } from '../src/sayings.ts'
import { apply } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qq-saying-'))
  dirs.push(dir)
  return join(dir, 'qq-sayings.json')
}

describe('学来的说法', () => {
  it('记一句短句，再查得到', () => {
    const file = tempFile()

    const added = addSaying(file, '有一说一', '要先肯定再转折', 'group:1', 1000)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.created).toBe(true)

    const found = findSayings(file, '有一说一', 10)
    expect(found[0]?.when).toBe('要先肯定再转折')
  })

  it('同一句只记一次，太长的拒', () => {
    const file = tempFile()
    addSaying(file, '懂的都懂', '不展开说', 'group:1', 1000)

    const again = addSaying(file, '懂的都懂', '另一场合', 'group:2', 2000)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.created).toBe(false)
    expect(readSayings(file)).toHaveLength(1)

    const long = addSaying(file, '一'.repeat(70), '场合', 'group:1', 1000)
    expect(long.ok).toBe(false)
    if (long.ok) return
    expect(long.code).toBe('saying.too_long')
  })

  it('按场合也能查，空串列全部，库坏了不抛', () => {
    const file = tempFile()
    addSaying(file, '有一说一', '先肯定再转折', 'group:1', 1000)
    addSaying(file, '乐', '不想多说', 'group:1', 2000)

    expect(findSayings(file, '转折', 10)[0]?.text).toBe('有一说一')
    expect(findSayings(file, '', 10)).toHaveLength(2)
    expect(readSayings('/没有这份.json')).toEqual([])
  })

  it('默认路径落在数据目录下', () => {
    expect(defaultSayingFile()).toContain('qq-sayings.json')
  })
})

class MessySocket {
  static readonly opened: MessySocket[] = []
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, ((event: { data?: string }) => void)[]>()

  constructor() {
    MessySocket.opened.push(this)
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

function actions(): { action: string; text: string | undefined }[] {
  return (MessySocket.opened.at(-1)?.sent ?? []).map((payload) => {
    const parsed = JSON.parse(payload) as { action: string; params?: { message?: unknown } }
    return { action: parsed.action, text: typeof parsed.params?.message === 'string' ? parsed.params.message : undefined }
  })
}

function mount(): Map<string, ToolDefinition> {
  vi.stubGlobal('WebSocket', MessySocket)
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
  ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
  apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', sayingFile: tempFile(), quietStart: '00:00', quietEnd: '00:00' })
  MessySocket.opened.at(-1)?.open()
  return tools
}

describe('打岔与说法的工具', () => {
  afterEach(() => {
    MessySocket.opened.length = 0
  })

  it('三个工具都挂上了', () => {
    const tools = mount()

    expect([...tools.keys()]).toEqual(expect.arrayContaining(['qq_send_messy', 'qq_saying_query', 'qq_saying_submit']))
  })

  it('打飞鱼撤回来换成大肥鱼：发、撤、再发三步', async () => {
    const tools = mount()
    const messy = tools.get('qq_send_messy')
    if (messy === undefined) throw new Error('没挂上打岔工具')

    const result = await messy.execute({ steps: '发 你再叫我一次打飞鱼\n撤\n换 你再叫我一次大肥鱼', gap_ms: 0 }, execOf('group:1')) as { steps: number; sent: number }

    expect(result.steps).toBe(3)
    expect(result.sent).toBe(2)
    const steps = actions()
    expect(steps.map(row => row.action)).toEqual(['send_group_msg', 'delete_msg', 'send_group_msg'])
    expect(steps[0]?.text).toBe('你再叫我一次打飞鱼')
    expect(steps[2]?.text).toBe('你再叫我一次大肥鱼')
  })

  it('拼音没打完就直接发出去，不撤', async () => {
    const tools = mount()
    const messy = tools.get('qq_send_messy')
    if (messy === undefined) throw new Error('没挂上打岔工具')

    const result = await messy.execute({ steps: '发 pe', gap_ms: 0 }, execOf('group:1'))

    expect(result).toHaveProperty('sent', 1)
    expect(actions()).toEqual([{ action: 'send_group_msg', text: 'pe' }])
  })

  it('前面没发过就撤，给一个能看懂的码', async () => {
    const tools = mount()
    const messy = tools.get('qq_send_messy')
    if (messy === undefined) throw new Error('没挂上打岔工具')

    await expect(messy.execute({ steps: '撤', gap_ms: 0 }, execOf('group:1'))).rejects.toThrow(/messy.nothing_to_withdraw/u)
  })

  it('记一句群里的说法再查得到', async () => {
    const tools = mount()
    const submit = tools.get('qq_saying_submit')
    const query = tools.get('qq_saying_query')
    if (submit === undefined || query === undefined) throw new Error('没挂上说法工具')

    const written = await submit.execute({ text: '有一说一', when: '先肯定再转折' }, execOf('group:1')) as { created: boolean }
    expect(written.created).toBe(true)

    const found = await query.execute({ query: '有一说一' }, execOf('group:1')) as { count: number; items: { text: string }[] }
    expect(found.count).toBe(1)
    expect(found.items[0]?.text).toBe('有一说一')
  })
})
