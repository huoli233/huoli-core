import { afterEach, describe, expect, it } from 'vitest'
import { recall } from '../src/recall.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 1, 12, 0).getTime()

afterEach(cleanupTempDirs)

describe('按字数装箱', () => {
  it('预算装不下长的就换短的，不是直接把后面的丢掉', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(`${'开黑'.repeat(1)}${'很长的一段'.repeat(20)}`, 'group:1', { at: NOW - 1000, importance: 90 })
    seam.remember('开黑要用麦', 'group:1', { at: NOW - 2000, importance: 60 })

    const hits = recall(seam.store, { query: '开黑', scope: 'group:1', now: NOW, limit: 5, tuning: { budgetChars: 30 } })

    expect(hits.map(hit => hit.text)).toContain('开黑要用麦')
    expect(hits.every(hit => hit.text.length <= 30)).toBe(true)
  })

  it('预算为零时不限字数', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('开黑要用麦', 'group:1', { at: NOW - 1000, importance: 60 })

    const hits = recall(seam.store, { query: '开黑', scope: 'group:1', now: NOW, tuning: { budgetChars: 0 } })

    expect(hits).toHaveLength(1)
  })
})

describe('核心记忆保底', () => {
  it('分数低也照样带出来，排在最前', () => {
    const { seam } = mount({ file: tempFile() })
    // 这条跟查询毫无关系，但它是核心记忆：她的身份
    const core = seam.remember('我是住在群里的那个人', 'group:1', { at: NOW - 90_000, importance: 100 })
    seam.store.update(core.id, { metadata: { core: true } })
    seam.remember('开黑要用麦', 'group:1', { at: NOW - 1000, importance: 60 })

    const hits = recall(seam.store, { query: '开黑', scope: 'group:1', now: NOW, limit: 5 })

    expect(hits[0]?.id).toBe(core.id)
    expect(hits[0]?.core).toBe(true)
  })

  it('核心记忆最多保底两条', () => {
    const { seam } = mount({ file: tempFile() })
    for (let i = 0; i < 4; i += 1) {
      const item = seam.remember(`我是谁第 ${i} 条`, 'group:1', { at: NOW - i * 1000, importance: 100 })
      seam.store.update(item.id, { metadata: { core: true } })
    }

    const hits = recall(seam.store, { query: '', scope: 'group:1', now: NOW, limit: 10 })

    expect(hits.filter(hit => hit.core === true)).toHaveLength(2)
  })
})
