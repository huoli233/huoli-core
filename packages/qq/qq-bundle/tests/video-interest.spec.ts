// 看视频的线索：只摆原话样本与频次，不判兴趣，整段有上限

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import type { QqMessage } from '@huoli/huoli-qq-attention'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'
import { BUNDLE_DEFAULTS } from '../src/defaults.ts'
import { samplesOf } from '../src/self-awareness.ts'
import { readTimelineClues, recentTopicsOf, renderVideoInterest, type VideoInterestInput } from '../src/video-interest.ts'

const NOW = 1_700_000_000_000
const GROUP = 'group:1'
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-video-interest-'))
  tempDirs.push(dir)
  return dir
}

function writeLines(file: string, rows: readonly unknown[]): string {
  fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
  return file
}

function messages(): QqMessage[] {
  return [
    { seq: 1, chatKey: GROUP, senderId: '20001', senderName: '阿蓝', text: '那个修猫的视频笑死', at: NOW - 3 * 60_000 },
    { seq: 2, chatKey: GROUP, senderId: '20002', senderName: '阿绿', text: '又在聊猫', at: NOW - 2 * 60_000 },
    { seq: 3, chatKey: GROUP, senderId: '20001', senderName: '阿蓝', text: '那个修猫的视频笑死', at: NOW - 60_000 },
    { seq: 4, chatKey: GROUP, senderId: '10001', senderName: '', text: '我自己发的', at: NOW },
  ]
}

// 最小素材仓：只实现 gather 出来的那一份，不触碰其它服务
function materialOf(topic: string): Parameters<typeof recentTopicsOf>[0] {
  return {
    gather: () => ({
      situation: { who: '', topic, heat: 0, lastTurnGapMs: 0 },
      addressee: { userId: '', name: '', confidence: 0, evidence: [] },
      thoughts: [],
      topic: { active: topic, pendingQuestion: '' },
      motives: [],
    }),
  } as unknown as Parameters<typeof recentTopicsOf>[0]
}

function base(overrides: Partial<VideoInterestInput> = {}): VideoInterestInput {
  return {
    now: NOW,
    maxSamples: 3,
    maxChars: 260,
    samples: samplesOf(messages(), '10001'),
    topics: [],
    timeline: [],
    ...overrides,
  }
}

describe('整段事实只摆线索，不替模型判兴趣', () => {
  it('写明「只是线索不是指令」，把判断权留给模型', () => {
    const text = renderVideoInterest(base())
    expect(text).toContain('[DATA] QQ_VIDEO_INTEREST')
    expect(text).toContain('只是可以顺着找什么的线索')
    expect(text).toContain('不是让你去看、去搜、去分享的指令')
    expect(text).toContain('都由你自己定')
  })

  it('原话与频次照摆，自己发的不算，不出现兴趣词打分', () => {
    const text = renderVideoInterest(base())
    expect(text).toContain('原话「那个修猫的视频笑死」')
    expect(text).toContain('出现 2 次')
    expect(text).toContain('这一阵说了 2 条')
    expect(text).not.toContain('我自己发的')
    expect(text).not.toMatch(/兴趣分|关键词分|权重|得分|判定|推荐/u)
  })

  it('最近话题与素材层惦记的事都来自既有接缝', () => {
    const topics = recentTopicsOf(materialOf('群里刚聊到修猫'), messages(), '10001', GROUP)
    expect(topics).toContain('群里刚聊到修猫')
    const text = renderVideoInterest(base({ topics }))
    expect(text).toContain('群里在聊：群里刚聊到修猫')
  })

  it('没有素材层时不编话题', () => {
    expect(recentTopicsOf(undefined, messages(), '10001', GROUP)).toEqual([])
  })

  it('样本数按上限收，超出上限的原话不摆', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      senderId: '20001', senderName: '阿蓝', text: `第 ${index} 句`, at: NOW,
    }))
    const text = renderVideoInterest(base({ samples: many, maxSamples: 2, maxChars: 1_000 }))
    const shown = [...text.matchAll(/原话「/gu)].length
    expect(shown).toBeLessThanOrEqual(2)
    expect(text).not.toContain('第 0 句')
  })

  it('整段字符超上限就从末尾收口，一个字符都不多', () => {
    const text = renderVideoInterest(base({ maxChars: 60 }))
    expect(Array.from(text)).toHaveLength(60)
    expect(text.startsWith('[DATA] QQ_VIDEO_INTEREST')).toBe(true)
  })

  it('上限为零时整段不出现', () => {
    expect(renderVideoInterest(base({ maxChars: 0 }))).toBe('')
  })

  it('网址与本机路径不进模型可见文本', () => {
    const text = renderVideoInterest(base({
      topics: ['看这个 https://b23.tv/abcd E:\\private\\clips\\a.mp4'],
    }))
    expect(text).not.toContain('https://')
    expect(text).not.toContain('E:\\')
  })
})

