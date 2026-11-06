import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import { SystemPrompt } from '@huoli/huoli-system-prompt'
import type { Agent } from '@huoli/huoli-agent'
import { apply } from '../src/index.ts'
import { createSelfStore } from '../src/store.ts'
import { resolveSettings } from '../src/defaults.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-rules-'))
  dirs.push(dir)
  return dir
}

function open(dir: string) {
  const store = createSelfStore({ dir, settings: resolveSettings({ versionsKeep: 3 }) })
  store.ensure()
  return store
}

describe('人格规矩的版本', () => {
  it('第一次存就留下一份，正本原样抄进去', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    fs.writeFileSync(rules, '第一条：别装\n')
    const store = open(path.join(root, 'self'))

    const saved = store.snapshotExternal(rules, 'rules', new Date(2026, 10, 6, 9, 0).getTime())

    expect(saved).toMatch(/^rules-/u)
    const kept = store.listVersions('rules')
    expect(kept).toHaveLength(1)
    expect(fs.readFileSync(path.join(store.dir, 'versions', kept[0]?.name ?? ''), 'utf8')).toBe('第一条：别装\n')
  })

  it('一字没改就不再存一版', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    fs.writeFileSync(rules, '第一条：别装\n')
    const store = open(path.join(root, 'self'))
    const at = new Date(2026, 10, 6, 9, 0).getTime()

    store.snapshotExternal(rules, 'rules', at)
    const again = store.snapshotExternal(rules, 'rules', at + 60_000)

    expect(again).toBeUndefined()
    expect(store.listVersions('rules')).toHaveLength(1)
  })

  it('改了就再存一版，旧的那份还在', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    const store = open(path.join(root, 'self'))
    const at = new Date(2026, 10, 6, 9, 0).getTime()

    fs.writeFileSync(rules, '旧的一条\n')
    store.snapshotExternal(rules, 'rules', at)
    fs.writeFileSync(rules, '新的一条\n')
    store.snapshotExternal(rules, 'rules', at + 60_000)

    expect(store.listVersions('rules')).toHaveLength(2)
  })

  it('份数按参数滚，超出的最旧的先删', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    const store = open(path.join(root, 'self'))
    let at = new Date(2026, 10, 6, 9, 0).getTime()

    for (const body of ['一', '二', '三', '四', '五']) {
      fs.writeFileSync(rules, `${body}\n`)
      store.snapshotExternal(rules, 'rules', at)
      at += 60_000
    }

    expect(store.listVersions('rules')).toHaveLength(3)
  })

  it('正本不在时什么也不做', () => {
    const root = tempDir()
    const store = open(path.join(root, 'self'))

    expect(store.snapshotExternal(path.join(root, '没有这份.md'), 'rules', Date.now())).toBeUndefined()
    expect(store.listVersions('rules')).toEqual([])
  })
})

describe('人格正文的版本', () => {
  it('存一版之后能列出来，改一句就是新的一版', () => {
    const root = tempDir()
    const persona = path.join(root, 'persona.md')
    const store = open(path.join(root, 'self'))
    const at = new Date(2026, 10, 6, 9, 0).getTime()

    fs.writeFileSync(persona, '我是小鲸鱼。\n')
    store.snapshotExternal(persona, 'persona', at)
    fs.writeFileSync(persona, '我是小鲸鱼，爱犯困。\n')
    store.snapshotExternal(persona, 'persona', at + 60_000)

    expect(store.listVersions('persona')).toHaveLength(2)
    expect(store.listVersions('rules')).toEqual([])
  })

  it('人格与规矩两类版本互不串门', () => {
    const root = tempDir()
    const persona = path.join(root, 'persona.md')
    const rules = path.join(root, 'rules.md')
    const store = open(path.join(root, 'self'))
    const at = new Date(2026, 10, 6, 9, 0).getTime()

    fs.writeFileSync(persona, '人格\n')
    fs.writeFileSync(rules, '规矩\n')
    const personaVersion = store.snapshotExternal(persona, 'persona', at) ?? ''
    const rulesVersion = store.snapshotExternal(rules, 'rules', at) ?? ''

    expect(personaVersion.startsWith('persona-')).toBe(true)
    expect(rulesVersion.startsWith('rules-')).toBe(true)
    // 种类与名字必须对上，拿规矩的版本名当人格的会被拒
    expect(store.restoreExternal(persona, 'persona', rulesVersion).code).toBe('versions.name_invalid')
  })

  it('拿人格的旧版盖回去，盖之前先把现在这份存下来', () => {
    const root = tempDir()
    const persona = path.join(root, 'persona.md')
    const store = open(path.join(root, 'self'))
    const at = new Date(2026, 10, 6, 9, 0).getTime()

    fs.writeFileSync(persona, '原来的我\n')
    store.snapshotExternal(persona, 'persona', at)
    const first = store.listVersions('persona')[0]?.name ?? ''
    fs.writeFileSync(persona, '被改坏的我\n')

    const outcome = store.restoreExternal(persona, 'persona', first)

    expect(outcome.ok).toBe(true)
    expect(fs.readFileSync(persona, 'utf8')).toBe('原来的我\n')
    expect(outcome.savedCurrent).toBeDefined()
  })
})

