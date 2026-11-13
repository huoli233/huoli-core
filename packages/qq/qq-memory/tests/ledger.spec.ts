import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultLedgerFile,
  describeLedger,
  emptyBook,
  fingerprint,
  initBook,
  reconcileMaintenanceBook,
  runLedger,
  syncBook,
  verifyBook,
} from '../src/ledger.ts'
import type { MemoryItem } from '../src/types.ts'
import { cleanupTempDirs, mount, tempDir, tempFile } from './harness.ts'

const DAY = 86_400_000
const NOW = new Date(2026, 9, 30, 18, 39).getTime()

function make(text: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: `id-${text}`,
    text,
    layer: 'episodic',
    scope: 'group:1',
    importance: 40,
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

const FIRST = make('先说的一句')
const SECOND = make('后说的一句')
// 同一条退役之后的样子：编号不变，没有正文，留着退役时刻
const RETIRED_FIRST = make('先说的一句', { text: '', state: 'forgotten', clarity: 'forgotten', retiredAt: NOW })
// 一条从头到尾只在退役态里出现过的记忆
const RETIRED = make('先说过又忘掉的一句', { text: '', state: 'forgotten', clarity: 'forgotten', retiredAt: NOW })

afterEach(cleanupTempDirs)

describe('指纹', () => {
  it('同一句话算出来一样，改一个字就不一样', () => {
    expect(fingerprint('一句话')).toEqual(fingerprint('一句话'))
    expect(fingerprint('一句话').sha256).not.toBe(fingerprint('两句话').sha256)
    expect(fingerprint('一句话').len).toBe(3)
  })

  it('空记录表一条都没有', () => {
    expect(Object.keys(emptyBook().entries)).toHaveLength(0)
  })
})

describe('维护合并后的记录表', () => {
  it('移除的旧编号和改写的正文按当前记忆重新对齐', () => {
    const file = tempFile()
    const before = [FIRST, SECOND, make('会被并掉的一句')]
    runLedger('init', { file, items: before })
    const after = [{ ...SECOND, text: `${SECOND.text}；并进来的内容` }, make('新写的一句')]

    const result = reconcileMaintenanceBook(file, after)

    expect(result.report.ok).toBe(true)
    expect(result.report.lost).toEqual([])
    expect(result.report.changed).toEqual([])
    expect(result.report.unrecorded).toEqual([])
  })
})

describe('建账', () => {
  it('把现在每一条都记上一份指纹', () => {
    const book = initBook([FIRST, SECOND])

    expect(Object.keys(book.entries)).toHaveLength(2)
    expect(book.entries[FIRST.id]).toEqual({ ...fingerprint(FIRST.text), state: 'held' })
  })

  it('记录表默认落在主目录的 data 下', () => {
    const home = tempDir()

    expect(defaultLedgerFile(home)).toBe(path.join(home, 'data', 'qq-memory-ledger.json'))
  })
})

describe('补新', () => {
  it('只补没记过的编号', () => {
    const book = initBook([FIRST])

    const { book: next, added } = syncBook(book, [FIRST, SECOND])

    expect(added).toEqual([SECOND.id])
    expect(Object.keys(next.entries)).toHaveLength(2)
  })

  it('老记录一个字都不覆盖', () => {
    const book = initBook([FIRST])

    const { book: next, added } = syncBook(book, [{ ...FIRST, text: '被人改过的正文' }])

    expect(added).toEqual([])
    expect(next.entries[FIRST.id]).toEqual(book.entries[FIRST.id])
  })
})

describe('核对', () => {
  it('一条没动就对得上', () => {
    const book = initBook([FIRST, SECOND])

    const report = verifyBook(book, [FIRST, SECOND])

    expect(report.ok).toBe(true)
    expect(report.held).toBe(2)
    expect(describeLedger(report)).toContain('2 条')
  })

  it('正文被改就报出来，还得指出是哪一条', () => {
    const book = initBook([FIRST, SECOND])

    const report = verifyBook(book, [FIRST, { ...SECOND, text: '被人改过的正文' }])

    expect(report.ok).toBe(false)
    expect(report.lost).toEqual([])
    expect(report.changed.map(one => one.id)).toEqual([SECOND.id])
    expect(describeLedger(report)).toContain(SECOND.id)
  })

  it('少了一条就报丢了，还得指出是哪一条', () => {
    const book = initBook([FIRST, SECOND])

    const report = verifyBook(book, [FIRST])

    expect(report.ok).toBe(false)
    expect(report.lost).toEqual([SECOND.id])
    expect(report.changed).toEqual([])
    expect(describeLedger(report)).toContain(SECOND.id)
  })

  it('淡到底退役记过账的那条不算被改', () => {
    const book = initBook([FIRST])

    const { book: next, added } = syncBook(book, [RETIRED_FIRST])
    const report = verifyBook(next, [RETIRED_FIRST])

    expect(added).toEqual([])
    expect(next.entries[FIRST.id]?.state).toBe('retired')
    expect(report.ok).toBe(true)
    expect(report.changed).toEqual([])
    expect(report.held).toBe(1)
    expect(report.retired).toBe(1)
  })

  it('只清正文没登记退役的照样报被改', () => {
    const book = initBook([FIRST])

    const report = verifyBook(book, [{ ...FIRST, text: '', state: 'forgotten' }])

    expect(report.ok).toBe(false)
    expect(report.changed.map(one => one.id)).toEqual([FIRST.id])
  })

  it('还没进记录表的条数就是待记进记录表', () => {
    const book = initBook([FIRST])

    const report = verifyBook(book, [FIRST, SECOND])

    expect(report.ok).toBe(false)
    expect(report.unrecorded).toEqual([SECOND.id])
  })
})

describe('顺序纪律', () => {
  it('先 sync 再 verify 才对得上', () => {
    const book = initBook([FIRST])

    const { book: next } = syncBook(book, [FIRST, SECOND])

    expect(verifyBook(next, [FIRST, SECOND]).ok).toBe(true)
  })

  it('反过来会把新记的那条报成没记进记录表', () => {
    const book = initBook([FIRST])

    const early = verifyBook(book, [FIRST, SECOND])

    expect(early.ok).toBe(false)
    expect(early.lost).toEqual([])
    expect(early.unrecorded).toEqual([SECOND.id])
  })
})

describe('落到文件', () => {
  it('建账之后记录表文件读得回来', () => {
    const file = path.join(tempDir(), 'ledger.json')

    const built = runLedger('init', { file, items: [FIRST, SECOND] })
    const checked = runLedger('verify', { file, items: [FIRST, SECOND] })

    expect(built.added).toEqual([FIRST.id, SECOND.id])
    expect(built.entries).toBe(2)
    expect(checked.report.ok).toBe(true)
  })

  it('文件里没有记录表时，补新会先建一本', () => {
    const file = path.join(tempDir(), 'ledger.json')

    const synced = runLedger('sync', { file, items: [FIRST] })
    const again = runLedger('sync', { file, items: [FIRST, SECOND] })

    expect(synced.report.ok).toBe(true)
    expect(again.added).toEqual([SECOND.id])
    expect(runLedger('verify', { file, items: [FIRST, SECOND] }).report.ok).toBe(true)
  })

  it('改了一条正文，核对说得出是哪一条', () => {
    const file = tempFile()
    const { seam } = mount({ file })
    const kept = seam.remember('要留下的那句', 'group:1')
    const touched = seam.remember('会被改掉的那句', 'group:1')
    seam.ledger('init')

    seam.store.update(touched.id, { text: '换成了别的正文' })
    const report = seam.ledger('verify').report

    expect(report.ok).toBe(false)
    expect(report.changed.map(one => one.id)).toEqual([touched.id])
    expect(report.lost).toEqual([])
    expect(report.changed[0]?.expectedLen).toBe('会被改掉的那句'.length)
    expect(describeLedger(report)).toContain(touched.id)
    expect(describeLedger(report)).not.toContain(kept.id)
  })

  it('删了一条，核对说得出是哪一条', () => {
    const file = tempFile()
    const { seam } = mount({ file })
    const kept = seam.remember('要留下的那句', 'group:1')
    const gone = seam.remember('会被删掉的那句', 'group:1')
    seam.ledger('init')

    seam.store.remove(gone.id)
    const report = seam.ledger('verify').report

    expect(report.ok).toBe(false)
    expect(report.lost).toEqual([gone.id])
    expect(describeLedger(report)).toContain(gone.id)
    expect(describeLedger(report)).not.toContain(kept.id)
  })

  it('先 sync 再 verify 通过，反过来会把新记忆报成没记进记录表', () => {
    const file = tempFile()
    const { seam } = mount({ file })
    seam.remember('原有的那句', 'group:1')
    seam.ledger('init')
    const fresh = seam.remember('后来才记的那句', 'group:1')

    const early = seam.ledger('verify').report
    expect(early.ok).toBe(false)
    expect(early.unrecorded).toEqual([fresh.id])

    seam.ledger('sync')
    const late = seam.ledger('verify').report

    expect(late.ok).toBe(true)
    expect(late.unrecorded).toEqual([])
  })
})

describe('退役是显式的', () => {
  it('遗忘之后记录表记为退役，核对照样通过', () => {
    const file = tempFile()
    const { seam } = mount({ file })
    const gone = seam.remember('会淡到没的一句', 'group:1', { importance: 40, at: NOW - 87 * DAY })
    seam.store.update(gone.id, { clarity: 'trace', lastSeenAt: NOW - 87 * DAY })
    seam.ledger('init')

    // 这次整理掉一分、淡到已遗忘、清正文，记录跟着把它标成退役
    const run = seam.maintain(NOW)
    const report = seam.ledger('verify').report

    expect(run.forgotten).toBe(1)
    expect(report.ok).toBe(true)
    expect(report.changed).toEqual([])
    expect(report.retired).toBe(1)
    expect(describeLedger(report)).toContain('已退役 1 条')
  })

  it('退役之后又长出正文就报被改', () => {
    const book = initBook([RETIRED])

    const report = verifyBook(book, [{ ...RETIRED, text: '退役之后又被人写回来的一句' }])

    expect(report.ok).toBe(false)
    expect(report.lost).toEqual([])
    expect(report.changed.map(one => one.id)).toEqual([RETIRED.id])
  })

  it('把状态改回 active 且改写正文也报被改', () => {
    const book = initBook([RETIRED])

    const report = verifyBook(book, [{ ...RETIRED, text: '换了个说法还改回 active', state: 'active' }])

    expect(report.ok).toBe(false)
    expect(report.changed.map(one => one.id)).toEqual([RETIRED.id])
  })

  it('退役条数在报告里点得出来', () => {
    const report = verifyBook(initBook([FIRST, RETIRED]), [FIRST, RETIRED])

    expect(report.ok).toBe(true)
    expect(report.retired).toBe(1)
    expect(report.held).toBe(2)
    expect(describeLedger(report)).toContain('已退役 1 条')
  })
})

describe('记录表版本戳', () => {
  it('写出来的记录表带 schemaVersion 与每条的状态', () => {
    const file = path.join(tempDir(), 'ledger.json')

    runLedger('init', { file, items: [FIRST, RETIRED] })

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      schemaVersion: number
      entries: Record<string, { state: string; retiredAt?: number }>
    }
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.entries[FIRST.id]?.state).toBe('held')
    expect(parsed.entries[RETIRED.id]?.state).toBe('retired')
    expect(parsed.entries[RETIRED.id]?.retiredAt).toBe(NOW)
  })

  it('没有 schemaVersion 的旧记录表读得回来，按 1 补默认', () => {
    const file = path.join(tempDir(), 'ledger.json')
    // 旧格式：文件头只有 version，每条只有指纹与字数
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: { [FIRST.id]: fingerprint(FIRST.text) } }, null, 2))

    const report = runLedger('verify', { file, items: [FIRST] }).report

    expect(report.ok).toBe(true)
    expect(report.held).toBe(1)
    expect(report.retired).toBe(0)

    // 补一次账，写回去的文件就带上版本戳
    runLedger('sync', { file, items: [FIRST] })
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { schemaVersion: number }

    expect(parsed.schemaVersion).toBe(1)
  })
})
