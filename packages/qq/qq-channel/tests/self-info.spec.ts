import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition } from '@huoli/huoli-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, qqChannelOf, type Config, type SelfInfo } from '../src/index.ts'
import { selfInfoFact } from '../src/self-info.ts'

type SocketHandler = (event: { data?: string }) => void

interface SelfReply {
  userId: number | string
  nickname: string
  code?: number
  silent?: boolean
}

// 业务连接 open 的那一刻新建的连接算身份短连接，其余算业务连接
let openingBusiness = false

// 业务连接：只认自己发出去的动作，当场回一个 echo
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
    this.emit('message', JSON.stringify({ echo, retcode: 0, data: { message_id: this.sent.length, messages: [] } }))
  }

  close(): void {
    this.readyState = 3
    this.emit('close')
  }

  open(): void {
    this.readyState = 1
    openingBusiness = true
    try { this.emit('open') } finally { openingBusiness = false }
  }

  actions(): string[] {
    return this.sent.map(payload => (JSON.parse(payload) as { action?: string }).action ?? '')
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

// 身份短连接：连上就问一次，按第几次问给回话，装死时留给超时那一档
class ProbeSocket {
  static readonly opened: ProbeSocket[] = []
  static replies: SelfReply[] = []
  readonly index = ProbeSocket.opened.length
  readyState = 0
  readonly sent: string[] = []
  private readonly handlers = new Map<string, SocketHandler[]>()

  constructor() {
    ProbeSocket.opened.push(this)
    void Promise.resolve().then(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.emit('open')
    })
  }

  addEventListener(type: string, handler: SocketHandler): void {
    const list = this.handlers.get(type) ?? []
    if (list.length === 0) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(payload: string): void {
    this.sent.push(payload)
    const parsed = JSON.parse(payload) as { echo?: string; action?: string }
    if (parsed.action !== 'get_login_info' || parsed.echo === undefined) return
    const reply = ProbeSocket.replies[this.index] ?? ProbeSocket.replies.at(-1)
    if (reply?.silent === true) return
    const code = reply?.code ?? 0
    void Promise.resolve().then(() => {
      this.emit('message', JSON.stringify({
        echo: parsed.echo,
        retcode: code,
        data: reply === undefined
          ? { user_id: 10000, nickname: '网关名字' }
          : { user_id: reply.userId, nickname: reply.nickname },
        ...code === 0 ? {} : { wording: '对方拒了' },
      }))
    })
  }

  close(): void {
    this.readyState = 3
    this.emit('close')
  }

  private emit(type: string, data?: string): void {
    for (const handler of this.handlers.get(type) ?? []) handler(data === undefined ? {} : { data })
  }
}

function SocketCtor(): FakeSocket | ProbeSocket {
  return openingBusiness ? new ProbeSocket() : new FakeSocket()
}

interface Mounted {
  ctx: Context
  socket: FakeSocket
  logs: string[]
  info: () => SelfInfo | undefined
  fact: () => string | undefined
  send: (text: string) => Promise<{ ok: boolean }>
}

const OPEN_HOURS = { quietStart: '00:00', quietEnd: '00:00' }
const tempDirs: string[] = []

function mount(patch: Partial<Config> = {}): Mounted {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-info-'))
  tempDirs.push(dir)
  const ctx = new Context()
  ctx.accessor('tools', {
    get: () => ({ register: (_definition: ToolDefinition) => () => {} }),
  })
  const logs: string[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: ({ args }) => { logs.push(String(args[0])) } })
  apply(ctx, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    selfName: '配置名字',
    sentLedgerFile: path.join(dir, 'sent.json'),
    actionsFile: path.join(dir, 'actions.json'),
    ...OPEN_HOURS,
    ...patch,
  })
  const socket = FakeSocket.opened.at(-1)
  if (socket === undefined) throw new Error('连接没建起来')
  socket.open()
  const seam = qqChannelOf(ctx)
  if (seam === undefined) throw new Error('服务接口没装上')
  return {
    ctx,
    socket,
    logs,
    info: () => seam.selfInfo(),
    fact: () => seam.selfInfoFact(),
    send: text => seam.send(text, 'group:1'),
  }
}

