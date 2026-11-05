import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLiveness } from '../src/liveness.ts'

const roots: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-liveness-'))
  roots.push(dir)
  return path.join(dir, 'liveness.json')
}

const AT = new Date(2026, 10, 4, 10, 0).getTime()
const NEXT_DAY = new Date(2026, 10, 5, 10, 0).getTime()

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('今天重启过几次', () => {
  it('第一次启动不算重启', () => {
    const file = tempFile()
    const liveness = createLiveness({ file, now: () => AT, uptime: () => 5000 })

    expect(liveness.facts(AT).restartsToday).toBe(0)
  })

  it('同一天再开一次算一次重启', () => {
    const file = tempFile()
    createLiveness({ file, now: () => AT, uptime: () => 5000 })
    createLiveness({ file, now: () => AT, uptime: () => 5000 })
    const third = createLiveness({ file, now: () => AT, uptime: () => 5000 })

    expect(third.facts(AT).restartsToday).toBe(2)
  })

  it('跨一天重新从零算', () => {
    const file = tempFile()
    createLiveness({ file, now: () => AT, uptime: () => 5000 })
    createLiveness({ file, now: () => AT, uptime: () => 5000 })
    const tomorrow = createLiveness({ file, now: () => NEXT_DAY, uptime: () => 5000 })

    expect(tomorrow.facts(NEXT_DAY).restartsToday).toBe(0)
  })

  it('活多久问运行时，负数按零算', () => {
    const file = tempFile()
    const liveness = createLiveness({ file, now: () => AT, uptime: () => -20 })

    expect(liveness.facts(AT).uptimeMs).toBe(0)
  })

  it('记录表读不出来就按今天第一次启动算，整条装配不塌', () => {
    const file = tempFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '这不是 JSON')

    const liveness = createLiveness({ file, now: () => AT, uptime: () => 1000 })

    expect(liveness.facts(AT).restartsToday).toBe(0)
  })

  it('关停提示这一版没有来源，一律按没有算', () => {
    const file = tempFile()
    const liveness = createLiveness({ file, now: () => AT, uptime: () => 1000 })

    expect(liveness.facts(AT).shutdownNotice).toBe(false)
  })
})
