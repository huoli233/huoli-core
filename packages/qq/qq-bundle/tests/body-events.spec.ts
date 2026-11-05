import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { ToolDefinition, ToolRunContext } from '@huoli/huoli-tools'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applySubject } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals, createVitalsStore, emptyState, qqVitalsOf, resolveTuning, type QqVitalsSeam, type VitalsState,
} from '@huoli/huoli-qq-vitals'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'

const tuning = resolveTuning()
const AT = new Date(2026, 10, 5, 10, 0, 0).getTime()

const roots: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-body-event-'))
  roots.push(dir)
  return dir
}

interface Mounted {
  vitals: QqVitalsSeam
  tool: (name: string) => ToolDefinition
}

// 把挂上来的工具收下来，身体用一份种好的状态：口渴与饥饿都到一半
async function mount(body: Partial<VitalsState> = {}): Promise<Mounted> {
  const dir = tempDir()
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write({
    ...emptyState(tuning, AT - 60_000),
    thirst: 0.5,
    hunger: 0.5,
    ...body,
  })
  const ctx = new Context()
  const tools = new Map<string, ToolDefinition>()
  ctx.accessor('tools', {
    get: () => ({
      register: (definition: ToolDefinition) => {
        tools.set(definition.name, definition)
        return () => {}
      },
    }),
  })
  await ctx.plugin(SystemPrompt, {})
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyVitals(ctx, { file, tuning: { startDelayMs: 60 * 60_000 } })
  applyBundle(ctx, {
    maxSteps: 5,
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    dailySweepAt: '04:00',
  })
  const vitals = qqVitalsOf(ctx)
  if (vitals === undefined) throw new Error('身体没装上')
  const tool = (name: string): ToolDefinition => {
    const found = tools.get(name)
    if (found === undefined) throw new Error(`没有注册工具 ${name}`)
    return found
  }
  return { vitals, tool }
}

// 工具体只读会话编号与取消信号，其余字段由内核在真实调用时给
function execOf(): ToolRunContext {
  return Object.assign({} as ToolRunContext, { agent: { id: 'group:1' }, signal: new AbortController().signal })
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('身体事件由模型报', () => {
  it('报喝了就掉口渴，名字也记下来', async () => {
    const { vitals, tool } = await mount()
    const before = vitals.read()

    await tool('qq_body_event').execute({ events: [{ kind: 'drank', name: '奶茶' }] }, execOf())

    const after = vitals.read()
    expect(after.thirst).toBeLessThan(before.thirst)
    expect(after.last_drink_name).toBe('奶茶')
  })

  it('报吃了就掉饥饿', async () => {
    const { vitals, tool } = await mount()
    const before = vitals.read()

    await tool('qq_body_event').execute({ events: [{ kind: 'ate' }] }, execOf())

    expect(vitals.read().hunger).toBeLessThan(before.hunger)
  })

  it('报被凶就把怒气抬起来', async () => {
    const { vitals, tool } = await mount()
    const before = vitals.read()

    await tool('qq_body_event').execute({ events: [{ kind: 'scolded' }] }, execOf())

    expect(vitals.read().anger).toBeGreaterThan(before.anger)
  })

  it('一次报好几件事，按顺序都做', async () => {
    const { vitals, tool } = await mount()
    const before = vitals.read()

    await tool('qq_body_event').execute({
      events: [{ kind: 'drank' }, { kind: 'ate' }, { kind: 'praised' }],
    }, execOf())

    const after = vitals.read()
    expect(after.thirst).toBeLessThan(before.thirst)
    expect(after.hunger).toBeLessThan(before.hunger)
    expect(after.dopamine).toBeGreaterThan(before.dopamine)
  })

  it('不认识的事一律拒，并说清下一步', async () => {
    const { tool } = await mount()

    await expect(tool('qq_body_event').execute({ events: [{ kind: '被绿了' }] }, execOf()))
      .rejects.toThrow(/body\.unknown_kind: .+｜下一步: .+/u)
  })

  it('什么都没报也拒', async () => {
    const { tool } = await mount()

    await expect(tool('qq_body_event').execute({ events: [] }, execOf()))
      .rejects.toThrow(/body\.no_events/u)
  })

  it('不调这个工具时，光发一句话不动身体：不吃关键词', async () => {
    const { vitals } = await mount()

    // 词表默认空着：这一句谁也认不出来，身体只会随时间走，不会因为这句话掉下去
    vitals.react('我喝了奶茶，还吃了面', AT)
    const after = vitals.read()

    expect(after.thirst).toBeGreaterThan(0.5)
    expect(after.hunger).toBeGreaterThan(0.5)
  })
})
