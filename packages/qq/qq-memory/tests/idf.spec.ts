import { afterEach, describe, expect, it } from 'vitest'
import { recall } from '../src/recall.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const NOW = new Date(2026, 10, 1, 12, 0).getTime()

afterEach(cleanupTempDirs)

describe('常见词不该把分数带偏', () => {
  it('只命中「开会」的排在只命中「今天」的前面', () => {
    const { seam } = mount({ file: tempFile() })
    // 十句都带「今天」：这个词在库里非常常见
    for (let i = 0; i < 10; i += 1) {
      seam.remember(`今天没什么特别的第 ${i} 句`, 'group:1', { at: NOW - i * 1000, importance: 40 })
    }
    // 只有一句带「开会」：罕见的那个词
    seam.remember('明天下午开会', 'group:1', { at: NOW - 60_000, importance: 40 })

    const hits = recall(seam.store, { query: '今天开会', scope: 'group:1', now: NOW, limit: 11 })

    expect(hits[0]?.text).toBe('明天下午开会')
  })

  it('罕见表里没有的词，命中照样算数', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember('他说周末要开黑打游戏', 'group:1', { at: NOW - 60_000, importance: 40 })

    const hits = recall(seam.store, { query: '开黑', scope: 'group:1', now: NOW })

    expect(hits).toHaveLength(1)
  })
})