async function flush(rounds = 12): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve()
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  ProbeSocket.opened.length = 0
  ProbeSocket.replies = []
  openingBusiness = false
  vi.stubGlobal('WebSocket', SocketCtor)
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('网关身份', () => {
  it('状态只留在当前实例里，没读到时明说是配置兜底', () => {
    const store = selfInfoFact({ nickname: '配置名字', qqId: '999', fetched: false, fetchedAt: 0, fallback: true })
    expect(store).toContain('STATE: fallback')
    expect(store).toContain('不是网关当前昵称与号')
    expect(store).toContain('NAME: 配置名字')
    expect(store).toContain('QQ: 999')
  })

  it('连上取到网关名字与号，从既有服务接口读到', async () => {
    ProbeSocket.replies = [{ userId: 10001, nickname: '现在的名字' }]
    const { info, fact, socket } = mount({ selfInfoEnabled: true })
    await flush()

    expect(socket.actions()).not.toContain('get_login_info')
    expect(ProbeSocket.opened[0]?.sent.some(frame => frame.includes('get_login_info'))).toBe(true)
    expect(info()).toMatchObject({ nickname: '现在的名字', qqId: '10001', fetched: true, fallback: false })
    expect(info()?.fetchedAt).toBeGreaterThan(0)
    expect(fact()).toContain('STATE: gateway')
    expect(fact()).toContain('名字与号来自网关当前登录信息')
  })

  it('重连后再问一次并刷新', async () => {
    vi.useFakeTimers()
    ProbeSocket.replies = [
      { userId: 10001, nickname: '旧名字' },
      { userId: 10002, nickname: '新名字' },
    ]
    const { ctx, info, socket } = mount({ reconnectMs: 1_000, selfInfoEnabled: true })
    await flush()
    expect(info()).toMatchObject({ nickname: '旧名字', qqId: '10001' })

    socket.close()
    await vi.advanceTimersByTimeAsync(1_000)
    const second = FakeSocket.opened.at(-1)
    if (second === undefined || second === socket) throw new Error('重连没建起来')
    second.open()
    await flush()

    expect(info()).toMatchObject({ nickname: '新名字', qqId: '10002', fetched: true })
    expect(ProbeSocket.opened).toHaveLength(2)
    expect(second.actions()).not.toContain('get_login_info')
    qqChannelOf(ctx)?.channel.stop()
  })

  it('关掉重连刷新就只问第一次，留着旧值', async () => {
    vi.useFakeTimers()
    ProbeSocket.replies = [
      { userId: 10001, nickname: '旧名字' },
      { userId: 10002, nickname: '新名字' },
    ]
    const { ctx, info, socket } = mount({ reconnectMs: 1_000, selfInfoEnabled: true, selfInfoRefreshOnReconnect: false })
    await flush()
    socket.close()
    await vi.advanceTimersByTimeAsync(1_000)
    const second = FakeSocket.opened.at(-1)
    if (second === undefined || second === socket) throw new Error('重连没建起来')
    second.open()
    await flush()

    expect(ProbeSocket.opened).toHaveLength(1)
    expect(second.actions()).not.toContain('get_login_info')
    expect(info()).toMatchObject({ nickname: '旧名字', qqId: '10001' })
    qqChannelOf(ctx)?.channel.stop()
  })

  it('取不到时回退配置且事实里标兜底，失败有记录', async () => {
    ProbeSocket.replies = [{ userId: 0, nickname: '', code: 100 }]
    const { info, fact, logs } = mount({ selfInfoEnabled: true })
    await flush()

    expect(info()).toMatchObject({ nickname: '配置名字', qqId: '999', fetched: false, fetchedAt: 0, fallback: true, lastFailure: 'channel.100' })
    expect(fact()).toContain('STATE: fallback')
    expect(fact()).toContain('部署配置里的兜底值')
    expect(fact()).toContain('LAST_FAILURE: channel.100')
    expect(logs.some(line => line.includes('网关身份没读到'))).toBe(true)
  })

  it('缺字段当作没读到，失败码写进事实', async () => {
    ProbeSocket.replies = [{ userId: 10001, nickname: '' }]
    const { info, fact } = mount({ selfInfoEnabled: true })
    await flush()

    expect(info()?.lastFailure).toBe('self_info.incomplete')
    expect(fact()).toContain('STATE: fallback')
  })

  it('等回话超时不影响既有收发，也不挡住发送', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_760_000_000_000)
    ProbeSocket.replies = [{ userId: 0, nickname: '', silent: true }]
    const { info, fact, send, logs, socket } = mount({ selfInfoEnabled: true, selfInfoTimeoutMs: 1_200 })
    const sending = send('照样能发')
    await vi.advanceTimersByTimeAsync(1_250)
    await flush()
    await expect(sending).resolves.toMatchObject({ ok: true })

    expect(socket.actions()).toEqual(['send_group_msg'])
    expect(info()).toMatchObject({ nickname: '配置名字', qqId: '999', fallback: true, lastFailure: 'channel.timeout' })
    expect(fact()).toContain('STATE: fallback')
    expect(logs.some(line => line.includes('网关身份没读到'))).toBe(true)
  })

  it('关掉开关一条都不请求，仍给配置兜底事实', async () => {
    const { socket, info, fact } = mount({ selfInfoEnabled: false })
    await flush()

    expect(ProbeSocket.opened).toHaveLength(0)
    expect(socket.actions()).not.toContain('get_login_info')
    expect(info()).toMatchObject({ nickname: '配置名字', qqId: '999', fallback: true, fetched: false })
    expect(fact()).toContain('STATE: fallback')
  })

  it('默认不传时业务连接帧序列里没有身份请求，既有收发不受影响', async () => {
    const { socket, info, send } = mount()
    await flush()

    expect(ProbeSocket.opened).toHaveLength(0)
    expect(socket.actions()).not.toContain('get_login_info')
    await expect(send('照样能发')).resolves.toMatchObject({ ok: true })
    expect(socket.actions()).toEqual(['send_group_msg'])
    expect(info()).toMatchObject({ nickname: '配置名字', qqId: '999', fallback: true, fetched: false })
  })

  it('上层不改也能从既有服务接口读到同一份身份', async () => {
    ProbeSocket.replies = [{ userId: '10003', nickname: '另一个名字' }]
    const { ctx, info, fact } = mount({ selfInfoEnabled: true })
    await flush()
    const seam = qqChannelOf(ctx.root)
    expect(seam?.selfInfo()).toEqual(info())
    expect(seam?.selfInfoFact()).toBe(fact())
    expect(seam?.selfId).toBe('999')
    expect(seam?.channel.selfInfo()).toEqual(info())
  })
})
