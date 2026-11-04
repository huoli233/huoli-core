import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/store.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const AT = new Date(2026, 10, 1, 10, 0).getTime()

// 手写一份旧格式的文件，字段该缺的都缺着
function writeRaw(file: string, items: readonly Record<string, unknown>[]): void {
  fs.writeFileSync(file, JSON.stringify({ version: 1, items }, null, 2))
}

function readBack(file: string): readonly Record<string, unknown>[] {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { items: readonly Record<string, unknown>[] }
  return parsed.items
}

afterEach(cleanupTempDirs)

describe('旧文件读得回来', () => {
  it('缺的字段按默认补齐', () => {
    const file = tempFile()
    writeRaw(file, [{
      id: 'old-1',
      text: '周三去爬山',
      layer: 'episodic',
      scope: 'group:1',
      importance: 50,
      clarity: 'vivid',
      at: AT,
    }])

    const item = createMemoryStore({ file }).byId('old-1')

    expect(item?.metadata).toEqual({})
    expect(item?.lastSeenAt).toBe(AT)
    expect(item?.recallCount).toBe(0)
    expect(item?.emotional).toBe(0)
    expect(item?.source).toBe('chat')
    expect(item?.forgotten).toBe(false)
  })

  it('不认识的字段原样留着，写回还在', () => {
    const file = tempFile()
    writeRaw(file, [{
      id: 'old-2',
      text: '周三去爬山',
      layer: 'episodic',
      scope: 'group:1',
      importance: 50,
      clarity: 'vivid',
      at: AT,
      note: '这条要留着',
    }])
    const store = createMemoryStore({ file })

    store.flush()

    expect(readBack(file)[0]?.note).toBe('这条要留着')
  })

  it('情绪强度按 24 分制折回 0 到 1', () => {
    const file = tempFile()
    writeRaw(file, [{
      id: 'old-3',
      text: '周三去爬山',
      layer: 'episodic',
      scope: 'group:1',
      importance: 50,
      clarity: 'vivid',
      at: AT,
      emotional: 12,
    }])

    expect(createMemoryStore({ file }).byId('old-3')?.emotional).toBe(0.5)
  })

  it('缺的层与来源回落到默认', () => {
    const file = tempFile()
    writeRaw(file, [{ id: 'old-4', text: '周三去爬山', scope: 'group:1', importance: 50, at: Date.now() }])

    const item = createMemoryStore({ file }).byId('old-4')

    expect(item?.layer).toBe('episodic')
    expect(item?.source).toBe('chat')
    expect(item?.clarity).toBe('vivid')
  })

  it('缺字段不会被丢掉', () => {
    const file = tempFile()
    writeRaw(file, [{ id: 'old-5', text: '周三去爬山' }, { id: 'old-6', text: '周四下山' }])

    expect(createMemoryStore({ file }).all()).toHaveLength(2)
  })
})

describe('新写入的条目', () => {
  it('能带上 metadata，关掉再开还在', () => {
    const file = tempFile()
    mount({ file }).seam.remember('周三去爬山', 'group:1', { metadata: { topic: '爬山', place: '西山' } })

    const reopened = mount({ file }).seam.store.all()[0]

    expect(reopened?.metadata).toEqual({ topic: '爬山', place: '西山' })
  })
})
