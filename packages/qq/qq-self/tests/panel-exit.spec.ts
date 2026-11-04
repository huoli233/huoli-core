import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, panelBody, panelStamp, qqSelfOf, type Config, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []
const SENTINEL = '【自我】\n此刻：别人写进去的那一句\n我可以说不，也可以说不知道。'

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-exit-'))
  roots.push(root)
  return path.join(root, 'self')
}

async function mount(config: Config): Promise<QqSelfSeam> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, config)
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return seam
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('面板出口', () => {
  it('还没生成过面板就什么都不给', async () => {
    const seam = await mount({ enabled: true, dir: tempDir(), mainChatKey: 'group:1' })

    expect(seam.panelText('group:1')).toBe('')
    expect(seam.panelGeneratedAt('group:1')).toBe('')
  })

  it('只读缓存文件，不重算也不改文件', async () => {
    const dir = tempDir()
    const seam = await mount({ enabled: true, dir, mainChatKey: 'group:1' })
    seam.panel()
    const file = path.join(dir, 'panel.md')
    fs.writeFileSync(file, `<!-- generated_at: 2026-01-02T03:04:05.000Z -->\n${SENTINEL}\n`)
    const before = fs.readFileSync(file, 'utf8')
    const stamp = fs.statSync(file).mtimeMs

    expect(seam.panelText('group:1')).toBe(SENTINEL)
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
    expect(fs.statSync(file).mtimeMs).toBe(stamp)
  })

  it('生成时间就是首行那句', async () => {
    const dir = tempDir()
    const seam = await mount({ enabled: true, dir, mainChatKey: 'group:1' })
    const body = seam.panel()

    const raw = fs.readFileSync(path.join(dir, 'panel.md'), 'utf8')
    const generated = seam.panelGeneratedAt('group:1')

    expect(generated).toBe(panelStamp(raw))
    expect(Number.isNaN(Date.parse(generated))).toBe(false)
    expect(Date.now() - Date.parse(generated)).toBeLessThan(60_000)
    expect(panelBody(raw)).toBe(body)
  })

  it('首行没记时间就给空串', async () => {
    const dir = tempDir()
    const seam = await mount({ enabled: true, dir, mainChatKey: 'group:1' })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'panel.md'), `<!-- 没有生成时间 -->\n${SENTINEL}\n`)

    expect(seam.panelText('group:1')).toBe(SENTINEL)
    expect(seam.panelGeneratedAt('group:1')).toBe('')
  })

  it('别的会话从出口拿不到面板', async () => {
    const dir = tempDir()
    const seam = await mount({ enabled: true, dir, mainChatKey: 'group:1' })
    seam.panel()

    expect(seam.panelText('group:2')).toBe('')
    expect(seam.panelGeneratedAt('group:2')).toBe('')
  })

  it('没配主会话时不按会话过滤', async () => {
    const dir = tempDir()
    const seam = await mount({ enabled: true, dir })
    seam.panel()

    expect(seam.panelText('谁都能看')).toContain('【自我】')
    expect(seam.panelGeneratedAt('谁都能看')).not.toBe('')
  })

  it('关着的时候出口全空', async () => {
    const dir = tempDir()
    const seam = await mount({ enabled: false, dir, mainChatKey: 'group:1' })
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'panel.md'), `<!-- generated_at: 2026-01-02T03:04:05.000Z -->\n${SENTINEL}\n`)

    expect(seam.panelText('group:1')).toBe('')
    expect(seam.panelGeneratedAt('group:1')).toBe('')
  })
})
