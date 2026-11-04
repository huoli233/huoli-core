import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboundEvent } from '../src/events.ts'
import { apply, qqChannelOf, type Config, type QqChannelSeam } from '../src/index.ts'

type SocketHandler = (event: { data?: string }) => void

// 每次发出去都立刻回一个 echo，好让发送这条路当场结算
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

// 静默时段两头写成一样等于关掉，免得用例跑在深夜时被它拦下
const OPEN_HOURS = { quietStart: '00:00', quietEnd: '00:00' }

// 本地中午，离日界够远
const NOON = new Date(2026, 2, 5, 12, 0, 0, 0).getTime()

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-post-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  seam: QqChannelSeam
  events: OutboundEvent[]
  file: string
}

function mount(patch: Partial<Config> = {}): Mounted {
  const dir = tempDir()
  const file = path.join(dir, 'posts.json')
  const ctx = new Context()
  ctx.accessor('tools', {
    get: () => ({ register: () => () => {} }),
  })
  apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', ...OPEN_HOURS, actionsFile: file, ...patch })
  FakeSocket.opened.at(-1)?.open()
  const seam = qqChannelOf(ctx)
  if (seam === undefined) throw new Error('通道没装配上')
  // 这一组用例看的是级别与后面的闸门，阶段统一停在能放行的那一档
  seam.useStage(() => 'P3')
  const events: OutboundEvent[] = []
  seam.onOutbound(event => events.push(event))
  return { seam, events, file }
}

