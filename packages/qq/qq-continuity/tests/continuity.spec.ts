import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqContinuityOf, type QqContinuitySeam } from '../src/index.ts'

// 工具体只读会话编号，其余执行字段由内核在真实调用时注入
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  seam: QqContinuitySeam
  tool: (name: string) => ToolDefinition
}

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-continuity-'))
  tempDirs.push(dir)
  return path.join(dir, 'continuity.json')
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
  const seam = qqContinuityOf(ctx)
  if (seam === undefined) throw new Error('收尾没有装配')
  const tool = (name: string): ToolDefinition => {
    const found = registered.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { seam, tool }
}

async function call<T>(tool: ToolDefinition, args: Record<string, unknown>, exec: ToolRunContext): Promise<T> {
  return await tool.execute(args, exec) as T
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('收尾与下次', () => {
  it('收尾会留下结束点和下次的接法', () => {
    const { seam } = mount(tempFile())

    const note = seam.close({ chatKey: 'group:1', summary: '聊到周末开黑', nextOpening: '问是哪个游戏' })

    expect(note.summary).toBe('聊到周末开黑')
    expect(note.nextOpening).toBe('问是哪个游戏')
  })

  it('下次能接上上次的话头', () => {
    const { seam } = mount(tempFile())
    seam.close({ chatKey: 'group:1', summary: '聊到周末开黑', nextOpening: '问是哪个游戏' })

    const resume = seam.resume('group:1')

    expect(resume).toContain('周末开黑')
    expect(resume).toContain('哪个游戏')
  })

  it('没聊过的群不硬编一句话', () => {
    const { seam } = mount(tempFile())

    expect(seam.resume('group:404')).toBe('')
  })
})

describe('聊得怎么样', () => {
  it('有人接着说话算聊得好', () => {
    const { seam } = mount(tempFile())
    const now = Date.now()

    const good = seam.judge([
      { self: false, at: now - 300_000 },
      { self: true, at: now - 240_000 },
      { self: false, at: now - 60_000 },
    ])

    expect(good.gotReply).toBe(true)
    expect(good.humanMessages).toBe(2)
  })

  it('只有自己在说也看得出来', () => {
    const { seam } = mount(tempFile())

    const cold = seam.judge([{ self: true, at: Date.now() - 60_000 }])

    expect(cold.gotReply).toBe(false)
    expect(cold.selfMessages).toBe(1)
  })
})

describe('事后想一想', () => {
  it('事后能记一句', async () => {
    const { tool } = mount(tempFile())

    const reflected = await call<{ id: string; kind: string }>(
      tool('note_reflection'), { kind: 'good', text: '这次接话接得还行，下次别抢话' }, execOf('group:1'),
    )

    expect(reflected.id).not.toBe('')
    expect(reflected.kind).toBe('good')
  })

  it('想过的能翻回来', async () => {
    const { seam, tool } = mount(tempFile())
    await tool('note_reflection').execute({ kind: 'good', text: '这次接话接得还行，下次别抢话' }, execOf('group:1'))

    const history = seam.history('group:1')

    expect(history).toHaveLength(1)
    expect(history[0]?.text).toContain('别抢话')
  })

  it('太短的不记', async () => {
    const { tool } = mount(tempFile())

    await expect(tool('note_reflection').execute({ text: '嗯' }, execOf('group:1'))).rejects.toThrow(/continuity\.too_short/)
  })
})

describe('关掉再开', () => {
  it('收尾还在', () => {
    const file = tempFile()
    const first = mount(file)
    first.seam.close({ chatKey: 'group:1', summary: '聊到周末开黑', nextOpening: '问是哪个游戏' })

    expect(mount(file).seam.resume('group:1')).toContain('周末开黑')
  })

  it('回想还在', () => {
    const file = tempFile()
    const first = mount(file)
    first.seam.store.addReflection('group:1', 'good', '这次接话接得还行，下次别抢话')

    expect(mount(file).seam.history('group:1')).toHaveLength(1)
  })
})
