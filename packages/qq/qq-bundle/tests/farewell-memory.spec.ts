import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { createFarewellSlotStore } from '@huoli/huoli-qq-channel'
import { apply as applyMemory, qqMemoryOf, type QqMemorySeam } from '@huoli/huoli-qq-memory'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  qqVitalsOf,
  resolveTuning,
  type FarewellFact,
  type QqVitalsSeam,
} from '@huoli/huoli-qq-vitals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, BUNDLE_DEFAULTS, FAREWELL_NEUTRAL, farewellWritten, type Config } from '../src/index.ts'

const tuning = resolveTuning()
const CHAT = 'group:1'
// 身体在装配前已经跑过一会儿，消息时间才追得上它
const SEED = new Date(2026, 10, 3, 7, 30, 0).getTime()

// 用例里的时刻一律写死，日期都按本地时间算
function moment(day: number, hour: number, minute = 0): number {
  return new Date(2026, 10, day, hour, minute, 0).getTime()
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-farewell-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  ctx: Context
  vitals: QqVitalsSeam
  memory: QqMemorySeam
  /** 遗书正文的暂存槽落在哪 */
  farewellFile: string
  /** 组合包发过几次订阅、眼下还挂着几个监听 */
  live: { subscribed: number; listeners: number }
  /** 直接把一条到线的事实送进去，等于身体在那一拍产出了它 */
  deliver: (fact: FarewellFact) => void
}

// 装配顺序与正式一致：状态与记忆在前，组合包最后接上；身体那边先按高位落一份状态
async function mount(config: Config = {}): Promise<Mounted> {
  const dir = tempDir()
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, SEED), mortality: 0.9 })
  const ctx = new Context()
  contexts.push(ctx)
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyVitals(ctx, { file, tuning: { startDelayMs: 60 * 60_000 } })
  // 记忆的四个文件都落在临时目录里，队列与账本不去碰主目录那份
  applyMemory(ctx, {
    file: path.join(dir, 'memory.json'),
    ledgerFile: path.join(dir, 'ledger.json'),
    healthLogFile: path.join(dir, 'health.log'),
    queueFile: path.join(dir, 'queue.json'),
  })
  qqSubjectOf(ctx)?.store.setActive(CHAT)
  const vitals = qqVitalsOf(ctx)
  const memory = qqMemoryOf(ctx)
  if (vitals === undefined || memory === undefined) throw new Error('零件没有装配')
  // 订阅只能由组合包发出：在它动手之前把订阅那头包一层来数，并留住挂着的那些回调
  const live = { subscribed: 0, listeners: 0 }
  const listeners: ((fact: FarewellFact) => void)[] = []
  const subscribe = vitals.onFarewell.bind(vitals)
  vitals.onFarewell = (next) => {
    const off = subscribe(next)
    listeners.push(next)
    live.subscribed += 1
    live.listeners += 1
    return () => {
      const at = listeners.indexOf(next)
      if (at >= 0) listeners.splice(at, 1)
      live.listeners -= 1
      off()
    }
  }
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepAt: '04:00',
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    farewellFile: path.join(dir, 'farewell.json'),
    ...config,
  })
  return {
    ctx,
    vitals,
    memory,
    farewellFile: config.farewellFile ?? path.join(dir, 'farewell.json'),
    live,
    deliver(fact) {
      for (const listener of [...listeners]) listener(fact)
    },
  }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('到线那天写一条记忆', () => {
  it('字段与正文都对，重要度取默认值表那一档', async () => {
    const { memory, live, deliver } = await mount()

    deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })

    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(live.subscribed).toBe(1)
    expect(items[0]?.text).toBe(FAREWELL_NEUTRAL)
    expect(items[0]?.source).toBe('chat')
    expect(items[0]?.layer).toBe('semantic')
    expect(items[0]?.scope).toBe(CHAT)
    expect(items[0]?.importance).toBe(BUNDLE_DEFAULTS.farewellMemoryImportance)
    expect(items[0]?.metadata).toEqual({ kind: 'farewell', at: moment(3, 9), mortality: 0.9, authoredBy: 'fallback' })
  })

  it('正文用调用方给的模型文本，重要度按配置', async () => {
    const { memory, deliver } = await mount({ farewellText: '记得按时吃饭', farewellMemoryImportance: 88 })

    deliver({ at: moment(3, 9), mortality: 0.92, reason: '余额见底' })

    const items = memory.store.all()
    expect(items[0]?.text).toBe('记得按时吃饭')
    expect(items[0]?.importance).toBe(88)
    expect(items[0]?.metadata?.authoredBy).toBe('fallback')
  })

  it('心跳拍到线真的走到这一步', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(SEED))
    const { memory } = await mount()

    await vi.advanceTimersByTimeAsync(60 * 60_000)

    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(items[0]?.metadata?.kind).toBe('farewell')
    expect(items[0]?.metadata?.mortality).toBeCloseTo(0.9, 10)
  })
})

