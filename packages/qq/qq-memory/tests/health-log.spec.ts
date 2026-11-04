import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultHealthLogFile } from '../src/health.ts'
import { cleanupTempDirs, mount, tempDir, tempFile } from './harness.ts'

const DAY = 86_400_000
// 第一天早上九点起算，跨天沿用它推
const FIRST_DAY = new Date(2026, 10, 4, 9, 0).getTime()
const NEXT_DAY = FIRST_DAY + DAY

// 日志里现有的每一行，文件还没建过就是空的
function linesOf(file: string): string[] {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').trimEnd().split('\n')
}

afterEach(cleanupTempDirs)

describe('健康日志', () => {
  it('连续两天各追加一行，先写的在前', () => {
    const file = tempFile()
    const log = path.join(path.dirname(file), 'health.log')
    const { seam } = mount({ file, healthLogFile: log, tuning: { decayBase: 100 } })
    seam.remember('会掉分的一句', 'group:1', { importance: 45, at: FIRST_DAY })

    const first = seam.maintain(FIRST_DAY)
    const second = seam.maintain(NEXT_DAY)
    const lines = linesOf(log)

    expect(lines).toHaveLength(2)
    expect(first.line).toContain('2026-11-04')
    expect(second.line).toContain('2026-11-05')
    expect(lines[0]).toBe(first.line)
    expect(lines[1]).toBe(second.line)
  })

  it('同一天再调只有一行', () => {
    const file = tempFile()
    const log = path.join(path.dirname(file), 'health.log')
    const { seam } = mount({ file, healthLogFile: log, tuning: { decayBase: 100 } })
    seam.remember('记下的一句', 'group:1', { importance: 45, at: FIRST_DAY })

    seam.maintain(FIRST_DAY)
    const again = seam.maintain(FIRST_DAY + 60_000)

    expect(again.didWork).toBe(false)
    expect(again.line).toBe('')
    expect(linesOf(log)).toHaveLength(1)
  })

  it('关掉开关就一行都不写', () => {
    const file = tempFile()
    const log = path.join(path.dirname(file), 'health.log')
    const { seam } = mount({ file, healthLogFile: log, tuning: { healthLog: false } })
    seam.remember('记下的一句', 'group:1', { importance: 45, at: FIRST_DAY })

    const kept = seam.maintain(FIRST_DAY)

    expect(kept.didWork).toBe(true)
    expect(kept.line).toContain('[memory]')
    expect(fs.existsSync(log)).toBe(false)
  })

  it('日志路径跟着配置走，不填就落在主目录的 data 下', () => {
    const home = tempDir()
    const file = tempFile()
    const log = path.join(tempDir(), 'logs', 'health.log')
    const { seam } = mount({ file, healthLogFile: log })
    seam.remember('记下的一句', 'group:1', { importance: 45, at: FIRST_DAY })

    seam.maintain(FIRST_DAY)

    expect(defaultHealthLogFile(home)).toBe(path.join(home, 'data', 'qq-memory-health.log'))
    expect(linesOf(log)).toHaveLength(1)
  })

  it('一天的进程重启接着写，前面的行还在', () => {
    const file = tempFile()
    const log = path.join(path.dirname(file), 'health.log')
    const first = mount({ file, healthLogFile: log, tuning: { decayBase: 100 } })
    first.seam.remember('记下的一句', 'group:1', { importance: 45, at: FIRST_DAY })
    first.seam.maintain(FIRST_DAY)

    const next = mount({ file, healthLogFile: log, tuning: { decayBase: 100 } }).seam.maintain(NEXT_DAY)

    expect(next.didWork).toBe(true)
    expect(linesOf(log)).toHaveLength(2)
    expect(linesOf(log)[1]).toBe(next.line)
  })
})
