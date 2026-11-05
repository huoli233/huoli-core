import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULTS, type AlertThresholds } from '../src/defaults.ts'
import { healthCounts, healthLine, ledgerLevel } from '../src/health.ts'
import { initBook, runLedger, verifyBook, type LedgerReport } from '../src/ledger.ts'
import type { MemoryItem } from '../src/types.ts'
import { cleanupTempDirs, mount, tempDir, tempFile } from './harness.ts'

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
    recoverDay: 0,
    recoverTimes: 0,
    at: NOW,
    lastSeenAt: NOW,
    state: 'active',
    source: 'chat',
    ...overrides,
  }
}

const WARM = make('id-warm', '天天提起的那句', 75)
const LIGHT = make('id-light', '随口一句', 20)
const COLD = make('id-cold', '', 75, { state: 'forgotten', clarity: 'forgotten', retiredAt: NOW })
const TRACE = make('id-trace', '只剩概念的那句', 20, { clarity: 'trace' })
const KEPT: readonly MemoryItem[] = [WARM, LIGHT, COLD]
const WITH_TRACE: readonly MemoryItem[] = [WARM, LIGHT, TRACE, COLD]
const PASSED: LedgerReport = verifyBook(initBook(KEPT), KEPT)

function thresholds(overrides: Partial<AlertThresholds> = {}): AlertThresholds {
  return {
    pendingAlert: DEFAULTS.pendingAlert,
    pinnedAlert: DEFAULTS.pinnedAlert,
    coldRatioAlert: DEFAULTS.coldRatioAlert,
    ...overrides,
  }
}

function lineOf(
  ledger: LedgerReport,
  extra: { items?: readonly MemoryItem[]; injectMaxChars?: number; protectLine?: number; alerts?: Partial<AlertThresholds> } = {},
): string {
  return healthLine({
    items: extra.items ?? KEPT,
    now: NOW,
    injectMaxChars: extra.injectMaxChars ?? 1200,
    protectLine: extra.protectLine ?? 70,
    ledger,
    thresholds: thresholds(extra.alerts),
  })
}

// 一行里 alert 标记只许出现一次
function alertMarks(line: string): number {
  return line.split('alert=').length - 1
}

afterEach(cleanupTempDirs)

describe('每天一行', () => {
  it('按时按序拼成一行', () => {
    expect(lineOf(PASSED)).toBe('[memory] 2026-10-30 18:39 total=2 pinned=1 cold=1 inject_cap=1200 ledger=OK pending=0')
  })

  it('字段顺序固定，可以按空格切着读', () => {
    expect(lineOf(PASSED)).toMatch(
      /^\[memory\] \d{4}-\d{2}-\d{2} \d{2}:\d{2} total=\d+ pinned=\d+ cold=\d+ inject_cap=\d+ ledger=(OK|DRIFT|MISSING|ERROR) pending=\d+$/,
    )
  })

  it('数出来的四个数跟这一行对得上', () => {
    expect(healthCounts(KEPT, 70)).toEqual({ total: 2, pinned: 1, cold: 1, pending: 0 })
  })

  it('冷的那一档把退役与只剩印象都数进来', () => {
    expect(healthCounts(WITH_TRACE, 70)).toEqual({ total: 3, pinned: 1, cold: 2, pending: 0 })
  })

  it('总数只数还没退役的条目', () => {
    const many: readonly MemoryItem[] = [WARM, LIGHT, TRACE, COLD, { ...COLD, id: 'id-cold-2' }]

    expect(healthCounts(many, 70).total).toBe(3)
    expect(healthCounts(many, 70).cold).toBe(3)
  })

  it('待写入只认队列给的数，没给就是 0', () => {
    const short = verifyBook(initBook([WARM, LIGHT]), KEPT)

    expect(short.unrecorded).toEqual([COLD.id])
    expect(healthCounts(KEPT, 70).pending).toBe(0)
    expect(healthCounts(KEPT, 70, 7).pending).toBe(7)
  })
})

