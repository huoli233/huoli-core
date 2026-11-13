import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWsChannel, WS_DEFAULTS, type WsChannel } from '../src/ws.ts'

// 只记下发出去了什么、从不回话的假连接：等回话那一路必然走到超时
class SilentSocket {
  static readonly opened: SilentSocket[] = []
  readyState = 1
  readonly sent: string[] = []
  private readonly handlers = new Map<string, Array<(event: { data?: string }) => void>>()

  constructor() {
    SilentSocket.opened.push(this)
  }

  addEventListener(type: string, handler: (event: { data?: string }) => void): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  removeEventListener(): void {}

  // 收下这一帧就装死：不回话，等回话的那一路才会走到超时
  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {}
}

function mount(options: { callTimeoutMs?: number } = {}): WsChannel {
  return createWsChannel(
    { url: 'ws://127.0.0.1:1', selfId: '10000', ...options },
    { onMessage: () => {}, onStatus: () => {}, log: () => {} },
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', SilentSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  SilentSocket.opened.length = 0
})

describe('等回话的超时', () => {
  it('配多久就等多久，不是写死十五秒', async () => {
    const channel = mount({ callTimeoutMs: 2_000 })
    channel.start()
    const sending = channel.send('喂', 'group:1')

    await vi.advanceTimersByTimeAsync(1_999)
    expect(SilentSocket.opened[0]?.sent).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2)
    await expect(sending).resolves.toMatchObject({ ok: false, code: 'channel.timeout', outcome: 'unknown' })
  })

  it('不配就按参数表那一档', async () => {
    const channel = mount()
    channel.start()
    const sending = channel.send('喂', 'group:1')

    await vi.advanceTimersByTimeAsync(WS_DEFAULTS.callTimeoutMs - 1)
    await vi.advanceTimersByTimeAsync(2)

    await expect(sending).resolves.toMatchObject({ ok: false, code: 'channel.timeout' })
  })

  it('请求发出后没收到回执，主动额度按保守方式记入', async () => {
    const channel = mount({ callTimeoutMs: 2_000 })
    const settled: boolean[] = []
    channel.useProactiveSendQuota(() => ({
      ok: true,
      settle: (sent) => { settled.push(sent) },
    }))
    channel.start()
    const sending = channel.send('喂', 'group:1')

    await vi.advanceTimersByTimeAsync(2_001)
    await expect(sending).resolves.toMatchObject({ ok: false, code: 'channel.timeout', outcome: 'unknown' })
    expect(settled).toEqual([true])
  })

  it('配得比下限还小也按不低于下限算', async () => {
    const channel = mount({ callTimeoutMs: 1 })
    channel.start()
    const sending = channel.send('喂', 'group:1')

    let settled = false
    void sending.then(() => {
      settled = true
    })
    // 下限是一秒，所以九百毫秒时还没超时
    await vi.advanceTimersByTimeAsync(900)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(200)
    await expect(sending).resolves.toMatchObject({ ok: false, code: 'channel.timeout' })
  })
})
