import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyMemory, qqMemoryOf, type QqMemorySeam } from '@huoli/huoli-qq-memory'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  qqVitalsOf,
  resolveTuning,
  type ScarFact,
} from '@huoli/huoli-qq-vitals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, type Config } from '../src/index.ts'
import { SCAR_TEXT, scarImportance } from '../src/scar.ts'

const tuning = resolveTuning()
const CHAT = 'group:1'
// 身体在装配前已经跑过一会儿，事实时刻才追得上它
const SEED = new Date(2026, 10, 3, 7, 30, 0).getTime()

// 用例里的时刻一律写死，一小时那道去重线按毫秒比
function at(hour: number, minute = 0, day = 3): number {
  return new Date(2026, 10, day, hour, minute, 0).getTime()
}

// 留下这道疤的那一刻：第一次是满格，之后压在疤的上限上
function scar(hour: number, importance = 1, minute = 0, day = 3): ScarFact {
  return { at: at(hour, minute, day), source: 'scar', importance }
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-scar-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  ctx: Context
  memory: QqMemorySeam
  /** 组合包发过几次订阅、眼下还挂着几个监听 */
  live: { subscribed: number; listeners: number }
  /** 把留下这道疤的那一刻递给组合包订阅进来的那个回调 */
  deliver: (fact: ScarFact) => void
}

interface MountOptions {
  /** 有没有活跃会话，没有时这条路只该留一行告警 */
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
  applyVitals(ctx, { file, tuning: { startDelayMs: 60 * 60_000 } })
  // 记忆的四个文件都落在临时目录里，队列与账本不去碰主目录那份
  applyMemory(ctx, {
    file: path.join(dir, 'memory.json'),
    ledgerFile: path.join(dir, 'ledger.json'),
    healthLogFile: path.join(dir, 'health.log'),
    queueFile: path.join(dir, 'queue.json'),
  })
  if (options.active !== false) qqSubjectOf(ctx)?.store.setActive(CHAT)
  const vitals = qqVitalsOf(ctx)
  const memory = qqMemoryOf(ctx)
  if (vitals === undefined || memory === undefined) throw new Error('零件没有装配')
  const live = { subscribed: 0, listeners: 0 }
  const listeners = new Set<(fact: ScarFact) => void>()
  // 订阅只能由组合包发出：在它动手之前把订阅那头包一层，顺手留住它递过来的回调
  const subscribe = vitals.onScar.bind(vitals)
  vitals.onScar = (listener) => {
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
  applyBundle(ctx, { maxSteps: 5, dailySweepHour: 4, decisionsFile: path.join(dir, 'decisions.jsonl'), ...config })
  return {
    ctx,
    memory,
    live,
    deliver(fact) {
      if (listeners.size === 0) throw new Error('组合包没有订阅疤痕')
      for (const listener of [...listeners]) listener(fact)
    },
  }
}

function warnings(ctx: Context): string[] {
  return ctx.logger.buffer
    .filter(message => message.name === 'qq-bundle' && message.type === 'warn')
    .map(message => String(message.args[0]))
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('疤痕写记忆', () => {
  it('一条长期印象，来源、层次、重要度与附加事实都对', async () => {
    const { memory, deliver } = await mount()

    const fact = scar(9)
    deliver(fact)

    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toBe(SCAR_TEXT)
    expect(items[0]?.source).toBe('chat')
    expect(items[0]?.layer).toBe('semantic')
    expect(items[0]?.scope).toBe(CHAT)
    expect(items[0]?.importance).toBe(100)
    expect(items[0]?.at).toBe(fact.at)
    expect(items[0]?.metadata).toEqual({ kind: 'scar', at: fact.at })
  })

  it('隔一小时的第二道疤并进上一条，重要度取高的那次', async () => {
    const { memory, deliver } = await mount()

    deliver(scar(9))
    deliver(scar(10, 0.8, 30))

    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(items[0]?.importance).toBe(100)
    expect(items[0]?.metadata?.['mergedCount']).toBe(1)
  })
})

describe('重要度换算', () => {
  it('零到一换成百分制：第一次满格，之后压在疤的上限', () => {
    expect(scarImportance(scar(9))).toBe(100)
    expect(scarImportance(scar(10, 0.8))).toBe(80)
    expect(scarImportance(scar(10, 0.7))).toBe(70)
  })
})

describe('一小时内只写一条', () => {
  it('半小时里的第二次不写', async () => {
    const { memory, deliver } = await mount()

    deliver(scar(9))
    deliver(scar(9, 1, 30))

    expect(memory.store.all()).toHaveLength(1)
  })
})

describe('写记忆失手', () => {
  it('只记一行日志，回调照常返回', async () => {
    const { ctx, memory, deliver } = await mount()
    const failing = vi.spyOn(memory, 'write').mockImplementation(() => {
      throw new Error('磁盘满了')
    })

    deliver(scar(9))

    expect(failing).toHaveBeenCalledTimes(1)
    expect(memory.store.all()).toHaveLength(0)
    expect(warnings(ctx).some(line => line.includes('疤痕'))).toBe(true)
  })
})

describe('没有活跃会话', () => {
  it('不写，只留一行告警', async () => {
    const { ctx, memory, deliver } = await mount({}, { active: false })

    deliver(scar(9))

    expect(memory.store.all()).toHaveLength(0)
    expect(warnings(ctx).filter(line => line.includes('疤痕记忆没有落点'))).toHaveLength(1)
  })
})

describe('开关关着', () => {
  it('一个订阅都没有，零写入', async () => {
    const { memory, live, deliver } = await mount({ scarMemory: false })

    expect(live.subscribed).toBe(0)
    expect(live.listeners).toBe(0)
    expect(() => {
      deliver(scar(9))
    }).toThrow()

    expect(memory.store.all()).toHaveLength(0)
  })
})

describe('卸载之后', () => {
  it('订阅撤掉了，再来一道疤也不写', async () => {
    const { ctx, memory, deliver, live } = await mount()
    deliver(scar(9))
    expect(memory.store.all()).toHaveLength(1)

    contexts.splice(contexts.indexOf(ctx), 1)
    await ctx.fiber.dispose()

    expect(live.listeners).toBe(0)
    expect(() => {
      deliver(scar(10, 0.8, 30))
    }).toThrow()
    expect(memory.store.all()).toHaveLength(1)
  })
})
