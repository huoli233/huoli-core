import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, qqSubjectOf, type Config, type QqSubjectSeam } from '../src/index.ts'

const tempDirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-subject-'))
  tempDirs.push(dir)
  return path.join(dir, 'subject.json')
}

async function mount(file: string, config: Config = {}): Promise<{
  ctx: Context
  seam: QqSubjectSeam
  tools: Map<string, ToolDefinition>
}> {
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.provide('tools', {
    register(definition: ToolDefinition) {
      tools.set(definition.name, definition)
      return () => {}
    },
  })
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, { file, ...config })
  const seam = qqSubjectOf(ctx)
  if (seam === undefined) throw new Error('状态没有装配')
  return { ctx, seam, tools }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('写进提示词', () => {
  it('状态段落带位置符进提示词', async () => {
    const { ctx } = await mount(tempFile())

    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(entry => entry.name === 'qq:self')

    expect(section?.text).toContain('{{qq_self}}')
  })

  it('状态变量能被提示词取到', async () => {
    const { ctx } = await mount(tempFile())

    const assembly = await ctx.systemPrompt.assemble()

    expect(Object.hasOwn(assembly.variables, 'qq_self')).toBe(true)
  })

  it('没聊过天时给出一句正常的话', async () => {
    const { ctx } = await mount(tempFile())

    const assembly = await ctx.systemPrompt.assemble()
    const text = assembly.variables.qq_self

    expect(typeof text).toBe('string')
    expect(text).not.toBe('')
  })

  it('心情低和关系近之后，提示词里的状态跟着变', async () => {
    const { ctx, seam } = await mount(tempFile())
    seam.store.setActive('group:1')
    seam.store.changeGlobal('mood', -0.4)
    seam.store.changeGlobal('energy', -0.5)
    seam.store.changeChat('group:1', 'familiarity', 0.6)

    const assembly = await ctx.systemPrompt.assemble()
    const text = assembly.variables.qq_self ?? ''

    expect(text).toContain('心情')
    expect(text).toContain('精力')
    expect(text).toContain('低落')
  })
})

describe('写成一整段快照', () => {
  it('心情低时写成低落', async () => {
    const { seam } = await mount(tempFile())
    seam.store.changeGlobal('mood', -0.4)

    const text = seam.render('group:1')

    expect(text).toContain('低落')
  })

  it('关系带上称呼和熟悉度', async () => {
    const { seam } = await mount(tempFile(), { chatNames: { 'group:1': '阿澈他们群' } })
    seam.store.changeChat('group:1', 'familiarity', 0.6)

    const text = seam.render('group:1')

    expect(text).toContain('对 阿澈他们群')
    expect(text).toContain('熟悉度')
    expect(text).toContain('熟人')
  })

  it('带上心里还惦记着的事', async () => {
    const { seam } = await mount(tempFile())

    const text = seam.render('group:1', ['他说周末要开黑，我还想问是哪个游戏'])

    expect(text).toContain('心里还惦记着')
    expect(text).toContain('周末要开黑')
  })

  it('一段快照不超过三百字', async () => {
    const { seam } = await mount(tempFile(), { maxChars: 300 })
    seam.store.changeGlobal('mood', -0.4)
    seam.store.changeChat('group:1', 'familiarity', 0.6)

    const text = seam.render('group:1', ['他说周末要开黑，我还想问是哪个游戏'])

    expect(text.length).toBeLessThanOrEqual(300)
  })
})

