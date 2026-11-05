import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { backup, describeRestore, readManifest, restore } from '../scripts/archive.ts'
import { cleanupTempDirs, ledgerBeside, mount, queueBeside, tempDir, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 4, 9, 30, 0).getTime()
const SECOND = 1_000

interface Seeded {
  file: string
  ledger: string
  queue: string
}

// 造一份三件都有、记录已经建好的记忆
function seeded(): Seeded {
  const file = tempFile()
  const { seam } = mount({ file })
  seam.remember('备份之前记下的那句', 'group:1', { at: NOW })
  seam.enqueue('还压着没写的那句', 'group:1', { at: NOW })
  seam.ledger('init')
  return { file, ledger: ledgerBeside(file), queue: queueBeside(file) }
}

// 备份根目录下有几个时间戳目录
function archiveDirs(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

afterEach(cleanupTempDirs)

describe('备份', () => {
  it('三份文件整份抄进带时间戳的目录，清单也跟着落', () => {
    const seededOne = seeded()

    const result = backup(NOW, { file: seededOne.file })

    expect(result.copied).toEqual(['memory.json', 'ledger.json', 'queue.json'])
    expect(result.missing).toEqual([])
    expect(path.basename(result.dir)).toBe('20261104-093000')
    expect(fs.existsSync(path.join(result.dir, 'manifest.json'))).toBe(true)
    expect(fs.readFileSync(path.join(result.dir, 'memory.json'), 'utf8')).toBe(fs.readFileSync(seededOne.file, 'utf8'))
    expect(readManifest(result.dir).entries.map(entry => entry.kind)).toEqual(['memory', 'ledger', 'queue'])
  })

  it('只留 N 份，最旧的那份滚掉', () => {
    const seededOne = seeded()

    backup(NOW, { file: seededOne.file, keep: 2 })
    backup(NOW + SECOND, { file: seededOne.file, keep: 2 })
    const third = backup(NOW + SECOND * 2, { file: seededOne.file, keep: 2 })

    const root = path.join(path.dirname(seededOne.file), 'backups')
    expect(archiveDirs(root)).toEqual(['20261104-093001', '20261104-093002'])
    expect(third.removed).toEqual(['20261104-093000'])
    expect(third.kept).toEqual(['20261104-093001', '20261104-093002'])
  })

  it('默认留七份', () => {
    const seededOne = seeded()

    for (let at = 0; at < 9; at += 1) backup(NOW + at * SECOND, { file: seededOne.file })

    const root = path.join(path.dirname(seededOne.file), 'backups')
    expect(archiveDirs(root)).toHaveLength(7)
    expect(archiveDirs(root)[0]).toBe('20261104-093002')
  })

  it('记忆文件不在就拒绝，不造空备份', () => {
    const file = path.join(tempDir(), 'memory.json')

    expect(() => backup(NOW, { file })).toThrow(/memory.backup_source_missing/)
  })

  it('记录表与队列不在时照样备份记忆，缺的那两份点出来', () => {
    const dir = tempDir()
    const file = path.join(dir, 'memory.json')
    fs.writeFileSync(file, JSON.stringify({ version: 1, lastMaintainedDay: '', items: [] }))

    const result = backup(NOW, { file })

    expect(result.copied).toEqual(['memory.json'])
    expect(result.missing).toEqual([
      path.join(dir, 'qq-memory-ledger.json'),
      path.join(dir, 'qq-memory-queue.json'),
    ])
  })
})

describe('恢复', () => {
  it('恢复之后核对通过，恢复之前对不上', () => {
    const seededOne = seeded()
    const result = backup(NOW, { file: seededOne.file })
    const { seam } = mount({ file: seededOne.file })
    const target = seam.store.all()[0]
    if (target === undefined) throw new Error('没读到记忆')
    seam.store.update(target.id, { text: '备份之后被改的一句' })

    const restored = restore(result.dir)

    expect(restored.before.ok).toBe(false)
    expect(restored.before.changed.map(one => one.id)).toEqual([target.id])
    expect(restored.after.ok).toBe(true)
    expect(restored.restored).toEqual(['memory.json', 'queue.json', 'ledger.json'])
    expect(fs.readFileSync(seededOne.file, 'utf8')).toContain('备份之前记下的那句')
    expect(describeRestore(restored)).toContain('恢复后：账本对得上')
  })

  it('恢复到另一套路径时按给的位置落地', () => {
    const seededOne = seeded()
    const result = backup(NOW, { file: seededOne.file })
    const otherDir = tempDir()
    const file = path.join(otherDir, 'memory.json')
    const ledger = path.join(otherDir, 'ledger.json')

    const restored = restore(result.dir, { file, ledgerFile: ledger, queueFile: path.join(otherDir, 'queue.json') })

    expect(restored.after.ok).toBe(true)
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.existsSync(ledger)).toBe(true)
  })

  it('清单读不出来就停下，一个文件都不动', () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'memory.json'), '{}')

    expect(() => restore(dir)).toThrow(/memory.backup_manifest_unreadable/)
  })
})

describe('更新的版本一律不写', () => {
  // 手搭一个清单，指名恢复到哪个文件
  function crafted(dir: string, target: string, memory: unknown, ledger: unknown): string {
    const archive = path.join(dir, '20261104-093000')
    fs.mkdirSync(archive, { recursive: true })
    fs.writeFileSync(path.join(archive, 'memory.json'), JSON.stringify(memory))
    fs.writeFileSync(path.join(archive, 'ledger.json'), JSON.stringify(ledger))
    fs.writeFileSync(path.join(archive, 'manifest.json'), JSON.stringify({
      version: 1,
      at: NOW,
      entries: [
        { kind: 'memory', source: target, name: 'memory.json' },
        { kind: 'ledger', source: ledgerBeside(target), name: 'ledger.json' },
      ],
    }))
    return archive
  }

  it('备份里的记忆版本更高就拒绝恢复，目标文件一字不动', () => {
    const dir = tempDir()
    const target = path.join(dir, 'memory.json')
    fs.writeFileSync(target, JSON.stringify({ version: 1, lastMaintainedDay: '', items: [] }))
    const before = fs.statSync(target).mtimeMs
    const archive = crafted(dir, target, { version: 9, lastMaintainedDay: '', items: [] }, { schemaVersion: 1, entries: {} })

    expect(() => restore(archive)).toThrow(/memory.version_ahead/)
    expect(fs.readFileSync(target, 'utf8')).toContain('"version":1')
    expect(fs.statSync(target).mtimeMs).toBe(before)
  })

  it('备份里的记录表版本更高也拒绝恢复', () => {
    const dir = tempDir()
    const target = path.join(dir, 'memory.json')
    fs.writeFileSync(target, JSON.stringify({ version: 1, lastMaintainedDay: '', items: [] }))
    const archive = crafted(dir, target, { version: 1, lastMaintainedDay: '', items: [] }, { schemaVersion: 7, entries: {} })

    expect(() => restore(archive)).toThrow(/账本.*schemaVersion 是 7/)
  })

  it('目标那份比本包新时同样拒绝，挡住低版本覆盖', () => {
    const dir = tempDir()
    const target = path.join(dir, 'memory.json')
    fs.writeFileSync(target, JSON.stringify({ version: 8, lastMaintainedDay: '', items: [] }))
    const archive = crafted(dir, target, { version: 1, lastMaintainedDay: '', items: [] }, { schemaVersion: 1, entries: {} })

    expect(() => restore(archive)).toThrow(/现在的记忆文件 version 是 8/)
  })
})
