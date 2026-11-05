import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqSelfOf, type QqSelfSeam, type SelfMirrorPort } from '../src/index.ts'

const roots: string[] = []
const AT = new Date(2026, 10, 3, 21, 0).getTime()

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-proposal-'))
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

function pause(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'PAUSE'), '')
}

// 记下镜像调用，用来证明提议不进记忆库
function spyMemory(): { port: SelfMirrorPort; seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    port: {
      mirroredSelfIds: () => seen,
      memoryIds: () => [],
      rememberSelf(entry) {
        seen.push(entry.selfId)
        return { id: `m${seen.length}`, created: true }
      },
    },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('暂停时的提议', () => {
  it('PAUSE 下来的是提议，不是做成', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    pause(dir)

    const outcome = seam.recordProject({ title: '把夜里那句话记下来', next: '先写一句', failIf: '两周没动' }, AT)

    expect(outcome).toEqual({ written: true, proposed: true })
    const kept = rows(dir, 'projects.jsonl')
    expect(kept).toHaveLength(1)
    expect(kept[0]?.proposed).toBe(true)
    expect(kept[0]?.outcome).toBe('dropped')
    expect(kept[0]?.title).toBe('把夜里那句话记下来')
  })

  it('没 PAUSE 的同一条就是做成', async () => {
    const dir = tempDir()
    const seam = await mount(dir)

    const outcome = seam.recordProject({ title: '把夜里那句话记下来', next: '先写一句', failIf: '两周没动' }, AT)

    expect(outcome).toEqual({ written: true, proposed: false })
    const kept = rows(dir, 'projects.jsonl')
    expect(kept).toHaveLength(1)
    expect(kept[0]?.proposed).toBeUndefined()
    expect(kept[0]?.outcome).toBe('open')
  })

  it('提议不算进面板的我在做', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    pause(dir)

    seam.recordProject({ title: '把夜里那句话记下来', next: '先写一句', failIf: '两周没动' }, AT)

    expect(seam.panel()).not.toContain('我在做：')
  })

  it('提议不占没结束项目的额度', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    pause(dir)

    for (let step = 0; step < 3; step += 1) {
      expect(seam.recordProject({ title: `想做第${step}件`, next: '先写一句', failIf: '两周没动' }, AT)).toEqual({ written: true, proposed: true })
    }
    fs.rmSync(path.join(dir, 'PAUSE'))

    expect(seam.recordProject({ title: '第一件', next: '先写一句', failIf: '两周没动' }, AT)).toEqual({ written: true, proposed: false })
    expect(seam.recordProject({ title: '第二件', next: '先挑一件', failIf: '两周没动' }, AT)).toEqual({ written: true, proposed: false })
    expect(seam.recordProject({ title: '第三件', next: '看一眼', failIf: '两周没动' }, AT))
      .toEqual({ written: false, proposed: false, reason: 'capped' })
  })

  it('提议不进记忆库', async () => {
    const dir = tempDir()
    const seam = await mount(dir)
    const memory = spyMemory()
    seam.useMemory(memory.port)
    pause(dir)

    seam.recordProject({ title: '把夜里那句话记下来', next: '先写一句', failIf: '两周没动' }, AT)
    expect(seam.mirror()).toEqual({ written: 0, skipped: 0, split: 0, unverified: 0 })
    expect(memory.seen).toEqual([])

    fs.rmSync(path.join(dir, 'PAUSE'))
    seam.recordProject({ title: '真的在做的那件', next: '先写一句', failIf: '两周没动' }, AT)

    expect(seam.mirror()).toEqual({ written: 1, skipped: 0, split: 0, unverified: 0 })
    expect(memory.seen).toEqual(['projects.jsonl#2'])
  })
})
