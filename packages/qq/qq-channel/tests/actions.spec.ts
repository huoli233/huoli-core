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
const HALF_HOUR = 30 * 60_000

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-actions-'))
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
  const file = path.join(dir, 'actions.json')
  const ctx = new Context()
  ctx.accessor('tools', {
    get: () => ({ register: () => () => {} }),
  })
  apply(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', ...OPEN_HOURS, actionsFile: file, privateAllowPeers: ['u-1'], ...patch })
  FakeSocket.opened.at(-1)?.open()
  const seam = qqChannelOf(ctx)
  if (seam === undefined) throw new Error('通道没装配上')
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

// 例行那一级的动态，话题取预授权清单里的
const ROUTINE = { chatKey: 'group:123', level: 'routine', topic: '吃喝' }
// 公开评论：两把钥匙都在，话题也在清单里
const COMMENT = { chatKey: 'group:123', topic: '吃喝', userOk: true, selfOk: true }
// 私信：写给名单里的那个人，两把钥匙都在
const PRIVATE = { chatKey: 'private:u-1', peer: 'u-1', userOk: true, selfOk: true }

describe('公开评论', () => {
  it('两把钥匙都在、话题在清单里就发出去', async () => {
    const { seam, events } = mount()
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(asked.confirmId ?? '', NOON)

    const result = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(result.ok).toBe(true)
    expect(result.at).toBe(NOON)
    expect(events.map(event => event.kind)).toEqual(['attempt', 'sent'])
  })

  it('缺一把钥匙就拒，码是 comment.needs_keys', async () => {
    const { seam, events } = mount()

    const result = await seam.publish('comment', '这条我也想说说', { ...COMMENT, selfOk: false })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('comment.needs_keys')
    expect(result.reason).toBeTruthy()
    expect(result.retryAt).toBe(NOON)
    expect(events.some(event => event.kind === 'sent')).toBe(false)
  })

  it('话题不在预授权清单里就拒，码是 comment.topic_not_allowed', async () => {
    const { seam } = mount()

    const result = await seam.publish('comment', '这条我也想说说', { ...COMMENT, topic: '工作' })

    expect(result.code).toBe('comment.topic_not_allowed')
    expect(result.reason).toBeTruthy()
  })

  it('评论自己的冷却到了就拒，下次时刻是上次加三十分钟', async () => {
    const { seam } = mount()
    const ticket = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(ticket.confirmId ?? '', NOON)
    await seam.publish('comment', '这条我也想说说', COMMENT)
    vi.setSystemTime(NOON + 60_000)
    const other = seam.requestConfirm('comment', '换一句说说', NOON + 60_000)
    seam.confirm(other.confirmId ?? '', NOON + 60_000)

    const again = await seam.publish('comment', '换一句说说', COMMENT)

    expect(again.code).toBe('comment.cooling')
    expect(again.retryAt).toBe(NOON + HALF_HOUR)
  })

  it('停手时评论也不发', async () => {
    const { seam } = mount()
    seam.usePause(() => true)

    const result = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(result.code).toBe('comment.paused')
    expect(result.reason).toBeTruthy()
  })
})

describe('私信', () => {
  it('P3 起、对面在名单里、两把钥匙都在就发出去', async () => {
    const { seam, events } = mount()
    seam.useStage(() => 'P3')
    const asked = seam.requestConfirm('private', '问你一件事', NOON)
    seam.confirm(asked.confirmId ?? '', NOON)

    const result = await seam.publish('private', '问你一件事', PRIVATE)

    expect(result.ok).toBe(true)
    expect(result.at).toBe(NOON)
    expect(events.map(event => event.kind)).toEqual(['attempt', 'sent'])
  })

  it('P0 到 P2 一律拒，两把钥匙都在也拒', async () => {
    const { seam } = mount()
    for (const stage of ['P0', 'P1', 'P2']) {
      seam.useStage(() => stage)

      const result = await seam.publish('private', '问你一件事', PRIVATE)

      expect(result.ok).toBe(false)
      expect(result.code).toBe('private.stage_blocked')
      expect(result.reason).toBeTruthy()
    }
  })

  it('没接上阶段时按最保守的那一档拒', async () => {
    const { seam } = mount()

    const result = await seam.publish('private', '问你一件事', PRIVATE)

    expect(result.code).toBe('private.stage_blocked')
  })

  it('对面不在允许名单里就拒，码是 private.peer_not_allowed', async () => {
    const { seam } = mount()
    seam.useStage(() => 'P3')

    const result = await seam.publish('private', '问你一件事', { ...PRIVATE, peer: 'u-2', chatKey: 'private:u-2' })

    expect(result.code).toBe('private.peer_not_allowed')
    expect(result.reason).toBeTruthy()
  })
})

describe('冷却与额度互不共用', () => {
  it('发满动态不影响评论额度', async () => {
    const { seam } = mount({ postDailyMax: 1 })
    await seam.publish('post', '今天吃了面', ROUTINE)
    vi.setSystemTime(NOON + HALF_HOUR)

    const blocked = await seam.publish('post', '晚上想去跑步', ROUTINE)
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON + HALF_HOUR)
    seam.confirm(asked.confirmId ?? '', NOON + HALF_HOUR)
    const comment = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(blocked.code).toBe('post.day_full')
    expect(comment.ok).toBe(true)
  })

  it('发满评论不影响动态额度', async () => {
    const { seam } = mount({ commentDailyMax: 1 })
    const ticket = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(ticket.confirmId ?? '', NOON)
    await seam.publish('comment', '这条我也想说说', COMMENT)
    vi.setSystemTime(NOON + HALF_HOUR)
    const second = seam.requestConfirm('comment', '换一句说说', NOON + HALF_HOUR)
    seam.confirm(second.confirmId ?? '', NOON + HALF_HOUR)

    const blocked = await seam.publish('comment', '换一句说说', COMMENT)
    const post = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(blocked.code).toBe('comment.day_full')
    expect(post.ok).toBe(true)
  })

  it('一条动态的冷却不拦评论', async () => {
    const { seam } = mount()
    await seam.publish('post', '今天吃了面', ROUTINE)
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(asked.confirmId ?? '', NOON)

    const comment = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(comment.ok).toBe(true)
  })

  it('私信的额度也不跟评论共用', async () => {
    const { seam } = mount({ privateDailyMax: 1 })
    seam.useStage(() => 'P3')
    const first = seam.requestConfirm('private', '问你一件事', NOON)
    seam.confirm(first.confirmId ?? '', NOON)
    await seam.publish('private', '问你一件事', PRIVATE)
    vi.setSystemTime(NOON + HALF_HOUR)
    const second = seam.requestConfirm('private', '再问一件事', NOON + HALF_HOUR)
    seam.confirm(second.confirmId ?? '', NOON + HALF_HOUR)

    const blocked = await seam.publish('private', '再问一件事', PRIVATE)
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON + HALF_HOUR)
    seam.confirm(asked.confirmId ?? '', NOON + HALF_HOUR)
    const comment = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(blocked.code).toBe('private.day_full')
    expect(comment.ok).toBe(true)
  })
})

