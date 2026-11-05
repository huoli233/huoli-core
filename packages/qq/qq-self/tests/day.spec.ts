import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []
const AT = new Date(2026, 10, 3, 21, 0).getTime()
const NEXT_DAY = AT + 24 * 60 * 60 * 1000

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-day-'))
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

describe('每天三行', () => {
  it('正好三行才落一条', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.recordDay(['今天把周报写成了一句', '夜里那句话没说完', '明天先列三条'], AT))
      .toEqual({ written: true, proposed: false })

    const kept = rows(dir, 'day.jsonl')
    expect(kept).toHaveLength(1)
    expect(kept[0]?.lines).toEqual(['今天把周报写成了一句', '夜里那句话没说完', '明天先列三条'])
    expect(kept[0]?.skipped).toBe(false)
    expect(kept[0]?.why).toBe('')
    expect(kept[0]?.at).toBe(AT)
    expect(typeof kept[0]?.id).toBe('string')
  })

  it('两行或四行都不写', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.recordDay(['一行', '两行'], AT)).toEqual({ written: false, proposed: false, reason: 'bad_lines' })
    expect(seam.recordDay(['一', '二', '三', '四'], AT)).toEqual({ written: false, proposed: false, reason: 'bad_lines' })
    expect(seam.recordDay(['一', '  ', '三'], AT)).toEqual({ written: false, proposed: false, reason: 'bad_lines' })
    expect(fs.existsSync(path.join(dir, 'day.jsonl'))).toBe(false)
  })

  it('一天只有一条，同一天再写就跳过', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordDay(['一', '二', '三'], AT)
    const again = seam.recordDay(['一', '二', '三'], AT + 60_000)

    expect(again).toEqual({ written: false, proposed: false, reason: 'duplicate' })
    expect(rows(dir, 'day.jsonl')).toHaveLength(1)
  })

  it('换一天就能再写一条', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordDay(['一', '二', '三'], AT)
    expect(seam.recordDay(['四', '五', '六'], NEXT_DAY)).toEqual({ written: true, proposed: false })

    expect(rows(dir, 'day.jsonl')).toHaveLength(2)
  })

  it('跳过那天也落一条，写清为什么', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.skipDay('那天在赶工，不想为了打卡硬写', AT)).toEqual({ written: true, proposed: false })

    const kept = rows(dir, 'day.jsonl')
    expect(kept).toHaveLength(1)
    expect(kept[0]?.skipped).toBe(true)
    expect(kept[0]?.why).toBe('那天在赶工，不想为了打卡硬写')
    expect(kept[0]?.lines).toEqual(['', '', ''])
  })

  it('跳过也要写原因，空着不落盘', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.skipDay('   ', AT)).toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(fs.existsSync(path.join(dir, 'day.jsonl'))).toBe(false)
  })

  it('跳过以后再补三行也不行，一天只留一条', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.skipDay('那天在赶工', AT)

    expect(seam.recordDay(['一', '二', '三'], AT)).toEqual({ written: false, proposed: false, reason: 'duplicate' })
  })

  it('行太长就截断', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordDay(['长'.repeat(200), '二', '三'], AT)

    const kept = rows(dir, 'day.jsonl')
    expect(String((kept[0]?.lines as string[])[0]).length).toBe(60)
  })

  it('PAUSE 时三行也只提议', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'PAUSE'), '')

    expect(seam.recordDay(['一', '二', '三'], AT)).toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(seam.skipDay('今天跳过', AT)).toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(fs.existsSync(path.join(dir, 'day.jsonl'))).toBe(false)
  })

  it('坏行不挡下一次写入', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'day.jsonl'), '这不是一行 JSON\n')

    expect(seam.recordDay(['一', '二', '三'], AT)).toEqual({ written: true, proposed: false })

    const kept = fs.readFileSync(path.join(dir, 'day.jsonl'), 'utf8')
      .split('\n')
      .filter(line => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>]
        } catch {
          return []
        }
      })
    expect(kept).toHaveLength(1)
    expect(kept[0]?.lines).toEqual(['一', '二', '三'])
  })
})
