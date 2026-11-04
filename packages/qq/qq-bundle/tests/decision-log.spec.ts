import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDecisionLog, type DecisionRecord } from '../src/decisions.ts'

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-decision-log-'))
  tempDirs.push(dir)
  return path.join(dir, 'qq-decisions.jsonl')
}

function recordOf(at: number, patch: Partial<DecisionRecord> = {}): DecisionRecord {
  return { at, chatKey: 'group:1', awake: true, reason: 'incoming', attempted: false, sent: 0, blocked: null, ...patch }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('轮次记录文件', () => {
  it('还没写过就是空的', () => {
    expect(createDecisionLog({ file: tempFile() }).read(0, 10)).toEqual([])
  })

  it('写一条读得到，字段原样', () => {
    const log = createDecisionLog({ file: tempFile() })
    log.append(recordOf(1000, { blocked: { code: 'outbound.banned', retryAt: 2000 } }))

    expect(log.read(0, 10)).toEqual([{ at: 1000, chatKey: 'group:1', awake: true, reason: 'incoming', attempted: false, sent: 0, blocked: { code: 'outbound.banned', retryAt: 2000 } }])
  })

  it('只给某一时刻之后的', () => {
    const log = createDecisionLog({ file: tempFile() })
    log.append(recordOf(1000))
    log.append(recordOf(2000))

    expect(log.read(1500, 10).map(record => record.at)).toEqual([2000])
  })

  it('按条数只留最后几条', () => {
    const log = createDecisionLog({ file: tempFile() })
    log.append(recordOf(1000))
    log.append(recordOf(2000))
    log.append(recordOf(3000))

    expect(log.read(0, 2).map(record => record.at)).toEqual([2000, 3000])
    expect(log.read(0, 0)).toEqual([])
  })

  it('坏行整行丢掉，好行照样读', () => {
    const file = tempFile()
    const log = createDecisionLog({ file })
    log.append(recordOf(1000))
    fs.appendFileSync(file, '这行不是记录\n')
    log.append(recordOf(2000))

    expect(log.read(0, 10).map(record => record.at)).toEqual([1000, 2000])
  })

  it('一行一条，结尾有换行', () => {
    const file = tempFile()
    const log = createDecisionLog({ file })
    log.append(recordOf(1000))
    log.append(recordOf(2000))

    const text = fs.readFileSync(file, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.trim().split('\n')).toHaveLength(2)
  })
})