describe('确定性', () => {
  it('同一次输入连问两遍，下次时刻一模一样', async () => {
    const { seam } = mount()
    const first = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(first.confirmId ?? '', NOON)
    await seam.publish('comment', '这条我也想说说', COMMENT)
    vi.setSystemTime(NOON + 60_000)
    const second = seam.requestConfirm('comment', '换一句说说', NOON + 60_000)
    seam.confirm(second.confirmId ?? '', NOON + 60_000)

    const once = await seam.publish('comment', '换一句说说', COMMENT)
    const twice = await seam.publish('comment', '换一句说说', COMMENT)

    expect(once.retryAt).toBe(twice.retryAt)
    expect(once.retryAt).toBe(NOON + HALF_HOUR)
  })

  it('同一段正文问两次确认，第二次被拒，编号能看出品类与时刻', () => {
    const { seam } = mount()

    const first = seam.requestConfirm('comment', '这条我也想说说', NOON)
    const twice = seam.requestConfirm('comment', '这条我也想说说', NOON)

    expect(first.confirmId).toMatch(/^comment:\d+:[0-9a-f]{12}$/)
    expect(twice.code).toBe('comment.confirm_duplicate')
  })
})

describe('一次确认通道', () => {
  it('没确认就发被拒，码是 comment.needs_confirm', async () => {
    const { seam } = mount()

    const result = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(result.ok).toBe(false)
    expect(result.code).toBe('comment.needs_confirm')
    expect(result.reason).toBeTruthy()
    expect(result.retryAt).toBe(NOON)
  })

  it('点过头才放行', async () => {
    const { seam } = mount()
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)
    expect(asked.ok).toBe(true)
    expect(asked.confirmId).toBeTruthy()
    expect(asked.expiresAt).toBe(NOON + HALF_HOUR)

    const nodded = seam.confirm(asked.confirmId ?? '', NOON + 60_000)
    const result = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(nodded.ok).toBe(true)
    expect(result.ok).toBe(true)
  })

  it('同一段正文不重复进队列，码是 comment.confirm_duplicate', () => {
    const { seam } = mount()
    seam.requestConfirm('comment', '这条我也想说说', NOON)

    const again = seam.requestConfirm('comment', '这条我也想说说', NOON + 60_000)

    expect(again.ok).toBe(false)
    expect(again.code).toBe('comment.confirm_duplicate')
    expect(again.reason).toBeTruthy()
    expect(again.retryAt).toBe(NOON + HALF_HOUR)
  })

  it('过期之后点头被拒，码是 comment.confirm_expired', () => {
    const { seam } = mount()
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)

    const late = seam.confirm(asked.confirmId ?? '', NOON + HALF_HOUR)

    expect(late.ok).toBe(false)
    expect(late.code).toBe('comment.confirm_expired')
    expect(late.reason).toBeTruthy()
    expect(late.retryAt).toBe(NOON + HALF_HOUR)
  })

  it('过期之后直接发还是拒，重新要一次才能过', async () => {
    const { seam } = mount()
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(asked.confirmId ?? '', NOON)
    vi.setSystemTime(NOON + HALF_HOUR)

    const stale = await seam.publish('comment', '这条我也想说说', COMMENT)
    const askedAgain = seam.requestConfirm('comment', '这条我也想说说', NOON + HALF_HOUR)
    seam.confirm(askedAgain.confirmId ?? '', NOON + HALF_HOUR)
    const fresh = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(stale.code).toBe('comment.needs_confirm')
    expect(askedAgain.ok).toBe(true)
    expect(fresh.ok).toBe(true)
  })

  it('丢掉的那一条发不出去', async () => {
    const { seam } = mount()
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)

    const dropped = seam.reject(asked.confirmId ?? '')
    const result = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(dropped.ok).toBe(true)
    expect(result.code).toBe('comment.needs_confirm')
  })

  it('没有这个编号就拒，码是 confirm.unknown', () => {
    const { seam } = mount()

    expect(seam.reject('comment:none:000000000000').code).toBe('confirm.unknown')
    expect(seam.confirm('comment:none:000000000000', NOON).code).toBe('confirm.unknown')
  })

  it('一张票只用一次', async () => {
    const { seam } = mount()
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(asked.confirmId ?? '', NOON)
    await seam.publish('comment', '这条我也想说说', COMMENT)

    const again = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(again.code).toBe('comment.needs_confirm')
  })
})

