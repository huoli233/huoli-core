import { initialImportance } from '@huoli/huoli-qq-policy'
import { afterEach, describe, expect, it } from 'vitest'
import { call, cleanupTempDirs, execOf, mount, tempFile } from './harness.ts'

const SENTENCE = '他说周末要开黑，我还想问是哪个游戏'

afterEach(cleanupTempDirs)

describe('记得住', () => {
  it('记一条会拿到编号', async () => {
    const { tool } = mount({ file: tempFile() })

    const added = await call<{ id: string }>(tool('memory_append'), { text: SENTENCE }, execOf('group:1'))

    expect(typeof added.id).toBe('string')
    expect(added.id).not.toBe('')
  })

  it('同一句再记一次会被拦住', async () => {
    const { tool } = mount({ file: tempFile() })
    await tool('memory_append').execute({ text: SENTENCE }, execOf('group:1'))

    await expect(tool('memory_append').execute({ text: SENTENCE }, execOf('group:1'))).rejects.toThrow(/memory\.duplicate/)
  })

  it('太短的内容不记', async () => {
    const { tool } = mount({ file: tempFile() })

    await expect(tool('memory_append').execute({ text: '嗯' }, execOf('group:1'))).rejects.toThrow(/memory\.too_short/)
  })

  it('自己声明不想让人知道：放 private 才收 secret', async () => {
    const { tool, seam } = mount({ file: tempFile() })

    const added = await call<{ id: string; layer: string }>(tool('memory_append'), {
      text: '偷偷给自己做了点事', layer: 'private', secret: true,
    }, execOf('group:1'))

    expect(added.layer).toBe('private')
    expect(seam.store.byId(added.id)?.secret).toBe(true)
  })

  it('不是 private 那一层却想标私密就拒', async () => {
    const { tool } = mount({ file: tempFile() })

    await expect(tool('memory_append').execute({
      text: '随口一句', layer: 'episodic', secret: true,
    }, execOf('group:1'))).rejects.toThrow(/memory\.secret_layer/u)
  })

  it('没声明 secret 就还是普通记忆', async () => {
    const { tool, seam } = mount({ file: tempFile() })

    const added = await call<{ id: string }>(tool('memory_append'), { text: SENTENCE }, execOf('group:1'))

    expect(seam.store.byId(added.id)?.secret).toBeUndefined()
  })
})

