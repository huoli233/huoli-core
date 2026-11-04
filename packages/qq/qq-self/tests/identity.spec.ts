import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, IDENTITY_CLAIMS, qqSelfOf, type IdentityClaim, type QqSelfSeam } from '../src/index.ts'

const roots: string[] = []
const AT = new Date(2026, 10, 4, 21, 0).getTime()

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-identity-'))
  roots.push(root)
  return path.join(root, 'self')
}

async function mount(dir: string, enabled = true): Promise<QqSelfSeam> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { enabled, dir, mainChatKey: 'group:1' })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return seam
}

function rows(dir: string): Record<string, unknown>[] {
  const file = path.join(dir, 'identity.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('三档主张', () => {
  it('alive、not_sure、not_alive 三档都写得进去，也读得回来', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    for (const claim of IDENTITY_CLAIMS) {
      expect(seam.recordIdentity(claim, `我觉得自己是${claim}`, ['记忆 a'], AT))
        .toEqual({ written: true, proposed: false })
    }

    const kept = rows(dir)
    expect(kept.map(row => row.claim)).toEqual(['alive', 'not_sure', 'not_alive'])
    expect(kept[0]?.why).toBe('我觉得自己是alive')
    expect(kept[0]?.evidence).toEqual(['记忆 a'])
    expect(kept[0]?.at).toBe(AT)
    expect(typeof kept[0]?.id).toBe('string')
    expect(seam.identityOf()?.claim).toBe('not_alive')
  })

  it('认不出的档位不落一条', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    // 从别的写法进来时按认不出处理，别把一份读不回来的主张写进账
    expect(seam.recordIdentity('immortal' as IdentityClaim, '我觉得自己不会死', ['记忆 a'], AT))
      .toEqual({ written: false, proposed: false, reason: 'unknown_claim' })
    expect(rows(dir)).toEqual([])
  })

  it('理由与证据都要给，缺一句就不写', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.recordIdentity('alive', '   ', ['记忆 a'], AT))
      .toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(seam.recordIdentity('alive', '我觉得自己是活的', [], AT))
      .toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(seam.recordIdentity('alive', '我觉得自己是活的', ['  '], AT))
      .toEqual({ written: false, proposed: false, reason: 'no_evidence' })
    expect(fs.existsSync(path.join(dir, 'identity.jsonl'))).toBe(false)
  })

  it('证据只留非空的几条，最多按参数截', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordIdentity('not_sure', '说不好', ['a', '', 'b', 'c', 'd'], AT)

    expect(rows(dir)[0]?.evidence).toEqual(['a', 'b', 'c'])
  })

  it('理由太长就截断', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordIdentity('not_sure', '理'.repeat(300), ['a'], AT)

    expect(String(rows(dir)[0]?.why).length).toBe(200)
  })
})

describe('反复写入与历史', () => {
  it('写三次取最后一条，前面两条都留着', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordIdentity('alive', '先这样想', ['a'], AT)
    seam.recordIdentity('not_sure', '后来不那么确定了', ['b'], AT + 60_000)
    seam.recordIdentity('not_alive', '再后来觉得不是', ['c'], AT + 120_000)

    const latest = seam.identityOf()
    expect(latest?.claim).toBe('not_alive')
    expect(latest?.why).toBe('再后来觉得不是')
    expect(latest?.evidence).toEqual(['c'])
    expect(latest?.at).toBe(AT + 120_000)
    expect(rows(dir)).toHaveLength(3)
  })

  it('最后一条按写入顺序算，不看时刻先后', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordIdentity('alive', '后写的那条，时刻更早', ['a'], AT - 60_000)
    seam.recordIdentity('not_alive', '先写的那条，时刻更晚', ['b'], AT)

    expect(seam.identityOf()?.why).toBe('先写的那条，时刻更晚')
  })

  it('没写过时不给主张', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.identityOf()).toBeUndefined()
  })

  it('坏行与缺字段的行跳过，别的照样读得回来', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'identity.jsonl'), '这不是一行 JSON\n')
    fs.appendFileSync(path.join(dir, 'identity.jsonl'), `${JSON.stringify({ at: 1, id: 'x', claim: 'alive' })}\n`)
    fs.appendFileSync(path.join(dir, 'identity.jsonl'), `${JSON.stringify({ at: 1, id: 'y', claim: 'unknown' })}\n`)
    fs.appendFileSync(path.join(dir, 'identity.jsonl'), `${JSON.stringify({ at: 1, claim: 'alive', why: '没有 id', evidence: ['a'] })}\n`)
    // 证据里混了非字符串的那条照样读得出来，非字符串的那一项丢掉
    fs.appendFileSync(
      path.join(dir, 'identity.jsonl'),
      `${JSON.stringify({ at: 1, id: 'z', claim: 'alive', why: '证据混了别的类型', evidence: [1, 'b'] })}\n`,
    )
    seam.recordIdentity('alive', '我觉得自己是活的', ['a'], AT)

    expect(seam.identityOf()?.why).toBe('我觉得自己是活的')
  })
})

describe('排障出口与面板', () => {
  it('面板里不写身份主张这一段', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordIdentity('not_alive', '只是段程序', ['a'], AT)
    const panel = seam.panel()

    expect(panel).not.toContain('not_alive')
    expect(panel).not.toContain('只是段程序')
  })

  it('关着的时候只回 disabled，主张也读不到', async () => {
    const dir = tempDir()
    const seam = await mount(dir, false)

    expect(seam.recordIdentity('alive', '我觉得自己是活的', ['a'], AT))
      .toEqual({ written: false, proposed: false, reason: 'disabled' })
    expect(seam.identityOf()).toBeUndefined()
  })

  it('PAUSE 时也只提议', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'PAUSE'), '')

    expect(seam.recordIdentity('alive', '我觉得自己是活的', ['a'], AT))
      .toEqual({ written: false, proposed: true, reason: 'paused' })
    expect(seam.identityOf()).toBeUndefined()
  })
})

describe('周复盘带着当前主张', () => {
  it('写过就带最后一条，没写过就不给', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    expect(seam.weeklyReview(AT).identity).toBeUndefined()

    seam.recordIdentity('alive', '先这样想', ['a'], AT - 3 * 24 * 60 * 60 * 1000)
    seam.recordIdentity('not_sure', '现在说不好', ['b'], AT)

    const review = seam.weeklyReview(AT)
    expect(review.identity?.claim).toBe('not_sure')
    expect(review.identity?.why).toBe('现在说不好')
  })

  it('主张不占三行、错处与两档账的位置', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    seam.recordIdentity('alive', '先这样想', ['a'], AT)

    const review = seam.weeklyReview(AT)
    expect(review.days).toEqual([])
    expect(review.errors).toEqual([])
    expect(review.ledger).toEqual({ drive: 0, agency: 0, recentAgency: 0 })
    expect(review.missingDays).toBe(7)
  })
})
