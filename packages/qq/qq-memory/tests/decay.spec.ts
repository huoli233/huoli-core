import { RETENTION } from '@huoli/huoli-qq-policy'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULTS } from '../src/defaults.ts'
import { describeLedger } from '../src/ledger.ts'
import { touch } from '../src/sweep.ts'
import { call, cleanupTempDirs, execOf, mount, tempFile } from './harness.ts'

const DAY = 86_400_000
const NOW = new Date(2026, 9, 30, 18, 39).getTime()

afterEach(cleanupTempDirs)

describe('保护线说法', () => {
  it('默认就是策略表那条线，现在是 70', () => {
    expect(DEFAULTS.protectLine).toBe(RETENTION.anchorImportance)
    expect(DEFAULTS.protectLine).toBe(70)
  })
})

describe('每天掉一次重要度', () => {
  it('一天最多掉封顶那么多分', () => {
    const { seam } = mount({ file: tempFile(), tuning: { decayBase: 100 } })
    const kept = seam.remember('掉得最快的一句', 'group:1', { importance: 45, at: NOW })

    const run = seam.maintain(NOW)

    expect(run.decayed).toBe(1)
    expect(seam.store.byId(kept.id)?.importance).toBe(45 - DEFAULTS.decayDailyCap)
  })

  it('掉到地板就停住，再跑也不动', () => {
    const { seam } = mount({ file: tempFile(), tuning: { decayBase: 100 } })
    const kept = seam.remember('快落到地板的一句', 'group:1', { importance: 6, at: NOW })

    seam.maintain(NOW)
    const afterFirst = seam.store.byId(kept.id)?.importance ?? 0
    const again = seam.maintain(NOW + DAY)

    expect(afterFirst).toBe(DEFAULTS.importanceFloor)
    expect(seam.store.byId(kept.id)?.importance).toBe(DEFAULTS.importanceFloor)
    expect(again.decayed).toBe(0)
  })

  it('保护线以上一天都不掉，线下照常掉', () => {
    const { seam } = mount({ file: tempFile() })
    const pinned = seam.remember('必须记住的一句', 'group:1', { importance: DEFAULTS.protectLine, at: NOW })
    const near = seam.remember('差一分才受保护的一句', 'group:1', { importance: DEFAULTS.protectLine - 1, at: NOW })

    const run = seam.maintain(NOW)

    expect(run.decayed).toBe(1)
    expect(seam.store.byId(pinned.id)?.importance).toBe(DEFAULTS.protectLine)
    expect(seam.store.byId(near.id)?.importance).toBeLessThan(DEFAULTS.protectLine - 1)
  })

  it('保护线跟着配置走', () => {
    const { seam } = mount({ file: tempFile(), tuning: { protectLine: 90 } })
    const kept = seam.remember('八十五分的一句', 'group:1', { importance: 85, at: NOW })

    seam.maintain(NOW)

    expect(seam.store.byId(kept.id)?.importance).toBeLessThan(85)
  })

  it('常被召回的那条掉得慢', () => {
    const { seam } = mount({ file: tempFile() })
    const quiet = seam.remember('从没被提起的一句', 'group:1', { importance: 45, at: NOW })
    const recalled = seam.remember('被反复提起的一句', 'group:1', { importance: 45, at: NOW })
    seam.store.update(recalled.id, { recallCount: DEFAULTS.reviewCap })

    seam.maintain(NOW)

    const quietLeft = seam.store.byId(quiet.id)?.importance ?? 0
    const recalledLeft = seam.store.byId(recalled.id)?.importance ?? 0

    expect(recalledLeft).toBeGreaterThan(quietLeft)
  })

  it('情绪越重掉得越快', () => {
    const { seam } = mount({ file: tempFile() })
    const calm = seam.remember('平平淡淡的一句', 'group:1', { importance: 45, at: NOW })
    const hot = seam.remember('带着情绪的一句', 'group:1', { importance: 45, emotional: 1, at: NOW })

    seam.maintain(NOW)

    expect(seam.store.byId(hot.id)?.importance ?? 0).toBeLessThan(seam.store.byId(calm.id)?.importance ?? 0)
  })

  it('已经忘掉的条目不再掉分', () => {
    const { seam } = mount({ file: tempFile() })
    const gone = seam.remember('已经忘掉的一句', 'group:1', { importance: 45, at: NOW })
    seam.store.update(gone.id, { state: 'forgotten', clarity: 'forgotten', text: '', retiredAt: NOW })

    const run = seam.maintain(NOW)

    expect(run.decayed).toBe(0)
    expect(seam.store.byId(gone.id)?.importance).toBe(45)
  })
})

