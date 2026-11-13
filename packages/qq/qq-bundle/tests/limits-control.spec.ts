import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLimitsControl, LIMITS_DEFAULTS } from '../src/limits-control.ts'
import { createSelfQuiet } from '../src/self-quiet.ts'

const roots: string[] = []
const HOUR = 60 * 60_000

function tempControl(maxProactivePerHour = 30) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-limits-'))
  roots.push(dir)
  const file = path.join(dir, 'limits.json')
  const quiet = createSelfQuiet({
    file: path.join(dir, 'quiet.json'),
    minMinutes: 1,
    maxMinutes: 60,
  })
  const control = createLimitsControl({
    file,
    quiet,
    defaults: { ...LIMITS_DEFAULTS, proactivePerHour: 2 },
    maxProactivePerHour,
    warn: () => {},
  })
  return { control, file, quiet }
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('每小时主动发送额度', () => {
  it('预留和成功提交一起计入，失败会释放', () => {
    const { control } = tempControl()
    const first = control.reserveProactiveSend('group:1', 1_000)
    const second = control.reserveProactiveSend('group:1', 1_000)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(control.reserveProactiveSend('group:1', 1_000)).toMatchObject({
      ok: false,
      code: 'bundle.proactive_hour_limit',
    })

    if (first.ok) first.settle(false, 1_000)
    expect(control.reserveProactiveSend('group:1', 1_001).ok).toBe(true)
  })

  it('成功后落盘，重开仍保留最近一小时', () => {
    const { control, file, quiet } = tempControl()
    const at = Date.now()
    const reserved = control.reserveProactiveSend('group:1', at)
    expect(reserved.ok).toBe(true)
    if (reserved.ok) reserved.settle(true, at)

    const reopened = createLimitsControl({
      file,
      quiet,
      defaults: { ...LIMITS_DEFAULTS, proactivePerHour: 2 },
      warn: () => {},
    })
    expect(reopened.proactiveSentThisHour('group:1', at + HOUR - 1)).toBe(1)
    expect(reopened.proactiveSentThisHour('group:1', at + HOUR)).toBe(0)
  })

  it('读取时丢掉未来时刻，并按时间排序', () => {
    const { file, quiet } = tempControl()
    const now = Date.now()
    fs.writeFileSync(file, JSON.stringify({
      version: 2,
      proactiveAllowed: true,
      proactivePerHour: 3,
      sleepFrom: 23,
      sleepUntil: 7,
      proactiveSentAt: { 'group:1': [now - 1_000, now + HOUR, now - 2_000] },
    }))

    const control = createLimitsControl({
      file,
      quiet,
      defaults: { ...LIMITS_DEFAULTS, proactivePerHour: 3 },
      warn: () => {},
    })
    const reserved = control.reserveProactiveSend('group:1', now)
    expect(reserved.ok).toBe(true)
    if (reserved.ok) reserved.settle(true, now)
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { proactiveSentAt: Record<string, number[]> }
    expect(stored.proactiveSentAt['group:1']).toEqual([now - 2_000, now - 1_000, now])
  })

  it('面板可以把上限改成零', () => {
    const { control } = tempControl()
    expect(control.set({ proactivePerHour: 0 }).proactivePerHour).toBe(0)
    expect(control.reserveProactiveSend('group:1', 1_000).ok).toBe(false)
  })

  it('面板可设置的最大值来自配置', () => {
    const { control } = tempControl(5)
    expect(control.set({ proactivePerHour: 99 }).proactivePerHour).toBe(5)
  })
})
