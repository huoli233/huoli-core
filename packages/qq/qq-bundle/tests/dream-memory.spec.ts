import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyChannel, qqChannelOf, type QqChannelSeam } from '@huoli/huoli-qq-channel'
import { apply as applyMemory, qqMemoryOf, type QqMemorySeam } from '@huoli/huoli-qq-memory'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  qqVitalsOf,
  resolveTuning,
  type DreamFact,
  WORDS_PRESET,
} from '@huoli/huoli-qq-vitals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, type Config } from '../src/index.ts'

const tuning = resolveTuning()
const CHAT = 'group:1'
// 身体在装配前已经跑过一会儿，事实时刻才追得上它
const SEED = new Date(2026, 10, 3, 7, 30, 0).getTime()

// 用例里的时刻一律写死，本地日按本地时分算
function at(hour: number, minute = 15, day = 3): number {
  return new Date(2026, 10, day, hour, minute, 0).getTime()
}

const SWEET_TEXT = '她站在天台上收被子，风把布面吹得鼓鼓的，楼下有人喊她回去吃饭。'
const NIGHTMARE_TEXT = '旧教室的灯一排排灭下去，她找不到门，桌椅一直在往后挪。'
const PLAIN_TEXT = '她坐在海边看水，风有点凉，坐了一会儿就回去了。'

// 一场梦的事实：类型决定正文、地点、重要度与能不能发，与身体产出来的那一条同形
function dream(kind: DreamFact['kind'], day = 3): DreamFact {
  if (kind === 'sweet') {
    return { at: at(23, 15, day), kind, place: '天台', text: SWEET_TEXT, importance: 0.35, publishable: true }
  }
  if (kind === 'nightmare') {
    return { at: at(2, 40, day), kind, place: '旧教室', text: NIGHTMARE_TEXT, importance: 0.45, publishable: true }
  }
  return { at: at(13, 10, day), kind, place: '海边', text: PLAIN_TEXT, importance: 0.25, publishable: false }
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-dream-'))
  tempDirs.push(dir)
  return dir
}

type SocketHandler = (event: { data?: string }) => void

// 通道那一行照样挂上，只是不让它真去连：发出去的那一步在用例里全被替换掉
class FakeSocket {
  readyState = 0

  addEventListener(_type: string, _handler: SocketHandler): void {}

  send(_payload: string): void {}

  close(): void {
    this.readyState = 3
  }
}

interface Mounted {
  ctx: Context
  memory: QqMemorySeam
  channel: QqChannelSeam
  /** 组合包发过几次挂上、眼下还挂着几个监听 */
  live: { subscribed: number; listeners: number }
  /** 把一场梦的事实递给组合包挂上进来的那个被叫到时做的事 */
  deliver: (fact: DreamFact) => void
}

interface MountOptions {
  /** 有没有活跃会话，没有时那两条路都只该留一行告警 */
  active?: boolean
}

// 装配顺序与正式一致：状态与记忆在前，组合包最后接上
async function mount(config: Config = {}, options: MountOptions = {}): Promise<Mounted> {
  const dir = tempDir()
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write(emptyState(tuning, SEED))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyVitals(ctx, { file, tuning: { words: WORDS_PRESET, startDelayMs: 60 * 60_000 } })
  // 记忆的四个文件都落在临时目录里，队列与记录不去碰主目录那份
  applyMemory(ctx, {
    file: path.join(dir, 'memory.json'),
    ledgerFile: path.join(dir, 'ledger.json'),
    healthLogFile: path.join(dir, 'health.log'),
    queueFile: path.join(dir, 'queue.json'),
  })
  applyChannel(ctx, { url: 'ws://127.0.0.1:6700', selfId: '999', sentLedgerFile: path.join(dir, 'sent.json') })
  if (options.active !== false) qqSubjectOf(ctx)?.store.setActive(CHAT)
  const vitals = qqVitalsOf(ctx)
  const memory = qqMemoryOf(ctx)
  const channel = qqChannelOf(ctx)
  if (vitals === undefined || memory === undefined || channel === undefined) throw new Error('零件没有装配')
  const live = { subscribed: 0, listeners: 0 }
  const listeners = new Set<(fact: DreamFact) => void>()
  // 这些只能由组合包挂上去：在它动手之前把那一头包一层，顺手留住它递过来的函数
  const subscribe = vitals.onDream.bind(vitals)
  vitals.onDream = (listener) => {
    const off = subscribe(listener)
    live.subscribed += 1
    live.listeners += 1
    listeners.add(listener)
    return () => {
      live.listeners -= 1
      listeners.delete(listener)
      off()
    }
  }
  // 这一组只看梦境那一条路，情绪抬升另有自己的用例
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepAt: '04:00',
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    emotion: { memoryLift: false },
    ...config,
  })
  return {
    ctx,
    memory,
    channel,
    live,
    deliver(fact) {
      if (listeners.size === 0) throw new Error('组合包没有订阅梦境')
      for (const listener of [...listeners]) listener(fact)
    },
  }
}

