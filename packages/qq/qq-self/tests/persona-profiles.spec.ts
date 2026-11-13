import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, createPersonaCatalog, qqSelfOf } from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-persona-'))
  roots.push(root)
  return root
}

async function mount(root: string, enabled = true) {
  const ctx = new Context()
  ctx.provide('tools', { register: () => () => {} })
  await ctx.plugin(SystemPrompt, {})
  apply(ctx, {
    enabled,
    dir: path.join(root, 'self'),
    personaProfiles: [
      {
        id: 'gentle',
        name: '温和角色',
        summary: '平时慢一点',
        values: ['守信'],
        boundaries: ['不替别人做决定'],
        tone: { private: '私聊里更放松', group: '群里少说一点', proactive: '主动时先想清楚' },
      },
      {
        id: 'lively',
        name: '活泼角色',
        summary: '更爱接话',
        tone: { private: '私聊里更直接', group: '群里可以接梗' },
      },
    ],
    activePersonaId: 'gentle',
  })
  const seam = qqSelfOf(ctx)
  if (seam === undefined) throw new Error('自我层没有装配')
  return { ctx, seam }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('角色补充档案', () => {
  it('多角色能保存、选择、按会话绑定并持久化', () => {
    const file = path.join(tempDir(), 'personas.json')
    const catalog = createPersonaCatalog(file)
    catalog.upsert({ id: 'a', name: '甲', tone: { private: '轻一点' } }, 1_000)
    catalog.upsert({ id: 'b', name: '乙', tone: { group: '稳一点' } }, 2_000)
    catalog.setActive('a')
    catalog.bind('group:1', 'b')

    expect(catalog.forChat('group:1')?.id).toBe('b')
    expect(catalog.render('group:1')).toContain('稳一点')
    expect(catalog.render('private:u1')).toContain('轻一点')

    const reopened = createPersonaCatalog(file)
    expect(reopened.active()?.id).toBe('a')
    expect(reopened.forChat('group:1')?.id).toBe('b')
  })

  it('删除当前角色后自动换到还留着的角色，绑定一起清掉', () => {
    const catalog = createPersonaCatalog(path.join(tempDir(), 'personas.json'))
    catalog.upsert({ id: 'a', name: '甲' }, 1_000)
    catalog.upsert({ id: 'b', name: '乙' }, 2_000)
    catalog.setActive('a')
    catalog.bind('group:1', 'a')

    expect(catalog.remove('a')).toBe(true)
    expect(catalog.active()?.id).toBe('b')
    expect(catalog.forChat('group:1')?.id).toBe('b')
  })

  it('角色补充进入提示词，核心身份说明不会被覆盖', async () => {
    const { ctx } = await mount(tempDir())

    const assembly = await ctx.systemPrompt.assemble({ agent: { id: 'group:1' } as Agent })
    const section = assembly.sections.find(item => item.name === 'qq:persona-profile')

    expect(section?.text).toContain('温和角色')
    expect(section?.text).toContain('群里少说一点')
    expect(section?.text).toContain('不覆盖核心身份')
  })

  it('渠道不同会选不同语气', async () => {
    const { seam } = await mount(tempDir())

    expect(seam.personaProfile('private:u1')).toMatchObject({ id: 'gentle' })
    const privatePrompt = createPersonaCatalog(path.join(tempDir(), 'unused.json'))
    privatePrompt.upsert({
      id: 'gentle',
      name: '温和角色',
      tone: { private: '私聊里更放松', group: '群里少说一点' },
    }, 1_000)

    expect(privatePrompt.render('private:u1')).toContain('私聊里更放松')
    expect(privatePrompt.render('group:1')).toContain('群里少说一点')
  })

  it('关着时不写角色档案', async () => {
    const root = tempDir()
    const { seam } = await mount(root, false)

    expect(seam.savePersonaProfile({ id: 'x', name: '新角色' })).toEqual({
      written: false,
      proposed: false,
      reason: 'disabled',
    })
    expect(fs.existsSync(path.join(root, 'self', 'persona-profiles.json'))).toBe(false)
  })
})
