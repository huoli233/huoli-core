import { afterEach, describe, expect, it } from 'vitest'
import { readEdges } from '../src/edges.ts'
import { recall } from '../src/recall.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 1, 12, 0).getTime()

afterEach(cleanupTempDirs)

describe('同一轮写进来的几条自动连边', () => {
  it('窗口内写两条就连上一条边', () => {
    const file = tempFile()
    const { seam } = mount({ file })
    seam.remember('中午吃了面', 'group:1', { at: NOW })
    seam.remember('下午要去开会', 'group:1', { at: NOW + 5_000 })

    const edges = readEdges(file.replace(/[^\\/]+$/, 'edges.jsonl'))

    expect(edges).toHaveLength(1)
    expect(edges[0]?.why).toBe('sameTurn')
  })

  it('隔得远的两条不算同一轮', () => {
    const file = tempFile()
    const { seam } = mount({ file })
    seam.remember('中午吃了面', 'group:1', { at: NOW })
    seam.remember('晚上要去跑步', 'group:1', { at: NOW + 10 * 60_000 })

    expect(readEdges(file.replace(/[^\\/]+$/, 'edges.jsonl'))).toEqual([])
  })
})

describe('星链给召回加分', () => {
  it('连在一起的两条排到没连的前面', () => {
    const { seam } = mount({ file: tempFile() })
    const first = seam.remember('周末要开黑', 'group:1', { at: NOW, importance: 50 })
    const second = seam.remember('开黑要用麦', 'group:1', { at: NOW, importance: 50 })
    seam.remember('开黑的房间订好了吗', 'group:1', { at: NOW, importance: 50 })

    const edges = [
      { a: first.id, b: second.id, weight: 8 },
    ]
    const hits = recall(seam.store, { query: '开黑', scope: 'group:1', now: NOW, edges })

    expect(hits[0]?.id === first.id || hits[0]?.id === second.id).toBe(true)
    expect(hits[2]?.id).not.toBe(first.id)
    expect(hits[2]?.id).not.toBe(second.id)
  })
})
