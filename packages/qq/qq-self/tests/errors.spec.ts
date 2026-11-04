import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []
const AT = new Date(2026, 10, 3, 21, 0).getTime()

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-errors-'))
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

function rows(dir: string, name: string): Record<string, unknown>[] {
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('错题本', () => {
  it('错在哪与怎么改都写了才落一条', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.recordError('把她的沉默当成同意', '下一次先问一句再动手', AT))
      .toEqual({ written: true, proposed: false })

    const kept = rows(dir, 'errors.jsonl')
    expect(kept).toHaveLength(1)
    expect(kept[0]?.text).toBe('把她的沉默当成同意')
    expect(kept[0]?.fix).toBe('下一次先问一句再动手')
    expect(kept[0]?.at).toBe(AT)
    expect(typeof kept[0]?.id).toBe('string')
  })

  it('缺一句就不写', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.recordError('  ', '下次先问一句', AT)).toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(seam.recordError('把沉默当成同意', '   ', AT)).toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(fs.existsSync(path.join(dir, 'errors.jsonl'))).toBe(false)
  })

  it('读回来按时间先后，能被起点筛掉', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordError('后写的那条', '改法二', AT)
    seam.recordError('先写的那条', '改法一', AT - 60_000)

    const all = seam.errors()
    expect(all.map(row => row.text)).toEqual(['先写的那条', '后写的那条'])

    const recent = seam.errors(AT - 30_000)
    expect(recent.map(row => row.text)).toEqual(['后写的那条'])
  })

  it('太长就截断', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordError('错'.repeat(300), '改'.repeat(300), AT)

    const kept = rows(dir, 'errors.jsonl')
    expect(String(kept[0]?.text).length).toBe(200)
    expect(String(kept[0]?.fix).length).toBe(200)
  })

  it('坏行跳过，别的照样读得回来', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'errors.jsonl'), '这不是一行 JSON\n')
    fs.appendFileSync(path.join(dir, 'errors.jsonl'), `${JSON.stringify({ at: 1, id: 'x' })}\n`)
    seam.recordError('把沉默当成同意', '先问一句', AT)

    expect(seam.errors().map(row => row.fix)).toEqual(['先问一句'])
  })

  it('PAUSE 时也只提议', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'PAUSE'), '')

    expect(seam.recordError('把沉默当成同意', '先问一句', AT))
      .toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(seam.errors()).toEqual([])
  })
})
