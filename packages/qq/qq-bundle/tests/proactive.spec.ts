import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention } from '@huoli/huoli-qq-attention'
import { apply as applyChannel, qqChannelOf } from '@huoli/huoli-qq-channel'
import { apply as applyMaterial, qqMaterialOf } from '@huoli/huoli-qq-material'
import { apply as applyProactive, PROACTIVE_DEFAULTS, qqProactiveOf, type PendingItem, type QqProactiveSeam } from '@huoli/huoli-qq-proactive'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import { apply as applyVitals, createVitalsStore, DEFAULTS, emptyState, type VitalsState } from '@huoli/huoli-qq-vitals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, BUNDLE_DEFAULTS, qqBundleOf, type Config as BundleConfig, type DecisionRecord } from '../src/index.ts'

type SocketHandler = (event: { data?: string }) => void

// 只留住那一头的事件，测试自己决定什么时候把话送进来
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

interface Mounted {
  ctx: Context
  socket: FakeSocket
  proactive: QqProactiveSeam
  dir: string
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-proactive-wiring-'))
  tempDirs.push(dir)
  return dir
}

const NO_QUIET = { quietStart: '00:00', quietEnd: '00:00' }

// 先把身体落成想要的那一态，装配时读到的就是它；一分钟内的读取不结算漂移，钟点不影响结果
function seedBody(dir: string, patch: Partial<VitalsState>): string {
  const file = path.join(dir, 'qq-vitals.json')
  createVitalsStore({ file, tuning: DEFAULTS }).write({ ...emptyState(DEFAULTS, Date.now()), ...patch })
  return file
}

// 睡着那一态取午睡：午睡只认到点醒，不会被按钟点叫醒，用例与当前几点无关
function sleepingBody(wakeAfter: number): Partial<VitalsState> {
  return { sleep_state: 'sleeping', sleep_kind: 'nap', nap_at: Date.now(), wake_after: wakeAfter, adenosine: 0.9 }
}

// 刚被吵醒那一态：迷糊窗口还没过
function wakingBody(): Partial<VitalsState> {
  return { sleep_state: 'waking', woken_at: Date.now(), groggy_until: Date.now() + 10 * 60_000, adenosine: 0.9 }
}

interface MountOptions {
  enabled: boolean
  throttleMs?: number
  body?: Partial<VitalsState>
  bundle?: Partial<BundleConfig>
}

async function mount(options: MountOptions): Promise<Mounted> {
  const dir = tempDir()
  const ctx = new Context()
  contexts.push(ctx)
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  if (options.body !== undefined) applyVitals(ctx, { file: seedBody(dir, options.body) })
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyMaterial(ctx, { thoughtsFile: path.join(dir, 'thoughts.json') })
  applyProactive(ctx, { file: path.join(dir, 'proactive.json'), enabled: options.enabled, ...NO_QUIET })
  applyChannel(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999' })
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepAt: '04:00',
    decisionsFile: path.join(dir, 'qq-decisions.jsonl'),
    ...options.throttleMs !== undefined ? { proactiveThrottleMs: options.throttleMs } : {},
    ...(options.bundle ?? {}),
  })
  const socket = FakeSocket.opened.at(-1)
  const proactive = qqProactiveOf(ctx)
  if (socket === undefined || proactive === undefined) throw new Error('没装起来')
  socket.open()
  return { ctx, socket, proactive, dir }
}

const AGENT = { id: 'group:1' } as Agent

// 一轮收尾，组合包就是在这里问她要不要开口
async function endTurn(ctx: Context): Promise<void> {
  await ctx.serial('agent/turn-stopping', { agent: AGENT, turn: 1, signal: new AbortController().signal })
}

function proactiveRecords(ctx: Context): DecisionRecord[] {
  const seam = qqBundleOf(ctx)
  if (seam === undefined) throw new Error('组合包没装上')
  return seam.decisions(0, 50).filter(record => record.reason?.startsWith('proactive:') === true)
}

const second = (): number => Math.floor(Date.now() / 1000)

