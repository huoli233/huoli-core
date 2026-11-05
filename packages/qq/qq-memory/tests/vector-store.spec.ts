import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openVectorStore } from '../src/vector-store.ts'
import { encodeVector } from '../src/recall.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const dirs: string[] = []

// 每个用例一个临时目录，用完连数据一起删干净
function vectorDirOf(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-vector-'))
  dirs.push(root)
  return path.join(root, 'pg')
}

afterEach(() => {
  cleanupTempDirs()
  for (const root of dirs.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    } catch {
      // 删不掉就留着，临时目录不该让用例失败
    }
  }
})

describe('向量仓', { timeout: 30_000 }, () => {
  it('存进去的向量能按相似度查回来，越像越靠前', async () => {
    const store = await openVectorStore({ dir: vectorDirOf() })
    await store.upsert([
      { id: 'a', embedding: [1, 0, 0], scope: 'group:1', at: 1 },
      { id: 'b', embedding: [0, 1, 0], scope: 'group:1', at: 2 },
    ])

    const hits = await store.search([1, 0.1, 0], { limit: 2 })

    expect(hits[0]?.id).toBe('a')
    expect(hits[0]?.score).toBeGreaterThan(0.9)
    expect(hits[1]?.id).toBe('b')
    await store.close()
  })

  it('同一个编号再存一次是覆盖，不是新增', async () => {
    const store = await openVectorStore({ dir: vectorDirOf() })
    await store.upsert([{ id: 'a', embedding: [1, 0, 0], scope: 'group:1', at: 1 }])
    await store.upsert([{ id: 'a', embedding: [0, 1, 0], scope: 'group:1', at: 2 }])

    expect(await store.count()).toBe(1)
    const hits = await store.search([0, 1, 0], { limit: 1 })
    expect(hits[0]?.score).toBeGreaterThan(0.9)
    await store.close()
  })

  it('按会话过滤时只查那一边', async () => {
    const store = await openVectorStore({ dir: vectorDirOf() })
    await store.upsert([
      { id: 'a', embedding: [1, 0], scope: 'group:1', at: 1 },
      { id: 'b', embedding: [1, 0], scope: 'group:2', at: 2 },
    ])

    const hits = await store.search([1, 0], { scope: 'group:2', limit: 5 })

    expect(hits.map(hit => hit.id)).toEqual(['b'])
    await store.close()
  })

  it('删掉一条就查不到了', async () => {
    const store = await openVectorStore({ dir: vectorDirOf() })
    await store.upsert([{ id: 'a', embedding: [1, 0], scope: 'g', at: 1 }])
    await store.remove('a')

    expect(await store.count()).toBe(0)
    await store.close()
  })

  it('关掉再开回来，数据还在', async () => {
    const dir = vectorDirOf()
    const first = await openVectorStore({ dir })
    await first.upsert([{ id: 'a', embedding: [1, 0], scope: 'g', at: 1 }])
    await first.close()

    const again = await openVectorStore({ dir })
    expect(await again.count()).toBe(1)
    const hits = await again.search([1, 0], { limit: 1 })
    expect(hits[0]?.id).toBe('a')
    await again.close()
  })
})

describe('接到记忆仓上', { timeout: 30_000 }, () => {
  it('写进去的记忆能被向量仓找回来', async () => {
    const { seam } = mount({ file: tempFile(), vectorStore: 'pglite', vectorDir: vectorDirOf() })
    seam.remember('周三去爬山', 'group:1', { at: 1, importance: 50 })
    seam.remember('晚上要跑步', 'group:1', { at: 2, importance: 50 })

    expect(await seam.vectorReindex()).toBe(2)
    const hits = await seam.vectorSearch(encodeVector('周三去爬山'), { scope: 'group:1', limit: 1 })

    expect(hits[0]?.score).toBeGreaterThan(0.5)
  })

  it('没开向量仓时查询回空表', async () => {
    const { seam } = mount({ file: tempFile() })

    expect(await seam.vectorSearch([1, 0, 0])).toEqual([])
    expect(await seam.vectorReindex()).toBe(0)
  })
})
