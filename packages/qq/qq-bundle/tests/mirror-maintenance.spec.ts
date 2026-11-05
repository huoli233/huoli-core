import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyMemory, qqMemoryOf, type QqMemorySeam } from '@huoli/huoli-qq-memory'
import { apply as applySelf, auditLedger, DEFAULTS, qqSelfOf, type QqSelfSeam } from '@huoli/huoli-qq-self'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-maintenance-'))
  roots.push(root)
  return root
}

interface Mounted {
  ctx: Context
  memory: QqMemorySeam
  self: QqSelfSeam
}

// 配置里那几条路径都落在临时目录，别去碰主目录那一份
function bundleConfig(dir: string) {
  return {
    maxSteps: 5,
    dailySweepAt: '04:00',
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    maintenanceLogFile: path.join(dir, 'maintenance.log'),
  }
}

// 装配顺序与正式一致：记忆在前，自我层在后，组合包最后接上
async function mount(dir: string, withBundle = true): Promise<Mounted> {
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
    queueFile: path.join(dir, 'queue.json'),
  })
  applySelf(ctx, { enabled: true, dir: path.join(dir, 'self'), mainChatKey: 'group:1' })
  if (withBundle) applyBundle(ctx, bundleConfig(dir))
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

// 读维护日志的全文
function readLog(dir: string): string {
  const file = path.join(dir, 'maintenance.log')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

// 把钟拨到整理前一小时，再挂组合包，下一次整点检查就落在整理那一小时
function sweepNow(dir: string, ctx: Context): void {
  vi.useFakeTimers({ now: new Date(2026, 10, 3, 3, 30, 0).getTime() })
  applyBundle(ctx, bundleConfig(dir))
  vi.advanceTimersByTime(60 * 60_000)
}

const AT = new Date(2026, 10, 3, 21, 0).getTime()
const NOW = new Date(2026, 10, 4, 4, 0).getTime()
const DAY = 24 * 60 * 60 * 1000
const AUDIT = { failedWindowMs: DEFAULTS.auditFailedWindowMs }

afterEach(() => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('镜像的证据回查', () => {
  it('证据里的编号查不到就跳过并计数，记忆里一条都不多', async () => {
    const dir = tempDir()
    const { memory, self } = await mount(dir)
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: '夜里那句话是她说给自己听的', evidence: ['没有这个编号'] }])

    const kept = self.mirror(AT)

    expect(kept).toMatchObject({ written: 0, unverified: 1 })
    expect(memory.store.all()).toHaveLength(0)
  })

  it('证据是库里真有的编号就照写，不换也不补', async () => {
    const dir = tempDir()
    const { memory, self } = await mount(dir)
    const anchor = memory.remember('她说过一句话', 'group:1', { at: AT - DAY })
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: '夜里那句话是她说给自己听的', evidence: [anchor.id] }])

    const kept = self.mirror(AT)

    expect(kept).toMatchObject({ written: 1, unverified: 0 })
    const mirrored = memory.store.all().find(item => item.source === 'self')
    expect(mirrored?.metadata?.evidence).toEqual([anchor.id])
  })

  it('日期只查格式，认不出的日子也算查不到', async () => {
    const dir = tempDir()
    const { memory, self } = await mount(dir)
    writeRows(dir, 'claims.jsonl', [
      { at: AT, id: 'c1', text: '这条挂着一个不存在的日子', evidence: ['2026-13-40'] },
      { at: AT, id: 'c2', text: '这条挂着一个真日子', evidence: ['2026-11-02'] },
    ])

    const kept = self.mirror(AT)

    expect(kept).toMatchObject({ written: 1, unverified: 1 })
    expect(memory.store.all()).toHaveLength(1)
  })
})

