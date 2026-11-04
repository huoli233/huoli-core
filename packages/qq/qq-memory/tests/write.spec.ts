import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULTS, type Tuning } from '../src/defaults.ts'
import { healthLine } from '../src/health.ts'
import type { QqMemorySeam } from '../src/index.ts'
import { createMemoryStore } from '../src/store.ts'
import { createWriteQueue, nearDuplicateOf, type QueuedFact } from '../src/write.ts'
import { cleanupTempDirs, mount, tempDir, tempFile } from './harness.ts'

const NOW = new Date(2026, 9, 30, 18, 39).getTime()
const EARLIER = NOW - 60_000

// 临时目录里的一个空记忆仓
function storeAt(name: string) {
  return createMemoryStore({ file: path.join(tempDir(), name) })
}

// 直接用队列模块建一个，用来注入写不进去的那种失败
function bareQueue(write: (fact: QueuedFact) => void, tuning: Partial<Tuning> = {}) {
  const store = storeAt('memory.json')
  const queue = createWriteQueue({
    file: path.join(tempDir(), 'queue.json'),
    tuning: { ...DEFAULTS, ...tuning },
    store,
    // 这些用例都不关心重要度门槛，按刚好过门槛算
    importanceOf: (_chatKey, options) => options.importance ?? DEFAULTS.writeMinImportance,
    write,
  })
  return { store, queue }
}

function lineOf(seam: QqMemorySeam, pending: number, thresholds: Tuning = DEFAULTS): string {
  return healthLine({
    items: seam.store.all(),
    now: NOW,
    injectMaxChars: DEFAULTS.injectMaxChars,
    protectLine: DEFAULTS.protectLine,
    ledger: seam.ledger('sync').report,
    pending,
    thresholds,
  })
}

afterEach(cleanupTempDirs)

describe('写入队列', () => {
  it('入队只进队列，不写库', () => {
    const { store, queue } = bareQueue(() => {})

    const outcome = queue.enqueue('周三下午去西山爬山', 'group:1')

    expect(outcome.pending).toBe(1)
    expect(queue.pending()).toBe(1)
    expect(store.all()).toHaveLength(0)
  })

  it('空、过短、过长都拒收', () => {
    const { queue } = bareQueue(() => {})

    expect(() => queue.enqueue('   ', 'group:1')).toThrow(/memory\.empty/)
    expect(() => queue.enqueue('嗯', 'group:1')).toThrow(/memory\.too_short/)
    expect(() => queue.enqueue('爬'.repeat(DEFAULTS.maxTextChars + 1), 'group:1')).toThrow(/memory\.too_long/)
    expect(queue.pending()).toBe(0)
  })

  it('排空之后才写进记忆', () => {
    const { seam } = mount({ file: tempFile() })
    seam.enqueue('周三下午去西山爬山', 'group:1')

    const flushed = seam.flushQueue(NOW)

    expect(flushed.written).toBe(1)
    expect(flushed.kept).toBe(0)
    expect(seam.pending()).toBe(0)
    expect(seam.store.all()).toHaveLength(1)
  })

  it('压满之后先丢最旧的并计数', () => {
    const { seam } = mount({ file: tempFile(), tuning: { queueMax: 2 } })
    seam.enqueue('第一条要被挤掉的', 'group:1')
    seam.enqueue('第二条留下来', 'group:1')

    const last = seam.enqueue('第三条留下来', 'group:1')

    expect(last.pending).toBe(2)
    expect(last.dropped).toBe(1)
    expect(seam.dropped()).toBe(1)
    seam.flushQueue(NOW)
    expect(seam.store.all().map(item => item.text)).toEqual(['第二条留下来', '第三条留下来'])
  })

  it('写不进去的那条留在队列里，不丢', () => {
    let failing = true
    const written: string[] = []
    const { queue } = bareQueue((fact) => {
      if (failing) throw new Error('memory.store_unwritable: 记忆写不进去')
      written.push(fact.text)
    })
    queue.enqueue('第一次写不进去的一句', 'group:1')

    const first = queue.flush(NOW)

    expect(first.written).toBe(0)
    expect(first.error).toContain('memory.store_unwritable')
    expect(queue.pending()).toBe(1)

    failing = false
    const second = queue.flush(NOW)

    expect(second.written).toBe(1)
    expect(queue.pending()).toBe(0)
    expect(written).toEqual(['第一次写不进去的一句'])
  })

  it('队列落在自己的文件里，关掉再开还在', () => {
    const file = tempFile()
    mount({ file }).seam.enqueue('关掉再开还在队列里', 'group:1')

    expect(mount({ file }).seam.pending()).toBe(1)
  })

  it('每满几轮自动排空一次', () => {
    const { seam } = mount({ file: tempFile() })
    seam.enqueue('第三轮攒下的一句话', 'group:1')
    const written: number[] = []
    for (let turn = 0; turn < DEFAULTS.flushEveryTurns; turn += 1) written.push(seam.tick(NOW + turn).written)

    expect(written).toEqual([0, 0, 0, 1])
    expect(seam.pending()).toBe(0)
    expect(seam.store.all()).toHaveLength(1)
  })
})

