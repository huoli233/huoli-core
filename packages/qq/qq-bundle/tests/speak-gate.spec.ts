import { describe, expect, it } from 'vitest'
import { budgetOf, stopNowOf } from '../src/speak-gate.ts'
import type { QqVitalsSeam } from '@huoli/huoli-qq-vitals'

describe('这一轮说到第几条收口', () => {
  it('睡着时仍允许少量短气泡，不再硬压成一条', () => {
    const seam = { read: () => ({ sleep_state: 'sleeping' }) } as unknown as QqVitalsSeam

    expect(budgetOf(seam)).toBe(3)
    expect(budgetOf(seam, 2)).toBe(2)
    expect(budgetOf(undefined)).toBe(8)
  })

  it('精力低时缩短气泡数，仍保留直接回复', () => {
    const tired = { read: () => ({ sleep_state: 'awake', energy: 0.3, adenosine: 0.2 }) } as unknown as QqVitalsSeam
    const exhausted = { read: () => ({ sleep_state: 'awake', energy: 0.1, adenosine: 0.2 }) } as unknown as QqVitalsSeam

    expect(budgetOf(tired, 3, 2)).toBe(2)
    expect(budgetOf(exhausted, 3, 2)).toBe(1)
  })

  it('说满配置的额度就停', () => {
    const stop = stopNowOf(2)

    expect(stop(1)).toBe(false)
    expect(stop(2)).toBe(true)
  })

  it('额度至少留一条，不给零也不给负数', () => {
    expect(stopNowOf(0)(0)).toBe(false)
    expect(stopNowOf(0)(1)).toBe(true)
  })

  it('每说一条都按同一个上限判，同样输入得到同样结果', () => {
    const stop = stopNowOf(3)

    expect([0, 1, 2, 3, 4].map(stop)).toEqual([false, false, false, true, true])
  })
})
