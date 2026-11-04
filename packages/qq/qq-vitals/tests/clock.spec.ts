import { describe, expect, it } from 'vitest'
import { cycleOf, localDayDiff, localHour, localPoint, resolveTuning } from '../src/index.ts'

const HOUR = 3_600_000

describe('按配置的时区取时刻', () => {
  it('同一时刻在两个时区算出不同的小时与零点', () => {
    const at = Date.UTC(2026, 10, 4, 4, 0)

    const utc = localPoint(at, 'UTC')
    const shanghai = localPoint(at, 'Asia/Shanghai')

    expect(utc.hour).toBe(4)
    expect(shanghai.hour).toBe(12)
    expect(utc.midnight).toBe(Date.UTC(2026, 10, 4))
    expect(shanghai.midnight).toBe(Date.UTC(2026, 10, 3, 16))
  })

  it('半小时偏移的时区把分算进小数小时', () => {
    const at = Date.UTC(2026, 5, 1, 3, 30)

    expect(localHour(at, 'UTC')).toBe(3.5)
    expect(localHour(at, 'Asia/Kolkata')).toBe(9)
    expect(localHour(at, 'Asia/Kathmandu')).toBe(9.25)
  })

  it('留空跟随运行环境，与不传时区一样', () => {
    const at = Date.UTC(2026, 10, 4, 4, 0)

    expect(localPoint(at, '')).toEqual(localPoint(at))
    expect(localHour(at, '')).toBe(localHour(at))
  })

  it('认不出的时区名退回运行环境时区', () => {
    const at = Date.UTC(2026, 10, 4, 4, 0)

    expect(localPoint(at, 'Nowhere/Nothing')).toEqual(localPoint(at))
    expect(localHour(at, 'Nowhere/Nothing')).toBe(localHour(at))
    expect(localDayDiff(at, at + 26 * HOUR, 'Nowhere/Nothing')).toBe(localDayDiff(at, at + 26 * HOUR))
  })
})

describe('跨夏令时的日期差', () => {
  const ZONE = 'America/New_York'

  it('春季拨快那天少一小时，日历日仍是一天', () => {
    const before = Date.UTC(2026, 2, 8, 16)
    const after = Date.UTC(2026, 2, 9, 16)

    expect(localDayDiff(before, after, ZONE)).toBe(1)
    expect(localPoint(after, ZONE).midnight - localPoint(before, ZONE).midnight).toBe(23 * HOUR)
  })

  it('秋季拨慢那天多一小时，日历日也仍是一天', () => {
    const before = Date.UTC(2026, 10, 1, 16)
    const after = Date.UTC(2026, 10, 2, 17)

    expect(localDayDiff(before, after, ZONE)).toBe(1)
    expect(localPoint(after, ZONE).midnight - localPoint(before, ZONE).midnight).toBe(25 * HOUR)
  })

  it('拨快那天的零点落在真实的当地零点上', () => {
    const at = Date.UTC(2026, 2, 8, 16)

    expect(localPoint(at, ZONE).midnight).toBe(Date.UTC(2026, 2, 8, 5))
    expect(localHour(localPoint(at, ZONE).midnight, ZONE)).toBe(0)
  })

  it('整年下来日期差不被夏令时带偏', () => {
    const from = Date.UTC(2026, 0, 1, 17)
    const to = Date.UTC(2027, 0, 1, 17)

    expect(localDayDiff(from, to, ZONE)).toBe(365)
  })
})

describe('周期跟着时区走', () => {
  it('同一时刻落在两地的日期不同，周期第几天也不同', () => {
    const at = Date.UTC(2026, 0, 4, 20)

    expect(cycleOf(at, resolveTuning({ timeZone: 'UTC' })).day).toBe(31)
    expect(cycleOf(at, resolveTuning({ timeZone: 'Asia/Shanghai' })).day).toBe(1)
    expect(cycleOf(at, resolveTuning({ timeZone: 'Asia/Shanghai' })).len).toBe(31)
  })
})
