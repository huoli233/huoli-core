import { describe, expect, it } from 'vitest'
import { curiousLineOf, privateLineOf } from '../src/body-tools.ts'

const NOW = new Date(2026, 10, 6, 12, 0, 0).getTime()

// 造一个只有 store.all() 的记忆面，回想起那条给空
function memoryOf(items: readonly { secret?: boolean; state: string; at: number }[]) {
  return {
    store: { all: () => items },
    recollect: () => ({ hits: [] }),
  }
}

describe('刚做过不想让人知道的事', () => {
  it('刚做过、还在紧绷那段时间里，群里要给那几句', () => {
    const line = privateLineOf(memoryOf([{ secret: true, state: 'active', at: NOW - 60_000 }]), 'group:1', NOW)

    expect(line).toContain('不想让人知道')
    expect(line).toContain('反问')
  })

  it('过了那段时间就不再紧绷', () => {
    const line = privateLineOf(memoryOf([{ secret: true, state: 'active', at: NOW - 2 * 3_600_000 }]), 'group:1', NOW)

    expect(line).toBe('')
  })

  it('私密空间里不用藏', () => {
    const line = privateLineOf(memoryOf([{ secret: true, state: 'active', at: NOW - 60_000 }]), 'private:1', NOW)

    expect(line).toBe('')
  })

  it('没有这样的事就什么都不给', () => {
    expect(privateLineOf(memoryOf([]), 'group:1', NOW)).toBe('')
    expect(privateLineOf(undefined, 'group:1', NOW)).toBe('')
  })
})

describe('好奇过线', () => {
  it('过线才提一句，且说清记下来不等于去做', () => {
    const line = curiousLineOf(0.9)

    expect(line).toContain('好奇')
    expect(line).toContain('不等于真的去做')
  })

  it('没到线就不提', () => {
    expect(curiousLineOf(0.4)).toBe('')
    expect(curiousLineOf(undefined)).toBe('')
  })
})
