import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyChannel } from '@huoli/huoli-qq-channel'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  qqVitalsOf,
  resolveTuning,
  type Config as VitalsConfig,
} from '@huoli/huoli-qq-vitals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, type Config as BundleConfig } from '../src/index.ts'

type SocketHandler = (event: { data?: string }) => void

class FakeSocket {
  static readonly opened: FakeSocket[] = []
  readyState = 0
  private readonly handlers = new Map<string, SocketHandler[]>()

  constructor() {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, handler: SocketHandler): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(): void {}

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

const tuning = resolveTuning()
const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-mortality-'))
  tempDirs.push(dir)
  return dir
}

// 身体先跑了两分钟：结算最小间隔是整 60 秒，消息时间又是整秒，卡太近会漏掉一拍
async function mount(bundle: BundleConfig, vitals: VitalsConfig = {}): Promise<Context> {
  const dir = tempDir()
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, Date.now() - 120_000) })
  const ctx = new Context()
  contexts.push(ctx)
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyVitals(ctx, { file, tuning: { startDelayMs: 60 * 60_000 }, ...vitals })
  applyChannel(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999' })
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepAt: '04:00',
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    livenessFile: path.join(dir, 'liveness.json'),
    ...bundle,
  })
  FakeSocket.opened.at(-1)?.open()
  return ctx
}

const second = (): number => Math.floor(Date.now() / 1000)

function groupMessage(text: string, id: number, time: number): Record<string, unknown> {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: 123,
    user_id: 555,
    sender: { card: '阿澈' },
    message: [{ type: 'text', data: { text } }],
    message_id: id,
    time,
  }
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('余额接进死亡威胁', () => {
  it('没配余额就是没有来源，死亡威胁一分不动', async () => {
    const ctx = await mount({})
    const seam = qqVitalsOf(ctx)

    FakeSocket.opened.at(-1)?.deliver(groupMessage('在吗', 1, second()))

    expect(seam?.read().mortality).toBe(0)
  })

  it('余额见底时死亡威胁朝危机档往上走', async () => {
    const ctx = await mount({ balanceLevel: 0 })
    const seam = qqVitalsOf(ctx)

    FakeSocket.opened.at(-1)?.deliver(groupMessage('在吗', 1, second()))

    expect(seam?.read().mortality).toBeGreaterThan(0)
  })

  it('余额宽裕时不往危机档走', async () => {
    const ctx = await mount({ balanceLevel: 100 })
    const seam = qqVitalsOf(ctx)

    FakeSocket.opened.at(-1)?.deliver(groupMessage('在吗', 1, second()))

    expect(seam?.read().mortality).toBe(0)
  })

  it('说过一句就一直在涨，攒到遗书线要好几拍', async () => {
    const ctx = await mount({ balanceLevel: 0 })
    const seam = qqVitalsOf(ctx)
    const socket = FakeSocket.opened.at(-1)
    const start = second()

    // 每一拍之间隔够结算最小间隔，否则同一分钟里的后两句不另算一拍
    for (let at = 1; at <= 3; at += 1) socket?.deliver(groupMessage(`第 ${at} 句`, at, start + at * 120))

    expect(seam?.read().mortality).toBeGreaterThan(0.2)
  })
})