// 发布那一步是异步的：等一轮定时器再看发了几次
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function warnings(ctx: Context): string[] {
  return ctx.logger.buffer
    .filter(message => message.name === 'qq-bundle' && message.type === 'warn')
    .map(message => String(message.args[0]))
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('梦境写记忆', () => {
  it('美梦写一条记忆，正文、重要度与附加事实都取事实里的', async () => {
    const { memory, channel, deliver } = await mount()
    vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: at(23, 30) })

    const fact = dream('sweet')
    deliver(fact)

    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toBe(SWEET_TEXT)
    expect(items[0]?.source).toBe('chat')
    expect(items[0]?.layer).toBe('episodic')
    expect(items[0]?.scope).toBe(CHAT)
    expect(items[0]?.importance).toBe(35)
    expect(items[0]?.at).toBe(fact.at)
    expect(items[0]?.metadata).toEqual({ kind: 'dream', dreamKind: 'sweet', place: '天台', at: fact.at })
  })

  it('平淡梦照样写记忆，但一次都不发', async () => {
    const { memory, channel, deliver } = await mount()
    const publish = vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: at(13, 20) })

    deliver(dream('plain'))
    await settle()

    expect(memory.store.all().map(item => item.text)).toEqual([PLAIN_TEXT])
    expect(memory.store.all()[0]?.importance).toBe(25)
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('梦境发布', () => {
  it('美梦与噩梦各发一次，同一条不重复发', async () => {
    const { memory, channel, deliver } = await mount()
    const publish = vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: at(23, 30) })

    const sweet = dream('sweet')
    const nightmare = dream('nightmare')
    deliver(sweet)
    deliver(sweet)
    deliver(nightmare)
    await settle()

    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenNthCalledWith(1, 'post', SWEET_TEXT, { chatKey: CHAT, level: 'public' })
    expect(publish).toHaveBeenNthCalledWith(2, 'post', NIGHTMARE_TEXT, { chatKey: CHAT, level: 'public' })
    expect(memory.store.all()).toHaveLength(2)
  })

  it('发布失手只记一行日志，记忆照写', async () => {
    const { ctx, memory, channel, deliver } = await mount()
    vi.spyOn(channel, 'publish').mockRejectedValue(new Error('那头断开了'))

    deliver(dream('sweet'))
    await settle()

    expect(memory.store.all()).toHaveLength(1)
    expect(warnings(ctx).some(line => line.includes('梦境没发出去'))).toBe(true)
  })
})

describe('同一天同一场只写一条', () => {
  it('同一条事实递两遍只落一条记忆', async () => {
    const { memory, channel, deliver } = await mount()
    vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: at(23, 30) })

    const fact = dream('sweet')
    deliver(fact)
    deliver(fact)
    await settle()

    expect(memory.store.all()).toHaveLength(1)
  })

  it('隔一天再梦到同一个地方，正文一样就并进上一条', async () => {
    const { memory, channel, deliver } = await mount()
    vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: at(23, 30) })

    deliver(dream('sweet', 3))
    deliver(dream('sweet', 4))

    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(items[0]?.metadata?.['mergedCount']).toBe(1)
  })
})

describe('写记忆失手', () => {
  it('只记一行日志，发布那条路照走', async () => {
    const { ctx, memory, channel, deliver } = await mount()
    const failing = vi.spyOn(memory, 'write').mockImplementation(() => {
      throw new Error('磁盘满了')
    })
    const publish = vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: at(23, 30) })

    deliver(dream('sweet'))
    await settle()

    expect(failing).toHaveBeenCalledTimes(1)
    expect(memory.store.all()).toHaveLength(0)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(warnings(ctx).some(line => line.includes('梦境记忆'))).toBe(true)
  })
})

describe('没有活跃会话', () => {
  it('不写也不发，只留一行告警', async () => {
    const { ctx, memory, channel, deliver } = await mount({}, { active: false })
    const publish = vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: at(23, 30) })

    deliver(dream('sweet'))
    await settle()

    expect(memory.store.all()).toHaveLength(0)
    expect(publish).not.toHaveBeenCalled()
    expect(warnings(ctx).filter(line => line.includes('梦境没有落点'))).toHaveLength(1)
  })
})

describe('开关关着', () => {
  it('一个挂上都没有，零写入零发布', async () => {
    const { memory, channel, live, deliver } = await mount({ dreamMemory: false, dreamPublish: false })
    const publish = vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: at(23, 30) })

    expect(live.subscribed).toBe(0)
    expect(live.listeners).toBe(0)
    expect(() => {
      deliver(dream('sweet'))
    }).toThrow()

    expect(memory.store.all()).toHaveLength(0)
    expect(publish).not.toHaveBeenCalled()
  })
})

describe('卸载之后', () => {
  it('挂上撤掉了，再来一场也不写', async () => {
    const { ctx, memory, channel, deliver, live } = await mount()
    vi.spyOn(channel, 'publish').mockResolvedValue({ ok: true, at: at(23, 30) })
    deliver(dream('sweet'))
    expect(memory.store.all()).toHaveLength(1)

    contexts.splice(contexts.indexOf(ctx), 1)
    await ctx.fiber.dispose()

    expect(live.listeners).toBe(0)
    expect(() => {
      deliver(dream('nightmare'))
    }).toThrow()
    expect(memory.store.all()).toHaveLength(1)
  })
})
