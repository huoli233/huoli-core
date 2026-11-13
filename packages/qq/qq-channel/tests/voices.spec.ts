import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huoli/cordis'
import { apply as applyPacing, qqPacingOf } from '@huoli/huoli-qq-pacing'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import {
  defaultVoiceFile,
  inspectVoice,
  listVoices,
  readVoices,
  sendVoice,
  voiceOf,
  type VoiceSendDeps,
} from '../src/voices.ts'
import { apply } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  VoiceSocket.opened.length = 0
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qq-voice-'))
  dirs.push(dir)
  return dir
}

function tempFile(body: unknown): string {
  const file = join(tempDir(), 'qq-voices.json')
  writeFileSync(file, JSON.stringify(body))
  return file
}

// 拼一段 AMR 窄带音频：每帧二十毫秒、三十二字节
function amrOf(seconds: number): Buffer {
  const frames = Math.round(seconds * 1000 / 20)
  return Buffer.concat([Buffer.from('#!AMR\n', 'latin1'), Buffer.alloc(frames * 32)])
}

function writeAudio(dir: string, name: string, body: Buffer): string {
  const file = join(dir, name)
  writeFileSync(file, body)
  return file
}

const LIMITS = { maxSeconds: 5, maxBytes: 50_000, bytesPerSecond: 1500 }

// 库里的两段现在是真文件，发之前要量得出来
function library(): { file: string; rows: { id: string; tag: string; file: string }[] } {
  const dir = tempDir()
  const rows = [
    { id: 'yawn', tag: '困 打哈欠', file: writeAudio(dir, 'yawn.amr', amrOf(2)) },
    { id: 'hi', tag: '打招呼', file: writeAudio(dir, 'hi.amr', amrOf(1)) },
  ]
  return { file: tempFile(rows), rows }
}

describe('语音库', () => {
  it('把整份库列出来，哪段合适由调用方自己挑', () => {
    const { file } = library()

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
    const { file, rows } = library()
    const one = voiceOf(file, 'hi')
    expect(one.ok).toBe(true)
    if (!one.ok) return
    expect(one.voice.file).toBe(rows[1]?.file)

    const miss = voiceOf(file, '自己编的')
    expect(miss.ok).toBe(false)
    if (miss.ok) return
    expect(miss.code).toBe('voice.unknown')
  })

  it('库坏了或多字段都当没这份，不抛', () => {
    expect(readVoices('/没有这份.json')).toEqual([])
    expect(readVoices(tempFile([{ id: 'x', file: 'a.amr', 多余的: 1 }, { 缺字段: true }]))).toEqual([{ id: 'x', tag: '', file: 'a.amr' }])
  })

  it('库里记了时长就带上，没记就不填', () => {
    const rows = readVoices(tempFile([{ id: 'a', file: 'a.amr', durationMs: 1200 }, { id: 'b', file: 'b.amr' }]))

    expect(rows[0]?.durationMs).toBe(1200)
    expect(rows[1]?.durationMs).toBeUndefined()
  })

  it('默认路径落在数据目录下', () => {
    expect(defaultVoiceFile()).toContain('qq-voices.json')
  })
})

describe('发之前量一遍', () => {
  it('AMR 按帧数量时长，超上限就拒绝并说明多少秒', () => {
    const dir = tempDir()
    const file = writeAudio(dir, 'long.amr', amrOf(8))

    const tooLong = inspectVoice({ file }, LIMITS)

    expect(tooLong.ok).toBe(false)
    if (tooLong.ok) return
    expect(tooLong.code).toBe('voice.too_long')
    expect(tooLong.reason).toContain('8 秒')
    expect(tooLong.reason).not.toContain(dir)
    expect(tooLong.hint).toBeTruthy()
  })

  it('量得出来的时长标成量过，认不出格式才按字节估', () => {
    const dir = tempDir()
    const measured = inspectVoice({ file: writeAudio(dir, 'ok.amr', amrOf(3)) }, LIMITS)
    const guessed = inspectVoice({ file: writeAudio(dir, 'blob.bin', Buffer.alloc(3000)) }, LIMITS)

    expect(measured.ok).toBe(true)
    if (!measured.ok) return
    expect(measured.seconds).toBe(3)
    expect(measured.measured).toBe(true)

    expect(guessed.ok).toBe(true)
    if (!guessed.ok) return
    expect(guessed.seconds).toBe(2)
    expect(guessed.measured).toBe(false)
  })

  it('库里记的时长优先，不信字节数', () => {
    const dir = tempDir()
    const file = writeAudio(dir, 'told.bin', Buffer.alloc(3000))

    const outcome = inspectVoice({ file, durationMs: 1200 }, LIMITS)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.seconds).toBe(1.2)
    expect(outcome.measured).toBe(true)
  })

  it('字节超上限就拒绝，说清多大', () => {
    const dir = tempDir()
    const file = writeAudio(dir, 'big.bin', Buffer.alloc(20_000))

    const tooBig = inspectVoice({ file }, { ...LIMITS, maxBytes: 10_000 })

    expect(tooBig.ok).toBe(false)
    if (tooBig.ok) return
    expect(tooBig.code).toBe('voice.too_big')
    expect(tooBig.reason).toContain('MB')
    expect(tooBig.reason).not.toContain(dir)
  })

  it('文件不在了只说不在了，不回传本机路径', () => {
    const missing = inspectVoice({ file: join(tempDir(), '没有这个.amr') }, LIMITS)

    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.code).toBe('voice.missing')
    expect(JSON.stringify(missing)).not.toContain('没有这个')
  })
})