describe('参数可被配置覆盖', () => {
  it('评论的冷却按配置走', async () => {
    const { seam } = mount({ commentCoolDownMs: 0 })
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(asked.confirmId ?? '', NOON)
    await seam.publish('comment', '这条我也想说说', COMMENT)
    const second = seam.requestConfirm('comment', '换一句说说', NOON + 1_000)
    seam.confirm(second.confirmId ?? '', NOON + 1_000)

    const next = await seam.publish('comment', '换一句说说', COMMENT)

    expect(next.ok).toBe(true)
  })

  it('评论的去重窗按配置走，比冷却更宽', async () => {
    const { seam } = mount({ commentCoolDownMs: 0, commentRepeatWindowMs: 2 * 60 * 60_000 })
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(asked.confirmId ?? '', NOON)
    await seam.publish('comment', '这条我也想说说', COMMENT)
    const second = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(second.confirmId ?? '', NOON)

    const again = await seam.publish('comment', '这条我也想说说', COMMENT)

    expect(again.code).toBe('comment.duplicate')
    expect(again.retryAt).toBe(NOON + 2 * 60 * 60_000)
  })

  it('私信的冷却按配置走', async () => {
    const { seam } = mount({ privateCoolDownMs: 0 })
    seam.useStage(() => 'P3')
    const first = seam.requestConfirm('private', '问你一件事', NOON)
    seam.confirm(first.confirmId ?? '', NOON)
    await seam.publish('private', '问你一件事', PRIVATE)
    const second = seam.requestConfirm('private', '再问一件事', NOON)
    seam.confirm(second.confirmId ?? '', NOON)

    const next = await seam.publish('private', '再问一件事', PRIVATE)

    expect(next.ok).toBe(true)
  })

  it('待确认项的有效期按配置走', () => {
    const { seam } = mount({ confirmTtlMs: 60_000 })
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)

    expect(asked.expiresAt).toBe(NOON + 60_000)
    expect(seam.confirm(asked.confirmId ?? '', NOON + 60_000).code).toBe('comment.confirm_expired')
  })

  it('指纹表只留几条也按配置走', async () => {
    const { seam } = mount({ postCoolDownMs: 0, postFingerprintMax: 1 })
    await seam.publish('post', '今天吃了面', ROUTINE)
    await seam.publish('post', '晚上想去跑步', ROUTINE)

    const again = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(again.ok).toBe(true)
  })
})

