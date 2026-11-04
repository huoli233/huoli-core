import { afterEach, describe, expect, it } from 'vitest'
import { healthCounts, healthLine } from '../src/health.ts'
import { initBook, verifyBook, type LedgerReport } from '../src/ledger.ts'
import type { MemoryItem } from '../src/types.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 9, 30, 18, 39).getTime()

function make(id: string, text: string, importance: number, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    text,
    layer: 'episodic',
    scope: 'group:1',
    importance,
    emotional: 0,
    clarity: 'vivid',
    recallCount: 0,
    at: NOW,
    lastSeenAt: NOW,
    forgotten: false,
    source: 'chat',
    ...overrides,
  }
}

const WARM = make('id-warm', '天天提起的那句', 75)
const LIGHT = make('id-light', '随口一句', 20)
const COLD = make('id-cold', '', 75, { forgotten: true, clarity: 'forgotten' })
const KEPT: readonly MemoryItem[] = [WARM, LIGHT, COLD]
const PASSED: LedgerReport = verifyBook(initBook(KEPT), KEPT)

function lineOf(ledger: LedgerReport, extra: { injectMaxChars?: number; protectLine?: number } = {}): string {
  return healthLine({
    items: KEPT,
    now: NOW,
    injectMaxChars: extra.injectMaxChars ?? 1200,
    protectLine: extra.protectLine ?? 60,
    ledger,
  })
}

afterEach(cleanupTempDirs)

describe('每天一行', () => {
  it('按时按序拼成一行', () => {
    expect(lineOf(PASSED)).toBe('[memory] 2026-10-30 18:39 total=3 pinned=1 cold=1 inject_cap=1200 ledger=OK pending=0')
  })

  it('字段顺序固定，可以按空格切着读', () => {
    expect(lineOf(PASSED)).toMatch(
      /^\[memory\] \d{4}-\d{2}-\d{2} \d{2}:\d{2} total=\d+ pinned=\d+ cold=\d+ inject_cap=\d+ ledger=(OK|FAIL) pending=\d+$/,
    )
  })

  it('账本对不上就不写 OK', () => {
    const broken = verifyBook(initBook(KEPT), [{ ...WARM, text: '被改过的正文' }, LIGHT, COLD])

    expect(lineOf(broken)).toContain('ledger=FAIL')
  })

  it('还没入账的条数就是待入账', () => {
    const short = verifyBook(initBook([WARM, LIGHT]), KEPT)

    expect(lineOf(short)).toContain('ledger=FAIL')
    expect(lineOf(short)).toContain('pending=1')
  })

  it('数出来的四个数跟这一行对得上', () => {
    expect(healthCounts(KEPT, 60, PASSED)).toEqual({ total: 3, pinned: 1, cold: 1, pending: 0 })
  })
})

describe('这两个数从配置来', () => {
  it('注入上限跟着配置走', () => {
    const { seam } = mount({ file: tempFile(), tuning: { injectMaxChars: 800 } })
    seam.remember('记下的一句', 'group:1')

    const kept = seam.maintain(NOW)

    expect(kept.line).toContain('inject_cap=800')
    expect(kept.line).toContain('ledger=OK')
  })

  it('保护线跟着配置走', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('记下的一句', 'group:1', { importance: 88 })

    expect(seam.maintain(NOW).line).toContain('pinned=1')

    const strict = mount({ file: tempFile(), tuning: { protectLine: 90 } })
    strict.seam.remember('记下的一句', 'group:1', { importance: 88 })

    expect(strict.seam.maintain(NOW).line).toContain('pinned=0')
  })
})
