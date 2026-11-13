import { afterEach, describe, expect, it } from 'vitest'
import { recall } from '../src/recall.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 1, 12, 0).getTime()
const DAY_MS = 86_400_000

afterEach(cleanupTempDirs)

describe('私密星点只在私密空间可见', () => {
  it('群聊召回一条都不返回', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('偷偷给自己做了点事', 'private:1', { at: NOW - DAY_MS, importance: 60, layer: 'private', secret: true })

    expect(recall(seam.store, { query: '偷偷', scope: 'group:1', now: NOW })).toEqual([])
  })

  it('私密空间自己取得到', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('偷偷给自己做了点事', 'private:1', { at: NOW - DAY_MS, importance: 60, layer: 'private', secret: true })

    const hits = recall(seam.store, { query: '偷偷', scope: 'private:1', now: NOW })

    expect(hits).toHaveLength(1)
  })

  it('普通记忆在两边都照旧取得到', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('他说周末要开黑', 'group:1', { at: NOW - DAY_MS, importance: 40 })

    expect(recall(seam.store, { query: '开黑', scope: 'group:1', now: NOW })).toHaveLength(1)
    expect(recall(seam.store, { query: '开黑', scope: 'private:1', now: NOW })).toEqual([])
  })

  it('同一个词在群里只返回群里的那条，私密那条不漏出来', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('我说了偷偷两个字', 'group:1', { at: NOW - DAY_MS, importance: 40 })
    seam.remember('偷偷给自己做了点事', 'group:1', { at: NOW - DAY_MS, importance: 60, layer: 'private', secret: true, personId: '1' })

    const hits = recall(seam.store, { query: '偷偷', scope: 'group:1', now: NOW })

    expect(hits).toHaveLength(1)
    expect(hits[0]?.text).toBe('我说了偷偷两个字')
  })
})
