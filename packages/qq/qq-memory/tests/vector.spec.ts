import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULTS } from '../src/defaults.ts'
import { cosineSimilarity, encodeVector, recall } from '../src/recall.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 1, 12, 0).getTime()
const DAY_MS = 86_400_000
const CLIMB = '周三去爬山'
const REWORDED = '礼拜三爬山'
const UNRELATED = '今天天气很好'

afterEach(cleanupTempDirs)

// 归一化之后长度应当是一，用它看归一化有没有做
function normOf(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
}

describe('本地编码', () => {
  it('同一段文本两次编码逐位相同', () => {
    const first = encodeVector(CLIMB)
    const second = encodeVector(CLIMB)

    expect(first).toEqual(second)
  })

  it('维度固定，换多长的文本都一样长', () => {
    const short = encodeVector('爬山')
    const long = encodeVector('他说周末要开黑，我还想问是哪个游戏')

    expect(short).toHaveLength(1024)
    expect(long).toHaveLength(short.length)
  })

  it('空文本得到零向量', () => {
    const empty = encodeVector('   ')

    expect(empty).toHaveLength(1024)
    expect(empty.every(value => value === 0)).toBe(true)
    expect(encodeVector('，。！')).toEqual(empty)
  })

  it('编码结果归一化，长度为一', () => {
    expect(normOf(encodeVector(CLIMB))).toBeCloseTo(1, 12)
  })
})

describe('余弦相似度', () => {
  it('近义改写高过门槛，无关句低于门槛', () => {
    const close = cosineSimilarity(encodeVector(CLIMB), encodeVector(REWORDED))
    const far = cosineSimilarity(encodeVector(CLIMB), encodeVector(UNRELATED))

    expect(close ?? 0).toBeGreaterThanOrEqual(DEFAULTS.minSimilarity)
    expect(far ?? 0).toBeLessThan(DEFAULTS.minSimilarity)
  })

  it('零向量没有相似度', () => {
    expect(cosineSimilarity(encodeVector(CLIMB), encodeVector(''))).toBeNull()
  })
})

describe('两路合并', () => {
  it('换一种说法也能靠向量路找回来', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(REWORDED, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    const hits = recall(seam.store, { query: CLIMB, scope: 'group:1', now: NOW })

    expect(hits).toHaveLength(1)
    expect(hits[0]?.text).toBe(REWORDED)
    expect(hits[0]?.reasons.vectorSim ?? 0).toBeGreaterThanOrEqual(DEFAULTS.minSimilarity)
  })

  it('无关的句子不会因为向量路混进来', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(CLIMB, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    expect(recall(seam.store, { query: UNRELATED, scope: 'group:1', now: NOW })).toEqual([])
  })

  it('两路都命中的那条只出现一次，理由里两路都在', () => {
    const { seam } = mount({ file: tempFile() })
    const item = seam.remember(CLIMB, 'group:1', { at: NOW - DAY_MS, importance: 40 })
    seam.remember(UNRELATED, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    const hits = recall(seam.store, { query: '周三爬山', scope: 'group:1', now: NOW })

    expect(hits).toHaveLength(1)
    expect(hits.filter(hit => hit.id === item.id)).toHaveLength(1)
    expect(hits[0]?.reasons.grams.length).toBeGreaterThan(0)
    expect(hits[0]?.reasons.vectorSim ?? 0).toBeGreaterThanOrEqual(DEFAULTS.minSimilarity)
  })
})

describe('相似度门槛可配', () => {
  const QUERY = '去年三号我们爬山了'

  it('只有向量路能命中的那条，调高门槛就消失，调低又回来', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(CLIMB, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    const byDefault = recall(seam.store, { query: QUERY, scope: 'group:1', now: NOW })
    const strict = recall(seam.store, { query: QUERY, scope: 'group:1', now: NOW, tuning: { minSimilarity: 0.9 } })
    const loose = recall(seam.store, { query: QUERY, scope: 'group:1', now: NOW, tuning: { minSimilarity: 0.2 } })

    expect(byDefault).toHaveLength(1)
    // 关键词路只对上一段，长查询要两段才算，这一条全靠向量路
    expect(byDefault[0]?.reasons.grams.length ?? 0).toBeLessThan(DEFAULTS.longQueryMinHits)
    expect(strict).toEqual([])
    expect(loose).toHaveLength(1)
  })

  it('装配时给的参数也生效', () => {
    const { seam } = mount({ file: tempFile(), tuning: { minSimilarity: 0.9 } })
    seam.remember(CLIMB, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    expect(seam.find(QUERY, 'group:1')).toEqual([])
  })
})

describe('旧判据照旧', () => {
  it('空查询只按重要度与新鲜度排', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('很久以前随口说的一句', 'group:1', { at: NOW - 40 * DAY_MS, importance: 20 })
    seam.remember('昨天说的一句', 'group:1', { at: NOW - DAY_MS, importance: 20 })

    const hits = recall(seam.store, { query: '', scope: 'group:1', now: NOW })

    expect(hits).toHaveLength(2)
    expect(hits[0]?.text).toBe('昨天说的一句')
    expect(hits[0]?.reasons.grams).toEqual([])
    expect(hits[0]?.reasons.vectorSim).toBeNull()
  })

  it('无关的查询返空数组', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(CLIMB, 'group:1', { at: NOW - DAY_MS, importance: 40 })

    expect(recall(seam.store, { query: '完全不存在的词', scope: 'group:1', now: NOW })).toEqual([])
  })

  it('别的会话里的条目看不见', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(CLIMB, 'group:2', { at: NOW - DAY_MS, importance: 40 })

    expect(recall(seam.store, { query: REWORDED, scope: 'group:1', now: NOW })).toEqual([])
    expect(recall(seam.store, { query: REWORDED, scope: 'group:2', now: NOW })).toHaveLength(1)
  })

  it('已遗忘的条目不出现', () => {
    const { seam } = mount({ file: tempFile() })
    const item = seam.remember(CLIMB, 'group:1', { at: NOW - DAY_MS, importance: 40 })
    seam.store.update(item.id, { clarity: 'forgotten', forgotten: true })

    expect(recall(seam.store, { query: REWORDED, scope: 'group:1', now: NOW })).toEqual([])
  })
})

describe('复算', () => {
  it('同样的输入两次召回，结果与理由逐字相同', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(CLIMB, 'group:1', { at: NOW - DAY_MS, importance: 40 })
    seam.remember(REWORDED, 'group:1', { at: NOW - 2 * DAY_MS, importance: 60 })
    seam.remember(UNRELATED, 'group:1', { at: NOW - 3 * DAY_MS, importance: 30 })
    const input = { query: '礼拜三去爬山', scope: 'group:1', now: NOW }

    const first = recall(seam.store, input)
    const second = recall(seam.store, input)

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first.length).toBeGreaterThan(0)
  })
})
