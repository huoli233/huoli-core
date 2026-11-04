import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import { apply as applySelf, qqSelfOf, type QqSelfSeam } from '@huoli/huoli-qq-self'
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

// 私信允许名单里那一个对象
const PEER = 'u-1'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-stage-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  seam: QqChannelSeam
  self: QqSelfSeam
  events: OutboundEvent[]
}

function mount(patch: Partial<Config> = {}): Mounted {
  const dir = tempDir()
  const ctx = new Context()
  ctx.accessor('tools', {
    get: () => ({ register: () => () => {} }),
  })
  // 这一组用例不读面板，提示词那一段只要有个落点
  ctx.accessor('systemPrompt', {
    get: () => ({ section: () => {}, variable: () => {} }),
  })
  apply(ctx, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    ...OPEN_HOURS,
    actionsFile: path.join(dir, 'actions.json'),
    privateAllowPeers: [PEER],
    ...patch,
  })
  FakeSocket.opened.at(-1)?.open()
  applySelf(ctx, { enabled: true, dir: path.join(dir, 'self') })
  const seam = qqChannelOf(ctx)
  const self = qqSelfOf(ctx)
  if (seam === undefined || self === undefined) throw new Error('零件没有装配')
  // 正式装配里这一步由组合包做，用例照着接
  seam.useStage(() => self.stage())
  const events: OutboundEvent[] = []
  seam.onOutbound(event => events.push(event))
  return { seam, self, events }
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
const PRIVATE = { chatKey: `private:${PEER}`, peer: PEER, userOk: true, selfOk: true }

describe('只读阶段一律拒', () => {
  it('P0 到 P2 三档，动态与评论都发不出去', async () => {
    const { seam, events } = mount()

    for (const stage of ['P0', 'P1', 'P2']) {
      seam.useStage(() => stage)

      const post = await seam.publish('post', '今天吃了面', ROUTINE)
      const comment = await seam.publish('comment', '这条我也想说说', COMMENT)

      expect(post.ok).toBe(false)
      expect(post.code).toBe('post.stage_blocked')
      expect(comment.ok).toBe(false)
      expect(comment.code).toBe('comment.stage_blocked')
      expect(post.reason).toContain(stage)
      expect(post.reason).toContain('P3')
      expect(comment.reason).toBeTruthy()
    }
    expect(events.some(event => event.kind === 'sent')).toBe(false)
  })

  it('阶段拦下的理由说清只读与要等到哪一档，下一步说清怎么推', async () => {
    const { seam } = mount()

    const result = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('只读')
    expect(result.hint).toContain('推进')
    expect(result.retryAt).toBe(NOON)
    expect(`${result.code}: ${result.reason}｜下一步: ${result.hint}`).toMatch(/^post\.stage_blocked: .+｜下一步: .+$/u)
  })

  it('P3 起放行，走到后面那几道闸而不是阶段闸', async () => {
    const { seam } = mount()
    seam.useStage(() => 'P3')

    const none = await seam.publish('post', '随便说点什么', { chatKey: 'group:123', level: 'none' })
    const comment = await seam.publish('comment', '这条我也想说说', COMMENT)
    const post = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(none.code).toBe('post.level')
    expect(comment.code).toBe('comment.needs_confirm')
    expect(post.ok).toBe(true)
  })

  it('没接上阶段时按 P0 拒', async () => {
    const { seam } = mount()
    seam.useStage(undefined)

    const post = await seam.publish('post', '今天吃了面', ROUTINE)
    const comment = await seam.publish('comment', '这条我也想说说', COMMENT)
    const direct = await seam.publish('private', '问你一件事', PRIVATE)

    expect(post.code).toBe('post.stage_blocked')
    expect(post.reason).toContain('P0')
    expect(comment.code).toBe('comment.stage_blocked')
    expect(direct.code).toBe('private.stage_blocked')
  })
})

describe('阶段推进之后放行', () => {
  it('P0 时发不出去，一档一档推到 P3 之后同一段正文发得出去', async () => {
    const { seam, self } = mount()

    const blocked = await seam.publish('post', '今天吃了面', ROUTINE)
    expect(blocked.code).toBe('post.stage_blocked')

    expect(self.advanceStage('P1', '基线访谈做完了', 1_000).ok).toBe(true)
    expect((await seam.publish('post', '今天吃了面', ROUTINE)).code).toBe('post.stage_blocked')
    expect(self.advanceStage('P2', '面板连着三天没变', 2_000).ok).toBe(true)
    expect((await seam.publish('post', '今天吃了面', ROUTINE)).code).toBe('post.stage_blocked')
    // 推到公开级要先有两把钥匙的留痕
    expect(self.approveStageAdvance(true, true, 2_900).allowed).toBe(true)
    expect(self.advanceStage('P3', '面板报错计数为 0', 3_000).ok).toBe(true)

    const allowed = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(allowed.ok).toBe(true)
  })

  it('跳级被拒，阶段与动作都不动', async () => {
    const { seam, self } = mount()

    const skipped = self.advanceStage('P2', '想一次推两档', 1_000)

    expect(skipped.ok).toBe(false)
    expect(skipped.code).toBe('stage.skip')
    expect(self.stage()).toBe('P0')
    expect((await seam.publish('post', '今天吃了面', ROUTINE)).code).toBe('post.stage_blocked')
  })

  it('私信也得等阶段，P3 之前一把钥匙都不看', async () => {
    const { seam } = mount()

    for (const stage of ['P0', 'P1', 'P2']) {
      seam.useStage(() => stage)

      const result = await seam.publish('private', '问你一件事', PRIVATE)

      expect(result.code).toBe('private.stage_blocked')
    }
  })
})

describe('阶段下限可被配置覆盖', () => {
  it('把 publicMinStage 调到 P2 之后 P2 就放行', async () => {
    const { seam } = mount({ publicMinStage: 'P2' })
    seam.useStage(() => 'P2')

    const post = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(post.ok).toBe(true)
  })

  it('同一档在默认下限下仍然被拒', async () => {
    const { seam } = mount()
    seam.useStage(() => 'P2')

    const post = await seam.publish('post', '今天吃了面', ROUTINE)

    expect(post.code).toBe('post.stage_blocked')
  })

  it('私信的下限单独调，调到 P4 之后 P3 就不放私信了', async () => {
    const { seam } = mount({ privateMinStage: 'P4' })
    seam.useStage(() => 'P3')

    const blocked = await seam.publish('private', '问你一件事', PRIVATE)

    expect(blocked.code).toBe('private.stage_blocked')
  })
})
