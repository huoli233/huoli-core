import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULTS } from '../src/defaults.ts'
import { importanceGate, LOW_IMPORTANCE } from '../src/write.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 4, 20, 0).getTime()
const EARLIER = NOW - 60_000
const OLD = '周三下午一起去西山爬山，说好带两瓶水'
const NEAR = '周三下午一起去西山爬山，说好带三瓶水'
// 群里说的一句平常事，默认算出来的重要度是 40
const PLAIN = '周四晚上在河边钓鱼'
const OTHER = '第二天一早又去了河边'

afterEach(cleanupTempDirs)

describe('重要度门槛', () => {
  it('默认门槛固定在默认值表里，够格按写入办、差一分就丢', () => {
    expect(DEFAULTS.writeMinImportance).toBe(10)

    expect(importanceGate(40, 40).written).toBe(true)
    const refused = importanceGate(39, 40)

    expect(refused.written).toBe(false)
    expect(refused.code).toBe(LOW_IMPORTANCE)
    expect(refused.reason).not.toBe('')
    expect(refused.hint).not.toBe('')
  })

  it('直接写入低于门槛一条不落库，返回码与原因齐全，丢弃计数条条累加', () => {
    const { seam } = mount({ file: tempFile(), tuning: { writeMinImportance: 60 } })

    const outcome = seam.write(PLAIN, 'group:1', { at: NOW })

    expect(outcome.written).toBe(false)
    expect(outcome.code).toBe(LOW_IMPORTANCE)
    expect(outcome.reason).toContain('60')
    expect(outcome.hint).not.toBe('')
    expect(outcome.id).toBe('')
    expect(outcome.item).toBeUndefined()
    expect(seam.store.all()).toHaveLength(0)

    seam.write(OTHER, 'group:1', { at: NOW })

    expect(seam.droppedLow()).toBe(2)
  })

  it('入队低于门槛的不进队列，排空也写不出东西来', () => {
    const { seam } = mount({ file: tempFile(), tuning: { writeMinImportance: 60 } })

    const outcome = seam.enqueue(PLAIN, 'group:1')

    expect(outcome.written).toBe(false)
    expect(outcome.code).toBe(LOW_IMPORTANCE)
    expect(outcome.reason).not.toBe('')
    expect(outcome.pending).toBe(0)
    expect(seam.pending()).toBe(0)
    expect(seam.droppedLow()).toBe(1)

    seam.flushQueue(NOW)

    expect(seam.store.all()).toHaveLength(0)
  })

  it('高过门槛照常写入，正好等于门槛也按写入办', () => {
    const even = mount({ file: tempFile(), tuning: { writeMinImportance: 40 } })

    expect(even.seam.write(PLAIN, 'group:1', { at: NOW }).written).toBe(true)
    expect(even.seam.store.all()).toHaveLength(1)
    expect(even.seam.droppedLow()).toBe(0)

    const above = mount({ file: tempFile() })
    expect(above.seam.write(PLAIN, 'group:1', { importance: 80, at: NOW }).written).toBe(true)
    expect(above.seam.store.all()).toHaveLength(1)
  })

  it('高过门槛的照常入队与写入，丢弃计数不涨', () => {
    const { seam } = mount({ file: tempFile(), tuning: { writeMinImportance: 40 } })
    seam.enqueue(PLAIN, 'group:1')

    const flushed = seam.flushQueue(NOW)

    expect(flushed.written).toBe(1)
    expect(seam.store.all()).toHaveLength(1)
    expect(seam.droppedLow()).toBe(0)
  })

  it('丢弃计数跟着队列文件走，关掉再开还在', () => {
    const file = tempFile()
    mount({ file, tuning: { writeMinImportance: 60 } }).seam.enqueue(PLAIN, 'group:1')

    expect(mount({ file, tuning: { writeMinImportance: 60 } }).seam.droppedLow()).toBe(1)
  })

  it('并进旧条不看门槛，合并照旧只动被提起时刻与重要度', () => {
    const { seam } = mount({ file: tempFile(), tuning: { writeMinImportance: 70 } })
    const kept = seam.remember(OLD, 'group:1', { importance: 40, at: EARLIER })

    const merge = seam.write(NEAR, 'group:1', { importance: 5, at: NOW })

    expect(merge.merged).toBe(true)
    expect(merge.written).toBe(true)
    expect(merge.id).toBe(kept.id)
    expect(seam.store.all()).toHaveLength(1)
    expect(seam.store.byId(kept.id)?.lastSeenAt).toBe(NOW)
    expect(seam.store.byId(kept.id)?.metadata?.['mergedCount']).toBe(1)
    expect(seam.droppedLow()).toBe(0)
  })

  it('门槛调高之后原本能写的那句被拒', () => {
    const loose = mount({ file: tempFile() })

    expect(loose.seam.write(PLAIN, 'group:1', { at: NOW }).written).toBe(true)
    expect(loose.seam.store.all()).toHaveLength(1)

    const strict = mount({ file: tempFile(), tuning: { writeMinImportance: 60 } })
    const refused = strict.seam.write(PLAIN, 'group:1', { at: NOW })

    expect(refused.written).toBe(false)
    expect(refused.code).toBe(LOW_IMPORTANCE)
    expect(strict.seam.store.all()).toHaveLength(0)
  })

  it('门槛调低之后原本被拒的那句能写进去', () => {
    const { seam } = mount({ file: tempFile(), tuning: { writeMinImportance: 1 } })

    const outcome = seam.write(PLAIN, 'group:1', { importance: 5, at: NOW })

    expect(outcome.written).toBe(true)
    expect(seam.store.all()).toHaveLength(1)
  })
})

describe('反思也过门槛', () => {
  it('合成条目重要度取原件最大值，过了门槛照常写入', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('周三下午去西山爬山', 'group:1', { importance: 40, at: EARLIER })
    seam.remember(PLAIN, 'group:1', { importance: 40, at: NOW })

    const outcome = seam.reflect(NOW + 1_000)

    expect(outcome.written).toBe(true)
    expect(outcome.id).not.toBe('')
    expect(outcome.mergedFrom).toHaveLength(2)
    expect(seam.store.all().filter(item => item.layer === 'semantic')).toHaveLength(1)
  })

  it('原件的最大值也过不了门槛时不合成，原件一条不丢', () => {
    const { seam } = mount({ file: tempFile(), tuning: { writeMinImportance: 90 } })
    seam.remember('周三下午去西山爬山', 'group:1', { importance: 40, at: EARLIER })
    seam.remember(PLAIN, 'group:1', { importance: 40, at: NOW })

    const outcome = seam.reflect(NOW + 1_000)

    expect(outcome.written).toBe(false)
    expect(outcome.code).toBe(LOW_IMPORTANCE)
    expect(outcome.reason).not.toBe('')
    expect(outcome.id).toBe('')
    expect(outcome.mergedFrom).toEqual([])
    expect(seam.store.all()).toHaveLength(2)
    expect(seam.droppedLow()).toBe(1)
  })
})
