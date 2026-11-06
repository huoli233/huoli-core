import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { defaultVoiceFile, listVoices, readVoices, voiceOf } from '../src/voices.ts'
import { apply } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function tempFile(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'qq-voice-'))
  dirs.push(dir)
  const file = join(dir, 'qq-voices.json')
  writeFileSync(file, JSON.stringify(body))
  return file
}

const LIBRARY = [
  { id: 'yawn', tag: '困 打哈欠', file: 'E:/sounds/yawn.amr' },
  { id: 'hi', tag: '打招呼', file: 'E:/sounds/hi.amr' },
]

describe('语音库', () => {
  it('把整份库列出来，哪段合适由调用方自己挑', () => {
    const file = tempFile(LIBRARY)

    const found = listVoices(file, 10)

    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.voices.map(row => row.id)).toEqual(['yawn', 'hi'])
  })

  it('一份库都没有就给码与下一步', () => {
    const found = listVoices(tempFile([]), 10)

    expect(found.ok).toBe(false)
    if (found.ok) return
    expect(found.code).toBe('voice.none')
    expect(found.hint).toBeTruthy()
  })

  it('按编号取一段，不认得的编号给码', () => {
    const one = voiceOf(tempFile(LIBRARY), 'hi')
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(one.voice.file).toBe('E:/sounds/hi.amr')

    const miss = voiceOf(tempFile(LIBRARY), '自己编的')
    expect(miss.ok).toBe(false)
    if (miss.ok) return
    expect(miss.code).toBe('voice.unknown')
  })

  it('库坏了或多字段都当没这份，不抛', () => {
    expect(readVoices('/没有这份.json')).toEqual([])
    expect(readVoices(tempFile([{ id: 'x', file: 'a.amr', 多余的: 1 }, { 缺字段: true }]))).toEqual([{ id: 'x', tag: '', file: 'a.amr' }])
  })

  it('默认路径落在数据目录下', () => {
    expect(defaultVoiceFile()).toContain('qq-voices.json')
  })
})

class VoiceSocket {
  static readonly opened: VoiceSocket[] = []
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, ((event: { data?: string }) => void)[]>()

  constructor() {
    VoiceSocket.opened.push(this)
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

function sentPayload(): { params?: { message?: unknown } } {
  return JSON.parse(VoiceSocket.opened.at(-1)?.sent.at(-1) ?? '{}') as { params?: { message?: unknown } }
}

function mount(): Map<string, ToolDefinition> {
  vi.stubGlobal('WebSocket', VoiceSocket)
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
  ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
  apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', voiceFile: tempFile(LIBRARY), quietStart: '00:00', quietEnd: '00:00' })
  VoiceSocket.opened.at(-1)?.open()
  return tools
}

describe('语音、引用与状态的工具', () => {
  afterEach(() => {
    VoiceSocket.opened.length = 0
  })

  it('四个工具都挂上了', () => {
    const tools = mount()

    expect([...tools.keys()]).toEqual(expect.arrayContaining(['qq_list_voices', 'qq_send_voice', 'qq_reply', 'qq_channel_status']))
  })

  it('发语音走的是一段录音，不是文字', async () => {
    const tools = mount()
    const send = tools.get('qq_send_voice')
    if (send === undefined) throw new Error('没挂上发语音的工具')

    const result = await send.execute({ voice_id: 'yawn' }, execOf('group:1'))

    expect(result).toHaveProperty('ok', true)
    expect(sentPayload().params?.message).toEqual([{ type: 'record', data: { file: 'E:/sounds/yawn.amr' } }])
  })

  it('引用回复带引用段与正文两段', async () => {
    const tools = mount()
    const reply = tools.get('qq_reply')
    if (reply === undefined) throw new Error('没挂上引用回复的工具')

    const result = await reply.execute({ message_id: '12345', text: '我在听' }, execOf('group:1'))

    expect(result).toHaveProperty('ok', true)
    expect(sentPayload().params?.message).toEqual([
      { type: 'reply', data: { id: '12345' } },
      { type: 'text', data: { text: '我在听' } },
    ])
  })

  it('状态只报事实：连上、重连次数、上次错', async () => {
    const tools = mount()
    const status = tools.get('qq_channel_status')
    if (status === undefined) throw new Error('没挂上看状态的工具')

    const result = await status.execute({}, execOf('group:1')) as { connected: boolean; url: string; reconnectCount: number; lastError: string }

    expect(result.connected).toBe(true)
    expect(result.url).toBe('ws://127.0.0.1:6700')
    expect(result.reconnectCount).toBe(0)
  })
})
