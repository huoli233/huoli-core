import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import {
  addSlang,
  defaultSlangFile,
  extractSlangCandidates,
  findSlangs,
  pendingSlangs,
  readSlangs,
  reviewSlang,
  suggestSlangs,
} from '../src/slang.ts'
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

  it('近期群消息里重复出现的词先变成待审核候选', () => {
    const messages = ['今天开黑吗', '晚上继续开黑', '开黑记得叫我']
    const candidates = extractSlangCandidates(messages, {
      minMessages: 2,
      minOccurrences: 2,
      minWordChars: 2,
      maxWordChars: 8,
    })

    expect(candidates.some(item => item.word === '开黑')).toBe(true)
  })

  it('候选不会直接进入查询，审核通过后才算学会', () => {
    const file = tempFile()
    suggestSlangs(file, [{ word: '开黑', evidenceCount: 3 }], 'group:1', 1_000)

    expect(findSlangs(file, 10)).toEqual([])
    expect(pendingSlangs(file, 10)[0]?.word).toBe('开黑')
    const approved = reviewSlang(file, '开黑', 'approve', '一起打游戏', '', 2_000)
    expect(approved.ok).toBe(true)
    expect(findSlangs(file, 10)[0]?.meaning).toBe('一起打游戏')
  })

  it('拒绝的候选不会出现在查询里', () => {
    const file = tempFile()
    suggestSlangs(file, [{ word: '不是词', evidenceCount: 2 }], 'group:1', 1_000)
    const rejected = reviewSlang(file, '不是词', 'reject', '', '只是普通短语', 2_000)

    expect(rejected.ok).toBe(true)
    expect(findSlangs(file, 10)).toEqual([])
    expect(pendingSlangs(file, 10)).toEqual([])
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

  deliver(raw: Record<string, unknown>): void {
    this.emit('message', JSON.stringify(raw))
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

function mount(patch: Record<string, unknown> = {}): Map<string, ToolDefinition> {
  vi.stubGlobal('WebSocket', BurstSocket)
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
  ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
  apply(ctx, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    slangFile: tempFile(),
    quietStart: '00:00',
    quietEnd: '00:00',
    ...patch,
  })
  BurstSocket.opened.at(-1)?.open()
  return tools
}

describe('连发与黑话的工具', () => {
  afterEach(() => {
    BurstSocket.opened.length = 0
  })

  it('三个工具都挂上了', () => {
    const tools = mount()

    expect([...tools.keys()]).toEqual(expect.arrayContaining([
      'qq_send_burst',
      'qq_slang_query',
      'qq_slang_submit',
      'qq_slang_pending',
      'qq_slang_review',
    ]))
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

  it('一串纯标点不会从连发工具漏出去', async () => {
    const tools = mount()
    const burst = tools.get('qq_send_burst')
    if (burst === undefined) throw new Error('没挂上连发的工具')

    await expect(burst.execute({ lines: '？？？', gap_ms: 0 }, execOf('group:1')))
      .rejects.toThrow(/burst.inner_only/u)
    expect(sentTexts()).toEqual([])
  })

  it('一句都没有就拒，不硬发', async () => {
    const tools = mount()
    const burst = tools.get('qq_send_burst')
    if (burst === undefined) throw new Error('没挂上连发的工具')

    await expect(burst.execute({ lines: '  \n  ' }, execOf('group:1'))).rejects.toThrow(/burst.empty/u)
  })

  it('好友私聊连着只发应声时拒掉', async () => {
    const tools = mount()
    const burst = tools.get('qq_send_burst')
    if (burst === undefined) throw new Error('没挂上连发的工具')

    await expect(burst.execute({ lines: '嗯\n在', gap_ms: 0 }, execOf('private:1')))
      .rejects.toThrow(/burst\.empty_reply/u)
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

  it('普通群消息攒够窗口后自动写出待审核候选', () => {
    const file = tempFile()
    mount({
      slangFile: file,
      slangWindowSize: 3,
      slangMinMessages: 2,
      slangMinOccurrences: 2,
    })
    const socket = BurstSocket.opened.at(-1)
    if (socket === undefined) throw new Error('连接没起来')
    const text = (body: string, id: number) => ({
      post_type: 'message',
      message_type: 'group',
      group_id: 1,
      user_id: 2,
      sender: { card: '甲' },
      message: body,
      message_id: id,
      time: Math.floor(Date.now() / 1000),
    })

    socket.deliver(text('今天开黑吗', 1))
    socket.deliver(text('晚上继续开黑', 2))
    socket.deliver(text('开黑记得叫我', 3))

    expect(readSlangs(file).some(item => item.word === '开黑' && item.status === 'pending')).toBe(true)
  })
})
