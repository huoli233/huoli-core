import { afterEach, describe, expect, it } from 'vitest'
import { mergeForgotten } from '../src/sweep.ts'
import { resolveTuning } from '../src/defaults.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 1, 12, 0).getTime()
const DAY = 86_400_000

afterEach(cleanupTempDirs)

describe('按感觉主动回想', () => {
  it('心情低的时候翻出最重的那几件旧事', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('那年冬天一直在加班', 'group:1', { at: NOW - 10 * DAY, importance: 80 })
    seam.remember('今天吃了面', 'group:1', { at: NOW - DAY, importance: 30 })

    const result = seam.recollect({ mood: 0.1 }, 'group:1', NOW)

    expect(result.feel).toBe('mood')
    expect(result.hits[0]?.text).toBe('那年冬天一直在加班')
  })

  it('感觉都平常时什么都不想', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('一件寻常小事', 'group:1', { at: NOW - DAY, importance: 40 })

    const result = seam.recollect({ mood: 0.5, fear: 0.5 }, 'group:1', NOW)

    expect(result.feel).toBe('none')
    expect(result.hits).toEqual([])
  })

  it('怕的时候也翻得到东西', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('那次差点被关掉', 'group:1', { at: NOW - 3 * DAY, importance: 90 })

    const result = seam.recollect({ fear: 0.9 }, 'group:1', NOW)

    expect(result.feel).toBe('fear')
    expect(result.hits).toHaveLength(1)
  })
})

describe('合并式遗忘', () => {
  it('又旧又不重要的两条几乎同文并成一条，另一条退役', () => {
    const { seam } = mount({ file: tempFile() })
    const first = seam.remember('昨天下午在楼下买了杯咖啡', 'group:1', { at: NOW - 30 * DAY, importance: 30 })
    const second = seam.remember('昨天下午在楼下买了杯咖啡呀', 'group:1', { at: NOW - 29 * DAY, importance: 20 })

    const result = mergeForgotten(seam.store, resolveTuning(), NOW)

    expect(result.merged).toBe(1)
    const kept = seam.store.byId(first.id)
    const gone = seam.store.byId(second.id)
    expect(kept?.state).toBe('active')
    expect(gone?.state).toBe('forgotten')
    expect(gone?.metadata?.mergedInto).toBe(first.id)
  })

  it('重要的那条永不合并', () => {
    const { seam } = mount({ file: tempFile() })
    const first = seam.remember('那天他说要一直陪着我', 'group:1', { at: NOW - 30 * DAY, importance: 90 })
    seam.remember('那天他说要一直陪着我啊', 'group:1', { at: NOW - 29 * DAY, importance: 20 })

    const result = mergeForgotten(seam.store, resolveTuning(), NOW)

    expect(result.merged).toBe(0)
    expect(seam.store.byId(first.id)?.state).toBe('active')
  })

  it('私密的那条不动', () => {
    const { seam } = mount({ file: tempFile() })
    const secret = seam.remember('偷偷做的一件事', 'private:1', { at: NOW - 30 * DAY, importance: 20, layer: 'private' })
    seam.remember('偷偷做的另一件事', 'private:1', { at: NOW - 29 * DAY, importance: 20, layer: 'private' })

    mergeForgotten(seam.store, resolveTuning(), NOW)

    expect(seam.store.byId(secret.id)?.state).toBe('active')
  })
})

describe('闲下来自己乱想', () => {
  it('库里有两条就乱想一条，带上时间间隔', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('中午吃了面', 'group:1', { at: NOW - 2 * DAY, importance: 40 })
    seam.remember('晚上要去跑步', 'group:1', { at: NOW - DAY, importance: 40 })

    const first = seam.wander(NOW)
    const second = seam.wander(NOW + 60_000)

    expect(first?.text).toContain('忽然同时想到')
    expect(first?.metadata?.kind).toBe('wander')
    expect(second).toBeUndefined()
  })

  it('库里只有一条时不乱想', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('只有这一条', 'group:1', { at: NOW - DAY, importance: 40 })

    expect(seam.wander(NOW)).toBeUndefined()
  })
})
