import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyPacing, qqPacingOf, type QqPacingSeam } from '@huoli/huoli-qq-pacing'
import { apply as applyChannel } from '../src/index.ts'
import { createOutboundCheck, OUTBOUND_DEFAULTS, type OutboundCheck, type OutboundTuning } from '../src/outbound.ts'

const dirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-quota-unified-'))
  dirs.push(dir)
  return path.join(dir, 'pacing.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

interface Mounted {
  pacing: QqPacingSeam
  outbound: OutboundCheck
}

// 体检按说话规矩那处的判据走，和真的发送链一样
function mount(pacingConfig: Record<string, unknown> = {}, tuning: Partial<OutboundTuning> = {}): Mounted {
  const ctx = new Context()
  applyPacing(ctx, { file: tempFile(), repeatWindowMs: 0, ...pacingConfig })
  const pacing = qqPacingOf(ctx)
  if (pacing === undefined) throw new Error('说话规矩没有装配')
  const outbound = createOutboundCheck(
    {
      ...OUTBOUND_DEFAULTS,
      quietStart: '00:00',
      quietEnd: '00:00',
      floodGuardEnabled: false,
      ...tuning,
    },
    undefined,
    undefined,
    { allow: text => pacing.allow(text) },
  )
  return { pacing, outbound }
}

const GROUP = 'group:123'

describe('三档配额的码分得清', () => {
  it('分钟档拦下是体检自己那一个码', () => {
    const { pacing, outbound } = mount({}, { perMinute: 1 })
    outbound.record(GROUP, Date.now())

    const verdict = outbound.check({ chatKey: GROUP, text: '再来一句测试内容' })

    expect(verdict.code).toBe('outbound.rate')
    expect(verdict.reason).toContain('一分钟')
    expect(pacing.allow('再来一句测试内容').ok).toBe(true)
  })

  it('小时档拦下是说话规矩那一个码，说清这一小时说了多少条', () => {
    const { pacing, outbound } = mount({ perHour: 2, perDay: 9 })
    pacing.spend('第一句正文')
    pacing.spend('第二句正文')

    const verdict = outbound.check({ chatKey: GROUP, text: '第三句正文' })

    expect(verdict.code).toBe('pacing.hour_full')
    expect(verdict.reason).toContain('2')
    expect(verdict.hint).toBeTruthy()
    expect(verdict.retryAt).toBeGreaterThan(Date.now())
  })

  it('日档拦下是日这一档的码，说清今天说了多少条', () => {
    const { pacing, outbound } = mount({ perHour: 50, perDay: 2 })
    pacing.spend('第一句正文')
    pacing.spend('第二句正文')

    const verdict = outbound.check({ chatKey: GROUP, text: '第三句正文' })

    expect(verdict.code).toBe('pacing.day_full')
    expect(verdict.reason).toContain('2')
  })

  it('三档的码互不相同', () => {
    const minute = mount({}, { perMinute: 1 })
    minute.outbound.record(GROUP, Date.now())
    const hour = mount({ perHour: 1 })
    hour.pacing.spend('第一句正文')
    const day = mount({ perHour: 50, perDay: 1 })
    day.pacing.spend('第一句正文')

    const codes = [
      minute.outbound.check({ chatKey: GROUP, text: '一句正文' }).code,
      hour.outbound.check({ chatKey: GROUP, text: '一句正文' }).code,
      day.outbound.check({ chatKey: GROUP, text: '一句正文' }).code,
    ]

    expect(new Set(codes).size).toBe(3)
    expect(codes).toEqual(['outbound.rate', 'pacing.hour_full', 'pacing.day_full'])
  })
})

describe('体检与发送问的是同一处', () => {
  it('体检放行时说话规矩也放行，反之亦然', () => {
    const { pacing, outbound } = mount({ perHour: 3, perDay: 9 })
    const text = '这句正文还没说过'

    expect(outbound.check({ chatKey: GROUP, text }).ok).toBe(pacing.allow(text).ok)

    pacing.spend('第一句正文')
    pacing.spend('第二句正文')
    pacing.spend('第三句正文')

    const verdict = outbound.check({ chatKey: GROUP, text })
    const allowed = pacing.allow(text)

    expect(verdict.ok).toBe(false)
    expect(allowed.ok).toBe(false)
    expect(verdict.code).toBe(allowed.code)
  })

  it('配额用满后再问几次都不重复累加', () => {
    const { pacing, outbound } = mount({ perHour: 1 })
    pacing.spend('第一句正文')

    for (let round = 0; round < 5; round += 1) {
      outbound.check({ chatKey: GROUP, text: `第 ${round} 句正文` })
      pacing.allow(`第 ${round} 句正文`)
    }

    expect(pacing.used()).toMatchObject({ hourCount: 1, dayCount: 1 })
  })

  it('空正文这一档不查：表情、戳一戳与语音各走各的账', () => {
    const { pacing, outbound } = mount({ perHour: 1 })
    pacing.spend('第一句正文')

    expect(outbound.check({ chatKey: GROUP, text: '再来一句正文' }).code).toBe('pacing.hour_full')
    expect(outbound.check({ chatKey: GROUP, text: '' }).ok).toBe(true)
  })

  it('没有接判据时只查体检自己这一侧', () => {
    const outbound = createOutboundCheck({ ...OUTBOUND_DEFAULTS, quietStart: '00:00', quietEnd: '00:00' })

    expect(outbound.check({ chatKey: GROUP, text: '一句正文' }).ok).toBe(true)
  })
})

describe('语音走同一处判据', () => {
  it('语音那本账用满时给语音自己的码，不影响文字这一档', () => {
    const { pacing, outbound } = mount({ voicePerHour: 1 })
    pacing.voiceSpend()

    expect(pacing.voiceAllow().code).toBe('pacing.voice_hour_full')
    expect(outbound.check({ chatKey: GROUP, text: '一句正文' }).ok).toBe(true)
  })

  it('文字用满也不会把语音拦下来', () => {
    const { pacing } = mount({ perHour: 1, voicePerHour: 5 })
    pacing.spend('第一句正文')

    expect(pacing.allow('第二句正文').code).toBe('pacing.hour_full')
    expect(pacing.voiceAllow().ok).toBe(true)
  })
})

// 装配层用一条假连接跑真的发送工具，看接上以后拦在哪一步
class QuietSocket {
  static readonly opened: QuietSocket[] = []
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, ((event: { data?: string }) => void)[]>()

  constructor() {
    QuietSocket.opened.push(this)
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

  // 只看真正发出去的正文，不看心跳与回执
  bodies(): string[] {
    return this.sent
      .map(payload => JSON.parse(payload) as { action?: string; params?: { message?: unknown } })
      .filter(item => item.action === 'send_group_msg')
      .map(item => (typeof item.params?.message === 'string' ? item.params.message : ''))
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface MountedChannel {
  tools: Map<string, ToolDefinition>
  pacing: QqPacingSeam
  socket: QuietSocket
}

describe('装配以后拦在同一处', () => {
  afterEach(() => {
    QuietSocket.opened.length = 0
    vi.unstubAllGlobals()
  })

  function mountChannel(pacingConfig: Record<string, unknown>): MountedChannel {
    vi.stubGlobal('WebSocket', QuietSocket)
    const ctx = new Context()
    const tools = new Map<string, ToolDefinition>()
    ctx.accessor('tools', { get: () => ({ register: (definition: ToolDefinition) => { tools.set(definition.name, definition); return () => {} } }) })
    ctx.logger.exporter({ levels: { default: 3 }, export: () => {} })
    applyPacing(ctx, { file: tempFile(), repeatWindowMs: 0, ...pacingConfig })
    applyChannel(ctx, {
      url: 'ws://127.0.0.1:6700',
      selfId: '999',
      quietStart: '00:00',
      quietEnd: '00:00',
      replySingleMessage: true,
      actionsFile: path.join(path.dirname(tempFile()), 'actions.json'),
    })
    const socket = QuietSocket.opened.at(-1)
    if (socket === undefined) throw new Error('连接没建起来')
    socket.open()
    const pacing = qqPacingOf(ctx)
    if (pacing === undefined) throw new Error('说话规矩没有装配')
    return { tools, pacing, socket }
  }

  it('小时额度用满时发送工具在体检这一步就被拦下，码来自说话规矩', async () => {
    const { tools, pacing, socket } = mountChannel({ perHour: 1 })
    const send = tools.get('qq_send_message')
    if (send === undefined) throw new Error('没挂上发送工具')
    pacing.spend('先说一句正文')

    await expect(send.execute({ text: '再来一句正文' }, execOf('group:1'))).rejects.toThrow(/pacing\.hour_full/)
    // 一条都没发出去，也没有把额度再记一笔
    expect(socket.bodies()).toHaveLength(0)
    expect(pacing.used().hourCount).toBe(1)
  })

  it('额度没满时照常发出去，只记一笔', async () => {
    const { tools, pacing, socket } = mountChannel({ perHour: 3 })
    const send = tools.get('qq_send_message')
    if (send === undefined) throw new Error('没挂上发送工具')

    await send.execute({ text: '在的' }, execOf('group:1'))

    expect(socket.bodies()).toHaveLength(1)
    expect(pacing.used().hourCount).toBe(1)
  })

  it('主会话不受重复内容和小时额度拦阻，其他人仍受限', async () => {
    vi.stubEnv('QQ_CREATOR_ID', 'owner')
    const { tools, pacing, socket } = mountChannel({ perHour: 1, repeatWindowMs: 60_000 })
    const send = tools.get('qq_send_message')
    if (send === undefined) throw new Error('没挂上发送工具')
    pacing.spend('同一句话')

    await expect(send.execute({ text: '同一句话' }, execOf('private:owner'))).resolves.toMatchObject({ parts: 1 })
    expect(socket.sent).toHaveLength(1)
    vi.stubEnv('QQ_CREATOR_ID', '')
  })
})
