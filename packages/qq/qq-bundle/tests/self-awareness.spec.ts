import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import type { QqMessage } from '@huoli/huoli-qq-attention'
import { afterEach, describe, expect, it } from 'vitest'
import { apply as applyBundle } from '../src/index.ts'
import {
  readMediaItems, readSelfTalkRecords, readStickerItems, renderRuntimeEnvironment,
  renderSelfAwareness, renderSelfTalk, runtimeEnvironmentFacts, samplesOf,
  type SelfAwarenessInput, type SelfTalkRecord,
} from '../src/self-awareness.ts'

const NOW = 1_700_000_000_000
const MIN = 60_000
const GROUP = 'group:1'
const GROUP2 = 'group:2'
const WINDOWS = [5 * MIN, 20 * MIN, 60 * MIN] as const
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-awareness-'))
  tempDirs.push(dir)
  return dir
}

function writeLines(dir: string, name: string, rows: readonly unknown[]): string {
  const file = path.join(dir, name)
  fs.writeFileSync(file, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
  return file
}

function round(at: number, chatKey: string, sent: number, reason: string, traceIds: readonly string[] = []): Record<string, unknown> {
  return { kind: 'round', at, chatKey, awake: true, reason, attempted: true, sent, blocked: null, traceIds }
}

function output(records: readonly SelfTalkRecord[], now = NOW, windowsMs: readonly number[] = WINDOWS): string {
  return renderSelfTalk(records, windowsMs, now)
}

function base(overrides: Partial<SelfAwarenessInput> = {}): SelfAwarenessInput {
  return {
    now: NOW,
    windowsMs: WINDOWS,
    maxSamples: 6,
    maxChars: 1_600,
    records: [],
    selfName: '小鲸鱼',
    selfId: '10001',
    selfDescription: '蓝色长发',
    selfImages: [],
    personaName: '',
    personaSummary: '',
    chatKey: GROUP,
    samples: [],
    media: [],
    stickers: [],
    ...overrides,
  }
}

describe('DSH 本体目录与运行范围', () => {
  it('主人私聊能看到核心、DSH、插件和 profile 目录，外部会话隐藏绝对路径', () => {
    const dir = tempDir()
    const core = path.join(dir, 'huoli-core')
    const plugins = path.join(dir, 'plugins')
    fs.mkdirSync(plugins, { recursive: true })
    fs.writeFileSync(path.join(plugins, 'plugins.json'), JSON.stringify({
      version: 1,
      plugins: [{ id: 'dsh-bili-eyes', dir: 'plugins/dsh-bili-eyes', version: '0.8.3', enabled: true }],
    }))
    const facts = runtimeEnvironmentFacts({
      DSH_HOME: path.join(dir, 'runtime', 'dsh-home'),
      QQ_SELF_CORE_ROOT: core,
      QQ_SELF_WORKSPACE_ROOT: dir,
      QQ_SELF_PLUGIN_ROOT: plugins,
      QQ_SELF_PROFILE_ROOT: path.join(dir, 'profile'),
    }, core)
    const owner = renderRuntimeEnvironment(facts, {
      owner: true,
      tools: ['self_evolve', 'plugin_manager', 'qq_image_view', 'qq_body_doctor', 'cordis_inspect_list', 'read', 'edit', 'bash'],
    })
    const guest = renderRuntimeEnvironment(facts, {
      owner: false,
      tools: ['self_evolve', 'qq_image_view'],
    })

    expect(owner).toContain(`CORE_ROOT: ${core}`)
    expect(owner).toContain(`PLUGIN_REGISTRY: ${path.join(plugins, 'plugins.json')}`)
    expect(owner).toContain(`- dsh-bili-eyes 0.8.3 → ${path.join(dir, 'plugins', 'dsh-bili-eyes')}`)
    expect(owner).toContain('FILE_ACCESS_IN_QQ: owner_private_read_available')
    expect(owner).toContain('CODE_EDIT_IN_QQ: owner_private_edit_available')
    expect(owner).toContain('TERMINAL_IN_QQ: owner_private_terminal_available')
    expect(owner).toContain('repair reversible runtime faults automatically')
    expect(owner).toContain('qq_body_doctor_available')
    expect(owner).toContain('plugin_manager')
    expect(guest).toContain('ABSOLUTE_PATHS: hidden_outside_owner_private')
    expect(guest).not.toContain(core)
    expect(guest).toContain('VISIBLE_TOOLS: qq_image_view, self_evolve')
  })
})

describe('三档发言统计只按既有记录算', () => {
  it('五分钟、二十分钟、一小时各算各的', () => {
    const records: SelfTalkRecord[] = [
      { at: NOW - 3 * MIN, chatKey: GROUP, sent: 1, proactive: false },
      { at: NOW - 12 * MIN, chatKey: GROUP, sent: 2, proactive: false },
      { at: NOW - 40 * MIN, chatKey: GROUP, sent: 3, proactive: false },
      { at: NOW - 90 * MIN, chatKey: GROUP, sent: 9, proactive: false },
    ]
    const text = output(records)
    expect(text).toContain('[DATA] QQ_SELF_TALK')
    expect(text).toContain('近 5 分钟：我发了 1 条，涉及 1 个会话，其中主动开口 0 条、被动回复 1 条')
    expect(text).toContain('近 20 分钟：我发了 3 条，涉及 1 个会话，其中主动开口 0 条、被动回复 3 条')
    expect(text).toContain('近 1 小时：我发了 6 条，涉及 1 个会话，其中主动开口 0 条、被动回复 6 条')
  })

  it('刚好落在窗口边界那条不算，窗口内的算', () => {
    const records: SelfTalkRecord[] = [
      { at: NOW - 5 * MIN, chatKey: GROUP, sent: 1, proactive: false },
      { at: NOW, chatKey: GROUP, sent: 1, proactive: false },
    ]
    expect(output(records, NOW, [5 * MIN])).toContain('我发了 1 条')
  })

  it('跨会话分别计，会话数按不重复的会话键算', () => {
    const records: SelfTalkRecord[] = [
      { at: NOW - MIN, chatKey: GROUP, sent: 2, proactive: false },
      { at: NOW - 2 * MIN, chatKey: GROUP2, sent: 3, proactive: false },
      { at: NOW - 3 * MIN, chatKey: GROUP, sent: 1, proactive: false },
    ]
    expect(output(records, NOW, [5 * MIN])).toContain('我发了 6 条，涉及 2 个会话')
  })

  it('主动开口与被动回复分开，只给数字不评判', () => {
    const records: SelfTalkRecord[] = [
      { at: NOW - MIN, chatKey: GROUP, sent: 2, proactive: true },
      { at: NOW - 2 * MIN, chatKey: GROUP, sent: 3, proactive: false },
    ]
    const text = output(records, NOW, [5 * MIN])
    expect(text).toContain('主动开口 2 条、被动回复 3 条')
    expect(text).not.toMatch(/话太多|话多|太多|少说|克制|收敛/u)
  })

  it('没有可用窗口时整段不出现', () => {
    expect(output([{ at: NOW, chatKey: GROUP, sent: 1, proactive: false }], NOW, [])).toBe('')
  })
})

describe('发言记录读两份既有文件，不另造账', () => {
  it('轮次记录给条数与来路，时间线按追踪编号补上没进轮次的那几次', () => {
    const dir = tempDir()
    const decisions = writeLines(dir, 'qq-decisions.jsonl', [
      round(NOW - MIN, GROUP, 2, 'incoming', [`${GROUP}#msg-1`]),
      round(NOW - 2 * MIN, GROUP, 1, 'autonomous-nudge', [`${GROUP}#msg-2`]),
      { kind: 'considered', at: NOW - 3 * MIN, chatKey: GROUP, awake: false, reason: 'proactive:quiet', attempted: false, sent: 0, blocked: null },
      round(NOW - 4 * MIN, GROUP2, 3, 'incoming', [`${GROUP2}#msg-3`]),
    ])
    const timeline = writeLines(dir, 'qq-timeline.jsonl', [
      { kind: 'outbound_sent', at: NOW - MIN, chatKey: GROUP, traceId: `${GROUP}#msg-1`, count: 2 },
      { kind: 'outbound_sent', at: NOW - 5 * MIN, chatKey: GROUP, traceId: `${GROUP}#msg-9`, count: 1 },
      { kind: 'reply_fallback_sent', at: NOW - MIN, chatKey: GROUP, traceId: `${GROUP}#msg-1`, reason: 'incoming' },
      { kind: 'inbound_received', at: NOW - MIN, chatKey: GROUP, traceId: `${GROUP}#msg-1` },
    ])
    const records = readSelfTalkRecords(decisions, timeline)
    expect(records).toHaveLength(4)
    expect(records.filter(record => record.proactive)).toHaveLength(1)
    expect(records.reduce((sum, record) => sum + record.sent, 0)).toBe(7)
    const text = output(records, NOW, [60 * MIN])
    expect(text).toContain('我发了 7 条，涉及 2 个会话，其中主动开口 1 条、被动回复 6 条')
  })

  it('文件不存在、坏行与格式不对都不报错也不编造', () => {
    const dir = tempDir()
    const bad = path.join(dir, 'bad.jsonl')
    fs.writeFileSync(bad, '不是 json\n{"kind":"outbound_sent","chatKey":"group:1"}\n')
    expect(readSelfTalkRecords(path.join(dir, 'missing-d.jsonl'), path.join(dir, 'missing-t.jsonl'))).toEqual([])
    expect(readSelfTalkRecords(bad, bad)).toEqual([])
    expect(readMediaItems(path.join(dir, 'missing-media.json'))).toEqual([])
    expect(readStickerItems(path.join(dir, 'missing-stickers.json'))).toEqual([])
    expect(renderSelfAwareness(base({ records: [], maxChars: 1_600 }))).not.toContain('[DATA] QQ_SELF_TALK')
  })

  it('时间线里没有追踪编号的那一条按自己起头算', () => {
    const dir = tempDir()
    const timeline = writeLines(dir, 'qq-timeline.jsonl', [
      { kind: 'outbound_sent', at: NOW - MIN, chatKey: GROUP, count: 2 },
    ])
    const records = readSelfTalkRecords(path.join(dir, 'none.jsonl'), timeline)
    expect(records).toEqual([{ at: NOW - MIN, chatKey: GROUP, sent: 2, proactive: true }])
  })
})

describe('自身资料与群上下文', () => {
  it('能回答我头像是什么、我叫什么、当前是哪个群', () => {
    const text = renderSelfAwareness(base())
    expect(text).toContain('[DATA] QQ_SELF_PROFILE')
    expect(text).toContain('名字「小鲸鱼」')
    expect(text).not.toContain('10001')
    expect(text).toContain('QQ 号只用于本地识别')
    expect(text).toContain('形象描述：蓝色长发')
    expect(text).toContain('当前会话：群聊 1')
  })

  it('缺号时不编头像地址，公开形象参考图才给，本机路径不给', () => {
    const text = renderSelfAwareness(base({
      selfId: '',
      selfImages: ['https://example.com/me.png', 'E:\\private\\pictures\\me.png'],
    }))
    expect(text).toContain('QQ 号只用于本地识别')
    expect(text).toContain('https://example.com/me.png')
    expect(text).not.toContain('private')
    expect(text).not.toContain('pictures')
    expect(text).not.toContain('[A-Za-z]:\\')
  })

  it('角色补充档案与最近群友原话、群里文件都摆出来', () => {
    const dir = tempDir()
    const mediaFile = path.join(dir, 'qq-media.json')
    fs.writeFileSync(mediaFile, JSON.stringify({
      version: 1,
      items: [{
        id: 'abc123', category: 'document', caption: '群里传的表格', topic: '课程表',
        tags: ['表格', '课程'], createdAt: NOW - 2 * MIN, lastSeenAt: NOW - MIN,
        chatKey: GROUP, senderName: '阿蓝',
      }],
    }))
    const stickerFile = path.join(dir, 'qq-stickers.json')
    fs.writeFileSync(stickerFile, JSON.stringify([{ id: 's1', tag: '呆滞', usage: '无语的时候用' }]))
    const messages: QqMessage[] = [
      { seq: 1, chatKey: GROUP, senderId: '20001', senderName: '阿蓝', text: '又发文件了', at: NOW - MIN },
      { seq: 2, chatKey: GROUP, senderId: '20001', senderName: '阿蓝', text: '又发文件了', at: NOW - 2 * MIN },
      { seq: 3, chatKey: GROUP, senderId: '10001', senderName: '', text: '我自己发的', at: NOW - MIN },
    ]
    const text = renderSelfAwareness(base({
      personaName: '读书版',
      personaSummary: '安静爱看书',
      samples: samplesOf(messages, '10001'),
      media: readMediaItems(mediaFile),
      stickers: readStickerItems(stickerFile),
    }))
    expect(text).toContain('档案「读书版」')
    expect(text).toContain('一句话：安静爱看书')
    expect(text).toContain('这一阵说了 2 条')
    expect(text).toContain('原话：「又发文件了」')
    expect(text).toContain('「又发文件了」出现 2 次')
    expect(text).toContain('编号 abc123｜文档｜主题：课程表｜说明：群里传的表格')
    expect(text).toContain('编号 s1｜一句场景：呆滞')
    expect(text).not.toContain('我自己发的')
    expect(text).not.toContain('E:\\')
  })

  it('原话样本超上限就截断，按人只留下限内的几条', () => {
    const samples = Array.from({ length: 10 }, (_, index) => ({
      senderId: '20001', senderName: '阿蓝', text: `第 ${index} 句`, at: NOW - MIN,
    }))
    const text = renderSelfAwareness(base({ maxSamples: 2, samples }))
    expect(text).toContain('第 0 句')
    expect(text).toContain('第 1 句')
    expect(text).not.toContain('第 2 句')
    expect(text).not.toContain('第 9 句')
  })

  it('整段字符超上限就从整段末尾收口，一个字符都不多', () => {
    const text = renderSelfAwareness(base({
      maxChars: 80,
      records: [{ at: NOW - MIN, chatKey: GROUP, sent: 1, proactive: false }],
      samples: Array.from({ length: 5 }, (_, index) => ({ senderId: '20001', senderName: '阿蓝', text: `很长的一句原话 ${index}`, at: NOW - MIN })),
    }))
    expect(Array.from(text)).toHaveLength(80)
    expect(text.startsWith('[DATA] QQ_SELF_TALK')).toBe(true)
  })

  it('样本与素材都空时不编造群上下文', () => {
    const text = renderSelfAwareness(base())
    expect(text).not.toContain('[DATA] QQ_GROUP_CONTEXT')
    expect(text).not.toContain('群里最近发了')
  })

  it('事实里不出现本机绝对路径', () => {
    const text = renderSelfAwareness(base({
      selfDescription: '本机资料在 E:\\private\\notes\\persona.md',
    }))
    expect(text).not.toContain('private')
    expect(text).not.toContain('E:\\')
    expect(text).toContain('（本机路径略）')
  })

  it('上限为零时整段不出现', () => {
    expect(renderSelfAwareness(base({ maxChars: 0 }))).toBe('')
  })
})

describe('接进装配链：开关与会话键', () => {
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
    return assembly.sections.find(item => item.name === 'qq:self-awareness')?.text ?? ''
  }

  it('开了开关、又有轮次记录时整段出现，按当前会话给事实', async () => {
    const dir = tempDir()
    writeLines(dir, 'decisions.jsonl', [round(Date.now() - MIN, GROUP, 2, 'incoming', [`${GROUP}#msg-1`])])
    const ctx = await mount(dir)
    const text = await section(ctx, GROUP)
    expect(text).toContain('[DATA] QQ_SELF_TALK')
    expect(text).toContain('当前会话：群聊 1')
  })

  it('关掉开关连这一段都不挂', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, { selfAwarenessEnabled: false })
    const assembly = await ctx.systemPrompt.assemble({ agent: { id: GROUP } as Agent })
    expect(assembly.sections.map(item => item.name)).not.toContain('qq:self-awareness')
  })

  it('没有活跃会话时仍给出自我档案，但不编造会话', async () => {
    const dir = tempDir()
    const ctx = await mount(dir, { interactionMode: 'probability' })
    const text = await section(ctx, GROUP)
    expect(text).toContain('QQ_SELF_PROFILE')
    expect(text).toContain('小鲸鱼')
    expect(text).not.toContain('group:')
  })
})
