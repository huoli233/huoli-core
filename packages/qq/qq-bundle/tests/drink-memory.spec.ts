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
} from '@huoli/huoli-qq-vitals'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle, type Config } from '../src/index.ts'

const tuning = resolveTuning()
const CHAT = 'group:1'
const SEED = new Date(2026, 10, 3, 7, 30, 0).getTime()

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-drink-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  vitals: QqVitalsSeam
  memory: QqMemorySeam
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
  applyVitals(ctx, { file, tuning: { startDelayMs: 60 * 60_000 } })
  applyMemory(ctx, {
    file: path.join(dir, 'memory.json'),
    ledgerFile: path.join(dir, 'ledger.json'),
    healthLogFile: path.join(dir, 'health.log'),
    queueFile: path.join(dir, 'queue.json'),
  })
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepAt: '04:00',
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    livenessFile: path.join(dir, 'liveness.json'),
    ...config,
  })
  const vitals = qqVitalsOf(ctx)
  const memory = qqMemoryOf(ctx)
  if (vitals === undefined || memory === undefined) throw new Error('没装起来')
  qqSubjectOf(ctx)?.store.setActive(CHAT)
  return { vitals, memory }
}

function drinks(memory: QqMemorySeam): { text: string; at: number }[] {
  return memory.store.all()
    .filter(item => item.metadata?.kind === 'drink')
    .map(item => ({ text: item.text, at: item.at }))
}

// 两分钟一杯，水是真的喝下去了
const MINUTE = 60_000

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('喝一杯水写一条记忆', () => {
  it('说喝水了就落一条，正文带喝的是什么', async () => {
    const { vitals, memory } = await mount()

    vitals.react('喝水了', SEED + MINUTE)

    const kept = drinks(memory)
    expect(kept).toHaveLength(1)
    expect(kept[0]?.text).toBe('喝了水')
  })

  it('二十分钟里连喝几杯只留一条，不成流水账', async () => {
    const { vitals, memory } = await mount()

    vitals.react('喝水了', SEED + MINUTE)
    vitals.react('喝水了', SEED + 5 * MINUTE)
    vitals.react('喝水了', SEED + 10 * MINUTE)

    expect(drinks(memory)).toHaveLength(1)
  })

  it('过了二十分钟再喝就算新的一条', async () => {
    const { vitals, memory } = await mount()

    vitals.react('喝水了', SEED + MINUTE)
    // 换一种喝的：正文不同，才看得出是两条而不是被记忆层合并了
    vitals.react('喝了奶茶', SEED + 30 * MINUTE)

    const kept = drinks(memory)
    expect(kept).toHaveLength(2)
    expect(kept.map(item => item.text)).toEqual(['喝了水', '喝了奶茶'])
  })

  it('关掉这一路就一条都不写', async () => {
    const { vitals, memory } = await mount({ drinkMemory: false })

    vitals.react('喝水了', SEED + MINUTE)

    expect(drinks(memory)).toHaveLength(0)
  })
})
