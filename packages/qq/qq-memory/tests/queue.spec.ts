import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupTempDirs, mount, queueBeside, tempFile } from './harness.ts'

const AT = new Date(2026, 10, 4, 20, 0).getTime()

afterEach(cleanupTempDirs)

// 排空过就会在队列文件上留下这个记号，没排空它一动不动
function lastFlushedAt(file: string): number {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { lastFlushedAt?: number }
  return raw.lastFlushedAt ?? 0
}

describe('队列节拍', () => {
  it('每四轮排空一次', () => {
    const { seam } = mount({ file: tempFile() })
    seam.enqueue('今天下午去河边走了走', 'group:1')

    const written = [1, 2, 3, 4].map(turn => seam.tick(AT + turn * 1000).written)

    expect(written).toEqual([0, 0, 0, 1])
    expect(seam.pending()).toBe(0)
  })

  it('第二段攒下的事到第八轮再排一次，中间的轮次一条都不动', () => {
    const { seam } = mount({ file: tempFile() })
    seam.enqueue('今天下午去河边走了走', 'group:1')

    const outcomes = Array.from({ length: 8 }, (_, index) => {
      if (index === 4) seam.enqueue('晚上那碗面有点咸', 'group:1')
      return seam.tick(AT + (index + 1) * 1000)
    })

    expect(outcomes.map(outcome => outcome.written)).toEqual([0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('每十轮反思一次，合成的只有一条', () => {
    const { seam } = mount({ file: tempFile() })
    seam.enqueue('今天下午去河边走了走', 'group:1')
    seam.enqueue('晚上那碗面有点咸', 'group:1')

    const outcomes = Array.from({ length: 10 }, (_, index) => seam.tick(AT + (index + 1) * 1000))

    expect(outcomes.map(outcome => outcome.turns)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(outcomes.filter(outcome => outcome.reflected !== '')).toHaveLength(1)
    expect(outcomes[9]?.reflected).not.toBe('')
  })

  it('每日整理刚排过，这一轮的排空不再走一遍', () => {
    const file = tempFile()
    const { seam } = mount({ file })
    seam.enqueue('今天下午去河边走了走', 'group:1')
    seam.maintain(AT)
    const flushedAt = lastFlushedAt(queueBeside(file))

    const written = [1, 2, 3, 4].map(turn => seam.tick(AT + turn * 1000).written)

    expect(written).toEqual([0, 0, 0, 0])
    expect(lastFlushedAt(queueBeside(file))).toBe(flushedAt)
    expect(seam.pending()).toBe(0)
  })

  it('每日整理之后又攒下的事，到点照样排空', () => {
    const file = tempFile()
    const { seam } = mount({ file })
    seam.maintain(AT)
    seam.enqueue('下午在河边看见一只白鹭', 'group:1')

    const written = [1, 2, 3, 4].map(turn => seam.tick(AT + turn * 1000).written)

    expect(written).toEqual([0, 0, 0, 1])
  })
})
