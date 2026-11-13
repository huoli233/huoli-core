import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import type { ToolExecution, ToolExecutionToken } from '@huoli/huoli-tools'
import { ToolCallId } from '@huoli/huoli-llm'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention, qqAttentionOf } from '@huoli/huoli-qq-attention'
import { apply as applyPacing } from '@huoli/huoli-qq-pacing'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'
import { stickerCandidateFacts, STICKER_SEND_TOOL } from '../src/sticker-facts.ts'

const CHAT = 'group:1'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-sticker-facts-'))
  tempDirs.push(dir)
  return dir
}

function libraryIn(dir: string, rows: readonly unknown[]): { file: string; usage: string } {
  const file = path.join(dir, 'qq-stickers.json')
  fs.writeFileSync(file, JSON.stringify(rows))
  return { file, usage: path.join(dir, 'qq-sticker-usage.json') }
}

// 装配只需要提示词与注意力两路：场景从收件箱里最近几条取
async function mount(
  dir: string,
  library: { file: string; usage: string },
  said: readonly string[] = [],
  patch: Record<string, unknown> = {},
): Promise<Context> {
  const ctx = new Context()
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyPacing(ctx, { file: path.join(dir, 'pacing.json') })
  applyAttention(ctx, { file: path.join(dir, 'attention.json'), selfNames: ['小岸'] })
  applyBundle(ctx, {
    maxSteps: 5,
    dailySweepAt: '04:00',
    modeFile: path.join(dir, 'mode.json'),
    decisionsFile: path.join(dir, 'decisions.jsonl'),
    timelineFile: path.join(dir, 'timeline.jsonl'),
    emergencyStopFile: path.join(dir, 'stop.json'),
    livenessFile: path.join(dir, 'liveness.json'),
    stickerFile: library.file,
    stickerUsageFile: library.usage,
    ...patch,
  })
  const inbox = qqAttentionOf(ctx)?.inbox
  said.forEach((text, index) => inbox?.push(CHAT, {
    messageId: `m-${index}`,
    senderId: '1',
    senderName: '甲',
    text,
    at: Date.now() + index,
    atMe: false,
    replyToBot: false,
  }))
  return ctx
}

async function stickerText(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble({ agent: { id: CHAT } as Agent })
  return assembly.sections.find(section => section.name === 'qq:sticker-candidates')?.text ?? ''
}

function stubExecution(name: string, agentId: string): ToolExecution {
  return {
    callId: ToolCallId('call-1'),
    signal: new AbortController().signal,
    name,
    arguments: {},
    agent: { id: agentId } as Agent,
    token: Symbol('qq-sticker-facts-test') as ToolExecutionToken,
    rootCallId: ToolCallId('call-1'),
  }
}

const TIRED = {
  id: 'tired',
  tag: '困 累',
  tags: ['下班'],
  emotions: ['累了'],
  intensity: 0.8,
  usage: '接一句累',
  file: 'tired.png',
}

describe('候选写成事实', () => {
  it('一句一条，写清编号、为什么和怎么用', () => {
    const text = stickerCandidateFacts({
      ok: true,
      librarySize: 2,
      candidates: [{ id: 'tired', reasons: ['情绪匹配：累了'], usage: '接一句累' }],
    })

    expect(text).toContain('很适合配一张表情包')
    expect(text).toContain('- tired 因为 情绪匹配：累了，用的时候：接一句累')
    expect(text).toContain(STICKER_SEND_TOOL)
  })

  it('库是空的只说一句没有', () => {
    expect(stickerCandidateFacts({ ok: true, librarySize: 0, candidates: [] })).toBe('库里还没有表情包，这一轮不用配图。')
  })

  it('刚发过或没有候选时什么都不说', () => {
    expect(stickerCandidateFacts({ ok: false, code: 'sticker.just_sent', reason: '这一处刚发过一张表情包' })).toBe('')
    expect(stickerCandidateFacts({ ok: true, librarySize: 3, candidates: [] })).toBe('')
  })
})

describe('提示词里的表情候选', () => {
  it('场景对上就给候选，并说清发不发由模型定', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, libraryIn(dir, [TIRED]), ['刚下班'])

    const text = await stickerText(ctx)

    expect(text).toContain('- tired 因为 场景相近：下班')
    expect(text).toContain('发不发你自己判断')
  })

  it('这一处刚发过就不再推', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, libraryIn(dir, [TIRED]), ['刚下班'])
    expect(await stickerText(ctx)).toContain('- tired 因为')

    ctx.emit('tools/result', stubExecution(STICKER_SEND_TOOL, CHAT), { isError: false, value: { ok: true }, content: [] })

    expect(await stickerText(ctx)).toBe('')
  })

  it('别的会话刚发过，不影响这一处', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, libraryIn(dir, [TIRED]), ['刚下班'])

    ctx.emit('tools/result', stubExecution(STICKER_SEND_TOOL, 'group:2'), { isError: false, value: { ok: true }, content: [] })

    expect(await stickerText(ctx)).toContain('- tired 因为')
  })

  it('没发出去的那一次不算刚发过', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, libraryIn(dir, [TIRED]), ['刚下班'])

    ctx.emit('tools/result', stubExecution(STICKER_SEND_TOOL, CHAT), {
      isError: true,
      error: { message: '没发出去', info: { name: 'Error', code: 'channel.send_failed' } },
      content: [],
    })

    expect(await stickerText(ctx)).toContain('- tired 因为')
  })

  it('库是空的也只说一句没有，不报错', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, libraryIn(dir, []), ['刚下班'])

    expect(await stickerText(ctx)).toBe('库里还没有表情包，这一轮不用配图。')
  })

  it('眼下没有对得上的地方就不推', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, libraryIn(dir, [TIRED]), ['今天在加班'])

    expect(await stickerText(ctx)).toBe('')
  })

  it('关掉这一路就整段不挂', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, libraryIn(dir, [TIRED]), ['刚下班'], { stickerSuggest: false })

    const assembly = await ctx.systemPrompt.assemble({ agent: { id: CHAT } as Agent })
    expect(assembly.sections.map(section => section.name)).not.toContain('qq:sticker-candidates')
  })
})
