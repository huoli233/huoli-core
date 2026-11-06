import { describe, expect, it } from 'vitest'
import { stopNowOf } from '../src/speak-gate.ts'

describe('这一轮说到第几条收口', () => {
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