describe('反思', () => {
  it('攒够轮数就把同类内容合成一条长期印象', () => {
    const { seam } = mount({ file: tempFile() })
    seam.enqueue('周三下午去西山爬山', 'group:1')
    seam.enqueue('周四晚上在河边钓鱼', 'group:1')
    for (let turn = 0; turn < DEFAULTS.reflectEveryTurns; turn += 1) seam.tick(NOW + turn)

    const originals = seam.store.all().filter(item => item.layer === 'episodic')
    const merged = seam.store.all().filter(item => item.layer === 'semantic')

    expect(originals).toHaveLength(2)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.source).toBe('chat')
    expect(merged[0]?.metadata?.['mergedFrom']).toEqual(originals.map(item => item.id))
  })

  it('不到轮数不动', () => {
    const { seam } = mount({ file: tempFile() })
    seam.enqueue('周三下午去西山爬山', 'group:1')
    seam.enqueue('周四晚上在河边钓鱼', 'group:1')
    for (let turn = 0; turn < DEFAULTS.reflectEveryTurns - 1; turn += 1) seam.tick(NOW + turn)

    expect(seam.store.all().filter(item => item.layer === 'semantic')).toHaveLength(0)
  })
})

describe('近似重复合并', () => {
  const OLD = '周三下午一起去西山爬山，说好带两瓶水'
  const NEAR = '周三下午一起去西山爬山，说好带三瓶水'
  const FAR = '今天的股票又跌了一点'

  it('够像的一句并进旧条，不新增第二份正文', () => {
    const { seam } = mount({ file: tempFile() })
    const kept = seam.remember(OLD, 'group:1', { importance: 40, at: EARLIER })

    expect(nearDuplicateOf(seam.store, NEAR, 'group:1')).toBeDefined()
    const merge = seam.write(NEAR, 'group:1', { importance: 80, at: NOW })
    const after = seam.store.byId(kept.id)

    expect(merge.merged).toBe(true)
    expect(merge.id).toBe(kept.id)
    expect(seam.store.all()).toHaveLength(1)
    expect(after?.text).toBe(OLD)
    expect(after?.importance).toBe(80)
    expect(after?.lastSeenAt).toBe(NOW)
    expect(after?.recallCount).toBe(0)
    expect(after?.metadata?.['mergedCount']).toBe(1)
  })

  it('合了几次看得出来', () => {
    const { seam } = mount({ file: tempFile() })
    const kept = seam.remember(OLD, 'group:1', { importance: 40, at: EARLIER })
    seam.write(NEAR, 'group:1', { at: NOW })
    seam.write(OLD, 'group:1', { at: NOW + 1 })

    expect(seam.store.byId(kept.id)?.metadata?.['mergedCount']).toBe(2)
  })

  it('差得远的两条各存一条', () => {
    const { seam } = mount({ file: tempFile() })

    const first = seam.write(OLD, 'group:1', { at: EARLIER })
    const second = seam.write(FAR, 'group:1', { at: NOW })

    expect(first.merged).toBe(false)
    expect(second.merged).toBe(false)
    expect(seam.store.all()).toHaveLength(2)
  })

  it('不同 scope 不合并', () => {
    const { seam } = mount({ file: tempFile() })
    const kept = seam.remember(OLD, 'group:1', { at: EARLIER })

    const other = seam.write(NEAR, 'group:2', { at: NOW })

    expect(other.merged).toBe(false)
    expect(other.id).not.toBe(kept.id)
    expect(seam.store.all()).toHaveLength(2)
  })

  it('退役的条目不参与合并', () => {
    const { seam } = mount({ file: tempFile() })
    const gone = seam.remember(OLD, 'group:1', { at: EARLIER })
    seam.store.update(gone.id, { text: '', clarity: 'forgotten', state: 'forgotten', retiredAt: EARLIER })

    const written = seam.write(NEAR, 'group:1', { at: NOW })

    expect(written.merged).toBe(false)
    expect(written.id).not.toBe(gone.id)
  })

  it('门槛可以调紧到不合', () => {
    const { seam } = mount({ file: tempFile(), tuning: { nearDuplicateRatio: 1 } })
    seam.remember(OLD, 'group:1', { at: EARLIER })

    const written = seam.write(NEAR, 'group:1', { at: NOW })

    expect(written.merged).toBe(false)
    expect(seam.store.all()).toHaveLength(2)
  })
})

describe('健康一行里的待写入', () => {
  it('pending 跟着队列长度走，超阈值时行尾告警', () => {
    const tight = { ...DEFAULTS, pendingAlert: 1 }
    const { seam } = mount({ file: tempFile(), tuning: { pendingAlert: 1 } })
    seam.enqueue('排在第一的一句', 'group:1')
    seam.enqueue('排在第二的一句', 'group:1')

    const line = lineOf(seam, seam.pending(), tight)

    expect(line).toContain('pending=2')
    expect(line.endsWith('alert=pending')).toBe(true)

    seam.flushQueue(NOW)
    const after = lineOf(seam, seam.pending(), tight)

    expect(after).toContain('pending=0')
    expect(after).not.toContain('alert=')
  })

  it('排空写不进去时，每日那一行把积压显出来', () => {
    const { seam } = mount({ file: tempFile(), tuning: { pendingAlert: 0 } })
    // 空键的 metadata 过不了写入校验，这一条排空时失败，就留在队列里
    seam.enqueue('排空写不进去的一句', 'group:1', { metadata: { '': '空键写不进去' } })

    const kept = seam.maintain(NOW)

    expect(kept.line).toContain('pending=1')
    expect(kept.line.endsWith('alert=pending')).toBe(true)
    expect(seam.store.all()).toHaveLength(0)
  })

  it('排空成功之后那一行归零', () => {
    const { seam } = mount({ file: tempFile() })
    seam.enqueue('这一条排空能写进去', 'group:1')

    const kept = seam.maintain(NOW)

    expect(kept.line).toContain('pending=0')
    expect(seam.store.all()).toHaveLength(1)
  })
})
