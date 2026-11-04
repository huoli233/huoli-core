import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf, type DriveNeed, type QqSelfSeam } from '../src/index.ts'

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

function ledgerLines(dir: string): string[] {
  const file = path.join(dir, 'ledger.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim().length > 0)
}

function readRows(dir: string, name: string): Record<string, unknown>[] {
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

describe('两档账', () => {
  it('drive 与 agency 分开计数', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    seam.recordDrive('thirst', now, { did: '倒了杯水', resolved: true })
    seam.recordDrive('adenosine', now, { did: '趴了一会儿' })
    seam.recordAgency('p1', '想把夜里那句话记下来', now)

    const summary = seam.ledgerSummary(now)

    expect(summary.drive).toBe(2)
    expect(summary.agency).toBe(1)
  })

  it('每行的 kind 与字段各归各', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    seam.recordDrive('hunger', now, { did: '吃了半个面包', resolved: true })
    seam.recordAgency('p1', '想弄明白为什么夜里更想说话', now, { failIf: '三天没写下一条' })

    const rows = ledgerLines(dir).map(line => JSON.parse(line) as Record<string, unknown>)

    expect(rows.map(row => row.kind)).toEqual(['drive', 'agency'])
    expect(rows[0]?.need).toBe('hunger')
    expect(rows[0]?.resolved).toBe(true)
    expect(rows[1]?.because).toBe('想弄明白为什么夜里更想说话')
    expect(rows[1]?.fail_if).toBe('三天没写下一条')
    expect(rows[1]?.outcome).toBe('dropped')
    expect(rows[0]?.because).toBeUndefined()
  })

  it('七天内同一句原话只记一次', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    seam.recordAgency('p1', '想把夜里那句话记下来', now)
    const again = seam.recordAgency('p2', '想把夜里那句话记下来', now + 60_000)

    expect(again).toEqual({ written: false, proposed: false, reason: 'duplicate' })
    expect(ledgerLines(dir)).toHaveLength(1)
  })

  it('需要名不在四种里就丢弃', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    // 需要名可能从文件或工具那边来，进来先过一遍清单
    const unknown = 'sleepiness' as string as DriveNeed

    const outcome = seam.recordDrive(unknown, Date.now())

    expect(outcome).toEqual({ written: false, proposed: false, reason: 'unknown_need' })
    expect(ledgerLines(dir)).toHaveLength(0)
  })
})

describe('停手开关', () => {
  it('PAUSE 在的时候写入只提议，不落盘', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    seam.recordDrive('thirst', Date.now())
    const before = ledgerLines(dir).length
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'PAUSE'), '')

    const drive = seam.recordDrive('thirst', Date.now())
    const agency = seam.recordAgency('p1', '想把夜里那句话记下来', Date.now())

    expect(seam.isPaused()).toBe(true)
    expect(drive).toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(agency).toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(ledgerLines(dir)).toHaveLength(before)
  })

  it('PAUSE 不在的时候照常落盘', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.isPaused()).toBe(false)
    expect(seam.recordDrive('thirst', Date.now())).toEqual({ written: true, proposed: false })
    expect(ledgerLines(dir)).toHaveLength(1)
  })

  it('PAUSE 时项目与问句也只提议', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'PAUSE'), '')

    expect(seam.recordProject({ title: '把周报写成一句', next: '先列三条', failIf: '两周没动' }, Date.now()))
      .toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(seam.recordQuestion('为什么夜里更想说话', Date.now()))
      .toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(fs.existsSync(path.join(dir, 'projects.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'questions.jsonl'))).toBe(false)
    expect(seam.recordClaim({ text: '夜里她更想说话', confidence: 0.7, evidence: ['m1'] }, Date.now()))
      .toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(seam.recordCommitment({ text: '周末把歌单给她' }, Date.now()))
      .toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(seam.requireKeys('money.spend', true, true, Date.now())).toMatchObject({ allowed: true, proposed: true })
  })
})

describe('账本的写法', () => {
  it('原话太长就截断，字段不丢', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    seam.recordAgency('p1', '想'.repeat(200), now)

    const rows = readRows(dir, 'ledger.jsonl')

    expect(String(rows[0]?.verbatim).length).toBe(60)
    expect(rows[0]?.because).toBe('想'.repeat(60))
  })

  it('drive 与 agency 混在一份文件里也分得清', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    seam.recordDrive('thirst', now)
    seam.recordAgency('p1', '想把夜里那句话记下来', now)
    fs.appendFileSync(path.join(dir, 'ledger.jsonl'), `${JSON.stringify({ at: now, id: 'x', kind: 'note' })}\n`)
    fs.appendFileSync(path.join(dir, 'ledger.jsonl'), `${JSON.stringify({ at: 1, id: 'y', kind: 'agency', outcome: 'done' })}\n`)
    fs.appendFileSync(path.join(dir, 'ledger.jsonl'), `${JSON.stringify({ kind: 'agency', verbatim: '另一句原话' })}\n`)

    const summary = seam.ledgerSummary(now)

    expect(summary.drive).toBe(1)
    expect(summary.agency).toBe(3)
    expect(summary.recentAgency).toBe(1)
    expect(seam.recordAgency('p2', '另一句原话', now)).toEqual({ written: true, proposed: false })
    expect(seam.recordAgency('p3', '再换一句原话', now, { outcome: 'failed', failIf: '三天没写下一条', artifact: 'notes/a.md' }))
      .toMatchObject({ written: true, proposed: false })
    const last = readRows(dir, 'ledger.jsonl').at(-1)
    expect(last?.outcome).toBe('failed')
    expect(last?.artifact).toBe('notes/a.md')
  })
})

