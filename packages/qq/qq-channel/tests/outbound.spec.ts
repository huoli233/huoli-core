import { describe, expect, it } from 'vitest'
import { CONTENT_GUARD_DEFAULTS, type ContentGuardTuning } from '../src/content-guard.ts'
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

function checker(now: number, patch: Partial<OutboundTuning> = {}, guard?: Partial<ContentGuardTuning>): Clocked {
  let clock = now
  const guardTuning = { ...CONTENT_GUARD_DEFAULTS, ...guard }
  return {
    check: createOutboundCheck({ ...OPEN, ...patch }, () => clock, guardTuning),
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

  it('静默时段仍允许对话回复，但普通出站仍被拦', () => {
    const check = createOutboundCheck(OUTBOUND_DEFAULTS, () => NIGHT)

    expect(check.check({ chatKey: 'group:1', text: '在的' }).code).toBe('outbound.quiet')
    expect(check.checkReply({ chatKey: 'group:1', text: '在的' }).ok).toBe(true)
  })

  it('对话回复跳过静默时段但仍受名单限制', () => {
    const check = createOutboundCheck({ ...OUTBOUND_DEFAULTS, allowGroups: ['123'] }, () => NIGHT)

    expect(check.checkReply({ chatKey: 'group:999', text: '在的' }).code).toBe('outbound.not_allowed')
  })
})