describe('记录表四档', () => {
  it('全部对上就是 OK', () => {
    expect(ledgerLevel(PASSED)).toBe('OK')
    expect(lineOf(PASSED)).toContain('ledger=OK')
  })

  it('只被改过、一条没丢就是 DRIFT', () => {
    const report = verifyBook(initBook(KEPT), [{ ...WARM, text: '被改过的正文' }, LIGHT, COLD])

    expect(report.lost).toEqual([])
    expect(report.changed.map(one => one.id)).toEqual([WARM.id])
    expect(ledgerLevel(report)).toBe('DRIFT')
    expect(lineOf(report)).toContain('ledger=DRIFT')
  })

  it('有条目丢了就是 MISSING', () => {
    const report = verifyBook(initBook(KEPT), [WARM, LIGHT])

    expect(report.lost).toEqual([COLD.id])
    expect(ledgerLevel(report)).toBe('MISSING')
    expect(lineOf(report)).toContain('ledger=MISSING')
  })

  it('记录表还没建过时一条都对不上，也记 MISSING', () => {
    const file = path.join(tempDir(), 'ledger.json')

    const report = runLedger('verify', { file, items: KEPT }).report

    expect(report.read).toBe('absent')
    expect(ledgerLevel(report)).toBe('MISSING')
  })

  it('记录表文件损坏就是 ERROR', () => {
    const file = path.join(tempDir(), 'ledger.json')
    fs.writeFileSync(file, '{ 这半截不是账本')

    const report = runLedger('verify', { file, items: KEPT }).report

    expect(report.read).toBe('broken')
    expect(report.ok).toBe(false)
    expect(ledgerLevel(report)).toBe('ERROR')
    expect(lineOf(report)).toContain('ledger=ERROR')
  })

  it('记录表坏了不补新也不覆盖，原有内容一个字不动', () => {
    const file = path.join(tempDir(), 'ledger.json')
    fs.writeFileSync(file, '{ 这半截不是账本')

    const synced = runLedger('sync', { file, items: [WARM] })

    expect(synced.added).toEqual([])
    expect(synced.report.read).toBe('broken')
    expect(fs.readFileSync(file, 'utf8')).toBe('{ 这半截不是账本')
  })
})

describe('告警阈值', () => {
  it('什么都不超时行尾没有标记', () => {
    expect(alertMarks(lineOf(PASSED))).toBe(0)
  })

  it('待写入超阈值时行尾挂一个标记', () => {
    // 待写入恒为 0，阈值压到 0 以下才看得出这条判定接得对
    const line = lineOf(PASSED, { alerts: { pendingAlert: -1 } })

    expect(alertMarks(line)).toBe(1)
    expect(line.endsWith('alert=pending')).toBe(true)
  })

  it('受保护条数超阈值时行尾挂一个标记', () => {
    const line = lineOf(PASSED, { alerts: { pinnedAlert: 0 } })

    expect(alertMarks(line)).toBe(1)
    expect(line.endsWith('alert=pinned')).toBe(true)
  })

  it('冷的比例超阈值时行尾挂一个标记', () => {
    const line = lineOf(PASSED, { items: WITH_TRACE })

    expect(alertMarks(line)).toBe(1)
    expect(line.endsWith('alert=cold')).toBe(true)
  })

  it('记录表不是 OK 也要告警，还排在头一个', () => {
    const broken = verifyBook(initBook(KEPT), [WARM, LIGHT])
    const line = lineOf(broken, { alerts: { pinnedAlert: 0 } })

    expect(alertMarks(line)).toBe(1)
    expect(line.endsWith('alert=ledger,pinned')).toBe(true)
  })

  it('三个阈值跟着配置走', () => {
    const loose = mount({ file: tempFile(), tuning: { pendingAlert: 0, pinnedAlert: 0, coldRatioAlert: 0.9 } })
    loose.seam.remember('重要的一句', 'group:1', { importance: 88 })

    const line = loose.seam.maintain(NOW).line

    expect(line).toContain('pinned=1')
    expect(line.endsWith('alert=pinned')).toBe(true)
  })
})

describe('这两个数从配置来', () => {
  it('放进上限跟着配置走', () => {
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