describe('镜像的长文拆分', () => {
  it('超过上限的行拆成几条，序号接着来源键', async () => {
    const dir = tempDir()
    const { memory, self } = await mount(dir)
    const long = '长'.repeat(1200)
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: long, evidence: ['2026-11-02'] }])

    const kept = self.mirror(AT)

    expect(kept).toMatchObject({ written: 3, split: 1, skipped: 0 })
    const items = memory.store.all()
    expect(items.map(item => item.metadata?.self_id)).toEqual(['claims.jsonl#1-1', 'claims.jsonl#1-2', 'claims.jsonl#1-3'])
    expect(items.every(item => item.text.length <= DEFAULTS.mirrorMaxChars)).toBe(true)
    expect(items.map(item => item.text).join('')).toBe(long)
  })

  it('拆开写进去的几条，账本核得过，再镜一次也不多写', async () => {
    const dir = tempDir()
    const { memory, self } = await mount(dir)
    writeRows(dir, 'commitments.jsonl', [{ at: AT, id: 'k1', text: '长'.repeat(700) }])

    self.mirror(AT)
    memory.ledger('sync')
    const again = self.mirror(AT + 60_000)

    expect(again.written).toBe(0)
    expect(memory.store.all()).toHaveLength(2)
    expect(memory.ledger('verify').report.ok).toBe(true)
  })
})

describe('每日维护的日志', () => {
  it('镜像前后各核一次，两次条数都写进当日维护日志', async () => {
    const dir = tempDir()
    const { ctx, memory } = await mount(dir, false)
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: '夜里那句话是她说给自己听的', evidence: ['2026-11-02'] }])

    sweepNow(dir, ctx)

    const log = readLog(dir)
    expect(log).toContain('镜像前 0 条一致')
    expect(log).toContain('镜像后 1 条一致')
    expect(memory.store.all()).toHaveLength(1)
    expect(memory.ledger('verify').report.ok).toBe(true)
  })

  it('判据三与判据四的违规也写进这一行', async () => {
    const dir = tempDir()
    const { ctx } = await mount(dir, false)
    writeRows(dir, 'ledger.jsonl', [
      { at: AT - 30 * DAY, id: 'a1', kind: 'agency', project_id: 'p1', verbatim: '把周报写成一句', because: '拖着没做完', fail_if: '两周没动', outcome: 'done', artifact: '' },
    ])

    sweepNow(dir, ctx)

    const log = readLog(dir)
    expect(log).toContain('镜像前')
    expect(log).toContain('判据三')
    expect(log).toContain('判据四')
  })
})

describe('账本判据三四', () => {
  it('判据三：done 多过有产出的条数就报一条', () => {
    const rows = [
      { at: AT, kind: 'agency', outcome: 'done', artifact: '' },
      { at: AT, kind: 'agency', outcome: 'done', artifact: 'reports/week.md' },
      { at: AT, kind: 'agency', outcome: 'failed', because: '挑错了做法', fail_if: '两周没动', artifact: '' },
    ]

    const violations = auditLedger(rows, NOW, AUDIT)

    expect(violations.map(one => one.rule)).toEqual(['done_without_artifact'])
    expect(violations[0]?.count).toBe(1)
  })

  it('判据三：done 都有产出就一条不报', () => {
    const rows = [
      { at: AT, kind: 'agency', outcome: 'done', artifact: 'reports/week.md' },
      { at: AT, kind: 'agency', outcome: 'dropped', artifact: '' },
      { at: AT, kind: 'agency', outcome: 'failed', because: '挑错了做法', fail_if: '两周没动', artifact: '' },
    ]

    expect(auditLedger(rows, NOW, AUDIT)).toEqual([])
  })

  it('判据四：两周里一条失败都没有就报一条', () => {
    const rows = [{ at: NOW - 30 * DAY, kind: 'agency', outcome: 'dropped', artifact: '' }]

    const violations = auditLedger(rows, NOW, AUDIT)

    expect(violations.map(one => one.rule)).toEqual(['no_recent_failed'])
  })

  it('判据四：两周里有一次写清理由的失败就不报', () => {
    const rows = [
      { at: NOW - 3 * DAY, kind: 'agency', outcome: 'failed', because: '挑错了做法', fail_if: '两周没动', artifact: '' },
    ]

    expect(auditLedger(rows, NOW, AUDIT)).toEqual([])
  })

  it('空账一条都不报', () => {
    expect(auditLedger([], NOW, AUDIT)).toEqual([])
  })
})
