import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []
const AT = new Date(2026, 10, 4, 21, 0).getTime()
const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-review-'))
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

// 直接往事件流尾部补一行，用来放七天以外的那条
function push(dir: string, name: string, row: object): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(path.join(dir, name), `${JSON.stringify(row)}\n`)
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('一周一次的汇总', () => {
  it('三行、错处、两档账与项目状态都在，七天以外的不要', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordDay(['把周报写成了一句', '夜里那句话没说完', '明天先列三条'], AT)
    seam.skipDay('那天在赶工，不想为了打卡硬写', AT - DAY)
    seam.recordError('把她的沉默当成同意', '下一次先问一句再动手', AT - 3_600_000)
    seam.recordDrive('thirst', AT, { did: '倒了杯水', resolved: true })
    seam.recordAgency('p1', '想把夜里那句话记下来', AT)
    seam.recordProject({ title: '把周报写成一句', next: '先列三条', failIf: '两周没动' }, AT)
    push(dir, 'day.jsonl', { at: AT - 8 * DAY, id: 'old-day', lines: ['一', '二', '三'], skipped: false, why: '' })
    push(dir, 'errors.jsonl', { at: AT - 8 * DAY, id: 'old-error', text: '更早的错', fix: '更早的改法' })

    const review = seam.weeklyReview(AT)

    expect(review.since).toBe(AT - WEEK)
    expect(review.days).toHaveLength(2)
    expect(review.days.map(row => row.skipped)).toEqual([true, false])
    expect(review.errors.map(row => row.text)).toEqual(['把她的沉默当成同意'])
    expect(review.ledger).toEqual({ drive: 1, agency: 1, recentAgency: 1 })
    expect(review.projects).toEqual({ open: 1, done: 0, failed: 0, dropped: 0, proposed: 0 })
    expect(review.missingDays).toBe(6)
  })

  it('两档账分开数，drive 不算进 agency', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordDrive('hunger', AT)
    seam.recordDrive('thirst', AT)
    seam.recordAgency('p1', '想把夜里那句话记下来', AT)
    seam.recordAgency('p1', '再换一句原话', AT, { outcome: 'done', artifact: 'notes/a.md' })

    const review = seam.weeklyReview(AT)

    expect(review.ledger.drive).toBe(2)
    expect(review.ledger.agency).toBe(2)
  })

  it('项目按收尾状态分开记，提议单独一档', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordProject({ title: '在做的那个', next: '先列三条', failIf: '两周没动' }, AT)
    push(dir, 'projects.jsonl', { at: AT - DAY, id: 'p-done', title: '做完了的', outcome: 'done' })
    push(dir, 'projects.jsonl', { at: AT - DAY, id: 'p-failed', title: '判成失败的', outcome: 'failed' })
    push(dir, 'projects.jsonl', { at: AT - DAY, id: 'p-proposed', title: '想做的', outcome: 'dropped', proposed: true })

    const review = seam.weeklyReview(AT)

    expect(review.projects).toEqual({ open: 1, done: 1, failed: 1, dropped: 0, proposed: 1 })
  })

  it('一天都没写就是七天全缺，跳过的不算写上', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.weeklyReview(AT).missingDays).toBe(7)

    seam.skipDay('那天在赶工', AT)

    expect(seam.weeklyReview(AT).missingDays).toBe(7)
  })

  it('七天都写了就是一天不缺', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    for (let step = 0; step < 7; step += 1) {
      seam.recordDay(['一', '二', '三'], AT - step * DAY)
    }

    expect(seam.weeklyReview(AT).missingDays).toBe(0)
    expect(seam.weeklyReview(AT).days).toHaveLength(7)
  })
})
