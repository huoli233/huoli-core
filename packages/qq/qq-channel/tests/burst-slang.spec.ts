import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { addSlang, defaultSlangFile, findSlangs, readSlangs } from '../src/slang.ts'
import { apply } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qq-slang-'))
  dirs.push(dir)
  return join(dir, 'qq-slang.json')
}

describe('学到的词', () => {
  it('记一个词，再查得到', () => {
    const file = tempFile()

    const added = addSlang(file, '摸鱼', '上班时偷偷歇着', 'group:1', 1000)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.created).toBe(true)

    const found = findSlangs(file, 10)
    expect(found[0]?.meaning).toBe('上班时偷偷歇着')
    expect(found[0]?.from).toBe('group:1')
  })

  it('同一个词只记一次，再提交不新建', () => {
    const file = tempFile()

    addSlang(file, '摸鱼', '歇着', 'group:1', 1000)
    const again = addSlang(file, '摸鱼', '另一个意思', 'group:2', 2000)

    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.created).toBe(false)
    expect(readSlangs(file)).toHaveLength(1)
  })

  it('整份词表列出来，哪个用得上由调用方自己挑', () => {
    const file = tempFile()
    addSlang(file, '摸鱼', '上班时偷偷歇着', 'group:1', 1000)
    addSlang(file, '开黑', '一起打游戏', 'group:1', 2000)

    expect(findSlangs(file, 10)[0]?.word).toBe('摸鱼')
    expect(findSlangs(file, 10)).toHaveLength(2)
  })

  it('空词、太长的词、写不进去都给码与下一步', () => {
    const file = tempFile()

    const empty = addSlang(file, '  ', '意思', 'group:1', 1000)
    expect(empty.ok).toBe(false)
    if (empty.ok) return
    expect(empty.code).toBe('slang.empty')

    const long = addSlang(file, '一'.repeat(50), '意思', 'group:1', 1000)
    expect(long.ok).toBe(false)
    if (long.ok) return
    expect(long.code).toBe('slang.too_long')
    expect(long.hint).toBeTruthy()

    const broken = addSlang('/没有这个目录/词.json', '摸鱼', '歇着', 'group:1', 1000)
    expect(broken.ok).toBe(false)
    if (broken.ok) return
    expect(broken.code).toBe('slang.write_failed')
  })

  it('库坏了或多字段都当没这份，不抛', () => {
    expect(readSlangs('/没有这份.json')).toEqual([])
    const file = tempFile()
    writeFileSync(file, '不是 JSON')
    expect(readSlangs(file)).toEqual([])
  })

  it('默认路径落在数据目录下', () => {
    expect(defaultSlangFile()).toContain('qq-slang.json')
  })
})

class BurstSocket {
  static readonly opened: BurstSocket[] = []
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, ((event: { data?: string }) => void)[]>()

  constructor() {
    BurstSocket.opened.push(this)
  }

  addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(payload: string): void {
    this.sent.push(payload)
    const echo = (JSON.parse(payload) as { echo?: string }).echo ?? ''
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

function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

function sentTexts(): string[] {
  return (BurstSocket.opened.at(-1)?.sent ?? []).map((payload) => {
    const message = (JSON.parse(payload) as { params?: { message?: unknown } }).params?.message
    return typeof message === 'string' ? message : ''
  })
}

function mount(): Map<string, ToolDefinition> {
  vi.stubGlobal('WebSocket', BurstSocket)
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
  ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
  apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', slangFile: tempFile(), quietStart: '00:00', quietEnd: '00:00' })
  BurstSocket.opened.at(-1)?.open()
  return tools
}

describe('连发与黑话的工具', () => {
  afterEach(() => {
    BurstSocket.opened.length = 0
  })

  it('三个工具都挂上了', () => {
    const tools = mount()

    expect([...tools.keys()]).toEqual(expect.arrayContaining(['qq_send_burst', 'qq_slang_query', 'qq_slang_submit']))
  })

  it('连发按换行拆成几条，一条一条发出去', async () => {
    const tools = mount()
    const burst = tools.get('qq_send_burst')
    if (burst === undefined) throw new Error('没挂上连发的工具')

    const result = await burst.execute({ lines: '啊？\n等下\n好', gap_ms: 0 }, execOf('group:1')) as { ok: boolean; sent: number }

    expect(result.ok).toBe(true)
    expect(result.sent).toBe(3)
    expect(sentTexts()).toEqual(['啊？', '等下', '好'])
  })

  it('一句都没有就拒，不硬发', async () => {
    const tools = mount()
    const burst = tools.get('qq_send_burst')
    if (burst === undefined) throw new Error('没挂上连发的工具')

    await expect(burst.execute({ lines: '  \n  ' }, execOf('group:1'))).rejects.toThrow(/burst.empty/u)
  })

  it('记一个词再查得到，走的是同一份词表', async () => {
    const tools = mount()
    const submit = tools.get('qq_slang_submit')
    const query = tools.get('qq_slang_query')
    if (submit === undefined || query === undefined) throw new Error('没挂上黑话的工具')

    const written = await submit.execute({ word: '摸鱼', meaning: '偷偷歇着' }, execOf('group:1')) as { created: boolean }
    expect(written.created).toBe(true)

    const found = await query.execute({ query: '摸鱼' }, execOf('group:1')) as { count: number; items: { word: string }[] }
    expect(found.count).toBe(1)
    expect(found.items[0]?.word).toBe('摸鱼')
  })
})