describe('用旧版盖回去', () => {
  it('盖回去之后正本变成那一版，现场也留了一份', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    const store = open(path.join(root, 'self'))
    const at = new Date(2026, 10, 6, 9, 0).getTime()

    fs.writeFileSync(rules, '好的一条\n')
    store.snapshotExternal(rules, 'rules', at)
    const old = store.listVersions('rules')[0]?.name ?? ''
    fs.writeFileSync(rules, '改坏的一条\n')

    const outcome = store.restoreExternal(rules, 'rules', old)

    expect(outcome.ok).toBe(true)
    expect(outcome.restoredFrom).toBe(old)
    expect(outcome.savedCurrent).toBeDefined()
    expect(fs.readFileSync(rules, 'utf8')).toBe('好的一条\n')
    expect(store.listVersions('rules')).toHaveLength(2)
  })

  it('名字不是这个种类的就拒绝', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    fs.writeFileSync(rules, '一条\n')
    const store = open(path.join(root, 'self'))

    const outcome = store.restoreExternal(rules, 'rules', 'panel-20261106-0900.md')

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('versions.name_invalid')
    expect(outcome.hint).toBeTruthy()
  })

  it('找不到那一份就拒绝', () => {
    const root = tempDir()
    const rules = path.join(root, 'rules.md')
    fs.writeFileSync(rules, '一条\n')
    const store = open(path.join(root, 'self'))

    const outcome = store.restoreExternal(rules, 'rules', 'rules-20261106-0900.md')

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('versions.missing')
  })
})

describe('人格正文进提示词', () => {
  it('文件里有正文时，部署人格那一段就是它', async () => {
    const root = tempDir()
    const persona = path.join(root, 'persona.md')
    fs.writeFileSync(persona, '我是小鲸鱼，爱犯困。\n')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin({
      name: 'qq-self-persona',
      inject: ['systemPrompt'],
      apply: (context: Context) => {
        apply(context, { enabled: true, dir: path.join(root, 'self'), personaFile: persona, mainChatKey: 'group:1' })
      },
    })

    const assembly = await ctx.systemPrompt.assemble({ agent: { id: 'group:1' } as Agent })
    const section = assembly.sections.find(entry => entry.name === 'qq:persona')

    expect(section?.text).toBe('我是小鲸鱼，爱犯困。')
  })

  it('文件不在时不多出这一段', async () => {
    const root = tempDir()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin({
      name: 'qq-self-persona',
      inject: ['systemPrompt'],
      apply: (context: Context) => {
        apply(context, { enabled: true, dir: path.join(root, 'self'), personaFile: path.join(root, '没有.md'), mainChatKey: 'group:1' })
      },
    })

    const assembly = await ctx.systemPrompt.assemble({ agent: { id: 'group:1' } as Agent })

    expect(assembly.sections.some(entry => entry.name === 'qq:persona')).toBe(false)
  })
})