describe('被召回时回升', () => {
  it('召回一次抬一点，同一天再召回不重复抬', async () => {
    const { seam, tool } = mount({ file: tempFile() })
    const kept = seam.remember('被问起的一句关于爬山的事', 'group:1', { importance: 40, at: NOW })

    await call(tool('memory_query'), { query: '爬山' }, execOf('group:1'))
    const first = seam.store.byId(kept.id)

    await call(tool('memory_query'), { query: '爬山' }, execOf('group:1'))
    const second = seam.store.byId(kept.id)

    expect(first?.importance).toBe(40 + DEFAULTS.recallRecover)
    expect(first?.recallCount).toBe(1)
    expect(second?.importance).toBe(first?.importance)
    expect(second?.recallCount).toBe(2)
  })

  it('回升封在表顶，不越过保护线', async () => {
    const { seam, tool } = mount({ file: tempFile() })
    const kept = seam.remember('马上就要受保护的一句', 'group:1', { importance: DEFAULTS.recoverCeiling - 1, at: NOW })

    await call(tool('memory_query'), { query: '受保护' }, execOf('group:1'))

    expect(seam.store.byId(kept.id)?.importance).toBe(DEFAULTS.recoverCeiling)
    expect(DEFAULTS.recoverCeiling).toBeLessThan(DEFAULTS.protectLine)
  })

  it('换一天再召回才回升一次', () => {
    const { seam } = mount({ file: tempFile() })
    const kept = seam.remember('隔天还会被提起的一句', 'group:1', { importance: 60, at: NOW })

    touch(seam.store, kept.id, NOW)
    touch(seam.store, kept.id, NOW + 60_000)
    const sameDay = seam.store.byId(kept.id)?.importance

    touch(seam.store, kept.id, NOW + DAY)
    const nextDay = seam.store.byId(kept.id)?.importance

    expect(sameDay).toBe(60 + DEFAULTS.recallRecover)
    expect(nextDay).toBe(60 + DEFAULTS.recallRecover * 2)
  })

  it('只剩印象的条目不回升', async () => {
    const { seam, tool } = mount({ file: tempFile() })
    const kept = seam.remember('只剩一点印象的一句', 'group:1', { importance: 40, at: NOW })
    seam.store.update(kept.id, { clarity: 'trace' })

    await call(tool('memory_query'), { query: '印象' }, execOf('group:1'))

    expect(seam.store.byId(kept.id)?.importance).toBe(40)
    expect(seam.store.byId(kept.id)?.recallCount).toBe(1)
  })

  it('已遗忘的条目既不回升也不动次数', () => {
    const { seam } = mount({ file: tempFile() })
    const gone = seam.remember('已经忘掉的一句', 'group:1', { importance: 45, at: NOW })
    seam.store.update(gone.id, { state: 'forgotten', clarity: 'forgotten', text: '', retiredAt: NOW })

    touch(seam.store, gone.id, NOW)

    expect(seam.store.byId(gone.id)?.importance).toBe(45)
    expect(seam.store.byId(gone.id)?.recallCount).toBe(0)
  })

  it('找不到的编号碰不到任何东西', () => {
    const { seam } = mount({ file: tempFile() })

    touch(seam.store, '没有这个编号', NOW)

    expect(seam.store.all()).toHaveLength(0)
  })
})

describe('先掉重要度，再算清晰度，最后清正文', () => {
  // 年龄扣分把保留度压到清晰度线上，只有先掉的那一分能把它推过线
  const OLD = NOW - 87 * DAY

  it('重要度先变，清晰度跟着落到已遗忘，正文才清空', () => {
    const { seam } = mount({ file: tempFile() })
    const doomed = seam.remember('快到线的一句', 'group:1', { importance: 40, at: OLD })
    seam.store.update(doomed.id, { clarity: 'trace', lastSeenAt: OLD })

    const run = seam.maintain(NOW)
    const after = seam.store.byId(doomed.id)

    expect(after?.importance).toBeCloseTo(40 - DEFAULTS.decayBase * DEFAULTS.salienceMid)
    expect(after?.clarity).toBe('forgotten')
    expect(after?.text).toBe('')
    expect(after?.state).toBe('forgotten')
    expect(after?.retiredAt).toBe(NOW)
    expect(run.forgotten).toBe(1)
  })

  it('没掉分的那条清晰度不动，正文也不动', () => {
    const { seam } = mount({ file: tempFile() })
    const kept = seam.remember('受保护的一句', 'group:1', { importance: DEFAULTS.protectLine, at: OLD })

    seam.maintain(NOW)

    expect(seam.store.byId(kept.id)?.importance).toBe(DEFAULTS.protectLine)
    expect(seam.store.byId(kept.id)?.text).toBe('受保护的一句')
  })

  it('一次只降一档的规矩不变', () => {
    const { seam } = mount({ file: tempFile() })
    const fading = seam.remember('早就记下的一句', 'group:1', { importance: 30, at: OLD })

    seam.maintain(NOW)

    expect(seam.store.byId(fading.id)?.clarity).toBe('clear')
  })
})

describe('落盘和记录表', () => {
  it('重启之后数值还是衰减后的那个', () => {
    const file = tempFile()
    const first = mount({ file })
    const kept = first.seam.remember('关掉再开还在的一句', 'group:1', { importance: 45, at: NOW })
    first.seam.maintain(NOW)
    const decayedTo = first.seam.store.byId(kept.id)?.importance

    const reopened = mount({ file }).seam.store.byId(kept.id)

    expect(decayedTo).toBeLessThan(45)
    expect(reopened?.importance).toBe(decayedTo)
  })

  it('衰减不碰正文，核对不报正文被改', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('掉分也不动正文的一句', 'group:1', { importance: 45, at: NOW })

    seam.maintain(NOW)
    const report = seam.ledger('verify').report

    expect(report.ok).toBe(true)
    expect(describeLedger(report)).not.toContain('正文被改')
  })
})
