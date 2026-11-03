import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent, PreStepDecision } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention, qqAttentionOf } from '@huoli/huoli-qq-attention'
import { apply as applyMemory, qqMemoryOf } from '@huoli/huoli-qq-memory'
import { apply as applyPacing } from '@huoli/huoli-qq-pacing'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'

interface Mounted {
  ctx: Context
  tools: number
}

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-'))
  tempDirs.push(dir)
  return dir
}

// 工具只登记不执行，这里数的是各零件一共挂上去几个工具
async function mount(dir: string): Promise<Mounted> {
  const ctx = new Context()
  let tools = 0
  ctx.accessor('tools', {
    get: () => ({
      register: () => {
        tools += 1
        return () => {}
      },
    }),
  })
  await ctx.plugin(SystemPrompt, {})
  applyPacing(ctx, { file: path.join(dir, 'pacing.json') })
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyMemory(ctx, { file: path.join(dir, 'memory.json') })
  applyBundle(ctx, { maxSteps: 5, dailySweepHour: 4 })
  return { ctx, tools }
}

const STEP_AGENT = { id: 'group:1' } as Agent

function stepPayload(step: number) {
  return {
    agent: STEP_AGENT,
    messages: [],
    turn: 1,
    step,
    signal: new AbortController().signal,
    modelSelection: { provider: 'test', model: 'test' },
  }
}

const next = async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] })

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('说话规矩', () => {
  it('规矩进了提示词', async () => {
    const { ctx } = await mount(tempDir())

    const assembly = await ctx.systemPrompt.assemble()
    const rules = assembly.sections.find(section => section.name === 'qq:rules')

    expect(rules?.text).toContain('你是群里的一个人')
  })

  it('规矩压在提示词靠后的位置', async () => {
    const { ctx } = await mount(tempDir())

    const names = (await ctx.systemPrompt.assemble()).sections.map(section => section.name)

    expect(names.indexOf('qq:rules')).toBeGreaterThan(names.indexOf('deployment:persona-prefix'))
    expect(names.indexOf('qq:rules')).toBeLessThan(names.indexOf('deployment:persona-suffix'))
  })
})

describe('每轮的步数上限', () => {
  it('步数没超就照常进入这一步', async () => {
    const { ctx } = await mount(tempDir())

    const early = await ctx.waterfall('agent/pre-step', stepPayload(3), next)

    expect(early.kind).toBe('enter')
  })

  it('步数超了就停下', async () => {
    const { ctx } = await mount(tempDir())

    const late = await ctx.waterfall('agent/pre-step', stepPayload(6), next)

    expect(late.kind).toBe('reject')
  })
})

describe('零件都装上了', () => {
  it('注意力装上了', async () => {
    const { ctx } = await mount(tempDir())

    expect(qqAttentionOf(ctx)).toBeDefined()
  })

  it('状态装上了', async () => {
    const { ctx } = await mount(tempDir())

    expect(qqSubjectOf(ctx)).toBeDefined()
  })

  it('记忆装上了', async () => {
    const { ctx } = await mount(tempDir())

    expect(qqMemoryOf(ctx)).toBeDefined()
  })

  it('各零件的工具都登记了', async () => {
    const { tools } = await mount(tempDir())

    expect(tools).toBeGreaterThanOrEqual(5)
  })
})
