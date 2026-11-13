import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huoli/cordis'
import {
  DEFAULTS,
  apply,
  applyLongingEvent,
  createLongingStore,
  effectiveDesire,
  emptyLongingState,
  nextLongingState,
  pressureOf,
  qqLongingOf,
  renderLongingBlock,
} from '../src/index.ts'

const roots: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-longing-'))
  roots.push(dir)
  return path.join(dir, 'state.json')
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('七维状态', () => {
  it('夸奖会抬好感和性欲，占有会压理智上限', () => {
    const state = emptyLongingState(1_000)
    const praised = applyLongingEvent(state, 'praise', DEFAULTS, 2_000).state
    const possessive = { ...state, possess: 90 }

    expect(praised.affection).toBeGreaterThan(state.affection)
    expect(praised.lust).toBeGreaterThan(state.lust)
    expect(pressureOf(possessive, DEFAULTS).resist).toBeLessThan(40)
  })

  it('成人总闸关着时亲密事件不算', () => {
    const outcome = applyLongingEvent(emptyLongingState(1_000), 'intimate', DEFAULTS, 2_000)

    expect(outcome.ok).toBe(false)
    expect(outcome.applied).toEqual({})
  })

  it('时间只把性欲拉回日常值，不会拉到零', () => {
    const state = { ...emptyLongingState(1_000), lust: 80, tickedAt: 1_000 }
    const next = nextLongingState(state, DEFAULTS, 1_000 + 2 * 3_600_000)

    expect(next.lust).toBeLessThan(80)
    expect(next.lust).toBeGreaterThanOrEqual(30)
  })

  it('好感低时高性欲不会自动变成愿意', () => {
    const state = { ...emptyLongingState(), lust: 90, resist: 20, affection: 5 }

    expect(effectiveDesire(state)).toBeLessThan(50)
  })
})

describe('提示与存盘', () => {
  it('事后余韵会写进私聊状态块', () => {
    const state = {
      ...emptyLongingState(1_000),
      lust: 10,
      aftercareUntil: 2_000,
    }
    const text = renderLongingBlock(state, { ...DEFAULTS, nsfwEnabled: true }, 1_500)

    expect(text).toContain('刚刚结束')
    expect(text).not.toContain('性欲')
  })

  it('状态原子写回，正式文件读不出时回退备份', () => {
    const file = tempFile()
    const store = createLongingStore({ file })
    const first = { ...emptyLongingState(1_000), affection: 66 }
    const second = { ...first, affection: 77 }

    store.write(first)
    store.write(second)
    fs.writeFileSync(file, '{broken')

    expect(store.read().affection).toBe(66)
  })

  it('插件装配后能从服务读写事件并生成提示', async () => {
    const file = tempFile()
    const ctx = new Context()
    apply(ctx, { file, enabled: true, nsfwEnabled: true })
    const seam = qqLongingOf(ctx)

    expect(seam).toBeDefined()
    seam?.contact('我回来了', 2_000)
    const outcome = seam?.event('praise', 3_000)

    expect(outcome?.ok).toBe(true)
    expect(seam?.render(4_000)).toContain('[暗涌状态]')
    await ctx.fiber.dispose()
    expect(fs.existsSync(file)).toBe(true)
  })
})
