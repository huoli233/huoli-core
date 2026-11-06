import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { defaultStickerFile, listStickers, readStickers, stickerOf } from '../src/stickers.ts'
import { apply } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function tempFile(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'qq-sticker-'))
  dirs.push(dir)
  const file = join(dir, 'qq-stickers.json')
  writeFileSync(file, JSON.stringify(body))
  return file
}

const LIBRARY = [
  { id: 'tired', tag: '困 累 趴', file: 'E:/pics/tired.png' },
  { id: 'happy', tag: '开心 被夸', file: 'E:/pics/happy.png' },
]

describe('表情包库', () => {
  it('把整份库列出来，谁合适由调用方自己挑', () => {
    const file = tempFile(LIBRARY)

    const found = listStickers(file, 10)

    expect(found.ok).toBe(true)
    if (!found.ok || !('stickers' in found)) return
    expect(found.stickers.map(row => row.id)).toEqual(['tired', 'happy'])
  })

  it('一份库都没有就给码与下一步', () => {
    const found = listStickers(tempFile([]), 10)

    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.code).toBe('sticker.none')
    expect(found.hint).toBeTruthy()
  })

  it('按编号取一张，编号不认得就给码', () => {
    const file = tempFile(LIBRARY)

    const one = stickerOf(file, 'happy')
    expect(one.ok).toBe(true)
    if (!one.ok || !('sticker' in one)) return
    expect(one.sticker.file).toBe('E:/pics/happy.png')

    const miss = stickerOf(file, '自己编的')
    expect(miss.ok).toBe(false)
    if (miss.ok) return
    expect(miss.code).toBe('sticker.unknown')
  })

  it('库坏了或多出来的字段都当没这份，不抛', () => {
    expect(readStickers('/没有这份.json')).toEqual([])

    const file = tempFile([{ id: 'x', file: 'a.png', 多余的: 1 }, { 缺字段: true }])
    expect(readStickers(file)).toEqual([{ id: 'x', tag: '', file: 'a.png' }])
  })

  it('默认路径落在数据目录下', () => {
    expect(defaultStickerFile()).toContain('qq-stickers.json')
  })
})

// 一个会把发出去的段记下来的假连接
class StickerSocket {
  static readonly opened: StickerSocket[] = []
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, ((event: { data?: string }) => void)[]>()

  constructor() {
    StickerSocket.opened.push(this)
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

function mount(patch: Record<string, unknown> = {}): Map<string, ToolDefinition> {
  vi.stubGlobal('WebSocket', StickerSocket)
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
  ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
  apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', stickerFile: tempFile(LIBRARY), quietStart: '00:00', quietEnd: '00:00', ...patch })
  StickerSocket.opened.at(-1)?.open()
  return tools
}

describe('表情包与戳的工具', () => {
  afterEach(() => {
    StickerSocket.opened.length = 0
  })

  it('三个工具都挂上了', () => {
    const tools = mount()

    expect([...tools.keys()]).toEqual(expect.arrayContaining(['qq_list_stickers', 'qq_send_sticker', 'qq_send_poke']))
  })

  it('按编号发的是一张图，不是一长串文字', async () => {
    const tools = mount()
    const send = tools.get('qq_send_sticker')
    if (send === undefined) throw new Error('没挂上发表情的工具')

    const result = await send.execute({ sticker_id: 'tired' }, execOf('group:1'))
    expect(result).toHaveProperty('ok', true)

    const payload = JSON.parse(StickerSocket.opened.at(-1)?.sent.at(-1) ?? '{}') as { params?: { message?: unknown } }
    expect(payload.params?.message).toEqual([{ type: 'image', data: { file: 'E:/pics/tired.png' } }])
  })

  it('没开戳人时给一个能看懂的码', async () => {
    const tools = mount()
    const poke = tools.get('qq_send_poke')
    if (poke === undefined) throw new Error('没挂上戳人的工具')

    await expect(poke.execute({ user_id: '678' }, execOf('group:1'))).rejects.toThrow(/poke.unavailable/u)
  })
})
