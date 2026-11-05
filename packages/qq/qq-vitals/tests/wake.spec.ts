import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apply, createVitalsStore, emptyState, qqVitalsOf, resolveTuning, type VitalsState,
} from '../src/index.ts'

const tuning = resolveTuning()
const NOON = new Date(2026, 10, 6, 12, 0, 0).getTime()
const dirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-wake-'))
  dirs.push(dir)
  return path.join(dir, 'vitals.json')
}

// 种一份睡着的状态，心跳一拍之后应该会醒过来
function seeded(file: string, overrides: Partial<VitalsState> = {}): void {
  createVitalsStore({ file, tuning }).write({
    ...emptyState(tuning, NOON - 60_000),
    sleep_state: 'sleeping',
    asleep: true,
    ...overrides,
  })
}

async function mount(file: string): Promise<{ ctx: Context; seam: NonNullable<ReturnType<typeof qqVitalsOf>> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { file, tuning: { startDelayMs: 10, beatMs: 50 } })
  const seam = qqVitalsOf(ctx)
  if (seam === undefined) throw new Error('身体没有装上')
  return { ctx, seam }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOON)
})

afterEach(() => {
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('睡醒了', () => {
  it('从睡着变回醒着时通知一次', async () => {
    const file = tempFile()
    seeded(file)
    const { ctx, seam } = await mount(file)
    const seen: string[] = []
    seam.onWake((fact) => { seen.push(fact.to) })

    await vi.advanceTimersByTimeAsync(200)

    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toBe('sleeping')
    await ctx.fiber.dispose()
  })

  it('一直醒着不会通知', async () => {
    const file = tempFile()
    createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, NOON - 60_000), sleep_state: 'awake' })
    const { ctx, seam } = await mount(file)
    let called = 0
    seam.onWake(() => { called += 1 })

    await vi.advanceTimersByTimeAsync(200)

    expect(called).toBe(0)
    await ctx.fiber.dispose()
  })

  it('撤下之后不再通知', async () => {
    const file = tempFile()
    seeded(file)
    const { ctx, seam } = await mount(file)
    let called = 0
    const off = seam.onWake(() => { called += 1 })
    off()

    await vi.advanceTimersByTimeAsync(200)

    expect(called).toBe(0)
    await ctx.fiber.dispose()
  })
})