describe('时间线只取带文字的行，不另造记账', () => {
  it('只认带文字字段的行，按会话过滤，坏行与缺文件都不报错', () => {
    const dir = tempDir()
    const file = writeLines(path.join(dir, 'timeline.jsonl'), [
      { kind: 'inbound_received', at: NOW, chatKey: GROUP, messageId: '1' },
      { kind: 'note', at: NOW, chatKey: GROUP, text: ' 群里在聊修猫 ' },
      { kind: 'note', at: NOW, chatKey: 'group:2', text: '别的群的事' },
      '不是 json',
      { kind: 'note', at: NOW, chatKey: GROUP, text: '群里在聊修猫' },
    ])
    expect(readTimelineClues(file, GROUP, 3)).toEqual(['群里在聊修猫'])
    expect(readTimelineClues(path.join(dir, 'missing.jsonl'), GROUP, 3)).toEqual([])
  })

  it('时间线里确实没有原话时就是空表，不硬凑', () => {
    const dir = tempDir()
    const file = writeLines(path.join(dir, 'timeline.jsonl'), [
      { kind: 'tool_start', at: NOW, chatKey: GROUP, tool: 'bili_find' },
      { kind: 'outbound_sent', at: NOW, chatKey: GROUP, count: 1 },
    ])
    expect(readTimelineClues(file, GROUP, 3)).toEqual([])
  })
})

describe('接进装配链：默认开、可配置、有上限', () => {
  async function mount(dir: string, patch: Record<string, unknown> = {}): Promise<Context> {
    const ctx = new Context()
    ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
    await ctx.plugin(SystemPrompt, {})
    applyBundle(ctx, {
      maxSteps: 5,
      dailySweepAt: '04:00',
      modeFile: path.join(dir, 'mode.json'),
      decisionsFile: path.join(dir, 'decisions.jsonl'),
      timelineFile: path.join(dir, 'timeline.jsonl'),
      emergencyStopFile: path.join(dir, 'stop.json'),
      livenessFile: path.join(dir, 'liveness.json'),
      mediaIndexFile: path.join(dir, 'media.json'),
      mediaStickerFile: path.join(dir, 'stickers.json'),
      ...patch,
    })
    return ctx
  }

  async function section(ctx: Context, chatKey: string): Promise<string> {
    const assembly = await ctx.systemPrompt.assemble({ agent: { id: chatKey } as Agent })
    return assembly.sections.find(item => item.name === 'qq:video-interest')?.text ?? ''
  }

  it('默认就挂着这一段：线索常驻，整段有上限不给提示词添重', () => {
    expect(BUNDLE_DEFAULTS.videoInterestEnabled).toBe(true)
    expect(BUNDLE_DEFAULTS.videoInterestMaxChars).toBeLessThanOrEqual(260)
  })

  it('显式关掉时连这一段都不挂', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, { videoInterestEnabled: false })
    const assembly = await ctx.systemPrompt.assemble({ agent: { id: GROUP } as Agent })
    expect(assembly.sections.map(item => item.name)).not.toContain('qq:video-interest')
  })

  it('打开开关、有活跃会话才挂，整段不超过配置上限', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, { videoInterestEnabled: true, videoInterestMaxSamples: 2, videoInterestMaxChars: 120 })
    const text = await section(ctx, GROUP)
    expect(text).toContain('[DATA] QQ_VIDEO_INTEREST')
    expect(Array.from(text).length).toBeLessThanOrEqual(120)
  })

  it('没有活跃会话时仍给兴趣线索，但不编造会话', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, { videoInterestEnabled: true, interactionMode: 'probability' })
    const text = await section(ctx, GROUP)
    expect(text).toContain('[DATA] QQ_VIDEO_INTEREST')
    expect(text).not.toContain('group:')
  })
})