describe('其它几份记录', () => {
  it('一条相信的事要带证据', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    expect(seam.recordClaim({ text: '夜里她更想说话', confidence: 0.7, evidence: [] }, now))
      .toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(seam.recordClaim({ text: '夜里她更想说话', confidence: 0.7, evidence: ['m1', 'm2'] }, now))
      .toEqual({ written: true, proposed: false })

    const rows = readRows(dir, 'claims.jsonl')

    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).toBe('夜里她更想说话')
    expect(rows[0]?.evidence).toEqual(['m1', 'm2'])
    expect(rows[0]?.counter).toBe('')
  })

  it('空正文的承诺不落盘', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    expect(seam.recordCommitment({ text: '   ' }, now)).toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(seam.recordCommitment({ text: '周末把歌单给她' }, now)).toEqual({ written: true, proposed: false })
    expect(seam.recordCommitment({ text: '下次换个说法', dueAt: now + 86_400_000 }, now))
      .toEqual({ written: true, proposed: false })

    const rows = readRows(dir, 'commitments.jsonl')

    expect(rows[0]?.text).toBe('周末把歌单给她')
    expect(rows[0]?.due_at).toBe(0)
    expect(rows[1]?.due_at).toBe(now + 86_400_000)
  })

  it('空正文的问句与相信的事都不落盘', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    expect(seam.recordQuestion('  ', now)).toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(seam.recordClaim({ text: '  ', confidence: 0.5, evidence: ['m1'] }, now))
      .toEqual({ written: false, proposed: false, reason: 'no_evidence' })
  })

  it('一周只记一条想问的事', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    expect(seam.recordQuestion('为什么夜里更想说话', now)).toEqual({ written: true, proposed: false })
    expect(seam.recordQuestion('为什么早上不想说话', now + 60_000))
      .toEqual({ written: false, proposed: false, reason: 'capped' })
    expect(readRows(dir, 'questions.jsonl')).toHaveLength(1)
  })

  it('同时最多两个没结束的项目', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const now = Date.now()

    seam.recordProject({ title: '记一句话', next: '先写一句', failIf: '两周没动' }, now)
    seam.recordProject({ title: '再记一句', next: '挑一句', failIf: '两周没动' }, now)
    const third = seam.recordProject({ title: '第三个', next: '看一眼', failIf: '两周没动' }, now)

    expect(third).toEqual({ written: false, proposed: false, reason: 'capped' })
    expect(readRows(dir, 'projects.jsonl')).toHaveLength(2)
  })

  it('没有失败条件的项目不落盘', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.recordProject({ title: '记一句话', next: '先写一句', failIf: '' }, Date.now()))
      .toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(seam.recordProject({ title: '  ', next: '先写一句', failIf: '两周没动' }, Date.now()))
      .toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(fs.existsSync(path.join(dir, 'projects.jsonl'))).toBe(false)
  })

  it('文件里的坏行不挡下一次写入', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'questions.jsonl'), `${JSON.stringify({ at: 1, id: '' })}\n`)

    expect(seam.recordQuestion('为什么夜里更想说话', Date.now())).toEqual({ written: true, proposed: false })
    expect(readRows(dir, 'questions.jsonl')).toHaveLength(2)
  })

  it('标题太长就截断，面板取最新的那个项目', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const base = Date.now()

    seam.recordProject({ title: '题'.repeat(60), next: '先写一句', failIf: '两周没动' }, base)
    seam.recordProject({ title: '第二个', next: '挑一句', failIf: '两周没动' }, base + 1_000)
    fs.appendFileSync(path.join(dir, 'projects.jsonl'), `${JSON.stringify({ at: base + 2_000, id: 'p3', title: '已经结束的那个', outcome: 'done' })}\n`)
    fs.appendFileSync(path.join(dir, 'projects.jsonl'), `${JSON.stringify({ at: base + 3_000, id: 'p4' })}\n`)
    fs.appendFileSync(path.join(dir, 'projects.jsonl'), `${JSON.stringify({ at: base - 1_000, id: 'p5', title: '更早的那个', outcome: 'open' })}\n`)

    expect(String(readRows(dir, 'projects.jsonl')[0]?.title).length).toBe(40)
    expect(seam.panel()).toContain('我在做：第二个')
  })

  it('面板取最新的一条想问的事', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const base = Date.now()

    seam.recordQuestion('第一条想弄明白的事', base)
    fs.appendFileSync(path.join(dir, 'questions.jsonl'), `${JSON.stringify({ at: base + 1_000, id: 'q2', text: '第二条想弄明白的事' })}\n`)
    fs.appendFileSync(path.join(dir, 'questions.jsonl'), `${JSON.stringify({ at: base + 2_000, id: '' })}\n`)
    fs.appendFileSync(path.join(dir, 'questions.jsonl'), `${JSON.stringify({ at: base - 1_000, id: 'q0', text: '更早的那条' })}\n`)

    expect(seam.panel()).toContain('第二条想弄明白的事')
  })
})
