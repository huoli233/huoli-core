import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { parseArgs, reportLines, runCli, type CliIo } from '../scripts/ledger.ts'
import { verifyBook } from '../src/ledger.ts'
import { cleanupTempDirs, ledgerBeside, mount, tempDir, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 4, 9, 30).getTime()

interface Collected {
  io: CliIo
  out: string[]
  err: string[]
}

// 收下命令行两条出口的话，退出码直接看返回值
function collecting(): Collected {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (text) => { out.push(text) }, err: (text) => { err.push(text) } }, out, err }
}

function cli(argv: readonly string[]): { code: number; out: string; err: string } {
  const collected = collecting()
  const code = runCli(argv, collected.io)
  return { code, out: collected.out.join('\n'), err: collected.err.join('\n') }
}

// 一份装了点东西的记忆文件与它旁边的账本
function seeded(): { file: string; ledger: string } {
  const file = tempFile()
  const { seam } = mount({ file })
  seam.remember('先记下的一句', 'group:1', { at: NOW })
  seam.remember('后来记下的一句', 'group:1', { at: NOW })
  return { file, ledger: ledgerBeside(file) }
}

afterEach(cleanupTempDirs)

describe('账本命令行的三种操作', () => {
  it('建账退出 0，账本写出来带版本戳', () => {
    const { file, ledger } = seeded()

    const built = cli(['--init', '--memory', file, '--file', ledger])
    const checked = cli(['--verify', '--memory', file, '--file', ledger])

    expect(built.code).toBe(0)
    expect(built.out).toContain('init 完成：新记 2 条，账本共 2 条')
    expect(checked.code).toBe(0)
    expect(checked.out).toContain('账本对得上，2 条')
    const parsed = JSON.parse(fs.readFileSync(ledger, 'utf8')) as { schemaVersion: number }
    expect(parsed.schemaVersion).toBe(1)
  })

  it('补账只补新的那条，补完再对账退出 0', () => {
    const { file, ledger } = seeded()
    cli(['--init', '--memory', file, '--file', ledger])
    const { seam } = mount({ file })
    const fresh = seam.remember('后补上的一条', 'group:1', { at: NOW })

    const early = cli(['--verify', '--memory', file, '--file', ledger])
    const synced = cli(['--sync', '--memory', file, '--file', ledger])
    const late = cli(['--verify', '--memory', file, '--file', ledger])

    expect(early.code).toBe(1)
    expect(early.err).toContain(`还没入账 1 条：${fresh.id}`)
    expect(synced.code).toBe(0)
    expect(synced.out).toContain('新记 1 条')
    expect(late.code).toBe(0)
  })

  it('正文被改就退出 1，并列出是哪一条', () => {
    const { file, ledger } = seeded()
    cli(['--init', '--memory', file, '--file', ledger])
    const { seam } = mount({ file })
    const target = seam.store.all()[0]
    if (target === undefined) throw new Error('没读到记忆')
    seam.store.update(target.id, { text: '换了个说法的一句' })

    const checked = cli(['--verify', '--memory', file, '--file', ledger])

    expect(checked.code).toBe(1)
    expect(checked.err).toContain('正文被改 1 条')
    expect(checked.err).toContain(target.id)
  })

  it('少了一条就退出 1，并说清丢了哪一条', () => {
    const { file, ledger } = seeded()
    cli(['--init', '--memory', file, '--file', ledger])
    const { seam } = mount({ file })
    const gone = seam.store.all()[1]
    if (gone === undefined) throw new Error('没读到记忆')
    seam.store.remove(gone.id)

    const checked = cli(['--verify', '--memory', file, '--file', ledger])

    expect(checked.code).toBe(1)
    expect(checked.err).toContain('丢了 1 条')
    expect(checked.err).toContain(gone.id)
  })

  it('退役的那条照样对得上，条数里点得出来', () => {
    const file = tempFile()
    const ledger = ledgerBeside(file)
    const { seam } = mount({ file })
    const gone = seam.remember('会淡到没的一句', 'group:1', { at: NOW })
    seam.store.update(gone.id, { text: '', state: 'forgotten', clarity: 'forgotten', retiredAt: NOW, at: NOW })
    seam.ledger('init')

    const checked = cli(['--verify', '--memory', file, '--file', ledger])

    expect(checked.code).toBe(0)
    expect(checked.out).toContain('已退役 1 条')
  })

  it('参数不对就退出 1，并打出用法', () => {
    const missing = cli([])
    const wrong = cli(['--bogus'])
    const twice = cli(['--init', '--sync'])
    const noValue = cli(['--init', '--file'])

    expect(missing.code).toBe(1)
    expect(missing.err).toContain('缺一件要做的事')
    expect(wrong.code).toBe(1)
    expect(wrong.err).toContain('不认识的参数 --bogus')
    expect(twice.code).toBe(1)
    expect(twice.err).toContain('一次只做一件')
    expect(noValue.code).toBe(1)
    expect(noValue.err).toContain('--file 后面要跟一个路径')
    expect(wrong.out).toContain('用法:')
  })

  it('--help 只打用法，退出 0', () => {
    const asked = cli(['--help'])

    expect(asked.code).toBe(0)
    expect(asked.out).toContain('--verify')
  })

  it('两条路径的默认值落在主目录的 data 下', () => {
    const home = tempDir()

    const parsed = parseArgs(['--init', '--home', home])

    expect(parsed.kind).toBe('run')
    if (parsed.kind !== 'run') return
    expect(parsed.args.file).toBe(path.join(home, 'data', 'qq-memory-ledger.json'))
    expect(parsed.args.memoryFile).toBe(path.join(home, 'data', 'qq-memory.json'))
  })

  it('差异行四种都点得出来', () => {
    const report = verifyBook(
      { schemaVersion: 1, entries: { gone: { sha256: 'x', len: 1, state: 'held' } } },
      [],
    )

    const lines = reportLines(report)

    expect(lines[0]).toContain('丢了 1 条：gone')
    expect(lines.at(-1)).toBe('已退役 0 条')
  })
})

