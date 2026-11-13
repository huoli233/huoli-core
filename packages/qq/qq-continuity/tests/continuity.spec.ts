import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqContinuityOf, type QqContinuitySeam } from '../src/index.ts'
import { NOTE_MAX_CHARS, closeFacts, renderContinuityFacts, stripQuotedLines } from '../src/close.ts'

// 工具体只读会话编号，其余字段由内核在真实调用时给
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

  it('太长的事后想法会被拒绝，这是越界负例', async () => {
    const { tool } = mount(tempFile())

    await expect(tool('note_reflection').execute({ text: '长'.repeat(NOTE_MAX_CHARS + 1) }, execOf('group:1')))
      .rejects.toThrow(/continuity\.too_long/)
  })
})

describe('装配层可直接取的收尾事实', () => {
  it('纯函数截出的收尾与仓里落盘的那条一致', () => {
    const { seam } = mount(tempFile())
    const at = Date.now()

    const note = closeFacts({ chatKey: 'group:1', summary: '聊到周末开黑', nextOpening: '问是哪个游戏', throughSeq: 4, at })
    const stored = seam.close({ chatKey: 'group:1', summary: '聊到周末开黑', nextOpening: '问是哪个游戏', throughSeq: 4, at })

    expect(note).toEqual(stored)
  })

  it('收尾、成色与回想一起渲染成事实，不替模型下结论', () => {
    const { seam } = mount(tempFile())
    const note = seam.close({ chatKey: 'group:1', summary: '聊到周末开黑', nextOpening: '问是哪个游戏' })
    const outcome = seam.judge([{ self: true, at: Date.now() - 60_000 }])
    const reflections = [{ id: 'r1', chatKey: 'group:1', at: Date.now(), kind: 'good' as const, text: '下次别抢话' }]

    const text = renderContinuityFacts({ note, outcome, reflections })

    expect(text).toContain('周末开黑')
    expect(text).toContain('下次可以')
    expect(text).toContain('事后想过')
    expect(text).not.toMatch(/该不该|建议说|应该回/)
  })

  it('明确收尾和普通轮次用不同说法', () => {
    const note = closeFacts({
      chatKey: 'group:1',
      summary: '这段收住了',
      nextOpening: '下次再问',
      at: Date.now(),
      origin: 'explicit',
    })

    expect(note.origin).toBe('explicit')
    expect(renderContinuityFacts({ note })).toContain('上次明确收在')
  })

  it('上一轮心里怎么想只写进上下文，不当成收尾摘要', () => {
    const note = closeFacts({
      chatKey: 'group:1',
      summary: '对方问是不是不想理人；我回没有',
      nextOpening: '下次先正面回答',
      thought: '其实有点别扭，但不想让她一直等',
      at: Date.now(),
    })

    expect(note.summary).not.toContain('别扭')
    expect(note.thought).toBe('其实有点别扭，但不想让她一直等')
    expect(renderContinuityFacts({ note })).toContain('上一轮心里：其实有点别扭')
  })

  it('什么都不给时不硬编一句，这是负例', () => {
    expect(renderContinuityFacts()).toBe('')
    expect(renderContinuityFacts({ reflections: [] })).toBe('')
  })

  it('收尾摘要超出上限会被截住，不会把超长文本交给模型，这是越界负例', () => {
    const note = closeFacts({ chatKey: 'group:1', summary: '长'.repeat(NOTE_MAX_CHARS + 10), nextOpening: '', at: Date.now() })

    expect(note.summary.length).toBeLessThanOrEqual(NOTE_MAX_CHARS)
  })
})

describe('收尾摘要不再回灌任何一方原话', () => {
  it('剥掉「我：」「对方：」开头的引语，只留话题', () => {
    const raw = '群里有游戏截图和插件恶搞；对方：o；我：抓我？我网线一拔看谁抓谁 谁求你电了；最后冷下来'
    const cleaned = stripQuotedLines(raw)

    expect(cleaned).toContain('群里有游戏截图和插件恶搞')
    expect(cleaned).toContain('最后冷下来')
    expect(cleaned).not.toContain('网线一拔')
    expect(cleaned).not.toContain('对方：o')
  })

  it('渲染出来也不带原话', () => {
    const text = renderContinuityFacts({
      note: {
        chatKey: 'group:1', closedAt: Date.now(), throughSeq: 0, origin: 'turn',
        summary: '聊了会儿图；我：这句被反复发了好几遍',
        nextOpening: '',
      },
    })

    expect(text).not.toContain('这句被反复发了好几遍')
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