describe('内容里的路径与凭据', () => {
  it('本机路径整条拦下，理由说是哪一类，提示换个说法', () => {
    const { check } = checker(NOON)

    const verdict = check.check({ chatKey: 'group:1', text: '报错在 C:\\Users\\mcpex\\a.txt' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.secret')
    expect(verdict.reason).toContain('路径')
    expect(verdict.hint).toBe('换个说法，别把路径或凭据带出来')
    expect(verdict.retryAt).toBe(NOON + OUTBOUND_DEFAULTS.retryMs)
  })

  it('Bearer 那一串被拦', () => {
    const { check } = checker(NOON)

    const verdict = check.check({ chatKey: 'group:1', text: '带着 Bearer eyJhbGciOiJIUzI1NiJ9.abc 就通了' })

    expect(verdict.code).toBe('outbound.secret')
    expect(verdict.reason).toContain('凭据')
  })

  it('token 后面跟值被拦', () => {
    const { check } = checker(NOON)

    const verdict = check.check({ chatKey: 'group:1', text: '他说 token=abc123def456 就能用' })

    expect(verdict.code).toBe('outbound.secret')
    expect(verdict.hint).toBeTruthy()
  })

  it('对话回复也拦', () => {
    const check = createOutboundCheck({ ...OUTBOUND_DEFAULTS, quietStart: '00:00', quietEnd: '00:00' }, () => NIGHT)

    expect(check.checkReply({ chatKey: 'group:1', text: '看 /home/ubuntu/x.sh 这个' }).code).toBe('outbound.secret')
  })

  it('正常聊天不误伤：表情、普通英文词与不带值的 token', () => {
    const { check } = checker(NOON)
    // 表情用码位写，源码里不放表情符号
    const withEmoji = '今天真开心\u{1F600}\u{1F44D}'

    expect(check.check({ chatKey: 'group:1', text: withEmoji }).ok).toBe(true)
    expect(check.check({ chatKey: 'group:1', text: 'this is a secret garden' }).ok).toBe(true)
    expect(check.check({ chatKey: 'group:1', text: '这个 token 好像过期了' }).ok).toBe(true)
    expect(check.check({ chatKey: 'group:1', text: '概率 1/2 吧' }).ok).toBe(true)
  })

  it('关掉内容闸就只管别的关卡', () => {
    const { check } = checker(NOON, {}, { enabled: false })

    expect(check.check({ chatKey: 'group:1', text: 'C:\\Users\\mcpex\\a.txt' }).ok).toBe(true)
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
    check.record('group:1', NOON)
    check.record('group:1', NOON + 1000)

    const verdict = check.check({ chatKey: 'group:1', text: '再来一句' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.rate')
    expect(verdict.retryAt).toBe(NOON + OUTBOUND_DEFAULTS.windowMs)
  })

  it('过了窗口又能发', () => {
    const { check, at } = checker(NOON, { perMinute: 1 })
    check.record('group:1', NOON)
    expect(check.check({ chatKey: 'group:1', text: '再来一句' }).ok).toBe(false)

    at(NOON + OUTBOUND_DEFAULTS.windowMs + 1)

    expect(check.check({ chatKey: 'group:1', text: '再来一句' }).ok).toBe(true)
  })

  it('一个群发满上限不会拦住私聊', () => {
    const { check } = checker(NOON, { perMinute: 1 })
    check.record('group:1', NOON)

    expect(check.check({ chatKey: 'group:1', text: '群里再来一句' }).code).toBe('outbound.rate')
    expect(check.check({ chatKey: 'private:2', text: '私聊回复' }).ok).toBe(true)
  })

  it('同一聊天发满上限后仍会被拦', () => {
    const { check } = checker(NOON, { perMinute: 2 })
    check.record('private:2', NOON)
    check.record('private:2', NOON + 1000)

    expect(check.check({ chatKey: 'private:2', text: '再来一句' }).code).toBe('outbound.rate')
  })

  it('好友私聊的入站回复不占公共每分钟额度', () => {
    const { check } = checker(NOON, { perMinute: 2 })
    check.record('private:2', NOON)
    check.record('private:2', NOON + 1000)
    check.record('group:3', NOON)
    check.record('group:3', NOON + 1000)

    expect(check.checkReply({ chatKey: 'private:2', text: '在听你说' }).ok).toBe(true)
    expect(check.check({ chatKey: 'private:2', text: '主动补一句' }).code).toBe('outbound.rate')
    expect(check.checkReply({ chatKey: 'group:3', text: '群里接一句' }).ok).toBe(true)
  })

  it('好友私聊回复仍检查名单、长度和敏感词', () => {
    const denied = checker(NOON, { allowPeople: ['3'] })
    const long = checker(NOON, { maxChars: 2 })
    const banned = checker(NOON, { banned: ['加群'] })

    expect(denied.check.checkReply({ chatKey: 'private:2', text: '在的' }).code).toBe('outbound.not_allowed')
    expect(long.check.checkReply({ chatKey: 'private:2', text: '一二三' }).code).toBe('outbound.too_long')
    expect(banned.check.checkReply({ chatKey: 'private:2', text: '来加群' }).code).toBe('outbound.banned')
  })

  it('过期记录清掉后不再占用新聊天的上限', () => {
    const { check, at } = checker(NOON, { perMinute: 1 })
    check.record('group:old', NOON)
    at(NOON + OUTBOUND_DEFAULTS.windowMs + 1)

    expect(check.check({ chatKey: 'private:new', text: '新会话' }).ok).toBe(true)
  })
})

describe('私聊必回', () => {
  it('主人连发也不会用刷屏保护拦住私聊回复', () => {
    const { check, at } = checker(NOON, { floodBurstCount: 3 })
    for (let index = 0; index < 3; index += 1) {
      check.sawIncoming({ chatKey: 'private:2', senderId: '2', at: NOON + index })
    }
    at(NOON + 3)

    expect(check.check({ chatKey: 'private:2', text: '主动补一句' }).code).toBe('outbound.flood_burst')
    expect(check.checkReply({ chatKey: 'private:2', text: '在听你说' }).ok).toBe(true)
  })
})

describe('两条之间留一点空', () => {
  it('没配间隔时不拦', () => {
    const { check } = checker(NOON)
    check.record('group:1', NOON)

    expect(check.check({ chatKey: 'group:1', text: '再来一句' }).ok).toBe(true)
  })

  it('配了间隔时上一条刚发就拒，下次时间是上一条加间隔', () => {
    const { check } = checker(NOON, { sendGapMs: 4_000 })
    check.record('group:1', NOON)

    const verdict = check.check({ chatKey: 'group:1', text: '再来一句' })

    expect(verdict.ok).toBe(false)
    expect(verdict.code).toBe('outbound.too_soon')
    expect(verdict.retryAt).toBe(NOON + 4_000)
  })

  it('隔够了就放行', () => {
    const { check, at } = checker(NOON, { sendGapMs: 4_000 })
    check.record('group:1', NOON)
    at(NOON + 4_000)

    expect(check.check({ chatKey: 'group:1', text: '再来一句' }).ok).toBe(true)
  })
})