function groupMessage(text: string, id: number): Record<string, unknown> {
  return {
    post_type: 'message',
    message_type: 'group',
    group_id: 1,
    user_id: 555,
    sender: { card: '阿澈' },
    message: [{ type: 'text', data: { text } }],
    message_id: id,
    time: second(),
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

describe('关着的时候', () => {
  it('一次都不问，也不往盘上写', async () => {
    const { ctx, proactive, dir } = await mount({ enabled: false })
    const asking = vi.spyOn(proactive, 'consider')

    await endTurn(ctx)

    expect(asking).not.toHaveBeenCalled()
    expect(proactiveRecords(ctx)).toHaveLength(0)
    expect(fs.existsSync(path.join(dir, 'proactive.json'))).toBe(false)
  })
})

describe('开了以后', () => {
  it('攒住的候选当场摆出来，拿编号就能投出去', async () => {
    const { ctx, proactive } = await mount({ enabled: true })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('周末那个游戏叫什么来着', 'group:1')

    await endTurn(ctx)
    const shown = proactive.preview('group:1')
    const target = shown[0]
    if (target === undefined) throw new Error('没有攒住任何一条')

    const delivered = proactive.deliver('group:1', target.id)

    expect(shown.map(item => item.text)).toEqual(['周末那个游戏叫什么来着'])
    expect(delivered.ok).toBe(true)
    expect(delivered.item?.text).toBe('周末那个游戏叫什么来着')
  })

  it('没候选也落一条记录，但不产生待发', async () => {
    const { ctx, proactive } = await mount({ enabled: true })

    await endTurn(ctx)

    expect(proactive.preview('group:1')).toHaveLength(0)
    expect(proactiveRecords(ctx).map(record => record.reason)).toEqual(['proactive:no_candidate'])
  })

  it('每轮收尾各落一条，理由都是 proactive 开头', async () => {
    const { ctx } = await mount({ enabled: true })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('想说说楼下新开的店', 'group:1')

    await endTurn(ctx)
    await endTurn(ctx)

    const reasons = proactiveRecords(ctx).map(record => record.reason)
    expect(reasons).toHaveLength(2)
    for (const reason of reasons) expect(reason?.startsWith('proactive:')).toBe(true)
    expect(reasons[0]).toBe('proactive:preview_ready')
  })

  it('刚投过一条，下一轮立刻被冷却拦下并记下码', async () => {
    const { ctx, proactive } = await mount({ enabled: true })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('想说说楼下新开的店', 'group:1')
    await endTurn(ctx)
    const target = proactive.preview('group:1')[0]
    if (target === undefined) throw new Error('没有攒住任何一条')
    proactive.deliver('group:1', target.id)

    await endTurn(ctx)

    expect(proactiveRecords(ctx).map(record => record.reason)).toEqual(['proactive:preview_ready', 'proactive:too_soon'])
  })
})

describe('入站之后的节流', () => {
  it('节流窗口里再来一条不再问一次', async () => {
    const { ctx, socket } = await mount({ enabled: true, throttleMs: 60 * 60_000 })

    socket.deliver(groupMessage('在吗', 11))
    socket.deliver(groupMessage('在不在', 12))

    expect(proactiveRecords(ctx)).toHaveLength(1)
  })

  it('节流窗口为零时每来一条都问一次', async () => {
    const { ctx, socket } = await mount({ enabled: true, throttleMs: 0 })

    socket.deliver(groupMessage('在吗', 21))
    socket.deliver(groupMessage('在不在', 22))

    expect(proactiveRecords(ctx)).toHaveLength(2)
  })
})

describe('睡着的时候', () => {
  const WAKE = Date.now() + 3 * 60 * 60_000

  it('睡着时一条候选都不攒，记录里写 proactive:asleep 与醒点', async () => {
    const { ctx, proactive, dir } = await mount({ enabled: true, body: sleepingBody(WAKE) })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('想说说楼下新开的店', 'group:1')

    await endTurn(ctx)

    const last = proactiveRecords(ctx).at(-1)
    expect(last?.reason).toBe('proactive:asleep')
    expect(last?.blocked).toEqual({ code: 'proactive.asleep', retryAt: WAKE })
    expect(fs.existsSync(path.join(dir, 'proactive.json'))).toBe(false)
    expect(proactive.preview('group:1')).toHaveLength(0)
  })

  it('睡着时待发条数前后一样', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: sleepingBody(WAKE) })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('想说说楼下新开的店', 'group:1')
    const before = proactive.pending.all().length

    await endTurn(ctx)

    expect(proactive.pending.all()).toHaveLength(before)
  })

  it('刚被吵醒时延后再来，记录里写 proactive:waking', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: wakingBody() })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('想说说楼下新开的店', 'group:1')
    const before = Date.now()

    await endTurn(ctx)
    const after = Date.now()

    const last = proactiveRecords(ctx).at(-1)
    const delay = PROACTIVE_DEFAULTS.wakingDelayMs
    expect(last?.reason).toBe('proactive:waking')
    expect(last?.blocked?.code).toBe('proactive.waking')
    expect(last?.blocked?.retryAt).toBeGreaterThanOrEqual(before + delay)
    expect(last?.blocked?.retryAt).toBeLessThanOrEqual(after + delay)
    expect(proactive.preview('group:1')).toHaveLength(0)
  })

  it('醒着时照旧攒候选', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: { sleep_state: 'awake', adenosine: 0.2 } })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('想说说楼下新开的店', 'group:1')

    await endTurn(ctx)

    expect(proactive.preview('group:1').map(item => item.text)).toEqual(['想说说楼下新开的店'])
    expect(proactiveRecords(ctx).at(-1)?.reason).toBe('proactive:preview_ready')
  })

  it('没接上身体就按醒着处理，不报错也不出睡眠码', async () => {
    const { ctx, proactive } = await mount({ enabled: true })
    const material = qqMaterialOf(ctx)
    if (material === undefined) throw new Error('素材仓没装上')
    material.thoughts.add('想说说楼下新开的店', 'group:1')

    await endTurn(ctx)

    expect(proactive.preview('group:1')).toHaveLength(1)
    expect(proactiveRecords(ctx).at(-1)?.reason).toBe('proactive:preview_ready')
  })

  it('关着的时候睡着了也一样不问', async () => {
    const { ctx, proactive } = await mount({ enabled: false, body: sleepingBody(WAKE) })
    const asking = vi.spyOn(proactive, 'consider')

    await endTurn(ctx)

    expect(asking).not.toHaveBeenCalled()
    expect(proactiveRecords(ctx)).toHaveLength(0)
  })
})

