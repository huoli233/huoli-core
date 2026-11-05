import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyVitals, createVitalsStore, emptyState, qqVitalsOf, resolveTuning } from '../src/index.ts'

const tuning = resolveTuning()
const SEED = new Date(2026, 10, 3, 7, 30, 0).getTime()
const roots: string[] = []
const contexts: Context[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vitals-beat-'))
  roots.push(dir)
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write(emptyState(tuning, SEED))
  return file
}

// 同一份状态文件上装两次，第二次不该再起一条心跳
async function mount(file: string): Promise<{ ctx: Context; logs: string[] }> {
  const ctx = new Context()
  contexts.push(ctx)
  const logs: string[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: ({ args }) => { logs.push(String(args[0])) } })
  await ctx.plugin(SystemPrompt, {})
  applyVitals(ctx, { file, tuning: { startDelayMs: 60 * 60_000 } })
  return { ctx, logs }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('同一份状态只有一条心跳', () => {
  it('第二次装配会记一行，说这一次不另起', async () => {
    const file = tempFile()
    await mount(file)

    const second = await mount(file)

    expect(second.logs.join('\n')).toContain('已经有一条心跳在跳')
  })

  it('两次装配都能读到同一份状态，第二个不是空壳', async () => {
    const file = tempFile()
    const first = await mount(file)
    const second = await mount(file)

    expect(qqVitalsOf(first.ctx)?.read().thirst).toBe(qqVitalsOf(second.ctx)?.read().thirst)
  })

  it('第一条卸载之后，同一份文件还能再起一条', async () => {
    const file = tempFile()
    const first = await mount(file)
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const again = await mount(file)

    expect(again.logs.join('\n')).not.toContain('已经有一条心跳在跳')
  })
})
