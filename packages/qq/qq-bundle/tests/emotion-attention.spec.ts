// 情绪接进注意力：心情重时这一段会多一行事实，候选与打分的口径一个字都不动

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention, qqAttentionOf } from '@huoli/huoli-qq-attention'
import { apply as applySubject } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  qqVitalsOf,
  resolveTuning,
  type VitalsState,
  WORDS_PRESET,
} from '@huoli/huoli-qq-vitals'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle, type Config } from '../src/index.ts'

const tuning = resolveTuning()
const CHAT = 'group:1'
const NOW = Date.now()
// 记仇是存下来的读数，写进去就是它；烦那几项是算出来的，写进去会被重算
const HEAVY = { resentment: 0.9 }

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-emotion-attn-'))
  tempDirs.push(dir)
  return dir
}

// 装配顺序与正式一致：注意力、状态在前，组合包最后接上
async function mount(body: Partial<VitalsState> = {}, config: Config = {}): Promise<Context> {
  const dir = tempDir()
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, NOW - 60_000), ...body })
  const ctx = new Context()
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小鲸鱼'] })
  applySubject(ctx, { file: path.join(dir, 'subject.json') })
  applyVitals(ctx, { file, tuning: { words: WORDS_PRESET, startDelayMs: 60 * 60_000 } })
  qqAttentionOf(ctx)?.inbox.push(CHAT, { senderId: 'u3', text: '@小鲸鱼 你在吗？', at: NOW })
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(dir, 'decisions.jsonl'), ...config })
  return ctx
}

// 取提示词里注意力那一段
async function attentionText(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble({ agent: { id: CHAT } as Agent })
  return assembly.sections.find(section => section.name === 'qq:attention')?.text ?? ''
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('注意力事实里那一行情绪', () => {
  it('心情重时这一段带上当前档位', async () => {
    const ctx = await mount(HEAVY)

    expect(await attentionText(ctx)).toContain('你现在的情绪：心里记着事（很重）')
  })

  it('身体平常时不写这一行，这一段还是原来那些事实', async () => {
    const ctx = await mount()
    const text = await attentionText(ctx)

    expect(text).toContain('文本里出现名字：小鲸鱼')
    expect(text).not.toContain('你现在的情绪')
  })

  it('关掉注意力那一条回路就回到原样', async () => {
    const ctx = await mount(HEAVY, { emotion: { attentionFact: false } })

    expect(await attentionText(ctx)).not.toContain('你现在的情绪')
  })

  it('总开关关掉也回到原样', async () => {
    const ctx = await mount(HEAVY, { emotion: { enabled: false } })

    expect(await attentionText(ctx)).not.toContain('你现在的情绪')
  })

  it('表情不影响现场读数与候选，两处仍是同一份', async () => {
    const ctx = await mount(HEAVY)
    const attention = qqAttentionOf(ctx)
    const signals = attention?.signals(CHAT)

    expect(signals?.addressee.named).toBe(true)
    expect(signals?.candidates.length).toBeGreaterThan(0)
    for (const candidate of signals?.candidates ?? []) {
      expect(Object.keys(candidate).sort()).toEqual(['kind', 'why'])
    }
    expect(qqVitalsOf(ctx)?.read().resentment).toBeGreaterThan(0.55)
  })
})