// 一份只认调用次数的假依赖，用来看每一段走到哪一步
type FakeDeps = VoiceSendDeps & { sent: string[]; spent: number[] }

function depsOf(overrides: Partial<VoiceSendDeps> & { sent?: string[]; spent?: number[] } = {}): FakeDeps {
  const sent = overrides.sent ?? []
  const spent = overrides.spent ?? []
  return {
    limits: LIMITS,
    send: async (file) => { sent.push(file); return { ok: true, messageId: '7' } },
    fetch: async () => ({ ok: true, hasRecord: true }),
    quota: { check: () => ({ ok: true }), spend: () => { spent.push(Date.now()) } },
    ...overrides,
    sent,
    spent,
  }
}

describe('发一段语音', () => {
  it('量不过就不发，也不记额度', async () => {
    const dir = tempDir()
    const deps = depsOf()

    const outcome = await sendVoice({ file: writeAudio(dir, 'long.amr', amrOf(9)) }, deps)

    expect(outcome.ok).toBe(false)
    expect(deps.sent).toHaveLength(0)
    expect(deps.spent).toHaveLength(0)
  })

  it('额度用满就不发，写明是哪一本账满了', async () => {
    const dir = tempDir()
    const deps = depsOf({
      quota: {
        check: () => ({ ok: false, code: 'pacing.voice_hour_full', reason: '这一小时发的语音够多了', hint: '这一轮改用文字' }),
        spend: () => {},
      },
    })

    const outcome = await sendVoice({ file: writeAudio(dir, 'ok.amr', amrOf(1)) }, deps)

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('pacing.voice_hour_full')
    expect(deps.sent).toHaveLength(0)
  })

  it('发出去又回读到了语音段，才算确认', async () => {
    const dir = tempDir()
    const deps = depsOf()

    const outcome = await sendVoice({ file: writeAudio(dir, 'ok.amr', amrOf(2)) }, deps)

    expect(outcome).toMatchObject({ ok: true, confirmed: true, seconds: 2, messageId: '7' })
    expect(deps.spent).toHaveLength(1)
  })

  it('回读里没有语音段就只报原因，不回传文件与播放地址', async () => {
    const dir = tempDir()
    const file = writeAudio(dir, 'ok.amr', amrOf(2))
    const deps = depsOf({ fetch: async () => ({ ok: true, hasRecord: false }) })

    const outcome = await sendVoice({ file }, deps)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.confirmed).toBe(false)
    expect(outcome.note).toBeTruthy()
    const shown = JSON.stringify(outcome)
    expect(shown).not.toContain(dir)
    expect(shown).not.toContain('.amr')
    expect(shown).not.toContain('http')
  })

  it('回读本身失败也只报原因，额度照样记一笔免得重复刷', async () => {
    const dir = tempDir()
    const deps = depsOf({ fetch: async () => ({ ok: false, code: 'channel.read_empty', reason: '没读到那一条', hint: '换个编号再看' }) })

    const outcome = await sendVoice({ file: writeAudio(dir, 'ok.amr', amrOf(1)) }, deps)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.confirmed).toBe(false)
    expect(outcome.note).toContain('没读到那一条')
    expect(deps.spent).toHaveLength(1)
  })

  it('发送本身失败时不记额度', async () => {
    const dir = tempDir()
    const deps = depsOf({ send: async () => ({ ok: false, code: 'channel.send_failed', reason: '这一段没发出去' }) })

    const outcome = await sendVoice({ file: writeAudio(dir, 'ok.amr', amrOf(1)) }, deps)

    expect(outcome.ok).toBe(false)
    expect(deps.spent).toHaveLength(0)
  })
})

