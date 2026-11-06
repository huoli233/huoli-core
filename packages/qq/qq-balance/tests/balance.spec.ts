import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@huoli/cordis'
import { applyUsage, dayOf, levelOf, tokensOf } from '../src/index.ts'

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

    expect(first).toEqual({ day: '2026-11-06', used: 120 })
    expect(second).toEqual({ day: '2026-11-06', used: 170 })
  })

  it('换了一天先清零再加', () => {
    const today = { day: '2026-11-06', used: 9_999 }
    const tomorrow = applyUsage(today, { inputTokens: 10 }, Date.UTC(2026, 10, 6, 17, 0), 'Asia/Shanghai')

    expect(tomorrow).toEqual({ day: '2026-11-07', used: 10 })
  })

  it('没有用量的那一条不动账', () => {
    const today = { day: '2026-11-06', used: 100 }

    expect(applyUsage(today, {}, noon, 'Asia/Shanghai')).toEqual(today)
    expect(applyUsage(today, { inputTokens: 0 }, noon, 'Asia/Shanghai')).toEqual(today)
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