describe('状态文件', () => {
  it('带版本戳，待确认项只短存正文', () => {
    const { seam, file } = mount()
    seam.requestConfirm('comment', '这条我也想说说', NOON)

    const state = JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number; kinds: Record<string, { dayCount: number }>; pending: Array<{ text: string }> }

    expect(state.version).toBe(2)
    expect(Object.keys(state.kinds)).toEqual(['post', 'comment', 'private'])
    expect(state.pending[0]?.text).toBe('这条我也想说说')
  })

  it('发出去之后只留指纹，正文不落盘', async () => {
    const { seam, file } = mount()
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(asked.confirmId ?? '', NOON)

    await seam.publish('comment', '这条我也想说说', COMMENT)
    const text = fs.readFileSync(file, 'utf8')

    expect(text).not.toContain('这条我也想说说')
    expect(text).toContain('"sha"')
    expect(JSON.parse(text) as { kinds: Record<string, { dayCount: number }> }).toMatchObject({ kinds: { comment: { dayCount: 1 } } })
  })

  it('正式文件读不出就回默认值，重来的一次照样按新鲜状态算', async () => {
    const { seam, file } = mount()
    const asked = seam.requestConfirm('comment', '这条我也想说说', NOON)
    seam.confirm(asked.confirmId ?? '', NOON)
    await seam.publish('comment', '这条我也想说说', COMMENT)
    fs.writeFileSync(file, '半截的 JSON')
    vi.setSystemTime(NOON + HALF_HOUR)

    const askedAgain = seam.requestConfirm('comment', '换一句说说', NOON + HALF_HOUR)
    seam.confirm(askedAgain.confirmId ?? '', NOON + HALF_HOUR)
    const next = await seam.publish('comment', '换一句说说', COMMENT)

    expect(next.ok).toBe(true)
  })

  it('正式文件坏了还能按备份认出重复', async () => {
    const { seam, file } = mount({ postCoolDownMs: 0, postRepeatWindowMs: 2 * 60 * 60_000 })
    await seam.publish('post', '今天吃了面', ROUTINE)
    await seam.publish('post', '晚上想去跑步', ROUTINE)
    fs.writeFileSync(file, '半截的 JSON')

    const again = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(again.code).toBe('post.duplicate')
  })
})