class VoiceSocket {
  static readonly opened: VoiceSocket[] = []
  /** 回读那一条时里面有没有语音段 */
  static answerRecord = false
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
    const asked = JSON.parse(payload) as { echo?: string; action?: string }
    const echo = asked.echo ?? ''
    if (asked.action === 'get_msg' && VoiceSocket.answerRecord) {
      this.emit('message', JSON.stringify({
        echo,
        retcode: 0,
        data: {
          message_id: 7,
          time: 1_700_000_000,
          sender: { user_id: 999, nickname: '我' },
          message: [{ type: 'record', data: { file: 'sent.amr', url: 'https://example.com/sent.amr' } }],
        },
      }))
      return
    }
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

// 只看真正发出去的那条，不看回读
function sentPayload(): { params?: { message?: unknown } } {
  const sent = VoiceSocket.opened.at(-1)?.sent ?? []
  const last = sent.filter(payload => (JSON.parse(payload) as { action?: string }).action === 'send_group_msg').at(-1)
  return JSON.parse(last ?? '{}') as { params?: { message?: unknown } }
}

interface Mounted {
  tools: Map<string, ToolDefinition>
  pacing: ReturnType<typeof qqPacingOf>
}

function mount(config: Record<string, unknown> = {}, pacingConfig: Record<string, unknown> = {}): Mounted {
  VoiceSocket.answerRecord = true
  vi.stubGlobal('WebSocket', VoiceSocket)
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
  ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
  applyPacing(ctx, { file: join(tempDir(), 'pacing.json'), ...pacingConfig })
  apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', voiceFile: library().file, quietStart: '00:00', quietEnd: '00:00', ...config })
  VoiceSocket.opened.at(-1)?.open()
  return { tools, pacing: qqPacingOf(ctx) }
}

describe('语音、引用与状态的工具', () => {
  it('四个工具都挂上了', () => {
    const { tools } = mount()

    expect([...tools.keys()]).toEqual(expect.arrayContaining(['qq_list_voices', 'qq_send_voice', 'qq_reply', 'qq_channel_status']))
  })

  it('发语音走的是一段录音，不是文字', async () => {
    const { tools } = mount()
    const send = tools.get('qq_send_voice')
    if (send === undefined) throw new Error('没挂上发语音的工具')

    const result = await send.execute({ voice_id: 'yawn' }, execOf('group:1')) as { ok: boolean; confirmed: boolean; seconds: number }

    expect(result).toHaveProperty('ok', true)
    expect(result.confirmed).toBe(true)
    expect(result.seconds).toBe(2)
    expect((sentPayload().params?.message as unknown[])[0]).toMatchObject({ type: 'record' })
  })

  it('回读没看到语音段时不报确认成功，也不回传文件与地址', async () => {
    const { tools } = mount()
    VoiceSocket.answerRecord = false
    const send = tools.get('qq_send_voice')
    if (send === undefined) throw new Error('没挂上发语音的工具')

    const result = await send.execute({ voice_id: 'yawn' }, execOf('group:1')) as { ok: boolean; confirmed: boolean; note?: string }

    expect(result.ok).toBe(true)
    expect(result.confirmed).toBe(false)
    expect(result.note).toBeTruthy()
    const shown = JSON.stringify(result)
    expect(shown).not.toContain('.amr')
    expect(shown).not.toContain('http')
  })

  it('语音额度用满就发不出去，且不占正文额度', async () => {
    const { tools, pacing } = mount({}, { voicePerHour: 1 })
    const send = tools.get('qq_send_voice')
    if (send === undefined) throw new Error('没挂上发语音的工具')

    await send.execute({ voice_id: 'yawn' }, execOf('group:1'))
    await expect(send.execute({ voice_id: 'hi' }, execOf('group:1'))).rejects.toThrow(/pacing\.voice_hour_full/)
    // 正文那本账一段没动，语音那本账记了一段
    expect(pacing?.used().hourCount).toBe(0)
    expect(pacing?.voiceUsed().hourCount).toBe(1)
  })

  it('引用回复带引用段与正文两段', async () => {
    const { tools } = mount()
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
    const { tools } = mount()
    const status = tools.get('qq_channel_status')
    if (status === undefined) throw new Error('没挂上看状态的工具')

    const result = await status.execute({}, execOf('group:1')) as { connected: boolean; url: string; reconnectCount: number; lastError: string }

    expect(result.connected).toBe(true)
    expect(result.url).toBe('ws://127.0.0.1:6700')
    expect(result.reconnectCount).toBe(0)
  })
})
