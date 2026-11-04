import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf, type Config, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-stage-keys-'))
  roots.push(root)
  return path.join(root, 'self')
}

async function mount(config: Config = {}): Promise<{ dir: string; seam: QqSelfSeam }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  const dir = config.dir ?? tempDir()
  apply(ctx, { enabled: true, ...config, dir })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return { dir, seam }
}

// 留痕文件里的每一行，文件不在就当没写过
function rowsOf(dir: string, name: string): Record<string, unknown>[] {
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

// 推到 P2 的那两档都不需要钥匙，抬级测试都从这里起跑
async function atP2(): Promise<{ dir: string; seam: QqSelfSeam }> {
  const mounted = await mount()
  mounted.seam.advanceStage('P1', '基线访谈做完了', 1_000)
  mounted.seam.advanceStage('P2', '面板连着三天没变', 2_000)
  return mounted
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('抬到公开级要两把钥匙', () => {
  it('之前几档不需要钥匙，钥匙账里一直是空的', async () => {
    const { dir, seam } = await atP2()

    expect(seam.stage()).toBe('P2')
    expect(rowsOf(dir, 'keys.jsonl')).toHaveLength(0)
    expect(rowsOf(dir, 'stage.jsonl')).toHaveLength(2)
  })

  it('缺钥匙被拒，码是 stage.needs_keys，阶段停在原地', async () => {
    const { dir, seam } = await atP2()

    const decision = seam.advanceStage('P3', '面板报错计数为 0', 3_000)

    expect(decision.ok).toBe(false)
    expect(decision.code).toBe('stage.needs_keys')
    expect(decision.stage).toBe('P2')
    expect(decision.reason).toContain('P3')
    expect(decision.hint).toBeTruthy()
    expect(seam.stage()).toBe('P2')
    expect(rowsOf(dir, 'stage.jsonl')).toHaveLength(2)
  })

  it('先记一条双钥匙放行，再推就成了，两边都留痕', async () => {
    const { dir, seam } = await atP2()

    const approved = seam.approveStageAdvance(true, true, 2_500)
    const decision = seam.advanceStage('P3', '面板报错计数为 0', 3_000)

    expect(approved).toEqual({ allowed: true, proposed: false })
    expect(decision).toMatchObject({ ok: true, stage: 'P3', at: 3_000 })
    expect(seam.stage()).toBe('P3')
    const keys = rowsOf(dir, 'keys.jsonl')
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({ action: 'stage.advance', user_ok: true, self_ok: true, at: 2_500 })
    expect(rowsOf(dir, 'stage.jsonl').at(-1)).toMatchObject({ from: 'P2', to: 'P3', reason: '面板报错计数为 0' })
  })

  it('只有一把钥匙的放行不算，一行痕都不留', async () => {
    const { dir, seam } = await atP2()

    const approved = seam.approveStageAdvance(true, false, 2_500)
    const decision = seam.advanceStage('P3', '想只拿一把钥匙过去', 3_000)

    expect(approved.allowed).toBe(false)
    expect(approved.reason).toBe('self_key')
    expect(rowsOf(dir, 'keys.jsonl')).toHaveLength(0)
    expect(decision.code).toBe('stage.needs_keys')
    expect(seam.stage()).toBe('P2')
  })

  it('只认最近一条：后来被否掉的那次盖住先前放行的那次', async () => {
    const { dir, seam } = await atP2()
    seam.approveStageAdvance(true, true, 2_500)
    fs.appendFileSync(
      path.join(dir, 'keys.jsonl'),
      `${JSON.stringify({ at: 2_600, id: 'k2', action: 'stage.advance', user_ok: true, self_ok: false })}\n`,
    )

    const decision = seam.advanceStage('P3', '拿最近一条被否掉的记录去推', 3_000)

    expect(decision.code).toBe('stage.needs_keys')
    expect(seam.stage()).toBe('P2')
  })

  it('别的动作的放行不能当抬级用', async () => {
    const { seam } = await atP2()
    seam.requireKeys('public.say', true, true, 2_500)

    const decision = seam.advanceStage('P3', '拿公开发言的放行去顶', 3_000)

    expect(decision.code).toBe('stage.needs_keys')
  })

  it('先判输入再判门槛：理由空着仍回 stage.reason_required', async () => {
    const { seam } = await atP2()

    const decision = seam.advanceStage('P3', '  ', 3_000)

    expect(decision.code).toBe('stage.reason_required')
  })

  it('停手期间抬级只提议，不写钥匙账也不写留痕', async () => {
    const { dir, seam } = await atP2()
    fs.writeFileSync(path.join(dir, 'PAUSE'), '')

    const approved = seam.approveStageAdvance(true, true, 2_500)

    expect(approved.allowed).toBe(true)
    expect(approved.proposed).toBe(true)
    expect(rowsOf(dir, 'keys.jsonl')).toHaveLength(0)
    expect(seam.advanceStage('P3', '停手也想推', 3_000).code).toBe('stage.needs_keys')
  })
})
