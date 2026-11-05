import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import SystemPrompt from '@huoli/huoli-system-prompt'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, NARRATIVE_CHAPTERS } from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-tools-'))
  roots.push(root)
  return path.join(root, 'self')
}

// 工具只读会话编号与取消信号，其余执行字段由内核在真实调用时注入
function execOf(chatKey = 'group:1'): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: chatKey }, signal: new AbortController().signal })
}

interface Mounted {
  tool: (name: string) => ToolDefinition
  names: readonly string[]
  dir: string
}

async function mount(enabled = true): Promise<Mounted> {
  const dir = tempDir()
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  const registered = new Map<string, ToolDefinition>()
  ctx.provide('tools', {
    register: (definition: ToolDefinition) => {
      registered.set(definition.name, definition)
      return () => {}
    },
  })
  apply(ctx, { enabled, dir, mainChatKey: 'group:1' })
  const tool = (name: string): ToolDefinition => {
    const found = registered.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { tool, names: [...registered.keys()], dir }
}

function rows(dir: string, name: string): Record<string, unknown>[] {
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('写入口挂上了', () => {
  it('这一层开着就注册全套写入口', async () => {
    const { names } = await mount()

    expect(names).toEqual([
      'qq_self_day',
      'qq_self_skip_day',
      'qq_self_question',
      'qq_self_error',
      'qq_self_claim',
      'qq_self_commitment',
      'qq_self_project',
      'qq_self_ledger',
      'qq_self_identity',
      'qq_self_narrative',
      'qq_self_stage',
      'qq_self_versions',
    ])
  })

  it('这一层关着就一个写入口都不露', async () => {
    const { names } = await mount(false)

    expect(names).toEqual([])
  })
})

describe('真的能写进目录', () => {
  it('三行写进 day.jsonl', async () => {
    const { tool, dir } = await mount()

    await tool('qq_self_day').execute(
      { lines: ['今天把周报写成了一句', '夜里那句话没说完', '明天先列三条'] },
      execOf(),
    )

    const kept = rows(dir, 'day.jsonl')
    expect(kept).toHaveLength(1)
    expect(kept[0]?.lines).toEqual(['今天把周报写成了一句', '夜里那句话没说完', '明天先列三条'])
  })

  it('相信的事带证据才落 claims.jsonl', async () => {
    const { tool, dir } = await mount()

    await tool('qq_self_claim').execute(
      { text: '他半夜说话更软', confidence: 0.6, evidence: ['2026-11-03'] },
      execOf(),
    )

    const kept = rows(dir, 'claims.jsonl')
    expect(kept).toHaveLength(1)
    expect(kept[0]?.text).toBe('他半夜说话更软')
  })

  it('列版本能看见刚存下来的那一份', async () => {
    const { tool } = await mount()
    const chapter = NARRATIVE_CHAPTERS[0]
    if (chapter === undefined) throw new Error('叙事一章都没有')

    await tool('qq_self_narrative').execute({ chapter, text: '我还在' }, execOf())
    const listed = await tool('qq_self_versions').execute({ kind: 'narrative' }, execOf()) as {
      entries: readonly { name: string }[]
    }

    expect(Array.isArray(listed.entries)).toBe(true)
  })
})

describe('写不成要说清为什么', () => {
  it('三行少一条就拒，并说清是条数不对', async () => {
    const { tool, dir } = await mount()

    await expect(tool('qq_self_day').execute({ lines: ['只有一条'] }, execOf()))
      .rejects.toThrow(/self\.bad_lines: .+｜下一步: .+/u)
    expect(rows(dir, 'day.jsonl')).toHaveLength(0)
  })

  it('相信的事没有证据就拒', async () => {
    const { tool, dir } = await mount()

    await expect(tool('qq_self_claim').execute({ text: '我觉得是这样', confidence: 0.5 }, execOf()))
      .rejects.toThrow(/self\.no_evidence/u)
    expect(rows(dir, 'claims.jsonl')).toHaveLength(0)
  })

  it('身份主张只能是那三档', async () => {
    const { tool } = await mount()

    await expect(tool('qq_self_identity').execute({ claim: 'alive-ish', why: '感觉', evidence: ['2026-11-03'] }, execOf()))
      .rejects.toThrow(/self\.unknown_claim/u)
  })

  it('账只分两档，drive 的需要也得在名单里', async () => {
    const { tool } = await mount()

    await expect(tool('qq_self_ledger').execute({ kind: 'drive', need: '想吃火锅' }, execOf()))
      .rejects.toThrow(/self\.unknown_need/u)
    await expect(tool('qq_self_ledger').execute({ kind: 'whatever' }, execOf()))
      .rejects.toThrow(/self\.unknown_need/u)
  })

  it('空着不发也算失败，不静默当成写过了', async () => {
    const { tool } = await mount()

    await expect(tool('qq_self_question').execute({ text: '   ' }, execOf()))
      .rejects.toThrow(/self\.empty/u)
  })
})
