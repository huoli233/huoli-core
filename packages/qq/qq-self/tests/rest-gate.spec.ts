import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-rest-'))
  roots.push(root)
  return path.join(root, 'self')
}

interface Mounted {
  seam: QqSelfSeam
  dir: string
}

// 接上一个只会报读数的假身体：电量与困倦由用例直接给
async function mount(body: { energy?: number; adenosine?: number } | undefined): Promise<Mounted> {
  const dir = tempDir()
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  ctx.provide('tools', { register: () => () => {} })
  apply(ctx, { enabled: true, dir, mainChatKey: 'group:1' })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  if (body !== undefined) seam.useVitals({ render: () => '此刻还行', read: () => body })
  return { seam, dir }
}

function keyRows(dir: string): Record<string, unknown>[] {
  const file = path.join(dir, 'keys.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as Record<string, unknown>)
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('累了不做身份级决定', () => {
  it('电量见底时两把钥匙都给也不放行', async () => {
    const { seam, dir } = await mount({ energy: 0.05 })

    const outcome = seam.requireKeys('memory.delete', true, true, Date.now())

    expect(outcome.allowed).toBe(false)
    expect(outcome.reason).toBe('rest')
    expect(keyRows(dir)).toHaveLength(0)
  })

  it('困到线以上同样不放行', async () => {
    const { seam } = await mount({ energy: 0.9, adenosine: 0.95 })

    expect(seam.requireKeys('money.spend', true, true, Date.now()).reason).toBe('rest')
  })

  it('歇过来就照常判，钥匙不全还是按钥匙拒', async () => {
    const { seam } = await mount({ energy: 0.8, adenosine: 0.1 })

    expect(seam.requireKeys('memory.delete', true, true, Date.now()).allowed).toBe(true)
    expect(seam.requireKeys('memory.delete', true, false, Date.now()).reason).toBe('self_key')
  })

  it('身体没接上时不拦，免得整层卡死', async () => {
    const { seam } = await mount(undefined)

    expect(seam.requireKeys('memory.delete', true, true, Date.now()).allowed).toBe(true)
  })

  it('累了也不写叙事大改', async () => {
    const { seam } = await mount({ energy: 0.02 })

    const outcome = seam.updateNarrative('身份', '这一段想改', 'replace')

    expect(outcome.written).toBe(false)
    expect(outcome.reason).toBe('rest')
  })
})
