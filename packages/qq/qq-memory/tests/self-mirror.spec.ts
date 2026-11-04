import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTempDirs, mount, tempFile } from './harness.ts'

const AT = new Date(2026, 10, 3, 21, 0).getTime()

afterEach(cleanupTempDirs)

function claim(selfId: string, text: string) {
  return {
    text,
    chatKey: 'group:1',
    selfId,
    selfKind: 'claim' as const,
    evidence: ['2026-11-02'],
  }
}

describe('镜像入口', () => {
  it('写进去的带来源、重要度与四项元信息', () => {
    const { seam } = mount({ file: tempFile() })

    const written = seam.rememberSelf(claim('claims.jsonl#1', '夜里那句话是她说给自己听的'), AT)

    const item = seam.store.byId(written.id)
    expect(written.created).toBe(true)
    expect(item?.source).toBe('self')
    expect(item?.layer).toBe('semantic')
    expect(item?.scope).toBe('group:1')
    expect(item?.importance).toBeGreaterThanOrEqual(80)
    expect(item?.metadata).toEqual({
      self_id: 'claims.jsonl#1',
      self_kind: 'claim',
      evidence: ['2026-11-02'],
      mirrored_at: new Date(AT).toISOString(),
    })
    expect(Object.keys(item?.metadata ?? {})).toHaveLength(4)
  })

  it('同一个来源键写两次只有一条', () => {
    const { seam } = mount({ file: tempFile() })

    const first = seam.rememberSelf(claim('claims.jsonl#1', '夜里那句话是她说给自己听的'), AT)
    const again = seam.rememberSelf(claim('claims.jsonl#1', '夜里那句话是她说给自己听的'), AT + 60_000)

    expect(first.created).toBe(true)
    expect(again.created).toBe(false)
    expect(again.id).toBe(first.id)
    expect(seam.store.all()).toHaveLength(1)
    expect(seam.mirroredSelfIds()).toEqual(['claims.jsonl#1'])
  })

  it('给的重要度低于下限时按下限写', () => {
    const { seam } = mount({ file: tempFile() })

    const low = seam.rememberSelf({ ...claim('claims.jsonl#1', '一句'), importance: 20 }, AT)
    const high = seam.rememberSelf({ ...claim('claims.jsonl#2', '两句'), importance: 96 }, AT)

    expect(low.item.importance).toBe(80)
    expect(high.item.importance).toBe(96)
  })

  it('缺来源键或证据就拒写', () => {
    const { seam } = mount({ file: tempFile() })

    expect(() => seam.rememberSelf({ ...claim(' ', '一句') }, AT)).toThrow(/memory\.mirror_incomplete/)
    expect(() => seam.rememberSelf({ ...claim('claims.jsonl#1', '一句'), evidence: [] }, AT))
      .toThrow(/memory\.mirror_incomplete/)
    expect(seam.store.all()).toHaveLength(0)
  })

  it('镜进来的能按关键词找回来', () => {
    const { seam } = mount({ file: tempFile() })
    seam.rememberSelf(claim('claims.jsonl#1', '周五爬山那次她更想待在家里'), AT)

    const hits = seam.find('爬山', 'group:1')

    expect(hits).toHaveLength(1)
    expect(hits[0]?.text).toContain('爬山')
  })
})