describe('关掉再开', () => {
  it('心情与关系还在', async () => {
    const file = tempFile()
    const first = await mount(file)
    first.seam.store.changeGlobal('mood', -0.4)
    first.seam.store.changeChat('group:1', 'familiarity', 0.6)

    const { seam } = await mount(file)
    const state = seam.store.read()

    expect(state.global.mood).toBeLessThan(0.4)
    expect(state.chats['group:1']?.familiarity ?? 0).toBeGreaterThan(0.5)
  })

  it('还记得最后聊的是哪个群', async () => {
    const file = tempFile()
    const first = await mount(file)
    first.seam.store.setActive('group:1')

    const { seam } = await mount(file)

    expect(seam.store.read().lastActive).toBe('group:1')
  })

  it('群切换只在内存即时更新，几秒内合并写一次', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 10, 10, 3, 0, 0))
      const file = tempFile()
      const { seam } = await mount(file)
      seam.store.setActive('group:1')

      vi.advanceTimersByTime(1_000)
      seam.store.setActive('group:2')
      const beforeFlush = JSON.parse(fs.readFileSync(file, 'utf8')) as { lastActive: string }
      expect(beforeFlush.lastActive).toBe('group:1')

      vi.advanceTimersByTime(5_000)
      seam.store.setActive('group:3')
      const afterFlush = JSON.parse(fs.readFileSync(file, 'utf8')) as { lastActive: string }
      expect(afterFlush.lastActive).toBe('group:3')
    } finally {
      vi.useRealTimers()
    }
  })

  it('状态带着本次的更新时间', async () => {
    const { seam } = await mount(tempFile())
    seam.store.changeGlobal('mood', 0.1)

    expect(seam.store.read().global.updatedAt).toBeGreaterThan(0)
  })
})

describe('关系工具', () => {
  it('五个关系工具都挂上了，私聊能直接记事件', async () => {
    const { seam, tools } = await mount(tempFile())

    expect([...tools.keys()]).toEqual(expect.arrayContaining([
      'qq_relation_get',
      'qq_relation_record',
      'qq_relation_name',
      'qq_relation_anniversary',
      'qq_relation_remove',
    ]))
    const record = tools.get('qq_relation_record')
    if (record === undefined) throw new Error('关系事件工具没挂上')
    seam.relations.observe({ personId: 'u1', name: '小鱼', chatKey: 'private:u1', at: Date.now() })
    const exec = Object.assign({} as ToolRunContext, {
      agent: { id: 'private:u1' },
      signal: new AbortController().signal,
    })

    const result = await record.execute({ kind: 'promise', summary: '约好周末见' }, exec) as { ok: boolean }

    expect(result.ok).toBe(true)
    expect(seam.relations.events('u1', 5).some(event => event.summary === '约好周末见')).toBe(true)
  })
})

describe('越界与读坏', () => {
  it('心情加减再猛也不越出零到一，这是越界负例', async () => {
    const { seam } = await mount(tempFile())
    seam.store.changeGlobal('mood', 10)
    const high = seam.store.read().global.mood
    seam.store.changeGlobal('mood', -20)
    const low = seam.store.read().global.mood

    expect(high).toBeLessThanOrEqual(1)
    expect(high).toBeGreaterThanOrEqual(0)
    expect(low).toBeLessThanOrEqual(1)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(low).toBeLessThan(high)
  })

  it('状态文件写坏了按初始状态回退，不把半截文件当真，这是失败负例', async () => {
    const file = tempFile()
    fs.writeFileSync(file, '{ 这不是一份完整的状态')

    const { seam } = await mount(file)

    expect(seam.store.read().global.mood).toBeGreaterThan(0)
    expect(seam.render('group:1')).toContain('心情')
  })
})

describe('安静时间里的动机', () => {
  it('一段时间没人说话后，无聊、想说话和好奇会自己涨起来', async () => {
    const { seam } = await mount(tempFile())
    const before = seam.store.read().global

    seam.store.tick(before.updatedAt + 3 * 3_600_000)
    const after = seam.store.read().global

    expect(after.boredom).toBeGreaterThan(before.boredom)
    expect(after.socialHunger).toBeGreaterThan(before.socialHunger)
    expect(after.curiosity).toBeGreaterThan(before.curiosity)
    expect(after.updatedAt).toBe(before.updatedAt + 3 * 3_600_000)
  })
})
