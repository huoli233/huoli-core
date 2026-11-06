import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huoli/cordis'
import { applyUsage, costOf, dayOf, levelOf, readPriceSheet, tokensOf } from '../src/index.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qq-balance-'))
  dirs.push(dir)
  return join(dir, 'qq-balance.json')
}

describe('用量怎么算成 token 数', () => {
  it('输入、输出、缓存读写加起来', () => {
    expect(tokensOf({ inputTokens: 100, outputTokens: 20 })).toBe(120)
    expect(tokensOf({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 5 })).toBe(425)
  })

  it('缺项当零，乱数当零', () => {
    expect(tokensOf({})).toBe(0)
    expect(tokensOf({ inputTokens: Number.NaN })).toBe(0)
    expect(tokensOf({ inputTokens: -50 })).toBe(0)
  })
})

describe('当天日期按时区算', () => {
  it('同一时刻在不同时区可能不是同一天', () => {
    // 2026-11-06 23:30 UTC：东京已是七号，洛杉矶还是六号
    const at = Date.UTC(2026, 10, 6, 23, 30)
    expect(dayOf(at, 'Asia/Tokyo')).toBe('2026-11-07')
    expect(dayOf(at, 'America/Los_Angeles')).toBe('2026-11-06')
  })
})

describe('用掉多少就掉多少档', () => {
  it('一点没用是满档，用光就是零', () => {
    expect(levelOf(0, 1_000, 10)).toBe(10)
    expect(levelOf(1_000, 1_000, 10)).toBe(0)
  })

  it('用一半掉一半', () => {
    expect(levelOf(500, 1_000, 10)).toBe(5)
    expect(levelOf(250, 1_000, 10)).toBe(7.5)
  })

  it('超额也不会变负，预算为零时按零档', () => {
    expect(levelOf(5_000, 1_000, 10)).toBe(0)
    expect(levelOf(0, 0, 10)).toBe(0)
  })
})

describe('账落盘与跨天', () => {
  it('写了再读回来还是那个数', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ day: '2026-11-06', used: 1234 }))

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ day: '2026-11-06', used: 1234 })
  })

  it('文件坏了当今天没花，不抛错', () => {
    const file = tempFile()
    writeFileSync(file, '不是 JSON')

    expect(() => { JSON.parse(readFileSync(file, 'utf8')) }).toThrow()
  })
})

describe('一笔一笔往账上加', () => {
  const noon = Date.UTC(2026, 10, 6, 4, 0)

  it('同一天累加', () => {
    const first = applyUsage({ day: '', used: 0 }, { inputTokens: 100, outputTokens: 20 }, noon, 'Asia/Shanghai')
    const second = applyUsage(first, { inputTokens: 50 }, noon + 60_000, 'Asia/Shanghai')

    expect(first).toEqual({ day: '2026-11-06', used: 120, cost: 0 })
    expect(second).toEqual({ day: '2026-11-06', used: 170, cost: 0 })
  })

  it('换了一天先清零再加', () => {
    const today = { day: '2026-11-06', used: 9_999 }
    const tomorrow = applyUsage(today, { inputTokens: 10 }, Date.UTC(2026, 10, 6, 17, 0), 'Asia/Shanghai')

    expect(tomorrow).toEqual({ day: '2026-11-07', used: 10, cost: 0 })
  })

  it('没有用量的那一条不动账', () => {
    const today = { day: '2026-11-06', used: 100 }

    expect(applyUsage(today, {}, noon, 'Asia/Shanghai')).toEqual(today)
    expect(applyUsage(today, { inputTokens: 0 }, noon, 'Asia/Shanghai')).toEqual(today)
  })
})

describe('按价目表算钱', () => {
  it('输入输出各按各的价，每百万 token 算', () => {
    // 一百万输入三块、一百万输出十五块，只用了十万输入与一万输出
    expect(costOf({ inputTokens: 100_000, outputTokens: 10_000 }, { input: 3, output: 15 })).toBeCloseTo(0.45)
  })

  it('缓存读写算进输入那一档', () => {
    expect(costOf({ inputTokens: 0, cacheReadTokens: 500_000 }, { input: 2, output: 8 })).toBeCloseTo(1)
  })

  it('没配价就是零，不瞎猜', () => {
    expect(costOf({ inputTokens: 100_000 }, undefined)).toBe(0)
    expect(costOf({ inputTokens: 100_000 }, {})).toBe(0)
  })

  it('账上同时记 token 与钱，换天一起清零', () => {
    const price = { input: 3, output: 15 }
    const noon = Date.UTC(2026, 10, 6, 4, 0)
    const first = applyUsage({ day: '', used: 0 }, { inputTokens: 100_000, outputTokens: 10_000 }, noon, 'Asia/Shanghai', price)

    expect(first.used).toBe(110_000)
    expect(first.cost).toBeCloseTo(0.45)
    const tomorrow = applyUsage(first, { inputTokens: 1_000 }, Date.UTC(2026, 10, 6, 17, 0), 'Asia/Shanghai', price)
    expect(tomorrow.day).toBe('2026-11-07')
    expect(tomorrow.cost).toBeCloseTo(0.003)
  })
})

describe('价目表文件', () => {
  it('读得到的时候把价与预算一起给出来', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({
      dailyCost: 5,
      prices: { 'deepseek-v4.1-flash': { input: 1, output: 2 } },
      defaultPrice: { input: 3, output: 15 },
    }))

    const sheet = readPriceSheet(file)

    expect(sheet?.dailyCost).toBe(5)
    expect(sheet?.prices?.['deepseek-v4.1-flash']).toEqual({ input: 1, output: 2 })
    expect(sheet?.defaultPrice).toEqual({ input: 3, output: 15 })
  })

  it('没配或读不动时当没有，不抛错', () => {
    expect(readPriceSheet('')).toBeUndefined()
    expect(readPriceSheet('/没有这个文件.json')).toBeUndefined()

    const broken = tempFile()
    writeFileSync(broken, '不是 JSON')
    expect(readPriceSheet(broken)).toBeUndefined()
  })
})

describe('装进运行环境', () => {
  it('已经记过的账在装配时就用上', async () => {
    const file = tempFile()
    const today = dayOf(Date.now(), '')
    writeFileSync(file, JSON.stringify({ day: today, used: 0 }))
    const ctx = new Context()

    // 没有身体那一路时也不能抛：读写只走自己那份账
    const { apply } = await import('../src/index.ts')
    expect(() => { apply(ctx, { stateFile: file, dailyTokens: 1_000 }) }).not.toThrow()
  })
})
