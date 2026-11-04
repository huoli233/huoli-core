import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { describeProbe, probe } from '../scripts/probe.ts'
import { cleanupTempDirs, ledgerBeside, mount, queueBeside, tempDir, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 4, 9, 30).getTime()

// 造一份有层、有清晰度、有账本、有队列的记忆
function seeded(): { file: string; ledger: string; queue: string; ids: readonly string[] } {
  const file = tempFile()
  const { seam } = mount({ file })
  const first = seam.remember('最早记下的一句', 'group:1', { at: NOW - 3_000, layer: 'ephemeral' })
  const second = seam.remember('后来记下的一句', 'group:1', { at: NOW - 1_000, layer: 'episodic' })
  seam.remember('再后来的一句', 'group:1', { at: NOW, layer: 'semantic' })
  seam.store.update(second.id, { clarity: 'fuzzy' })
  seam.enqueue('还压着没写的一句', 'group:1', { at: NOW })
  seam.ledger('init')
  return { file, ledger: ledgerBeside(file), queue: queueBeside(file), ids: [first.id, second.id] }
}

// 一个文件此刻的修改时间，读文件不该动它
function mtimeOf(file: string): number {
  return fs.statSync(file).mtimeMs
}

afterEach(cleanupTempDirs)

describe('只读探测', () => {
  it('条数、层分布、清晰度分布、账本结论、最早的记忆、待写入都在报告里', () => {
    const seededOne = seeded()

    const report = probe(seededOne.file)

    expect(report.memory).toBe('ok')
    expect(report.total).toBe(3)
    expect(report.active).toBe(3)
    expect(report.layers.ephemeral).toBe(1)
    expect(report.layers.episodic).toBe(1)
    expect(report.layers.semantic).toBe(1)
    expect(report.layers.private).toBe(0)
    expect(report.clarity.vivid).toBe(2)
    expect(report.clarity.fuzzy).toBe(1)
    expect(report.clarity.forgotten).toBe(0)
    expect(report.earliest?.id).toBe(seededOne.ids[0])
    expect(report.earliest?.text).toBe('最早记下的一句')
    expect(report.ledger.ok).toBe(true)
    expect(report.ledgerLine).toContain('账本对得上')
    expect(report.pending).toBe(1)
    expect(report.queue).toBe('ok')
  })

  it('跑一遍一个文件都不写，三份文件的修改时间一模一样', () => {
    const seededOne = seeded()
    const before = [mtimeOf(seededOne.file), mtimeOf(seededOne.ledger), mtimeOf(seededOne.queue)]
    const listing = fs.readdirSync(path.dirname(seededOne.file)).sort()

    probe(seededOne.file)

    expect([mtimeOf(seededOne.file), mtimeOf(seededOne.ledger), mtimeOf(seededOne.queue)]).toEqual(before)
    expect(fs.readdirSync(path.dirname(seededOne.file)).sort()).toEqual(listing)
  })

  it('文件坏了只报告，内容一个字不改', () => {
    const file = tempFile()
    fs.writeFileSync(file, '这不是 JSON')

    const report = probe(file)

    expect(report.memory).toBe('broken')
    expect(report.total).toBe(0)
    expect(fs.readFileSync(file, 'utf8')).toBe('这不是 JSON')
  })

  it('账本读不出来时结论就说这一件事', () => {
    const file = tempFile()
    const { seam } = mount({ file })
    seam.remember('记下来的一句', 'group:1', { at: NOW })
    fs.writeFileSync(ledgerBeside(file), '{坏掉的账本')

    const report = probe(file)

    expect(report.ledger.read).toBe('broken')
    expect(report.ledger.ok).toBe(false)
    expect(report.ledgerLine).toContain('读不出来')
  })

  it('什么都没建过时三处都空着，不报错', () => {
    const file = tempFile()

    const report = probe(file)

    expect(report.memory).toBe('absent')
    expect(report.queue).toBe('absent')
    expect(report.ledger.read).toBe('absent')
    expect(report.total).toBe(0)
    expect(report.pending).toBe(0)
    expect(report.earliest).toBeUndefined()
  })

  it('换成另一套路径也能探', () => {
    const dir = tempDir()
    const file = path.join(dir, 'memory.json')
    const ledger = path.join(dir, 'other-ledger.json')
    const queue = path.join(dir, 'other-queue.json')
    fs.writeFileSync(file, JSON.stringify({ version: 1, lastMaintainedDay: '', items: [] }))
    fs.writeFileSync(queue, JSON.stringify({ version: 2, entries: [{ text: '压着的一条' }, { text: '压着的两条' }] }))

    const report = probe(file, { ledgerFile: ledger, queueFile: queue })

    expect(report.ledgerFile).toBe(ledger)
    expect(report.queue).toBe('ok')
    expect(report.pending).toBe(2)
    expect(report.ledger.read).toBe('absent')
  })

  it('报告写成话时六件事各占一行', () => {
    const seededOne = seeded()

    const text = describeProbe(probe(seededOne.file))

    expect(text.split('\n')).toHaveLength(6)
    expect(text).toContain('层分布：')
    expect(text).toContain('清晰度分布：')
    expect(text).toContain('账本结论：')
    expect(text).toContain('待写入：1 条')
  })
})
