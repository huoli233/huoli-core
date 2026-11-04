import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULTS } from '../src/defaults.ts'
import { localDay } from '../src/health.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const DAY = 86_400_000
// 第一天早上九点起算，跨天与跨多天都用它推
const FIRST_DAY = new Date(2026, 10, 4, 9, 0).getTime()
const NEXT_DAY = FIRST_DAY + DAY
const THREE_DAYS_LATER = FIRST_DAY + 3 * DAY

afterEach(cleanupTempDirs)

describe('一天只整理一次', () => {
  it('同一天再调不衰减，也不出第二行', () => {
    const { seam } = mount({ file: tempFile(), tuning: { decayBase: 100 } })
    const kept = seam.remember('会掉分的一句', 'group:1', { importance: 45, at: FIRST_DAY })

    const first = seam.maintain(FIRST_DAY)
    const second = seam.maintain(FIRST_DAY + 60_000)

    expect(first.didWork).toBe(true)
    expect(first.lastMaintainedDay).toBe(localDay(FIRST_DAY))
    expect(first.previousMaintainedDay).toBe('')
    expect(seam.store.byId(kept.id)?.importance).toBe(45 - DEFAULTS.decayDailyCap)

    expect(second.didWork).toBe(false)
    expect(second.decayed).toBe(0)
    expect(second.stepped).toBe(0)
    expect(second.forgotten).toBe(0)
    expect(second.added).toBe(0)
    expect(second.line).toBe('')
    expect(second.lastMaintainedDay).toBe(localDay(FIRST_DAY))
    expect(seam.store.byId(kept.id)?.importance).toBe(45 - DEFAULTS.decayDailyCap)
  })

  it('同一天再调不清理，也不补账', () => {
    const { seam } = mount({ file: tempFile(), tuning: { decayBase: 100 } })
    const doomed = seam.remember('快要淡没的一句', 'group:1', { importance: 45, at: FIRST_DAY })
    seam.maintain(FIRST_DAY)
    // 整理过之后才把它推到线边：第二次若真的跑，就会掉分并清掉正文
    seam.store.update(doomed.id, {
      importance: 40,
      at: FIRST_DAY - 87 * DAY,
      lastSeenAt: FIRST_DAY - 87 * DAY,
      clarity: 'trace',
    })
    const fresh = seam.remember('第一次整理之后才记下的那句', 'group:1', { importance: 45, at: FIRST_DAY })

    const second = seam.maintain(FIRST_DAY + 3_600_000)
    const after = seam.store.byId(doomed.id)

    expect(second.didWork).toBe(false)
    expect(after?.importance).toBe(40)
    expect(after?.clarity).toBe('trace')
    expect(after?.text).toBe('快要淡没的一句')
    expect(after?.state).toBe('active')
    // 没补账，后记的那条还挂在待入账里
    expect(seam.ledger('verify').report.unrecorded).toEqual([fresh.id])
  })

  it('跨天第一次调用照常做', () => {
    const { seam } = mount({ file: tempFile(), tuning: { decayBase: 100 } })
    const kept = seam.remember('隔天还要掉分的一句', 'group:1', { importance: 45, at: FIRST_DAY })
    seam.maintain(FIRST_DAY)

    const next = seam.maintain(NEXT_DAY)

    expect(next.didWork).toBe(true)
    expect(next.decayed).toBe(1)
    expect(next.lastMaintainedDay).toBe(localDay(NEXT_DAY))
    expect(next.previousMaintainedDay).toBe(localDay(FIRST_DAY))
    expect(seam.store.byId(kept.id)?.importance).toBe(45 - 2 * DEFAULTS.decayDailyCap)
  })

  it('隔了三天也只掉一天的量', () => {
    const { seam } = mount({ file: tempFile(), tuning: { decayBase: 100 } })
    const kept = seam.remember('三天没人管的一句', 'group:1', { importance: 60, at: FIRST_DAY })
    seam.maintain(FIRST_DAY)
    const afterOneDay = seam.store.byId(kept.id)?.importance ?? 0

    const later = seam.maintain(THREE_DAYS_LATER)

    expect(afterOneDay).toBe(60 - DEFAULTS.decayDailyCap)
    expect(later.didWork).toBe(true)
    expect(later.decayed).toBe(1)
    // 掉的分跟隔一天一样多，没补扣三倍
    expect(seam.store.byId(kept.id)?.importance).toBe(afterOneDay - DEFAULTS.decayDailyCap)
  })

  it('整理日跟着文件留着，重开之后同一天仍不重复做', () => {
    const file = tempFile()
    const first = mount({ file })
    first.seam.remember('记下的一句', 'group:1', { importance: 45, at: FIRST_DAY })
    first.seam.maintain(FIRST_DAY)

    const again = mount({ file }).seam.maintain(FIRST_DAY + 60_000)

    expect(again.didWork).toBe(false)
    expect(again.lastMaintainedDay).toBe(localDay(FIRST_DAY))
  })
})
