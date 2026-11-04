import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf, requireKeys, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-'))
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

function keyRows(dir: string): Record<string, unknown>[] {
  const file = path.join(dir, 'keys.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('两把钥匙', () => {
  it('只有用户那把不放行', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    const outcome = seam.requireKeys('memory.delete', true, false, Date.now())

    expect(outcome.allowed).toBe(false)
    expect(outcome.reason).toBe('self_key')
    expect(keyRows(dir)).toHaveLength(0)
  })

  it('只有她自己那把也不放行', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    const outcome = seam.requireKeys('memory.delete', false, true, Date.now())

    expect(outcome.allowed).toBe(false)
    expect(outcome.reason).toBe('user_key')
    expect(keyRows(dir)).toHaveLength(0)
  })

  it('两把都在就放行并留一行痕', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    const outcome = seam.requireKeys('identity.constitution', true, true, now)
    const rows = keyRows(dir)

    expect(outcome.allowed).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.action).toBe('identity.constitution')
    expect(rows[0]?.user_ok).toBe(true)
    expect(rows[0]?.self_ok).toBe(true)
    expect(rows[0]?.at).toBe(now)
    expect(typeof rows[0]?.id).toBe('string')
  })

  it('不给时刻就按当下记', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    const outcome = seam.requireKeys('memory.delete', true, true)
    const rows = keyRows(dir)

    expect(outcome.allowed).toBe(true)
    expect(rows).toHaveLength(1)
    expect(typeof rows[0]?.at).toBe('number')
    expect(Number(rows[0]?.at)).toBeGreaterThan(0)
  })

  it('清单外的动作两把都在也不放行', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    const outcome = seam.requireKeys('chat.smallTalk', true, true, Date.now())

    expect(outcome.allowed).toBe(false)
    expect(outcome.reason).toBe('unknown_action')
    expect(keyRows(dir)).toHaveLength(0)
  })

  it('清单按逐字匹配，差一个字也不算', () => {
    expect(requireKeys('identity.constitution', true, true).allowed).toBe(true)
    expect(requireKeys('identity.constitutions', true, true).reason).toBe('unknown_action')
    expect(requireKeys('memory.delete ', true, true).reason).toBe('unknown_action')
  })

  it('纯函数只判级，不落盘', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(requireKeys('money.spend', true, true).allowed).toBe(true)
    expect(seam.isPaused()).toBe(false)
    expect(fs.existsSync(path.join(dir, 'keys.jsonl'))).toBe(false)
  })

  it('PAUSE 时放行但只算提议', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'PAUSE'), '')

    const outcome = seam.requireKeys('public.say', true, true, Date.now())

    expect(outcome.allowed).toBe(true)
    expect(outcome.proposed).toBe(true)
    expect(keyRows(dir)).toHaveLength(0)
  })
})