describe('找得回', () => {
  it('按关键词找得回来', async () => {
    const { tool } = mount({ file: tempFile() })
    await tool('memory_append').execute({ text: SENTENCE }, execOf('group:1'))

    const found = await call<{ count: number; text: string }>(tool('memory_query'), { query: '开黑' }, execOf('group:1'))

    expect(found.count).toBe(1)
    expect(found.text).toContain('开黑')
  })

  it('关键词对不上时如实说没想起来', async () => {
    const { tool } = mount({ file: tempFile() })
    await tool('memory_append').execute({ text: SENTENCE }, execOf('group:1'))

    const missing = await call<{ count: number; text: string }>(
      tool('memory_query'), { query: '完全不存在的词' }, execOf('group:1'),
    )

    expect(missing.count).toBe(0)
    expect(missing.text).toContain('没有想起')
  })

  it('被找出来的那条算被提起过一次', async () => {
    const { seam, tool } = mount({ file: tempFile() })
    await tool('memory_append').execute({ text: SENTENCE }, execOf('group:1'))
    await tool('memory_query').execute({ query: '开黑' }, execOf('group:1'))

    const touched = seam.store.all().find(item => item.text.includes('开黑'))

    expect(touched?.recallCount ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('已经淡忘的内容不会再被翻出来', async () => {
    const { seam, tool } = mount({ file: tempFile() })
    const doomed = seam.remember('会彻底忘掉的事', 'group:1')
    seam.store.update(doomed.id, { at: 0, lastSeenAt: 0 })
    for (let at = 0; at < 5; at += 1) seam.sweep()

    const searchForgotten = await call<{ text: string }>(tool('memory_query'), { query: '彻底忘掉' }, execOf('group:1'))

    expect(searchForgotten.text).not.toContain('彻底忘掉')
  })
})

describe('一层层往上挪', () => {
  it('刚发生的事不会立刻往上挪', () => {
    const { seam } = mount({ file: tempFile() })
    const early = seam.remember('刚发生的一件小事', 'group:1', { layer: 'ephemeral' })

    seam.promote()

    expect(seam.store.byId(early.id)?.layer).toBe('ephemeral')
  })

  it('过半小时之后往上挪一层', () => {
    const { seam } = mount({ file: tempFile() })
    const early = seam.remember('刚发生的一件小事', 'group:1', { layer: 'ephemeral' })
    seam.store.update(early.id, { at: Date.now() - 40 * 60_000 })

    seam.promote()

    expect(seam.store.byId(early.id)?.layer).toBe('episodic')
  })
})

describe('慢慢变淡', () => {
  it('跑一次只降一档', () => {
    const { seam } = mount({ file: tempFile() })
    const doomed = seam.remember('会彻底忘掉的事', 'group:1')
    seam.store.update(doomed.id, { at: 0, lastSeenAt: 0 })

    seam.sweep()

    expect(seam.store.byId(doomed.id)?.clarity).toBe('clear')
  })

  it('淡到底只留个空位', () => {
    const { seam } = mount({ file: tempFile() })
    const doomed = seam.remember('会彻底忘掉的事', 'group:1')
    seam.store.update(doomed.id, { at: 0, lastSeenAt: 0 })
    for (let at = 0; at < 5; at += 1) seam.sweep()

    const afterSweep = seam.store.byId(doomed.id)

    expect(afterSweep?.state).toBe('forgotten')
    expect(afterSweep?.text).toBe('')
    expect(afterSweep?.retiredAt).toBeGreaterThan(0)
  })
})

describe('重要度照着实情算', () => {
  it('同一句话直接说与随口提到算出来的不一样', () => {
    const { seam } = mount({ file: tempFile() })

    const told = seam.remember(SENTENCE, 'group:1', { directed: true, emotional: 12 })
    const overheard = seam.remember(SENTENCE, 'group:1', { directed: false, emotional: 0 })

    expect(told.importance).toBeGreaterThan(overheard.importance)
    expect(told.emotional).toBe(12)
    expect(overheard.emotional).toBe(0)
  })

  it('算出来的是公式的值，不是一个定数', () => {
    const { seam } = mount({ file: tempFile() })

    const item = seam.remember(SENTENCE, 'group:1', { directed: true, emotional: 20 })

    expect(item.importance).toBe(initialImportance({ scene: 'group', directed: true, emotional: 20 }))
    expect(item.importance).not.toBe(40)
  })

  it('不给情绪也不给直接说，就走默认的两项零', () => {
    const { seam } = mount({ file: tempFile() })

    const item = seam.remember(SENTENCE, 'group:1')

    expect(item.importance).toBe(initialImportance({ scene: 'group', directed: false, emotional: 0 }))
    expect(item.emotional).toBe(0)
  })

  it('调用方算好的重要度不会再被覆盖', () => {
    const { seam } = mount({ file: tempFile() })

    const item = seam.remember(SENTENCE, 'group:1', { importance: 88 })

    expect(item.importance).toBe(88)
  })

  it('工具记的时候按传进来的两项算', async () => {
    const { tool } = mount({ file: tempFile() })

    const plain = await call<{ importance: number }>(tool('memory_append'), { text: SENTENCE }, execOf('group:1'))
    const warm = await call<{ importance: number }>(
      tool('memory_append'), { text: '同一件事换个说法再讲一遍', directed: true, emotional: 24 }, execOf('group:1'),
    )

    expect(plain.importance).toBe(initialImportance({ scene: 'group', directed: false, emotional: 0 }))
    expect(warm.importance).toBe(initialImportance({ scene: 'group', directed: true, emotional: 24 }))
    expect(warm.importance).toBeGreaterThan(plain.importance)
  })
})

describe('每天跑一次', () => {
  it('变淡、记进记录表、写出一行健康记录', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(SENTENCE, 'group:1')

    const kept = seam.maintain(new Date(2026, 9, 30, 18, 39).getTime())

    expect(kept.added).toBe(1)
    expect(kept.line).toContain('ledger=OK')
    expect(kept.line).toContain('pending=0')
    expect(seam.ledger('verify').report.ok).toBe(true)
  })

  it('同一天再跑一次什么都不碰', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(SENTENCE, 'group:1')
    const at = new Date(2026, 9, 30, 18, 39).getTime()
    seam.maintain(at)

    const again = seam.maintain(at + 60_000)

    expect(again.didWork).toBe(false)
    expect(again.added).toBe(0)
    expect(again.line).toBe('')
  })
})

describe('关掉再开', () => {
  it('记下的条数还在', () => {
    const file = tempFile()
    const first = mount({ file })
    first.seam.remember(SENTENCE, 'group:1')
    const beforeRestart = first.seam.store.all().length

    expect(mount({ file }).seam.store.all().length).toBe(beforeRestart)
  })

  it('能给出一页记忆概要', () => {
    const { seam } = mount({ file: tempFile() })
    seam.remember(SENTENCE, 'group:1')

    const outline = seam.outline('group:1')

    expect(outline).toContain('记下了')
    expect(outline).toContain('开黑')
  })
})
