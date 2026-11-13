import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyMemory, qqMemoryOf, type QqMemorySeam } from '@huoli/huoli-qq-memory'
import { apply as applySelf, qqSelfOf, type QqSelfSeam } from '@huoli/huoli-qq-self'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-mirror-'))
  roots.push(root)
  return root
}

interface Mounted {
  ctx: Context
  memory: QqMemorySeam
  self: QqSelfSeam
}

// 装配顺序与正式一致：记忆在前，自我层在后，组合包最后接上
async function mount(dir: string, selfEnabled: boolean, withBundle = true): Promise<Mounted> {
  const ctx = new Context()
  ctx.accessor('tools', {
    get: () => ({
      register: () => () => {},
    }),
  })
  await ctx.plugin(SystemPrompt, {})
  applyMemory(ctx, {
    file: path.join(dir, 'memory.json'),
    ledgerFile: path.join(dir, 'ledger-book.json'),
    healthLogFile: path.join(dir, 'health.log'),
  })
  applySelf(ctx, { enabled: selfEnabled, dir: path.join(dir, 'self'), mainChatKey: 'group:1' })
  if (withBundle) applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-dec-')), 'decisions.jsonl') })
  const memory = qqMemoryOf(ctx)
  const self = qqSelfOf(ctx)
  if (memory === undefined || self === undefined) throw new Error('零件没有装配')
  return { ctx, memory, self }
}

// 往自我层目录里写一份事件流
function writeRows(dir: string, name: string, rows: readonly object[]): void {
  const selfDir = path.join(dir, 'self')
  fs.mkdirSync(selfDir, { recursive: true })
  fs.writeFileSync(path.join(selfDir, name), rows.map(row => `${JSON.stringify(row)}\n`).join(''))
}

const AT = new Date(2026, 10, 3, 21, 0).getTime()

afterEach(() => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('镜像接进了记忆库', () => {
  it('镜像之后能按关键词找回，来历与重要度都对', async () => {
    const dir = tempDir()
    const { memory, self } = await mount(dir, true)
    writeRows(dir, 'claims.jsonl', [
      { at: AT, id: 'c1', text: '周五爬山那次她更想待在家里', confidence: 0.7, evidence: ['2026-11-02'] },
    ])

    const kept = self.mirror(AT)

    expect(kept.written).toBe(1)
    const items = memory.store.all()
    expect(items).toHaveLength(1)
    expect(items[0]?.source).toBe('self')
    expect(items[0]?.importance).toBeGreaterThanOrEqual(80)
    expect(Object.keys(items[0]?.metadata ?? {})).toHaveLength(4)
    expect(memory.find('爬山', 'group:1')).toHaveLength(1)
  })

  it('同一批再镜一次，记忆里还是只有一条', async () => {
    const dir = tempDir()
    const { memory, self } = await mount(dir, true)
    writeRows(dir, 'commitments.jsonl', [{ at: AT, id: 'k1', text: '周末把歌单给她', due_at: 0 }])

    self.mirror(AT)
    const again = self.mirror(AT + 60_000)

    expect(again.written).toBe(0)
    expect(memory.store.all()).toHaveLength(1)
  })

  it('默认关闭时记忆里一条也不多', async () => {
    const dir = tempDir()
    const { memory, self } = await mount(dir, false)
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: '周五爬山那次她更想待在家里' }])

    const kept = self.mirror(AT)

    expect(kept).toMatchObject({ written: 0, reason: 'disabled' })
    expect(memory.store.all()).toHaveLength(0)
  })

  it('每天整理那一步会把镜像带上，并且立刻记进记录表', async () => {
    const dir = tempDir()
    const { ctx, memory, self } = await mount(dir, true, false)
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: '周五爬山那次她更想待在家里' }])
    // 钟拨到整理前半小时，组合包在这一刻挂上，下一次整点检查就落在四点
    vi.useFakeTimers({ now: new Date(2026, 10, 3, 3, 30, 0).getTime() })
    applyBundle(ctx, {
      maxSteps: 5,
      dailySweepAt: '04:00',
      decisionsFile: path.join(dir, 'decisions.jsonl'),
      maintenanceLogFile: path.join(dir, 'maintenance.log'),
    })

    vi.advanceTimersByTime(60 * 60_000)

    expect(memory.store.all().filter(item => item.source === 'self')).toHaveLength(1)
    expect(self.mirror(AT).written).toBe(0)
    expect(memory.ledger('verify').report.ok).toBe(true)
  })
})