beforeEach(() => {
  FakeSocket.opened.length = 0
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.useFakeTimers()
  vi.setSystemTime(NOON)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

// 例行那一级的话，话题取预授权清单里的
const ROUTINE = { chatKey: 'group:123', level: 'routine', topic: '吃喝' }

describe('级别放行', () => {
  it('routine 放行，回投递结果与时刻', async () => {
    const { seam, events } = mount()

    const result = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(result.ok).toBe(true)
    expect(result.at).toBe(NOON)
    expect(result.delivery?.messageId).toBe('1')
    expect(events.map(event => event.kind)).toEqual(['attempt', 'sent'])
  })

  it('none 拒绝，带码与原因', async () => {
    const { seam, events } = mount()

    const result = await seam.publish('post', '随便说点什么', { chatKey: 'group:123', level: 'none' })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('post.level')
    expect(result.reason).toBeTruthy()
    expect(result.retryAt).toBeGreaterThan(0)
    expect(events.at(-1)?.kind).toBe('blocked')
  })

  it('routine 的话题不在预授权清单里就拒', async () => {
    const { seam } = mount()

    const result = await seam.publish('post', '今天吃了面', { chatKey: 'group:123', level: 'routine', topic: '工作' })

    expect(result.code).toBe('post.not_routine')
    expect(result.reason).toBeTruthy()
  })

  it('话题清单可由配置换掉', async () => {
    const { seam } = mount({ routineTopics: ['工作'] })

    const result = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(result.code).toBe('post.not_routine')
  })

  it('public 缺一把钥匙就拒，码是 post.needs_keys', async () => {
    const { seam, events } = mount()

    const result = await seam.publish('post', '新话题想公开讲', { chatKey: 'group:123', level: 'public', userOk: true, selfOk: false })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('post.needs_keys')
    expect(result.reason).toBeTruthy()
    expect(events.some(event => event.kind === 'sent')).toBe(false)
  })

  it('public 两把钥匙都在就放行', async () => {
    const { seam } = mount()

    const result = await seam.publish('post', '新话题想公开讲', { chatKey: 'group:123', level: 'public', userOk: true, selfOk: true })

    expect(result.ok).toBe(true)
  })

  it('停手开关开着时一条都不发', async () => {
    const { seam } = mount()
    seam.usePause(() => true)

    const result = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(result.code).toBe('post.paused')
    expect(result.reason).toBeTruthy()
  })

  it('没有正文就拒', async () => {
    const { seam } = mount()

    const result = await seam.publish('post', '   ', ROUTINE)

    expect(result.code).toBe('post.empty')
  })
})

describe('冷却与去重', () => {
  it('冷却里同一段正文再发就拒，下次时刻是去重窗尾', async () => {
    const { seam } = mount()
    await seam.publish('post', '今天吃了面', ROUTINE)
    vi.setSystemTime(NOON + 60_000)

    const again = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(again.ok).toBe(false)
    expect(again.code).toBe('post.duplicate')
    expect(again.retryAt).toBe(NOON + 30 * 60_000)
  })

  it('冷却过了同一段正文还能发', async () => {
    const { seam } = mount()
    await seam.publish('post', '今天吃了面', ROUTINE)
    vi.setSystemTime(NOON + 30 * 60_000)

    const again = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(again.ok).toBe(true)
  })

  it('冷却里换一段正文照样发不出去', async () => {
    const { seam } = mount()
    await seam.publish('post', '今天吃了面', ROUTINE)
    vi.setSystemTime(NOON + 60_000)

    const other = await seam.publish('post', '晚上想去跑步', ROUTINE)

    expect(other.code).toBe('post.cooling')
    expect(other.retryAt).toBe(NOON + 30 * 60_000)
  })

  it('去重只认同一段正文，别的正文不受它影响', async () => {
    const { seam } = mount({ postCoolDownMs: 0 })
    await seam.publish('post', '今天吃了面', ROUTINE)

    const other = await seam.publish('post', '晚上想去跑步', ROUTINE)

    expect(other.ok).toBe(true)
  })

  it('同一次输入连问两遍，下次时刻一模一样', async () => {
    const { seam } = mount()
    await seam.publish('post', '今天吃了面', ROUTINE)
    vi.setSystemTime(NOON + 60_000)

    const first = await seam.publish('post', '今天吃了面', ROUTINE)
    const second = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(first.retryAt).toBe(second.retryAt)
  })

  it('每天发满了就拒，下次时刻是次日零点', async () => {
    const { seam } = mount({ postDailyMax: 1 })
    await seam.publish('post', '今天吃了面', ROUTINE)
    vi.setSystemTime(NOON + 60 * 60_000)

    const third = await seam.publish('post', '晚上想去跑步', ROUTINE)

    expect(third.code).toBe('post.day_full')
    expect(third.retryAt).toBe(new Date(2026, 2, 6, 0, 0, 0, 0).getTime())
  })

  it('过了零点额度重新算', async () => {
    const { seam } = mount({ postDailyMax: 1 })
    await seam.publish('post', '今天吃了面', ROUTINE)
    vi.setSystemTime(new Date(2026, 2, 6, 9, 0, 0, 0).getTime())

    const next = await seam.publish('post', '早上喝了粥', ROUTINE)

    expect(next.ok).toBe(true)
  })

  it('拒绝都带码、原因与下次时刻', async () => {
    const { seam } = mount({ postCoolDownMs: 0, postDailyMax: 1 })
    await seam.publish('post', '今天吃了面', ROUTINE)
    vi.setSystemTime(NOON + 60_000)

    const duplicate = await seam.publish('post', '今天吃了面', ROUTINE)
    const full = await seam.publish('post', '晚上想去跑步', ROUTINE)

    expect(duplicate.code).toBe('post.duplicate')
    expect(full.code).toBe('post.day_full')
    for (const result of [duplicate, full]) {
      expect(result.reason).toBeTruthy()
      expect(result.retryAt).toBeGreaterThan(NOON)
    }
  })
})

describe('状态文件', () => {
  it('只留指纹，正文一个字不进盘', async () => {
    const { seam, file } = mount()

    await seam.publish('post', '今天吃了面', ROUTINE)
    const text = fs.readFileSync(file, 'utf8')

    expect(text).not.toContain('今天吃了面')
    expect(text).toContain('"sha"')
    expect(JSON.parse(text) as { version: number }).toMatchObject({ version: 2, kinds: { post: { dayCount: 1 } } })
  })

  it('正式文件读不出就回默认值，重来的一次照样按新鲜状态算', async () => {
    const { seam, file } = mount()
    await seam.publish('post', '今天吃了面', ROUTINE)
    fs.writeFileSync(file, '半截的 JSON')
    vi.setSystemTime(NOON + 60 * 60_000)

    const next = await seam.publish('post', '晚上想去跑步', ROUTINE)

    expect(next.ok).toBe(true)
  })

  it('正式文件坏了还能按备份认出去重', async () => {
    const { seam, file } = mount({ postCoolDownMs: 0 })
    await seam.publish('post', '今天吃了面', ROUTINE)
    await seam.publish('post', '晚上想去跑步', ROUTINE)
    fs.writeFileSync(file, '半截的 JSON')

    const again = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(again.code).toBe('post.duplicate')
  })
})

describe('出站体检仍然生效', () => {
  it('静默时段发不出去', async () => {
    const { seam } = mount({ quietStart: '23:30', quietEnd: '07:30' })
    vi.setSystemTime(new Date(2026, 2, 5, 3, 0, 0, 0).getTime())

    const result = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(result.code).toBe('outbound.quiet')
    expect(result.retryAt).toBe(new Date(2026, 2, 5, 7, 30, 0, 0).getTime())
  })

  it('超出长度上限发不出去', async () => {
    const { seam } = mount({ maxChars: 3 })

    const result = await seam.publish('post', '一二三四', ROUTINE)

    expect(result.code).toBe('outbound.too_long')
    expect(result.reason).toBeTruthy()
  })

  it('敏感词命中就拦', async () => {
    const { seam } = mount({ banned: ['加群'] })

    const result = await seam.publish('post', '你也来加群吧', ROUTINE)

    expect(result.code).toBe('outbound.banned')
  })

  it('不在名单的群发不出去', async () => {
    const { seam } = mount({ allowGroups: ['999'] })

    const result = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(result.code).toBe('outbound.not_allowed')
  })

  it('发出去的动态占一分钟里的条数', async () => {
    const { seam } = mount({ perMinute: 1, postCoolDownMs: 0 })
    await seam.publish('post', '今天吃了面', ROUTINE)

    const second = await seam.publish('post', '晚上想去跑步', ROUTINE)

    expect(second.code).toBe('outbound.rate')
    expect(second.retryAt).toBe(NOON + 60_000)
  })
})
