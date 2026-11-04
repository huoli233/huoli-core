import { afterEach, describe, expect, it } from 'vitest'
import { resolveTuning } from '../src/defaults.ts'
import { keyGrams, recall } from '../src/recall.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 1, 12, 0).getTime()
const DAY_MS = 86_400_000
const SAID = '他说周末要开黑，我还想问是哪个游戏'

afterEach(cleanupTempDirs)

describe('关键词路按片段判相关', () => {
  it('短查询命中一个片段就算相关', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(SAID, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    const hits = recall(seam.store, { query: '开黑', scope: 'group:1', now: NOW })

    expect(hits).toHaveLength(1)
    expect(hits[0]?.reasons.grams).toEqual(['开黑'])
  })

  it('长查询只命中一个片段不算相关', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(SAID, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    const hits = recall(seam.store, { query: '爬山骑车看书跑步开黑', scope: 'group:1', now: NOW })

    expect(hits).toEqual([])
  })

  it('长查询命中两个片段就算相关', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(SAID, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    const hits = recall(seam.store, { query: '周末要开黑还想问游戏', scope: 'group:1', now: NOW })

    expect(hits).toHaveLength(1)
    expect(hits[0]?.reasons.grams.length).toBeGreaterThanOrEqual(2)
  })

  it('无关的查询给空数组，不给占位句', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(SAID, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    expect(recall(seam.store, { query: '今天天气很好', scope: 'group:1', now: NOW })).toEqual([])
    expect(seam.find('今天天气很好', 'group:1')).toEqual([])
  })

  it('别的会话里的条目看不见', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('爬山路上下起雨', 'group:2', { at: NOW - DAY_MS, importance: 40 })

    expect(recall(seam.store, { query: '爬山', scope: 'group:1', now: NOW })).toEqual([])
    expect(recall(seam.store, { query: '爬山', scope: 'group:2', now: NOW })).toHaveLength(1)
  })

  it('已遗忘的条目任何查询都不出现', () => {
    const { seam } = mount({ file: tempFile() })
    const item = seam.remember('爬山路上下起雨', 'group:1', { at: NOW - DAY_MS, importance: 40 })
    seam.store.update(item.id, { clarity: 'forgotten', forgotten: true })

    expect(recall(seam.store, { query: '爬山', scope: 'group:1', now: NOW })).toEqual([])
  })
})

describe('理由可以复算', () => {
  it('同样的输入算出同样的理由', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(SAID, 'group:1', { at: NOW - DAY_MS, importance: 40 })
    const input = { query: '周末开黑', scope: 'group:1', now: NOW }

    const first = recall(seam.store, input)[0]
    const second = recall(seam.store, input)[0]

    expect(first?.reasons).toEqual(second?.reasons)
    expect(first?.score).toBe(second?.score)
  })

  it('分数能从四项理由重算', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(SAID, 'group:1', { at: NOW - DAY_MS, importance: 40 })
    const tuning = resolveTuning()

    const hit = recall(seam.store, { query: '周末开黑', scope: 'group:1', now: NOW })[0]
    if (hit === undefined) throw new Error('没有找到')
    const sim = hit.reasons.grams.length / keyGrams('周末开黑', tuning.gramSize).length

    expect(hit.score).toBeCloseTo(
      tuning.weightSim * sim + hit.reasons.importanceTerm + hit.reasons.freshnessTerm,
      12,
    )
    expect(hit.reasons.freshnessTerm).toBeCloseTo(
      tuning.weightFreshness / (1 + (NOW - hit.at) / DAY_MS / tuning.freshnessDays),
      12,
    )
    expect(hit.reasons.vectorSim).toBeNull()
  })

  it('命中片段都真的出现在正文里', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(SAID, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    const hit = recall(seam.store, { query: '周末开黑', scope: 'group:1', now: NOW })[0]

    for (const gram of hit?.reasons.grams ?? []) expect(hit?.text).toContain(gram)
  })
})

describe('取几条', () => {
  it('默认取三条，配置能放宽', () => {
    const { seam } = mount({ file: tempFile() })
    for (let index = 0; index < 5; index += 1) {
      seam.remember(`第 ${index} 次去爬山`, 'group:1', { at: NOW - index * DAY_MS, importance: 50 })
    }

    const byDefault = recall(seam.store, { query: '爬山', scope: 'group:1', now: NOW })
    const widened = recall(seam.store, { query: '爬山', scope: 'group:1', now: NOW, limit: 5 })

    expect(byDefault).toHaveLength(3)
    expect(widened).toHaveLength(5)
  })

  it('装配时的参数决定默认取几条', () => {
    const { seam } = mount({ file: tempFile(), tuning: { recallLimit: 2 } })
    for (let index = 0; index < 4; index += 1) {
      seam.remember(`第 ${index} 次去爬山`, 'group:1', { at: NOW - index * DAY_MS, importance: 50 })
    }

    expect(seam.find('爬山', 'group:1')).toHaveLength(2)
  })

  it('空查询只看重要度与新鲜度', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('很久以前随口说的一句', 'group:1', { at: NOW - 40 * DAY_MS, importance: 20 })
    seam.remember('昨天说的一句', 'group:1', { at: NOW - DAY_MS, importance: 20 })

    const hits = recall(seam.store, { query: '', scope: 'group:1', now: NOW })

    expect(hits).toHaveLength(2)
    expect(hits[0]?.text).toBe('昨天说的一句')
    expect(hits[0]?.reasons.grams).toEqual([])
  })
})
