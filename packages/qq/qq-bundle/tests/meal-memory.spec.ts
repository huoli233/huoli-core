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
  type QqVitalsSeam,
  WORDS_PRESET,
} from '@huoli/huoli-qq-vitals'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, BUNDLE_DEFAULTS, type Config } from '../src/index.ts'
import { mealText, mealWord } from '../src/meal.ts'

const tuning = resolveTuning()
const CHAT = 'group:1'
// 身体在装配前已经跑过一会儿，消息时间才追得上它
const SEED = new Date(2026, 10, 3, 7, 30, 0).getTime()

// 用例里的时刻一律写死，时段与日期都按本地时分算
function at(hour: number, minute = 0, day = 3): number {
  return new Date(2026, 10, day, hour, minute, 0).getTime()
}

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-meal-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  ctx: Context
  vitals: QqVitalsSeam
  memory: QqMemorySeam
  /** 组合包发过几次挂上、眼下还挂着几个监听 */
  live: { subscribed: number; listeners: number }
}

// 装配顺序与正式一致：状态与记忆在前，组合包最后接上
async function mount(config: Config = {}): Promise<Mounted> {
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
  qqSubjectOf(ctx)?.store.setActive(CHAT)
  const vitals = qqVitalsOf(ctx)
  const memory = qqMemoryOf(ctx)
  if (vitals === undefined || memory === undefined) throw new Error('零件没有装配')
  // 这些只能由组合包挂上去：在它动手之前把那一头包一层来数
  const live = { subscribed: 0, listeners: 0 }
  const subscribe = vitals.onMeal.bind(vitals)
  vitals.onMeal = (listener) => {
    const off = subscribe(listener)
    live.subscribed += 1
    live.listeners += 1
    return () => {
      live.listeners -= 1
      off()
    }
  }
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(dir, 'decisions.jsonl'), ...config })
  return { ctx, vitals, memory, live }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('一顿饭写一条记忆', () => {
  it('正文带时刻与吃的东西，来源是聊天，重要度按配置', async () => {
    // 这条只看「配置项怎么落到重要度」，情绪抬升由情绪那组用例单独测
    const { vitals, memory, live } = await mount({ mealMemoryImportance: 42, emotion: { memoryLift: false } })

    vitals.react('给你点了碗面', at(11, 45))

    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(live.subscribed).toBe(1)
    expect(items[0]?.text).toBe('中午吃了面')
    expect(items[0]?.source).toBe('chat')
    expect(items[0]?.layer).toBe('episodic')
    expect(items[0]?.scope).toBe(CHAT)
    expect(items[0]?.importance).toBe(42)
    expect(items[0]?.metadata).toEqual({ kind: 'meal', at: at(11, 45), name: '面' })
  })

  it('不给配置时用默认值表里的那一档', async () => {
    const { vitals, memory } = await mount({ emotion: { memoryLift: false } })

    vitals.react('我去吃饭了', at(8, 5))

    const items = memory.store.all()
    expect(items[0]?.text).toBe('早上吃了饭')
    expect(items[0]?.importance).toBe(BUNDLE_DEFAULTS.mealMemoryImportance)
  })
})

describe('同一天同一顿只写一条', () => {
  it('中午的第二顿不再写一条', async () => {
    const { vitals, memory } = await mount()

    vitals.react('我去吃饭了', at(11, 5))
    vitals.react('给你点了碗面', at(11, 45))

    expect(vitals.read().last_meal).toBe(at(11, 45))
    expect(memory.store.all()).toHaveLength(1)
  })

  it('换个时段就是另一顿', async () => {
    const { vitals, memory } = await mount()

    vitals.react('我去吃饭了', at(8, 5))
    vitals.react('给你点了碗面', at(11, 45))

    expect(memory.store.all().map(item => item.text)).toEqual(['早上吃了饭', '中午吃了面'])
  })

  it('隔一天的中午算新的一条', async () => {
    const { vitals, memory } = await mount()

    vitals.react('我去吃饭了', at(11, 5, 3))
    vitals.react('给你点了碗面', at(11, 45, 4))

    expect(memory.store.all()).toHaveLength(2)
  })
})

describe('开关关着', () => {
  it('一个挂上都没有，一顿饭记忆零新增', async () => {
    const { vitals, memory, live } = await mount({ mealMemory: false })

    vitals.react('我去吃饭了', at(11, 45))

    expect(live.subscribed).toBe(0)
    expect(memory.store.all()).toHaveLength(0)
    expect(vitals.read().last_meal).toBe(at(11, 45))
  })
})

describe('卸载之后', () => {
  it('挂上撤掉了，再吃一顿也不写', async () => {
    const { ctx, vitals, memory, live } = await mount()
    vitals.react('我去吃饭了', at(8, 5))
    expect(memory.store.all()).toHaveLength(1)

    contexts.splice(contexts.indexOf(ctx), 1)
    await ctx.fiber.dispose()

    expect(live.listeners).toBe(0)
    vitals.react('给你点了碗面', at(11, 45))
    expect(memory.store.all()).toHaveLength(1)
  })
})

describe('写记忆失手', () => {
  it('只记一行日志，身体与通知那条路照旧', async () => {
    const { ctx, vitals, memory } = await mount()
    const failing = vi.spyOn(memory, 'write').mockImplementation(() => {
      throw new Error('磁盘满了')
    })
    const heard: string[] = []
    vitals.onMeal((fact) => {
      heard.push(fact.name)
    })

    vitals.react('给你点了碗面', at(11, 45))

    expect(failing).toHaveBeenCalledTimes(1)
    expect(memory.store.all()).toHaveLength(0)
    expect(vitals.read().last_meal).toBe(at(11, 45))
    expect(heard).toEqual(['面'])
    const warnings = ctx.logger.buffer.filter(message => message.name === 'qq-bundle' && message.type === 'warn')
    expect(warnings.some(message => String(message.args[0]).includes('进食记忆'))).toBe(true)
  })
})

describe('这一顿怎么说', () => {
  it('时段词按本地时分摊开', () => {
    expect(mealWord(at(8, 5))).toBe('早上')
    expect(mealWord(at(12, 10))).toBe('中午')
    expect(mealWord(at(16, 0))).toBe('下午')
    expect(mealWord(at(19, 0))).toBe('晚上')
    expect(mealWord(at(2, 0))).toBe('夜里')
  })

  it('没认出食物名时就说吃了饭', () => {
    expect(mealText({ at: at(12, 10), name: '' })).toBe('中午吃了饭')
    expect(mealText({ at: at(12, 10), name: '面' })).toBe('中午吃了面')
  })
})
