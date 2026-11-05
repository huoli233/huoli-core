import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf } from '../src/index.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const AT = new Date(2026, 10, 5, 10, 0, 0).getTime()
const dirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-hooks-'))
  dirs.push(dir)
  return path.join(dir, 'self')
}

async function mount(enabled = true): Promise<{ ctx: Context; seam: NonNullable<ReturnType<typeof qqSelfOf>> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  ctx.provide('tools', { register: () => () => {} })
  apply(ctx, { enabled, dir: tempDir(), mainChatKey: 'group:1' })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return { ctx, seam }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('写完才通知', () => {
  it('三行落盘之后才被叫到时做的事', async () => {
    const { ctx, seam } = await mount()
    const seen: string[][] = []
    seam.onDay((lines) => { seen.push([...lines]) })

    seam.recordDay(['今天把周报写成了一句', '夜里那句话没说完', '明天先列三条'], AT)

    expect(seen).toHaveLength(1)
    expect(seen[0]).toHaveLength(3)
    await ctx.fiber.dispose()
  })

  it('这一层关着时不被叫到时做的事', async () => {
    const { ctx, seam } = await mount(false)
    let called = 0
    seam.onDay(() => { called += 1 })

    seam.recordDay(['一', '二', '三'], AT)

    expect(called).toBe(0)
    await ctx.fiber.dispose()
  })

  it('撤掉之后不再被叫到时做的事', async () => {
    const { ctx, seam } = await mount()
    let called = 0
    const off = seam.onDay(() => { called += 1 })
    off()

    seam.recordDay(['一', '二', '三'], AT)

    expect(called).toBe(0)
    await ctx.fiber.dispose()
  })
})
