import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSettings } from '../src/defaults.ts'
import { apply, narrativeDue, narrativeStateOf, qqSelfOf, seedNarrative, updateNarrative, type Config, type QqSelfSeam } from '../src/index.ts'
import { createSelfStore } from '../src/store.ts'

const roots: string[] = []
const DAY = 24 * 60 * 60 * 1000

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-monthly-'))
  roots.push(root)
  return path.join(root, 'self')
}

async function mount(config: Config = {}): Promise<{ dir: string; seam: QqSelfSeam }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  const dir = config.dir ?? tempDir()
  apply(ctx, { enabled: true, ...config, dir })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return { dir, seam }
}

// 叙事时间账那一份文件，文件不在就当没记过
function stateOf(dir: string): Record<string, unknown> {
  const file = path.join(dir, 'narrative.json')
  if (!fs.existsSync(file)) return {}
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
}

// 已经有叙事正文、但还没有时间账的旧目录
function legacy(dir: string, at: number): void {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'narrative.md')
  fs.writeFileSync(file, '## 我是谁\n上一次写的那一段\n')
  fs.utimesSync(file, new Date(at), new Date(at))
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('满一个月才算到期', () => {
  it('从没写过就算到期', () => {
    const dir = tempDir()
    const store = createSelfStore({ dir, settings: resolveSettings() })

    expect(narrativeDue(store, 1_000)).toBe(true)
  })

  it('写过之后一个月内不到期，满一个月才到期', () => {
    const dir = tempDir()
    const store = createSelfStore({ dir, settings: resolveSettings() })
    const at = new Date(2026, 10, 4, 20, 0).getTime()

    seedNarrative(store, at)

    expect(narrativeDue(store, at + 20 * DAY)).toBe(false)
    expect(narrativeDue(store, at + 29 * DAY)).toBe(false)
    expect(narrativeDue(store, new Date(2026, 11, 4, 20, 0).getTime())).toBe(true)
  })

  it('月末没有那一号就按那个月的月末算', () => {
    const dir = tempDir()
    const store = createSelfStore({ dir, settings: resolveSettings() })
    const at = new Date(2026, 0, 31, 10, 0).getTime()

    seedNarrative(store, at)

    expect(narrativeDue(store, new Date(2026, 1, 27, 23, 59).getTime())).toBe(false)
    expect(narrativeDue(store, new Date(2026, 1, 28, 10, 0).getTime())).toBe(true)
  })

  it('改一章也把上次更新挪到那一刻', () => {
    const dir = tempDir()
    const store = createSelfStore({ dir, settings: resolveSettings() })
    const at = new Date(2026, 10, 4, 20, 0).getTime()

    seedNarrative(store, at)
    updateNarrative(store, resolveSettings(), '我做过什么', '起过一次早', at + 10 * DAY)

    expect(narrativeStateOf(store).lastUpdateAt).toBe(at + 10 * DAY)
    expect(narrativeDue(store, at + 20 * DAY)).toBe(false)
  })

  it('旧目录没有时间账时，按叙事文件的修改时间当上次更新', () => {
    const dir = tempDir()
    const at = new Date(2026, 10, 4, 20, 0).getTime()
    legacy(dir, at)
    const store = createSelfStore({ dir, settings: resolveSettings() })

    expect(narrativeStateOf(store).lastUpdateAt).toBe(at)
    expect(narrativeDue(store, at + 10 * DAY)).toBe(false)
    expect(narrativeDue(store, at + 40 * DAY)).toBe(true)
  })
})

describe('月更提醒', () => {
  it('到期给一次信号并记下这次到期时刻', async () => {
    const dir = tempDir()
    const now = new Date(2026, 10, 4, 20, 0).getTime()
    legacy(dir, now - 40 * DAY)
    const { seam } = await mount({ dir })
    const store = createSelfStore({ dir, settings: resolveSettings() })

    expect(seam.narrativeDue(now)).toBe(true)
    expect(seam.monthlyTick(now)).toMatchObject({ due: true, remind: true, at: now })
    expect(narrativeStateOf(store).lastUpdateAt).toBeGreaterThan(now - 41 * DAY)
    expect(stateOf(dir)).toMatchObject({ lastDueAt: now })
  })

  it('同一个月只提醒一次，到期状态一直挂着', async () => {
    const dir = tempDir()
    const now = new Date(2026, 10, 4, 20, 0).getTime()
    legacy(dir, now - 40 * DAY)
    const { seam } = await mount({ dir })

    seam.monthlyTick(now)
    const again = seam.monthlyTick(now + DAY)

    expect(again).toMatchObject({ due: true, remind: false, reason: 'already_reminded' })
    expect(stateOf(dir)).toMatchObject({ lastDueAt: now })
  })

  it('到了下一个月还能再提醒一次', async () => {
    const dir = tempDir()
    const now = new Date(2026, 10, 4, 20, 0).getTime()
    legacy(dir, now - 40 * DAY)
    const { seam } = await mount({ dir })

    seam.monthlyTick(now)
    const next = seam.monthlyTick(new Date(2026, 11, 4, 20, 0).getTime())

    expect(next).toMatchObject({ due: true, remind: true })
  })

  it('叙事刚写过就不到期，也不提醒', async () => {
    const dir = tempDir()
    const now = new Date(2026, 10, 4, 20, 0).getTime()
    legacy(dir, now - 40 * DAY)
    const { seam } = await mount({ dir })

    seam.updateNarrative('我是谁', '这一个月里我叫她别硬撑')

    expect(seam.narrativeDue(now + 1_000)).toBe(false)
    expect(seam.monthlyTick(now + 1_000)).toMatchObject({ due: false, remind: false, reason: 'not_due' })
  })

  it('提醒只是信号，叙事正文一个字都不动', async () => {
    const dir = tempDir()
    const now = new Date(2026, 10, 4, 20, 0).getTime()
    legacy(dir, now - 40 * DAY)
    const { seam } = await mount({ dir })
    const before = seam.narrative()

    seam.monthlyTick(now)

    expect(seam.narrative()).toBe(before)
    expect(stateOf(dir)).toMatchObject({ lastDueAt: now })
  })

  it('这一层关着时既不算到期也不提醒', async () => {
    const dir = tempDir()
    const now = new Date(2026, 10, 4, 20, 0).getTime()
    legacy(dir, now - 40 * DAY)
    const { seam } = await mount({ dir, enabled: false })

    expect(seam.narrativeDue(now)).toBe(false)
    expect(seam.monthlyTick(now)).toEqual({ due: false, remind: false, at: now, lastUpdateAt: 0, reason: 'disabled' })
    expect(fs.existsSync(path.join(dir, 'narrative.json'))).toBe(false)
  })

  it('停手期间照样算到期，但不记这次提醒', async () => {
    const dir = tempDir()
    const now = new Date(2026, 10, 4, 20, 0).getTime()
    legacy(dir, now - 40 * DAY)
    fs.writeFileSync(path.join(dir, 'PAUSE'), '')
    const { seam } = await mount({ dir })

    const tick = seam.monthlyTick(now)

    expect(tick).toMatchObject({ due: true, remind: false, reason: 'paused' })
    expect(fs.existsSync(path.join(dir, 'narrative.json'))).toBe(false)
  })
})