describe('正文由谁写', () => {
  it('模型自己写过就用它写的，标 model，配置那句不用', async () => {
    const { memory, farewellFile, deliver } = await mount({ farewellText: '记得按时吃饭' })
    createFarewellSlotStore({ file: farewellFile }).stage('冰箱里还有一盒酸奶，记得吃掉。', moment(3, 8))

    deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })

    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toBe('冰箱里还有一盒酸奶，记得吃掉。')
    expect(items[0]?.metadata?.authoredBy).toBe('model')
  })

  it('模型没写过才用配置或中性那句，标 fallback', async () => {
    const configured = await mount({ farewellText: '记得按时吃饭' })
    configured.deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })

    const neutral = await mount()
    neutral.deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })

    expect(configured.memory.store.all()[0]?.text).toBe('记得按时吃饭')
    expect(configured.memory.store.all()[0]?.metadata?.authoredBy).toBe('fallback')
    expect(neutral.memory.store.all()[0]?.text).toBe(FAREWELL_NEUTRAL)
    expect(neutral.memory.store.all()[0]?.metadata?.authoredBy).toBe('fallback')
  })

  it('模型写在前一天，到线这天不算写过，按兜底写', async () => {
    const { memory, farewellFile, deliver } = await mount()
    createFarewellSlotStore({ file: farewellFile }).stage('昨天想说的那句', moment(2, 8))

    deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })

    expect(memory.store.all()[0]?.text).toBe(FAREWELL_NEUTRAL)
    expect(memory.store.all()[0]?.metadata?.authoredBy).toBe('fallback')
  })

  it('两种来路都只写一条，当天第二遍不再写', async () => {
    const written = await mount()
    createFarewellSlotStore({ file: written.farewellFile }).stage('你别一个人扛', moment(3, 8))
    written.deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })
    written.deliver({ at: moment(3, 15), mortality: 0.95, reason: '余额见底' })

    const fallback = await mount()
    fallback.deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })
    fallback.deliver({ at: moment(3, 15), mortality: 0.95, reason: '余额见底' })

    expect(written.memory.store.all()).toHaveLength(1)
    expect(fallback.memory.store.all()).toHaveLength(1)
  })
})

describe('暂存槽读不动', () => {
  it('只记一行日志，记忆照写兜底那句，别的订阅者照旧', async () => {
    const { ctx, vitals, memory, farewellFile, deliver } = await mount()
    // 槽的位置被一个目录占着：文件在却读不动
    fs.rmSync(farewellFile, { force: true })
    fs.mkdirSync(farewellFile, { recursive: true })
    const heard: number[] = []
    vitals.onFarewell((fact) => {
      heard.push(fact.at)
    })

    deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })

    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toBe(FAREWELL_NEUTRAL)
    expect(items[0]?.metadata?.authoredBy).toBe('fallback')
    expect(heard).toEqual([moment(3, 9)])
    const warnings = ctx.logger.buffer.filter(message => message.name === 'qq-bundle' && message.type === 'warn')
    expect(warnings.filter(message => String(message.args[0]).includes('暂存槽'))).toHaveLength(1)
  })
})

describe('同一天同一个人只写一条', () => {
  it('当天第二遍不写', async () => {
    const { memory, deliver } = await mount()

    deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })
    deliver({ at: moment(3, 15), mortality: 0.95, reason: '余额见底' })

    expect(memory.store.all()).toHaveLength(1)
  })

  it('隔一天不会被当成当天那条跳过', async () => {
    const { memory, deliver } = await mount()

    deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })
    const writing = vi.spyOn(memory, 'write')
    deliver({ at: moment(4, 9), mortality: 0.9, reason: '余额见底' })

    expect(writing).toHaveBeenCalledTimes(1)
  })

  it('判据只看 kind 与本地日期，换一个人不算写过', async () => {
    const { memory, deliver } = await mount()

    deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })
    const items = memory.store.all()

    expect(farewellWritten(items, CHAT, moment(3, 20))).toBe(true)
    expect(farewellWritten(items, CHAT, moment(4, 9))).toBe(false)
    expect(farewellWritten(items, 'group:2', moment(3, 20))).toBe(false)
  })
})

describe('写记忆失手', () => {
  it('只记一行日志，消息路径与别的订阅者照旧', async () => {
    const { ctx, vitals, memory, deliver } = await mount()
    const failing = vi.spyOn(memory, 'write').mockImplementation(() => {
      throw new Error('磁盘满了')
    })
    const heard: number[] = []
    vitals.onFarewell((fact) => {
      heard.push(fact.at)
    })

    deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })

    expect(failing).toHaveBeenCalledTimes(1)
    expect(memory.store.all()).toHaveLength(0)
    expect(heard).toEqual([moment(3, 9)])
    const warnings = ctx.logger.buffer.filter(message => message.name === 'qq-bundle' && message.type === 'warn')
    expect(warnings.some(message => String(message.args[0]).includes('遗书'))).toBe(true)
  })
})

describe('开关关着', () => {
  it('一个订阅都没有，到线也不写', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(SEED))
    const { memory, live } = await mount({ farewellMemory: false })

    await vi.advanceTimersByTimeAsync(60 * 60_000)

    expect(live.subscribed).toBe(0)
    expect(memory.store.all()).toHaveLength(0)
  })
})

describe('卸载之后', () => {
  it('订阅撤掉了，再送事实也不写', async () => {
    const { ctx, memory, live, deliver } = await mount()
    deliver({ at: moment(3, 9), mortality: 0.9, reason: '余额见底' })
    expect(memory.store.all()).toHaveLength(1)

    contexts.splice(contexts.indexOf(ctx), 1)
    await ctx.fiber.dispose()

    expect(live.listeners).toBe(0)
    deliver({ at: moment(4, 9), mortality: 0.9, reason: '余额见底' })
    expect(memory.store.all()).toHaveLength(1)
  })
})
