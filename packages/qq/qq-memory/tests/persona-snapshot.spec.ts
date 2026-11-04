import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { personaSnapshot } from '../scripts/snapshot.ts'
import { DEFAULTS } from '../src/defaults.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 4, 9, 30).getTime()

// 一份记得住事、能给注入挑出条目的记忆
function seeded(text = '上次一起爬山的那天很热'): string {
  const file = tempFile()
  const { seam } = mount({ file })
  seam.remember(text, 'group:1', { at: NOW, importance: 80 })
  return file
}

// 照着文件内容重算一遍哈希，用来证明快照可复算
function hashOf(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file, 'utf8'), 'utf8').digest('hex')
}

afterEach(cleanupTempDirs)

describe('性格不变快照', () => {
  it('开关两份落到 snapshots 下，哈希不一样且都能照着文件重算', () => {
    const file = seeded()

    const result = personaSnapshot({ file, now: NOW })

    const dir = path.join(path.dirname(file), 'snapshots')
    expect(result.on.file).toBe(path.join(dir, 'inject-on.txt'))
    expect(result.off.file).toBe(path.join(dir, 'inject-off.txt'))
    expect(result.hits).toBe(1)
    expect(result.on.sha256).not.toBe(result.off.sha256)
    expect(result.changed).toBe(true)
    expect(hashOf(result.on.file)).toBe(result.on.sha256)
    expect(hashOf(result.off.file)).toBe(result.off.sha256)
    const on = fs.readFileSync(result.on.file, 'utf8')
    expect(on.startsWith(DEFAULTS.snapshotSample)).toBe(true)
    expect(on).toContain('【你记得的一些事，只作参考】')
    expect(on).toContain('上次一起爬山的那天很热')
    expect(fs.readFileSync(result.off.file, 'utf8')).toBe(DEFAULTS.snapshotSample)
  })

  it('同样的输入再算一遍，两份哈希一个都不变', () => {
    const file = seeded()

    const first = personaSnapshot({ file, now: NOW })
    const second = personaSnapshot({ file, now: NOW })

    expect(second.on.sha256).toBe(first.on.sha256)
    expect(second.off.sha256).toBe(first.off.sha256)
  })

  it('记忆是空的时候两份一样，报告里说没变', () => {
    const file = tempFile()
    mount({ file })

    const result = personaSnapshot({ file, now: NOW })

    expect(result.hits).toBe(0)
    expect(result.changed).toBe(false)
    expect(result.on.sha256).toBe(result.off.sha256)
  })

  it('写快照不碰记忆库，记忆文件的修改时间与内容都不变', () => {
    const file = seeded()
    const before = fs.statSync(file).mtimeMs
    const body = fs.readFileSync(file, 'utf8')

    personaSnapshot({ file, now: NOW })

    expect(fs.statSync(file).mtimeMs).toBe(before)
    expect(fs.readFileSync(file, 'utf8')).toBe(body)
  })

  it('调用方给的一句盖过默认取样句', () => {
    const file = seeded()

    const result = personaSnapshot({ file, now: NOW, sample: '换一句自己想的' })

    expect(fs.readFileSync(result.off.file, 'utf8')).toBe('换一句自己想的')
    expect(result.on.sha256).not.toBe(result.off.sha256)
  })
})
