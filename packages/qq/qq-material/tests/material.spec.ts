import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, qqMaterialOf, type QqMaterialSeam } from '../src/index.ts'
import { collectMaterialFacts, renderMaterialFacts } from '../src/collect.ts'

// 工具体只读会话编号，其余字段由内核在真实调用时给
function execOf(chatKey: string): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  seam: QqMaterialSeam
  tool: (name: string) => ToolDefinition
}

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-material-'))
  tempDirs.push(dir)
  return path.join(dir, 'thoughts.json')
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
  apply(ctx, { thoughtsFile: file })
  const seam = qqMaterialOf(ctx)
  if (seam === undefined) throw new Error('素材没有装配')
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

const NOW = Date.now()

const MESSAGES = [
  { seq: 1, senderId: 'u1', senderName: '阿澈', text: '周末有人开黑吗', at: NOW - 120_000 },
  { seq: 2, senderId: 'u2', senderName: '小周', text: '我在', at: NOW - 60_000 },
  { seq: 3, senderId: 'u1', senderName: '阿澈', text: '小岸你来不来', at: NOW - 10_000, atMe: true },
]

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('把现场摊开', () => {
  it('看得出群里在聊什么', () => {
    const { seam } = mount(tempFile())

    const material = seam.gather({ chatKey: 'group:1', messages: MESSAGES, selfNames: ['小岸'], boredom: 0.7 })

    expect(material.topic.active.length).toBeGreaterThan(0)
  })

  it('看得出有人在叫它', () => {
    const { seam } = mount(tempFile())

    const material = seam.gather({ chatKey: 'group:1', messages: MESSAGES, selfNames: ['小岸'], boredom: 0.7 })

    expect(material.addressee.confidence).toBeGreaterThanOrEqual(0.5)
    expect(material.addressee.name).toBe('阿澈')
  })

  it('看得出有一句话还没人接', () => {
    const { seam } = mount(tempFile())

    const material = seam.gather({ chatKey: 'group:1', messages: MESSAGES, selfNames: ['小岸'], boredom: 0.7 })

    expect(material.topic.pendingQuestion).toContain('开黑')
  })

  it('无聊高的时候给出想说话的由头', () => {
    const { seam } = mount(tempFile())

    const material = seam.gather({ chatKey: 'group:1', messages: MESSAGES, selfNames: ['小岸'], boredom: 0.7 })

    expect(material.motives.some(item => item.need === 'bored')).toBe(true)
  })

  it('能写成给模型看的一小段字', () => {
    const { seam } = mount(tempFile())
    const material = seam.gather({ chatKey: 'group:1', messages: MESSAGES, selfNames: ['小岸'] })

    const text = seam.render(material)

    expect(text).toContain('群里在聊')
  })
})

describe('惦记的事', () => {
  it('惦记的事能记下来', async () => {
    const { tool } = mount(tempFile())

    const added = await call<{ id: string }>(tool('write_thought'), { text: '想问清楚是哪个游戏' }, execOf('group:1'))

    expect(added.id).not.toBe('')
  })

  it('素材里会带上惦记的事', async () => {
    const { seam, tool } = mount(tempFile())
    await tool('write_thought').execute({ text: '想问清楚是哪个游戏' }, execOf('group:1'))

    const withThought = seam.gather({ chatKey: 'group:1', messages: MESSAGES, selfNames: ['小岸'] })

    expect(withThought.thoughts).toHaveLength(1)
    expect(withThought.thoughts[0]?.text).toContain('哪个游戏')
  })

  it('说完了就能删掉', async () => {
    const { tool } = mount(tempFile())
    const added = await call<{ id: string }>(tool('write_thought'), { text: '想问清楚是哪个游戏' }, execOf('group:1'))

    const dropped = await call<{ dropped: boolean }>(tool('drop_thought'), { id: added.id }, execOf('group:1'))

    expect(dropped.dropped).toBe(true)
  })

  it('删掉之后素材里就没有了', async () => {
    const { seam, tool } = mount(tempFile())
    const added = await call<{ id: string }>(tool('write_thought'), { text: '想问清楚是哪个游戏' }, execOf('group:1'))
    await tool('drop_thought').execute({ id: added.id }, execOf('group:1'))

    expect(seam.gather({ chatKey: 'group:1', messages: MESSAGES, selfNames: ['小岸'] }).thoughts).toHaveLength(0)
  })

  it('太短的不记', async () => {
    const { tool } = mount(tempFile())

    await expect(tool('write_thought').execute({ text: '嗯' }, execOf('group:1'))).rejects.toThrow(/material\.too_short/)
  })

  it('删不存在的会被拦住', async () => {
    const { tool } = mount(tempFile())

    await expect(tool('drop_thought').execute({ id: '不存在' }, execOf('group:1'))).rejects.toThrow(/material\.not_found/)
  })

  it('关掉再开，惦记的事还在', async () => {
    const file = tempFile()
    const first = mount(file)
    const kept = await call<{ id: string }>(first.tool('write_thought'), { text: '下次问问他周末几点' }, execOf('group:1'))

    const again = mount(file)

    expect(again.seam.thoughts.live('group:1').some(item => item.id === kept.id)).toBe(true)
  })
})

describe('装配层可直接取的素材事实', () => {
  it('纯函数与运行件采到同一份现场，且能带上惦记的事', () => {
    const { seam } = mount(tempFile())
    const thoughts = seam.thoughts.live('group:1')

    const material = collectMaterialFacts({ chatKey: 'group:1', messages: MESSAGES, selfNames: ['小岸'], now: NOW, thoughts })
    const gathered = seam.gather({ chatKey: 'group:1', messages: MESSAGES, selfNames: ['小岸'] })

    expect(material.topic.active).toBe(gathered.topic.active)
    expect(material.thoughts).toEqual([])
  })

  it('纯函数直接渲染出给模型看的中文事实', () => {
    const text = renderMaterialFacts({ chatKey: 'group:1', messages: MESSAGES, selfNames: ['小岸'], now: NOW })

    expect(text).toContain('群里在聊')
    expect(text).not.toMatch(/该不该|建议说|应该回/)
  })

  it('没有现场时不硬编话题，这是负例', () => {
    const text = renderMaterialFacts({ chatKey: 'group:404', messages: [], now: NOW })

    expect(text).toBe('群里没什么可接的话。')
    expect(collectMaterialFacts({ chatKey: 'group:404', messages: [], now: NOW }).topic.active).toBe('')
  })
})
