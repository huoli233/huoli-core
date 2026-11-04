import { afterEach, describe, expect, it } from 'vitest'
import { MEMORY_SOURCES } from '../src/types.ts'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const SENTENCE = '他把周三的爬山改到了周五'

afterEach(cleanupTempDirs)

// 从数据那边来的值可能是任何形状，这里按 JSON 给一份
function asJson(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>
}

describe('来源只有五档', () => {
  it('五档逐档都收得下', () => {
    const { seam } = mount({ file: tempFile() })

    const seen = MEMORY_SOURCES.map((source, index) => {
      return seam.remember(`${SENTENCE}，第 ${index} 档`, 'group:1', { source }).source
    })

    expect(seen).toEqual([...MEMORY_SOURCES])
  })

  it('第六档被拒，不写半条', () => {
    const { seam } = mount({ file: tempFile() })
    const outside = 'diary' as 'chat'

    expect(() => seam.remember(SENTENCE, 'group:1', { source: outside })).toThrow(/memory\.source_unknown/)
    expect(seam.store.all()).toHaveLength(0)
  })

  it('镜像走的是第五档', () => {
    const { seam } = mount({ file: tempFile() })

    const item = seam.remember(SENTENCE, 'group:1', { source: 'self' })

    expect(item.source).toBe('self')
  })

  it('不填来源就是聊天那一档', () => {
    const { seam } = mount({ file: tempFile() })

    expect(seam.remember(SENTENCE, 'group:1').source).toBe('chat')
  })
})

describe('metadata 的写法', () => {
  it('对象原样收下', () => {
    const { seam } = mount({ file: tempFile() })

    const item = seam.remember(SENTENCE, 'group:1', { metadata: { topic: '爬山', place: '西山' } })

    expect(item.metadata).toEqual({ topic: '爬山', place: '西山' })
  })

  it('不是对象就拒写', () => {
    const { seam } = mount({ file: tempFile() })

    expect(() => seam.remember(SENTENCE, 'group:1', { metadata: asJson('["爬山"]') }))
      .toThrow(/memory\.metadata_invalid/)
    expect(seam.store.all()).toHaveLength(0)
  })

  it('键不是字符串就拒写', () => {
    const { seam } = mount({ file: tempFile() })

    expect(() => seam.remember(SENTENCE, 'group:1', { metadata: asJson('{"":1}') }))
      .toThrow(/memory\.metadata_invalid/)
  })

  it('不填 metadata 就不留这一项', () => {
    const { seam } = mount({ file: tempFile() })

    expect(seam.remember(SENTENCE, 'group:1').metadata).toBeUndefined()
  })
})
