import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, NARRATIVE_CHAPTERS, qqSelfOf, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-narrative-'))
  roots.push(root)
  return path.join(root, 'self')
}

async function mount(dir: string): Promise<QqSelfSeam> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  // 这一层的行为用例不靠工具跑，给一个空的登记口就够
  ctx.provide('tools', { register: () => () => {} })
  apply(ctx, { enabled: true, dir, mainChatKey: 'group:1' })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return seam
}

// 一章的正文，按空行切
function chapterOf(text: string, chapter: string): string[] {
  const section = text.split(/^## /mu).find(part => part.startsWith(`${chapter}\n`))
  if (section === undefined) return []
  return section.split('\n').slice(1).map(line => line.trim()).filter(line => line !== '')
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('叙事', () => {
  it('首次补一份五章骨架，之后不再重写', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.narrative()).toBe('')
    expect(seam.seedNarrative()).toEqual({ written: true, proposed: false })
    const first = seam.narrative()
    expect(first.split('\n').filter(line => line.startsWith('## '))).toEqual(NARRATIVE_CHAPTERS.map(chapter => `## ${chapter}`))

    expect(seam.seedNarrative()).toEqual({ written: false, proposed: false, reason: 'duplicate' })
    expect(seam.narrative()).toBe(first)
  })

  it('显式调用才换掉一章，别的章不动', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    seam.seedNarrative()
    seam.updateNarrative('我做过什么', '起过一次早', 'append')

    expect(seam.updateNarrative('我是谁', '我叫她别硬撑\n我也一样')).toEqual({ written: true, proposed: false })
    const text = seam.narrative()

    expect(chapterOf(text, '我是谁')).toEqual(['我叫她别硬撑', '我也一样'])
    expect(chapterOf(text, '我做过什么')).toEqual(['起过一次早'])
    expect(chapterOf(text, '我在意什么')).toEqual(['（待写）'])
  })

  it('追加接在后面，章内段数有上限', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.updateNarrative('我在意什么', '第一段')
    seam.updateNarrative('我在意什么', '第二段', 'append')
    seam.updateNarrative('我在意什么', '第三段', 'append')
    seam.updateNarrative('我在意什么', '第四段', 'append')

    expect(chapterOf(seam.narrative(), '我在意什么')).toEqual(['第二段', '第三段', '第四段'])
  })

  it('章名不对或正文空着都不落盘', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.updateNarrative('我吃过什么', '随便写')).toEqual({ written: false, proposed: false, reason: 'unknown_chapter' })
    expect(seam.updateNarrative('我是谁', '  ')).toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(seam.narrative()).toBe('')
  })

  it('段太长就截断', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.updateNarrative('我是谁', '我'.repeat(300))

    expect(chapterOf(seam.narrative(), '我是谁')[0]?.length).toBe(150)
  })

  it('PAUSE 时叙事也不动', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'PAUSE'), '')

    expect(seam.seedNarrative()).toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(seam.updateNarrative('我是谁', '我叫她别硬撑')).toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(seam.narrative()).toBe('')
  })
})
