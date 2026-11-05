import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyMemory, qqMemoryOf, type QqMemorySeam } from '@huoli/huoli-qq-memory'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  qqVitalsOf,
  resolveTuning,
  type CycleStartFact,
  type QqVitalsSeam,
  WORDS_PRESET,
} from '@huoli/huoli-qq-vitals'
import { apply as applyBundle, type Config } from '../src/index.ts'

const tuning = resolveTuning()
const CHAT = 'group:1'
const AT = new Date(2026, 10, 5, 9, 0, 0).getTime()

const tempDirs: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-cycle-'))
  tempDirs.push(dir)
  return dir
}

interface Mounted {
  vitals: QqVitalsSeam
  memory: QqMemorySeam
  emit: (fact: CycleStartFact) => void
}

// 装配顺序与正式一致；把挂上去的函数留下来，用例自己触发那一拍
async function mount(config: Config = {}): Promise<Mounted> {
  const dir = tempDir()
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write(emptyState(tuning, AT))
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
  let heard: ((fact: CycleStartFact) => void) | undefined
  const subscribe = vitals.onCycleStart.bind(vitals)
  vitals.onCycleStart = (listener) => {
    const off = subscribe(listener)
    heard = listener
    return off
  }
  applyBundle(ctx, { maxSteps: 5, decisionsFile: path.join(dir, 'decisions.jsonl'), ...config })
  return {
    vitals,
    memory,
    emit: (fact) => {
      if (heard === undefined) throw new Error('组合包没有订阅开经')
      heard(fact)
    },
  }
}

function cycles(memory: QqMemorySeam): Record<string, unknown>[] {
  return memory.store.all()
    .filter(item => item.metadata?.kind === 'cycle_start')
    .map(item => item.metadata ?? {})
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('开经日写一条记忆', () => {
  it('收到开经事实就落一条，带第几天', async () => {
    const { memory, emit } = await mount()

    emit({ at: AT, day: 1, date: '2026-11-05' })

    const kept = cycles(memory)
    expect(kept).toHaveLength(1)
    expect(kept[0]?.day).toBe(1)
  })

  it('同一个周期里再来一次不重复写', async () => {
    const { memory, emit } = await mount()

    emit({ at: AT, day: 1, date: '2026-11-05' })
    emit({ at: AT + 60_000, day: 1, date: '2026-11-05' })

    expect(cycles(memory)).toHaveLength(1)
  })

  it('关掉这一路就一个挂上都不挂上', async () => {
    const { memory, emit } = await mount({ cycleMemory: false })

    // 关着时一个函数都不该挂上去，硬触发只会拿到「没有挂」
    expect(() => {
      emit({ at: AT, day: 1, date: '2026-11-05' })
    }).toThrow('组合包没有订阅开经')
    expect(cycles(memory)).toHaveLength(0)
  })
})
