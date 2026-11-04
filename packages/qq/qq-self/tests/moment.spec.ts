import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, compressMoment, momentPort, qqSelfOf, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-moment-'))
  roots.push(root)
  return path.join(root, 'self')
}

async function mount(dir: string): Promise<QqSelfSeam> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { enabled: true, dir, mainChatKey: 'group:1' })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return seam
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('压句', () => {
  it('取第一行，后面的行不进面板', () => {
    expect(compressMoment('嗓子发干。\n身体：想喝水。')).toBe('嗓子发干。')
    expect(compressMoment('\n\n  嗓子发干。  \n后面那行')).toBe('嗓子发干。')
  })

  it('去掉括号与编号', () => {
    expect(compressMoment('【你现在的神经状态（只用来决定语气）】\n你有点渴')).toBe('你现在的神经状态')
    expect(compressMoment('2、把话说短一点\n后面那行')).toBe('把话说短一点')
    expect(compressMoment('3. 身上沉(眼皮抬不起来)')).toBe('身上沉')
  })

  it('超长就截断，不丢整行', () => {
    expect(compressMoment('长'.repeat(200), 10)).toBe('长'.repeat(10))
    expect(compressMoment('长'.repeat(200)).length).toBe(120)
  })

  it('一行都没有就是空串', () => {
    expect(compressMoment('   \n  \n')).toBe('')
    expect(compressMoment('（只有括号里的说明）')).toBe('')
  })

  it('接上身体以后面板的此刻是压过的一句', async () => {
    const seam = await mount(tempDir())
    seam.useVitals(momentPort({ render: () => '【你现在的神经状态（只用来决定语气）】\n你有点渴，想喝点凉的。' }))

    const lines = seam.panel().split('\n')

    expect(lines[1]).toBe('此刻：你现在的神经状态')
    expect(lines).toHaveLength(3)
    expect(seam.panel().length).toBeLessThanOrEqual(300)
  })

  it('身体给太长也压到上限以内，此刻那一行不整行丢', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    seam.useVitals(momentPort({ render: () => `${'长'.repeat(200)}\n第二行` }))

    const text = seam.panel()

    expect(text).toContain('此刻：')
    expect(text.split('\n')[1]?.length).toBe('此刻：'.length + 120)
    expect(text.length).toBeLessThanOrEqual(300)
  })
})
