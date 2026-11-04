import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultLedgerFile,
  describeLedger,
  emptyBook,
  fingerprint,
  initBook,
  runLedger,
  syncBook,
  verifyBook,
} from '../src/ledger.ts'
import type { MemoryItem } from '../src/types.ts'
import { cleanupTempDirs, mount, tempDir, tempFile } from './harness.ts'

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
    forgotten: false,
    source: 'chat',
    ...overrides,
  }
}

const FIRST = make('先说的一句')
const SECOND = make('后说的一句')

afterEach(cleanupTempDirs)

describe('指纹', () => {
  it('同一句话算出来一样，改一个字就不一样', () => {
    expect(fingerprint('一句话')).toEqual(fingerprint('一句话'))
    expect(fingerprint('一句话').sha256).not.toBe(fingerprint('两句话').sha256)
    expect(fingerprint('一句话').len).toBe(3)
  })

  it('空账本一条都没有', () => {
    expect(Object.keys(emptyBook().entries)).toHaveLength(0)
  })
})

describe('建账', () => {
  it('把现在每一条都记上一份指纹', () => {
    const book = initBook([FIRST, SECOND])

    expect(Object.keys(book.entries)).toHaveLength(2)
    expect(book.entries[FIRST.id]).toEqual(fingerprint(FIRST.text))
  })

  it('账本默认落在主目录的 data 下', () => {
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

describe('对账', () => {
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

  it('淡到底清掉正文的那条不算被改', () => {
    const book = initBook([FIRST])

    const report = verifyBook(book, [{ ...FIRST, text: '', forgotten: true }])

    expect(report.ok).toBe(true)
    expect(report.changed).toEqual([])
    expect(report.held).toBe(1)
  })

  it('还没入账的条数就是待入账', () => {
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

  it('反过来会把新记的那条报成没入账', () => {
    const book = initBook([FIRST])

    const early = verifyBook(book, [FIRST, SECOND])

    expect(early.ok).toBe(false)
    expect(early.lost).toEqual([])
    expect(early.unrecorded).toEqual([SECOND.id])
  })
})

describe('落到文件', () => {
  it('建账之后账本文件读得回来', () => {
    const file = path.join(tempDir(), 'ledger.json')

    const built = runLedger('init', { file, items: [FIRST, SECOND] })
    const checked = runLedger('verify', { file, items: [FIRST, SECOND] })

    expect(built.added).toEqual([FIRST.id, SECOND.id])
    expect(built.entries).toBe(2)
    expect(checked.report.ok).toBe(true)
  })

  it('文件里没有账本时，补新会先建一本', () => {
    const file = path.join(tempDir(), 'ledger.json')

    const synced = runLedger('sync', { file, items: [FIRST] })
    const again = runLedger('sync', { file, items: [FIRST, SECOND] })

    expect(synced.report.ok).toBe(true)
    expect(again.added).toEqual([SECOND.id])
    expect(runLedger('verify', { file, items: [FIRST, SECOND] }).report.ok).toBe(true)
  })

  it('改了一条正文，对账说得出是哪一条', () => {
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

  it('删了一条，对账说得出是哪一条', () => {
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

  it('先 sync 再 verify 通过，反过来会把新记忆报成没入账', () => {
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
