import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqMemoryOf, type QqMemorySeam } from '../src/index.ts'

// 工具体只读会话编号，其余执行字段由内核在真实调用时注入
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  ctx: Context
  seam: QqMemorySeam
  tool: (name: string) => ToolDefinition
}

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-memory-'))
  tempDirs.push(dir)
  return path.join(dir, 'memory.json')
}

function mount(file: string): Mounted {
  const ctx = new Context()
  const registered = new Map<string, ToolDefinition>()
  ctx.accessor('tools', {
    get: () => ({
      register: (definition: ToolDefinition) => {
        registered.set(definition.name, definition)
        return () => {}
      },
    }),
  })
  apply(ctx, { file })
  const seam = qqMemoryOf(ctx)
  if (seam === undefined) throw new Error('记忆没有装配')
  const tool = (name: string): ToolDefinition => {
    const found = registered.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { ctx, seam, tool }
}

async function call<T>(tool: ToolDefinition, args: Record<string, unknown>, exec: ToolRunContext): Promise<T> {
  return await tool.execute(args, exec) as T
}

const SENTENCE = '他说周末要开黑，我还想问是哪个游戏'

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('记得住', () => {
  it('记一条会拿到编号', async () => {
    const { tool } = mount(tempFile())

    const added = await call<{ id: string }>(tool('memory_append'), { text: SENTENCE }, execOf('group:1'))

    expect(typeof added.id).toBe('string')
    expect(added.id).not.toBe('')
  })

  it('同一句再记一次会被拦住', async () => {
    const { tool } = mount(tempFile())
    await tool('memory_append').execute({ text: SENTENCE }, execOf('group:1'))

    await expect(tool('memory_append').execute({ text: SENTENCE }, execOf('group:1'))).rejects.toThrow(/memory\.duplicate/)
  })

  it('太短的内容不记', async () => {
    const { tool } = mount(tempFile())

    await expect(tool('memory_append').execute({ text: '嗯' }, execOf('group:1'))).rejects.toThrow(/memory\.too_short/)
  })
})

describe('找得回', () => {
  it('按关键词找得回来', async () => {
    const { tool } = mount(tempFile())
    await tool('memory_append').execute({ text: SENTENCE }, execOf('group:1'))

    const found = await call<{ count: number; text: string }>(tool('memory_query'), { query: '开黑' }, execOf('group:1'))

    expect(found.count).toBe(1)
    expect(found.text).toContain('开黑')
  })

  it('关键词对不上时如实说没想起来', async () => {
    const { tool } = mount(tempFile())
    await tool('memory_append').execute({ text: SENTENCE }, execOf('group:1'))

    const missing = await call<{ count: number; text: string }>(
      tool('memory_query'), { query: '完全不存在的词' }, execOf('group:1'),
    )

    expect(missing.count).toBe(0)
    expect(missing.text).toContain('没有想起')
  })

  it('被找出来的那条算被提起过一次', async () => {
    const { seam, tool } = mount(tempFile())
    await tool('memory_append').execute({ text: SENTENCE }, execOf('group:1'))
    await tool('memory_query').execute({ query: '开黑' }, execOf('group:1'))

    const touched = seam.store.all().find(item => item.text.includes('开黑'))

    expect(touched?.recallCount ?? 0).toBeGreaterThanOrEqual(1)
  })

  it('已经淡忘的内容不会再被翻出来', async () => {
    const { seam, tool } = mount(tempFile())
    const doomed = seam.remember('会彻底忘掉的事', 'group:1')
    seam.store.update(doomed.id, { at: 0, lastSeenAt: 0 })
    for (let at = 0; at < 5; at += 1) seam.sweep()

    const searchForgotten = await call<{ text: string }>(tool('memory_query'), { query: '彻底忘掉' }, execOf('group:1'))

    expect(searchForgotten.text).not.toContain('彻底忘掉')
  })
})

describe('一层层往上挪', () => {
  it('刚发生的事不会立刻往上挪', () => {
    const { seam } = mount(tempFile())
    const early = seam.remember('刚发生的一件小事', 'group:1', 'ephemeral')

    seam.promote()

    expect(seam.store.byId(early.id)?.layer).toBe('ephemeral')
  })

  it('过半小时之后往上挪一层', () => {
    const { seam } = mount(tempFile())
    const early = seam.remember('刚发生的一件小事', 'group:1', 'ephemeral')
    seam.store.update(early.id, { at: Date.now() - 40 * 60_000 })

    seam.promote()

    expect(seam.store.byId(early.id)?.layer).toBe('episodic')
  })
})

describe('慢慢变淡', () => {
  it('跑一次只降一档', () => {
    const { seam } = mount(tempFile())
    const doomed = seam.remember('会彻底忘掉的事', 'group:1')
    seam.store.update(doomed.id, { at: 0, lastSeenAt: 0 })

    seam.sweep()

    expect(seam.store.byId(doomed.id)?.clarity).toBe('clear')
  })

  it('淡到底只留个空位', () => {
    const { seam } = mount(tempFile())
    const doomed = seam.remember('会彻底忘掉的事', 'group:1')
    seam.store.update(doomed.id, { at: 0, lastSeenAt: 0 })
    for (let at = 0; at < 5; at += 1) seam.sweep()

    const afterSweep = seam.store.byId(doomed.id)

    expect(afterSweep?.forgotten).toBe(true)
    expect(afterSweep?.text).toBe('')
  })
})

describe('关掉再开', () => {
  it('记下的条数还在', () => {
    const file = tempFile()
    const first = mount(file)
    first.seam.remember(SENTENCE, 'group:1')
    const beforeRestart = first.seam.store.all().length

    expect(mount(file).seam.store.all().length).toBe(beforeRestart)
  })

  it('能给出一页记忆概要', () => {
    const { seam } = mount(tempFile())
    seam.remember(SENTENCE, 'group:1')

    const outline = seam.outline('group:1')

    expect(outline).toContain('记下了')
    expect(outline).toContain('开黑')
  })
})
