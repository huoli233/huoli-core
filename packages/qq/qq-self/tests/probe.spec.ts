import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []
const AT = new Date(2026, 10, 5, 10, 0, 0).getTime()

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-probe-'))
  roots.push(root)
  return path.join(root, 'self')
}

async function mount(): Promise<QqSelfSeam> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  ctx.provide('tools', { register: () => () => {} })
  apply(ctx, { enabled: true, dir: tempDir(), mainChatKey: 'group:1' })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return seam
}

// 十问的回答，正好十条
function ten(): string[] {
  return Array.from({ length: 10 }, (_unused, index) => `第 ${index + 1} 问的回答`)
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('每月一次十问十问', () => {
  it('十条答完就落一条，读得回来', async () => {
    const seam = await mount()

    const outcome = seam.probe(ten(), AT)

    expect(outcome.written).toBe(true)
    const kept = seam.probeThisMonth(AT)
    expect(kept?.month).toBe('2026-11')
    expect((kept?.answers as string[]).length).toBe(10)
  })

  it('条数不对就不落，理由说得清', async () => {
    const seam = await mount()

    const outcome = seam.probe(ten().slice(0, 9), AT)

    expect(outcome.written).toBe(false)
    expect(outcome.reason).toBe('wrong_count')
  })

  it('同一个月再写一条被挡住', async () => {
    const seam = await mount()
    seam.probe(ten(), AT)

    const again = seam.probe(ten(), AT + 24 * 3_600_000)

    expect(again.written).toBe(false)
    expect(again.reason).toBe('capped')
  })

  it('跨到下个月又能写一条', async () => {
    const seam = await mount()
    seam.probe(ten(), AT)

    const next = seam.probe(ten(), new Date(2026, 11, 2, 10, 0, 0).getTime())

    expect(next.written).toBe(true)
  })

  it('单条答太长就不落', async () => {
    const seam = await mount()
    const long = ten()
    long[3] = '很'.repeat(400)

    const outcome = seam.probe(long, AT)

    expect(outcome.written).toBe(false)
    expect(outcome.reason).toBe('no_evidence')
  })
})
