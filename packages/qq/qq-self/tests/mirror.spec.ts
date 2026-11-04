import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, MIRROR_FILES, qqSelfOf, type QqSelfSeam } from '../src/index.ts'
import type { SelfMirrorEntry, SelfMirrorPort } from '../src/types.ts'

const roots: string[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-mirror-'))
  roots.push(root)
  return path.join(root, 'self')
}

interface Handed {
  entry: SelfMirrorEntry
  at: number
}

// 记忆库那一面的替身：只认来源键，别的照收
function fakePort(): { port: SelfMirrorPort; handed: Handed[] } {
  const handed: Handed[] = []
  const mirrored = new Set<string>()
  return {
    handed,
    port: {
      mirroredSelfIds: () => [...mirrored],
      rememberSelf: (entry, at) => {
        if (mirrored.has(entry.selfId)) return { id: entry.selfId, created: false }
        mirrored.add(entry.selfId)
        handed.push({ entry, at })
        return { id: `m${handed.length}`, created: true }
      },
    },
  }
}

async function mount(dir: string, enabled = true): Promise<QqSelfSeam> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { enabled, dir, mainChatKey: 'group:1' })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('这一层没有装配')
  return seam
}

// 往目录里写一份事件流
function writeRows(dir: string, name: string, rows: readonly object[]): void {
  fs.mkdirSync(dir, { recursive: true })
  const body = rows.map(row => `${JSON.stringify(row)}\n`).join('')
  fs.writeFileSync(path.join(dir, name), body)
}

const AT = new Date(2026, 10, 3, 21, 0).getTime()

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('镜像三类', () => {
  it('主张、项目、承诺各写一条，四项都带上', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const { port, handed } = fakePort()
    seam.useMemory(port)
    writeRows(dir, 'claims.jsonl', [
      { at: AT, id: 'c1', text: '夜里那句话是她说给自己听的', confidence: 0.7, evidence: ['m1', 'm2'] },
    ])
    writeRows(dir, 'projects.jsonl', [
      { at: AT, id: 'p1', title: '把歌单写成一句', next: '先挑三首', fail_if: '两周没动', outcome: 'open' },
    ])
    writeRows(dir, 'commitments.jsonl', [{ at: AT, id: 'k1', text: '周末把歌单给她', due_at: 0 }])

    const kept = seam.mirror(AT)

    expect(kept).toEqual({ written: 3, skipped: 0, overlong: 0 })
    expect(handed.map(item => item.entry.selfKind)).toEqual(['claim', 'project', 'commitment'])
    expect(handed.map(item => item.entry.selfId)).toEqual(['claims.jsonl#1', 'projects.jsonl#1', 'commitments.jsonl#1'])
    expect(handed.map(item => item.entry.importance)).toEqual([80, 80, 80])
    expect(handed[0]?.entry.evidence).toEqual(['m1', 'm2'])
    // 没有记忆编号的条挂日期当证据
    expect(handed[2]?.entry.evidence).toEqual(['2026-11-03'])
    expect(handed[1]?.entry.text).toContain('把歌单写成一句')
    expect(handed[1]?.entry.text).toContain('先挑三首')
    expect(handed.every(item => item.entry.chatKey === 'group:1')).toBe(true)
  })

  it('同一批镜像两次只有一条', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const { port, handed } = fakePort()
    seam.useMemory(port)
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: '夜里那句话是她说给自己听的' }])

    seam.mirror(AT)
    const again = seam.mirror(AT + 60_000)

    expect(handed).toHaveLength(1)
    expect(again).toEqual({ written: 0, skipped: 1, overlong: 0 })
  })

  it('超长的一条不写，只记一笔', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const { port, handed } = fakePort()
    seam.useMemory(port)
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: '长'.repeat(520) }])

    const kept = seam.mirror(AT)

    expect(kept).toEqual({ written: 0, skipped: 0, overlong: 1 })
    expect(handed).toHaveLength(0)
  })
})

describe('镜像的边界', () => {
  it('日常三行、问句、账本、面板、叙事、错处一律不进记忆', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const { port, handed } = fakePort()
    seam.useMemory(port)
    writeRows(dir, 'day.jsonl', [
      { at: AT, id: 'd1', lines: ['今天这三行不该进记忆'], skipped: false, why: '' },
    ])
    writeRows(dir, 'questions.jsonl', [{ at: AT, id: 'q1', text: '想问的事不该进记忆' }])
    writeRows(dir, 'ledger.jsonl', [{ at: AT, id: 'l1', kind: 'drive', need: 'thirst', did: '倒水', resolved: true }])
    writeRows(dir, 'errors.jsonl', [{ at: AT, id: 'e1', text: '错处不该进记忆' }])
    fs.writeFileSync(path.join(dir, 'panel.md'), '<!-- generated_at: 2026-11-03T21:00:00+08:00 -->\n面板不该进记忆\n')
    fs.writeFileSync(path.join(dir, 'narrative.md'), '## 我是谁\n叙事不该进记忆\n')
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: '夜里那句话是她说给自己听的' }])

    seam.mirror(AT)

    // 只处理这三份文件，别的一个都不看
    expect(MIRROR_FILES.map(item => item.file)).toEqual(['claims.jsonl', 'projects.jsonl', 'commitments.jsonl'])
    expect(handed).toHaveLength(1)
    const said = handed.map(item => item.entry.text).join('\n')
    for (const word of ['三行', '想问的事', '倒水', '错处', '面板', '叙事']) expect(said).not.toContain(word)
  })

  it('默认关闭时一条都不写', async () => {
    const dir = tempDir()
    const seam = await mount(dir, false)
    const { port, handed } = fakePort()
    seam.useMemory(port)
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: '夜里那句话是她说给自己听的' }])

    const kept = seam.mirror(AT)

    expect(kept).toEqual({ written: 0, skipped: 0, overlong: 0, reason: 'disabled' })
    expect(handed).toHaveLength(0)
  })

  it('没有记忆库时一条都不写', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    writeRows(dir, 'claims.jsonl', [{ at: AT, id: 'c1', text: '夜里那句话是她说给自己听的' }])

    const kept = seam.mirror(AT)

    expect(kept).toEqual({ written: 0, skipped: 0, overlong: 0, reason: 'no_memory' })
    expect(fs.existsSync(path.join(dir, 'claims.jsonl'))).toBe(true)
  })
})