describe('账本命令行遇到更新的版本', () => {
  it('账本版本比本包新就拒绝写，文件一个字不动', () => {
    const { file, ledger } = seeded()
    const newer = { schemaVersion: 9, entries: {} }
    fs.writeFileSync(ledger, JSON.stringify(newer))
    const before = fs.statSync(ledger).mtimeMs

    const refused = cli(['--sync', '--memory', file, '--file', ledger])

    expect(refused.code).toBe(1)
    expect(refused.err).toContain('memory.version_ahead')
    expect(refused.err).toContain('9')
    expect(fs.readFileSync(ledger, 'utf8')).toBe(JSON.stringify(newer))
    expect(fs.statSync(ledger).mtimeMs).toBe(before)
  })

  it('记忆文件版本比本包新就拒绝建账，账本都不建', () => {
    const dir = tempDir()
    const file = path.join(dir, 'memory.json')
    const ledger = path.join(dir, 'ledger.json')
    fs.writeFileSync(file, JSON.stringify({ version: 2, lastMaintainedDay: '', items: [] }))

    const refused = cli(['--init', '--memory', file, '--file', ledger])

    expect(refused.code).toBe(1)
    expect(refused.err).toContain('memory.version_ahead')
    expect(fs.existsSync(ledger)).toBe(false)
  })

  it('记忆文件读不出来就拒绝对账，不去猜', () => {
    const dir = tempDir()
    const file = path.join(dir, 'memory.json')
    fs.writeFileSync(file, '这不是 JSON')

    const refused = cli(['--verify', '--memory', file, '--file', path.join(dir, 'ledger.json')])

    expect(refused.code).toBe(1)
    expect(refused.err).toContain('记忆文件读不出来')
  })
})

describe('账本命令行作为进程跑', () => {
  const repo = path.resolve(import.meta.dirname, '../../../..')
  const script = path.resolve(import.meta.dirname, '../scripts/ledger.ts')

  it('对得上就以 0 退出，对不上就以 1 退出', () => {
    const { file, ledger } = seeded()
    cli(['--init', '--memory', file, '--file', ledger])

    const good = spawnSync(process.execPath, ['--import', 'tsx', script, '--verify', '--memory', file, '--file', ledger], { cwd: repo, encoding: 'utf8' })
    const { seam } = mount({ file })
    const target = seam.store.all()[0]
    if (target === undefined) throw new Error('没读到记忆')
    seam.store.update(target.id, { text: '进程跑之前改过的一句' })
    const bad = spawnSync(process.execPath, ['--import', 'tsx', script, '--verify', '--memory', file, '--file', ledger], { cwd: repo, encoding: 'utf8' })

    expect(good.status).toBe(0)
    expect(good.stdout).toContain('账本对得上')
    expect(bad.status).toBe(1)
    expect(bad.stderr).toContain('正文被改 1 条')
  })
})
