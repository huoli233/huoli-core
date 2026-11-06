import { describe, expect, it } from 'vitest'
import { createOutboundCheck, OUTBOUND_DEFAULTS, type OutboundTuning } from '../src/outbound.ts'

// 本地凌晨三点，落在默认静默时段里
const NIGHT = new Date(2026, 2, 5, 3, 0, 0, 0).getTime()
const NOON = new Date(2026, 2, 5, 12, 0, 0, 0).getTime()

// 静默时段关掉，好让别的关卡单独被测到
const OPEN: OutboundTuning = { ...OUTBOUND_DEFAULTS, quietStart: '00:00', quietEnd: '00:00' }

interface Clocked {
  check: ReturnType<typeof createOutboundCheck>
  at: (ms: number) => void
}

function checker(now: number, patch: Partial<OutboundTuning> = {}): Clocked {
  let clock = now
  return {
    check: createOutboundCheck({ ...OPEN, ...patch }, () => clock),
    at: (ms) => {
      clock = ms
    },
  }
}

describe('群与人的名单', () => {
  it('名单里的群能发', () => {
    const { check } = checker(NOON, { allowGroups: ['123'] })

    expect(check.check({ chatKey: 'group:123', text: '在的' }).ok).toBe(true)
  })

  it('不在名单的群被拒，理由与下次时间都有', () => {
    const { check } = checker(NOON, { allowGroups: ['123'] })

    const verdict = check.check({ chatKey: 'group:999', text: '在的' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.not_allowed')
    expect(verdict.reason).toBeTruthy()
    expect(verdict.retryAt).toBeGreaterThan(NOON)
  })

  it('不在名单的人被拒，理由与下次时间都有', () => {
    const { check } = checker(NOON, { allowPeople: ['555'] })

    const verdict = check.check({ chatKey: 'private:666', text: '在的' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.not_allowed')
    expect(verdict.reason).toBeTruthy()
    expect(verdict.retryAt).toBeGreaterThan(NOON)
  })

  it('名单空着就不限制', () => {
    const { check } = checker(NOON)

    expect(check.check({ chatKey: 'group:1', text: '在的' }).ok).toBe(true)
    expect(check.check({ chatKey: 'private:2', text: '在的' }).ok).toBe(true)
  })

  it('会话键认不出来就拒', () => {
    const { check } = checker(NOON)

    const verdict = check.check({ chatKey: '随便写的', text: '在的' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.bad_chat')
    expect(verdict.retryAt).toBeGreaterThan(NOON)
  })
})

describe('静默时段', () => {
  it('落在默认静默时段里就拒，下次时间是静默结束', () => {
    const check = createOutboundCheck(OUTBOUND_DEFAULTS, () => NIGHT)
    const expected = new Date(2026, 2, 5, 7, 30, 0, 0).getTime()

    const verdict = check.check({ chatKey: 'group:1', text: '在的' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.quiet')
    expect(verdict.retryAt).toBe(expected)
  })

  it('静默时段之外放行', () => {
    const check = createOutboundCheck(OUTBOUND_DEFAULTS, () => NOON)

    expect(check.check({ chatKey: 'group:1', text: '在的' }).ok).toBe(true)
  })
})

describe('长度上限', () => {
  it('刚好等于上限能发', () => {
    const { check } = checker(NOON, { maxChars: 5 })

    expect(check.check({ chatKey: 'group:1', text: '一二三四五' }).ok).toBe(true)
  })

  it('超过上限就拒，理由里有上限这个数', () => {
    const { check } = checker(NOON, { maxChars: 5 })

    const verdict = check.check({ chatKey: 'group:1', text: '一二三四五六' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.too_long')
    expect(verdict.reason).toContain('5')
    expect(verdict.retryAt).toBeGreaterThan(NOON)
  })
})

describe('敏感词', () => {
  it('命中就拒，理由与下次时间都有', () => {
    const { check } = checker(NOON, { banned: ['加群'] })

    const verdict = check.check({ chatKey: 'group:1', text: '你也来加群吧' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.banned')
    expect(verdict.reason).toBeTruthy()
    expect(verdict.retryAt).toBeGreaterThan(NOON)
  })

  it('没命中就放行', () => {
    const { check } = checker(NOON, { banned: ['加群'] })

    expect(check.check({ chatKey: 'group:1', text: '今天吃什么' }).ok).toBe(true)
  })

  it('空词不算敏感词', () => {
    const { check } = checker(NOON, { banned: [''] })

    expect(check.check({ chatKey: 'group:1', text: '今天吃什么' }).ok).toBe(true)
  })
})

describe('每分钟条数', () => {
  it('发满了就拒，下次时间是窗口尾部', () => {
    const { check } = checker(NOON, { perMinute: 2 })
    check.record(NOON)
    check.record(NOON + 1000)

    const verdict = check.check({ chatKey: 'group:1', text: '再来一句' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.rate')
    expect(verdict.retryAt).toBe(NOON + OUTBOUND_DEFAULTS.windowMs)
  })

  it('过了窗口又能发', () => {
    const { check, at } = checker(NOON, { perMinute: 1 })
    check.record(NOON)
    expect(check.check({ chatKey: 'group:1', text: '再来一句' }).ok).toBe(false)

    at(NOON + OUTBOUND_DEFAULTS.windowMs + 1)

    expect(check.check({ chatKey: 'group:1', text: '再来一句' }).ok).toBe(true)
  })
})

describe('两条之间留一点空', () => {
  it('没配间隔时不拦', () => {
    const { check } = checker(NOON)
    check.record(NOON)

    expect(check.check({ chatKey: 'group:1', text: '再来一句' }).ok).toBe(true)
  })

  it('配了间隔时上一条刚发就拒，下次时间是上一条加间隔', () => {
    const { check } = checker(NOON, { sendGapMs: 4_000 })
    check.record(NOON)

    const verdict = check.check({ chatKey: 'group:1', text: '再来一句' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.too_soon')
    expect(verdict.retryAt).toBe(NOON + 4_000)
  })

  it('隔够了就放行', () => {
    const { check, at } = checker(NOON, { sendGapMs: 4_000 })
    check.record(NOON)
    at(NOON + 4_000)

    expect(check.check({ chatKey: 'group:1', text: '再来一句' }).ok).toBe(true)
  })
})
