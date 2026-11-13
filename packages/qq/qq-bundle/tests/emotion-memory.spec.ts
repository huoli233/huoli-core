// 情绪接进记忆：心情重时经历更容易留下来，调用方自己给过情绪分就按它的

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
  type VitalsState,
  WORDS_PRESET,
} from '@huoli/huoli-qq-vitals'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle, BUNDLE_DEFAULTS, type Config } from '../src/index.ts'
import { emotionTierOf, resolveEmotionSettings } from '../src/emotion-tier.ts'

const tuning = resolveTuning()
const CHAT = 'group:1'
// 这一顿的时刻固定，用例只看重要度
const LUNCH = new Date(2026, 10, 10, 11, 45, 0).getTime()
// 身体只提前一分钟写好，中间那段漂移不参与，读到的就是写进去的那一档
const SEED = LUNCH - 60_000
// 记仇与皮质醇都是存下来的读数，写进去就是它；烦那几项是算出来的，写进去会被重算
const PEAK = { resentment: 0.9 }
const HEAVY = { cortisol: 0.9 }

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-emotion-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  ctx: Context
  vitals: QqVitalsSeam
  memory: QqMemorySeam
}

// 装配顺序与正式一致：状态与记忆在前，组合包最后接上
async function mount(body: Partial<VitalsState> = {}, config: Config = {}): Promise<Mounted> {
  const dir = tempDir()
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, SEED), ...body })
  const ctx = new Context()
  contexts.push(ctx)
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyVitals(ctx, { file, tuning: { words: WORDS_PRESET, startDelayMs: 60 * 60_000 } })
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
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(dir, 'decisions.jsonl'), ...config })
  return { ctx, vitals, memory }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('心情重时写下来的经历更重要', () => {
  it('吃饭这种轻微反应按写记忆那拍的档位抬，不会凭空多抬', async () => {
    const { vitals, memory } = await mount()

    vitals.react('给你点了碗面', LUNCH)
    // 身体读数本来就在浮动，只断言「写下来的和那一拍算出来的完全一致」
    const lift = emotionTierOf(vitals.read(), resolveEmotionSettings()).lift

    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(items[0]?.importance).toBe(BUNDLE_DEFAULTS.mealMemoryImportance + lift)
    expect(items[0]?.emotional).toBe(lift)
  })

  it('情绪重时重要度抬得起来，情绪分也跟着记下', async () => {
    const { vitals, memory } = await mount(PEAK, { emotion: { mixBonus: 0 } })

    vitals.react('给你点了碗面', LUNCH)
    // 档位随身体读数变，按写记忆那一拍真实算出来的抬分断言
    const tier = emotionTierOf(vitals.read(), resolveEmotionSettings({ mixBonus: 0 }))

    expect(tier.lift).toBeGreaterThan(0)
    expect(memory.store.all()[0]?.importance).toBe(BUNDLE_DEFAULTS.mealMemoryImportance + tier.lift)
    expect(memory.store.all()[0]?.emotional).toBe(tier.lift)
  })

  it('偏高档抬的分与写记忆那一刻的档位一致', async () => {
    const { vitals, memory } = await mount(HEAVY, { emotion: { mixBonus: 0 } })

    vitals.react('给你点了碗面', LUNCH)
    // 这一顿会把绷紧的读数压下去，所以按写记忆那一拍真实算出来的档位断言，不写死档位
    const tier = emotionTierOf(vitals.read(), resolveEmotionSettings({ mixBonus: 0 }))

    expect(tier.lift).toBeGreaterThan(0)
    expect(memory.store.all()[0]?.importance).toBe(BUNDLE_DEFAULTS.mealMemoryImportance + tier.lift)
    expect(memory.store.all()[0]?.emotional).toBe(tier.lift)
  })

  it('抬多少按配置算，不是写死的四分', async () => {
    const { vitals, memory } = await mount(PEAK, { emotion: { mixBonus: 0, peakLift: 6, highLift: 6, mildLift: 6 } })

    vitals.react('给你点了碗面', LUNCH)
    // 三档都配成 6，不管落在哪一档都该是 6
    const tier = emotionTierOf(vitals.read(), resolveEmotionSettings({ mixBonus: 0, peakLift: 6, highLift: 6, mildLift: 6 }))

    expect(tier.lift).toBe(6)
    expect(memory.store.all()[0]?.importance).toBe(BUNDLE_DEFAULTS.mealMemoryImportance + 6)
    expect(memory.store.all()[0]?.emotional).toBe(6)
  })

  it('关掉记忆那一条回路就回到原样', async () => {
    const { vitals, memory } = await mount(HEAVY, { emotion: { memoryLift: false } })

    vitals.react('给你点了碗面', LUNCH)

    const items = memory.store.all()
    expect(items[0]?.importance).toBe(BUNDLE_DEFAULTS.mealMemoryImportance)
    expect(items[0]?.emotional).toBe(0)
  })

  it('总开关关掉也回到原样', async () => {
    const { vitals, memory } = await mount(HEAVY, { emotion: { enabled: false } })

    vitals.react('给你点了碗面', LUNCH)

    expect(memory.store.all()[0]?.importance).toBe(BUNDLE_DEFAULTS.mealMemoryImportance)
  })
})