// 孤独高过线以后，想发动态的劲会涨到平常那一档以上
const SHARE_BODY: Partial<VitalsState> = { oxytocin: 1, endorphin: 0.45 }

function shareWants(proactive: QqProactiveSeam): PendingItem[] {
  return proactive.preview('group:1').filter(item => item.facts.postWant !== undefined)
}

describe('想发动态的劲', () => {
  it('高过阈值就攒一条候选，带着理由与读数', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: SHARE_BODY })

    await endTurn(ctx)
    const kept = shareWants(proactive)

    expect(kept).toHaveLength(1)
    expect(kept[0]?.facts.kind).toBe('share')
    expect(kept[0]?.facts.source).toBe('post_want')
    expect(kept[0]?.facts.postWant).toBeGreaterThan(BUNDLE_DEFAULTS.addPostWantFrom)
    expect(kept[0]?.why).toContain('想发一条动态')
  })

  it('读数没到阈值就一条都不攒', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: { sleep_state: 'awake' } })

    await endTurn(ctx)

    expect(shareWants(proactive)).toHaveLength(0)
  })

  it('阈值能从配置改，调低以后平常的身体也攒一条', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: { sleep_state: 'awake' }, bundle: { addPostWantFrom: 0 } })

    await endTurn(ctx)

    expect(shareWants(proactive)).toHaveLength(1)
  })

  it('同一天只攒一次', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: SHARE_BODY })

    await endTurn(ctx)
    await endTurn(ctx)

    expect(shareWants(proactive)).toHaveLength(1)
  })

  it('攒过以后投递时走发布入口的 post 那一路，只给类别与正文', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: SHARE_BODY })
    const channel = qqChannelOf(ctx)
    if (channel === undefined) throw new Error('通道没装上')
    const publish = vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: Date.now() })
    await endTurn(ctx)
    const kept = shareWants(proactive)[0]
    if (kept === undefined) throw new Error('没有攒住动态候选')

    const delivered = await qqBundleOf(ctx)?.deliver('group:1', kept.id, '今天风大，在河边站了一会儿')

    expect(publish).toHaveBeenCalledWith('post', '今天风大，在河边站了一会儿', { chatKey: 'group:1', level: 'public' })
    expect(delivered?.ok).toBe(true)
  })

  it('动态级别可以由配置改成 routine，发布入口照单收到', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: SHARE_BODY, bundle: { postLevel: 'routine' } })
    const channel = qqChannelOf(ctx)
    if (channel === undefined) throw new Error('通道没装上')
    const publish = vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: Date.now() })
    await endTurn(ctx)
    const kept = shareWants(proactive)[0]
    if (kept === undefined) throw new Error('没有攒住动态候选')

    const delivered = await qqBundleOf(ctx)?.deliver('group:1', kept.id, '今天风大，在河边站了一会儿')

    expect(publish).toHaveBeenCalledWith('post', '今天风大，在河边站了一会儿', { chatKey: 'group:1', level: 'routine' })
    expect(delivered?.ok).toBe(true)
  })

  it('还没写出正文就不投，也不惊动发布入口', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: SHARE_BODY })
    const channel = qqChannelOf(ctx)
    if (channel === undefined) throw new Error('通道没装上')
    const publish = vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: Date.now() })
    await endTurn(ctx)
    const kept = shareWants(proactive)[0]
    if (kept === undefined) throw new Error('没有攒住动态候选')

    const delivered = await qqBundleOf(ctx)?.deliver('group:1', kept.id)

    expect(delivered?.code).toBe('bundle.no_body')
    expect(delivered?.reason).not.toBe('')
    expect(delivered?.hint).not.toBe('')
    expect(publish).not.toHaveBeenCalled()
  })

  it('发布入口拒了就把它的码与理由原样带回来', async () => {
    const { ctx, proactive } = await mount({ enabled: true, body: SHARE_BODY })
    const channel = qqChannelOf(ctx)
    if (channel === undefined) throw new Error('通道没装上')
    vi.spyOn(channel, 'publish').mockResolvedValue({ ok: false, code: 'post.level', reason: '这一条还不到能公开的级别', hint: '等攒到能公开的时候再说' })
    await endTurn(ctx)
    const kept = shareWants(proactive)[0]
    if (kept === undefined) throw new Error('没有攒住动态候选')

    const delivered = await qqBundleOf(ctx)?.deliver('group:1', kept.id, '今天风大')

    expect(delivered?.ok).toBe(false)
    expect(delivered?.code).toBe('post.level')
    expect(delivered?.reason).toBe('这一条还不到能公开的级别')
  })

  it('关着的时候零调用，也不往盘上写', async () => {
    const { ctx, proactive, dir } = await mount({ enabled: false, body: SHARE_BODY })
    const asking = vi.spyOn(proactive, 'consider')

    await endTurn(ctx)

    expect(asking).not.toHaveBeenCalled()
    expect(proactive.pending.all()).toHaveLength(0)
    expect(fs.existsSync(path.join(dir, 'proactive.json'))).toBe(false)
  })

  it('每天整理那一拍也读一次，攒出来的还是同一条事实', async () => {
    vi.useFakeTimers()
    try {
      // 整理那一小时是四点到五点，先退到三点半，再让定时器走过那一拍
      vi.setSystemTime(new Date(2026, 10, 4, 3, 30))
      const { ctx, proactive } = await mount({ enabled: true, body: SHARE_BODY, bundle: { addPostWantFrom: 0 } })
      qqSubjectOf(ctx)?.store.setActive('group:1')

      vi.advanceTimersByTime(60 * 60_000)

      const kept = shareWants(proactive)
      expect(kept).toHaveLength(1)
      expect(kept[0]?.facts.source).toBe('post_want')
      expect(proactiveRecords(ctx).at(-1)?.reason).toBe('proactive:preview_ready')
    } finally {
      vi.useRealTimers()
    }
  })
})
