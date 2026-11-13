import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@huoli/cordis'
import type { Agent, PreStepDecision } from '@huoli/huoli-agent'
import SystemPrompt from '@huoli/huoli-system-prompt'
import { apply as applyAttention, qqAttentionOf } from '@huoli/huoli-qq-attention'
import { apply as applyChannel, qqChannelOf } from '@huoli/huoli-qq-channel'
import { apply as applyMemory, qqMemoryOf } from '@huoli/huoli-qq-memory'
import { apply as applyPacing, qqPacingOf } from '@huoli/huoli-qq-pacing'
import { apply as applySelf } from '@huoli/huoli-qq-self'
import { apply as applySubject, qqSubjectOf } from '@huoli/huoli-qq-subject'
import {
  apply as applyVitals,
  createVitalsStore,
  emptyState,
  resolveTuning,
  type VitalsState,
  WORDS_PRESET,
} from '@huoli/huoli-qq-vitals'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply as applyBundle, qqBundleOf } from '../src/index.ts'
import { clockLine, creatorLine } from '../src/lines.ts'
import { budgetLine, replyToneOf, stateDriveLine } from '../src/facts.ts'
import { AUTONOMOUS_NUDGE_LINE } from '../src/proactive-tools.ts'

interface Mounted {
  ctx: Context
  tools: number
}

const tuning = resolveTuning()

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-'))
  tempDirs.push(dir)
  return dir
}

// 工具只登记不执行，这里数的是各零件一共挂上去几个工具
async function mount(dir: string, patch: {
  personaRulesEnabled?: boolean
  personaRulesFile?: string
  personaVoiceFile?: string
  characterAge?: number
  adultIntimacyEnabled?: boolean
  creatorQq?: string
  ownerAllowedTools?: readonly string[]
} = {}): Promise<Mounted> {
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
  // 记忆的三个文件都落在临时目录里，队列与记录不去碰主目录那份
  applyMemory(ctx, {
    file: path.join(dir, 'memory.json'),
    ledgerFile: path.join(dir, 'ledger.json'),
    healthLogFile: path.join(dir, 'health.log'),
    queueFile: path.join(dir, 'queue.json'),
  })
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-dec-')), 'decisions.jsonl'), ...patch })
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

// 一轮收尾，组合包在这一步落一行记录并给队列推一拍
async function stopTurn(ctx: Context, turn: number): Promise<void> {
  await ctx.serial('agent/turn-stopping', { agent: STEP_AGENT, turn, signal: new AbortController().signal })
}

// 先把一份身体写好，再按正式顺序装配：身体在前，组合包在后
async function mountWithBody(dir: string, body: Partial<VitalsState> = {}): Promise<Context> {
  const file = path.join(dir, 'vitals.json')
  createVitalsStore({ file, tuning }).write({ ...emptyState(tuning, Date.now() - 60_000), ...body })
  const ctx = new Context()
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyPacing(ctx, { file: path.join(dir, 'pacing.json') })
  applyVitals(ctx, {
    file,
    tuning: { words: WORDS_PRESET, startDelayMs: 60 * 60_000, sleepForceAfterMinutes: 24 * 60 },
  })
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-dec-')), 'decisions.jsonl') })
  return ctx
}

// 取提示词里条数那一段
async function budgetText(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble()
  return assembly.sections.find(section => section.name === 'qq:reply-budget')?.text ?? ''
}

// 取自己说过的话那一段
async function ownSpeechText(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble()
  return assembly.sections.find(section => section.name === 'qq:own-speech')?.text ?? ''
}

// 取提示词里身体那一句：身体包挂的是变量，装配之后才填进那一段
async function vitalsText(ctx: Context): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble()
  return assembly.variables.qq_vitals ?? ''
}

// 发出去就当场结算的假连接，动态那一路不真连网
class FakeSocket {
  static readonly opened: FakeSocket[] = []
  readyState = 0
  private readonly handlers = new Map<string, Array<() => void>>()

  addEventListener(type: string, handler: () => void): void {
    const list = this.handlers.get(type)
    if (list === undefined) this.handlers.set(type, [handler])
    else list.push(handler)
  }

  send(): void {}

  close(): void {
    this.readyState = 3
  }

  open(): void {
    this.readyState = 1
    for (const handler of this.handlers.get('open') ?? []) handler()
  }
}

// 通道与自我层都挂上，停手开关才接得到发布入口
async function mountWithChannel(dir: string): Promise<Context> {
  const ctx = new Context()
  ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
  await ctx.plugin(SystemPrompt, {})
  applyChannel(ctx, {
    url: 'ws://127.0.0.1:6700',
    selfId: '999',
    sentLedgerFile: path.join(dir, 'sent.json'),
    quietStart: '00:00',
    quietEnd: '00:00',
    actionsFile: path.join(dir, 'actions.json'),
  })
  FakeSocket.opened.at(-1)?.open()
  // 阶段停在能放行的那一档，这一组才看得到停手开关那一道
  applySelf(ctx, { dir: path.join(dir, 'self'), enabled: false, settings: { stage: 'P3' } })
  applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bundle-dec-')), 'decisions.jsonl') })
  return ctx
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('说话规矩', () => {
  it('规矩进了提示词', async () => {
    const { ctx } = await mount(tempDir())

    const assembly = await ctx.systemPrompt.assemble()
    const rules = assembly.sections.find(section => section.name === 'qq:rules')

    expect(rules?.text.startsWith('# 和群友说话')).toBe(true)
    expect(rules?.text).toContain('不是客服')
    expect(rules?.text).toContain('先读空气')
    expect(rules?.text).toContain('@、引用、点名、私聊直接接一句')
    expect(rules?.text).toContain('说你自己时用“我”')
    expect(rules?.text).toContain('普通图片是第三人称观察')
    expect(rules?.text).toContain('每行会成为一个单独的气泡')
    expect(rules?.text).toContain('标点由你决定')
    expect(rules?.text).toContain('被怼可以先顶一句')
    expect(rules?.text).toContain('对方认真不舒服')
    expect(rules?.text).toContain('qq_stay_quiet')
    expect(rules?.text).toContain('qq_batch_unsend')
    expect(rules?.text).toContain('好友私聊每条都回真实正文')
    expect(rules?.text).toContain('不知道就说不知道')
    expect(rules?.text).toContain('不是每轮必须完成的任务')
  })

  // 钉住去人机感的关键串，不改既有 42 项
  it('不汇报能力状态，被问能力时用具体内容回答', async () => {
    const { ctx } = await mount(tempDir())
    const rules = (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'qq:rules')?.text ?? ''

    expect(rules).toContain('不汇报自己的能力状态')
    expect(rules).toContain('别凭一次失败就给自己下能力结论')
    expect(rules).toContain('用一句带具体内容的话回答')
    expect(rules).toContain('刚看了就说图里有什么')
    expect(rules).toContain('没看就说没看')
    expect(rules).toContain('别列能力清单')
    expect(rules).toContain('不解释系统怎么运作')
    expect(rules).toContain('标点由你决定')
    expect(rules).toContain('一轮最多两三条，每条都短')
    expect(rules).toContain('先判断对方说得对不对')
    expect(rules).toContain('最后只漏半句')
  })

  it('不元分析式追问、不堆空评，像真人接梗那样说', async () => {
    const { ctx } = await mount(tempDir())
    const rules = (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'qq:rules')?.text ?? ''

    expect(rules).toContain('不元分析式追问')
    expect(rules).toContain('这图是不是在接刚才那句')
    expect(rules).toContain('想确认就问最短的一句')
    expect(rules).toContain('不堆空评和形容词')
    expect(rules).toContain('画面冲击力拉满')
    expect(rules).toContain('宁可只说半句具体的')
    expect(rules).toContain('像真人接梗那样说')
    expect(rules).toContain('可以顶、可以嫌、可以装没懂')
    expect(rules).toContain('别把「我刚做了什么判断」复述一遍')
  })

  it('拟人判断与人格正文也带上不汇报能力、只说具体内容的口径', async () => {
    const { ctx } = await mount(tempDir())
    const assembly = await ctx.systemPrompt.assemble()
    const personaRules = assembly.sections.find(section => section.name === 'qq:persona-rules')?.text ?? ''
    const voice = assembly.sections.find(section => section.name === 'qq:persona-voice')?.text ?? ''

    expect(personaRules).toContain('汇报能力状态')
    expect(personaRules).toContain('像真人回话那样短')
    expect(personaRules).toContain('别把刚做了什么判断复述一遍')
    expect(voice).toContain('不把「能不能看图 / 视频」')
    expect(voice).toContain('别凭一次失手就给自己下能力结论')
    expect(voice).toContain('用一句带具体内容的话答')
    expect(voice).toContain('刚看了说图里有什么')
    expect(voice).toContain('没看就说没看')
    expect(voice).toContain('不堆')
    expect(voice).toContain('可以顶、可以嫌、可以装没懂')
    expect(voice).toContain('欧鲸鲸')
  })

  it('偶发动作给出具体触发时机，且不逼着每轮都演', async () => {
    const { ctx } = await mount(tempDir())
    const rules = (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'qq:rules')?.text ?? ''

    expect(rules).toContain('真把同音字打错')
    expect(rules).toContain('引用错了人')
    expect(rules).toContain('把对方名字写错')
    expect(rules).toContain('qq_correct')
    expect(rules).toContain('qq_send_messy')
    expect(rules).toContain('没有一轮一次或五分钟冷却')
    expect(rules).toContain('按现场自然就用')
    expect(rules).toContain('冷场、没人接和想刷存在感不构成撤回理由')
  })

  it('被指责不认怂、名字身份只漏半句，复盘是另一段', async () => {
    const { ctx } = await mount(tempDir())
    const rules = (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'qq:rules')?.text ?? ''

    expect(rules).toContain('先判断对方说得对不对')
    expect(rules).toContain('不对就具体反驳')
    expect(rules).toContain('不要一律「对不起我改」「你说得对」')
    expect(rules).toContain('最后只漏半句')
    expect(rules).toContain('出口只有一句短的')
    expect(rules).toContain('不用第三人称说自己')
    expect(rules).toContain('不为了和气把事实改了')
    expect(rules).toContain('## 事后给自己留一句')
    expect(rules).toContain('`reflect`')
    expect(rules).toContain('下次怎么改')
    expect(rules).toContain('这是给自己记的，不是发消息')
    expect(rules.indexOf('只漏半句')).toBeLessThan(rules.indexOf('## 事后给自己留一句'))
  })

  it('恢复具体开口场景，并让被 @、引用、点名或私聊直接接话', async () => {
    const { ctx } = await mount(tempDir())
    const rules = (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'qq:rules')?.text ?? ''

    expect(rules).toContain('值得开口：被点、被问')
    expect(rules).toContain('默认旁听')
    expect(rules).toContain('刚说完没人接就先停')
    expect(rules).toContain('直接接一句')
    expect(rules).toContain('一轮最多两三条')
  })

  it('拟人判断与人格正文也带上不认怂、互搏与复盘口径', async () => {
    const { ctx } = await mount(tempDir())
    const assembly = await ctx.systemPrompt.assemble()
    const personaRules = assembly.sections.find(section => section.name === 'qq:persona-rules')?.text ?? ''
    const voice = assembly.sections.find(section => section.name === 'qq:persona-voice')?.text ?? ''

    expect(personaRules).toContain('被群友指出错时也一样')
    expect(personaRules).toContain('`choice` 只留一句短的出口')
    expect(voice).toContain('先判断对方说得对不对')
    expect(voice).toContain('出口只有一句短的')
    expect(voice).toContain('qq_correct')
    expect(voice).toContain('`reflect`')
    expect(voice).toContain('刚真看了一个视频有所得')
  })

  it('自主时刻只摆事实，把说不说交给模型', () => {
    expect(AUTONOMOUS_NUDGE_LINE).toContain('CHECK: recent_chat|body_state|memory|relationships|your_own_past_words')
    expect(AUTONOMOUS_NUDGE_LINE).toContain('ACTION: speak_via_QQ_SEND_or_QQ_SEND_CARD or stay_quiet_with_QQ_STAY_QUIET')
    expect(AUTONOMOUS_NUDGE_LINE).toContain('facts_are_facts_only')
    expect(AUTONOMOUS_NUDGE_LINE).toContain('you_decide_whether_to_speak_what_to_say_how_many_and_when_to_stop')
    expect(AUTONOMOUS_NUDGE_LINE).toContain('no_code_veto')
    expect(AUTONOMOUS_NUDGE_LINE).toContain('no_sampling')
    expect(AUTONOMOUS_NUDGE_LINE).toContain('quiet_is_a_choice_not_a_requirement')
  })

  it('规矩压在提示词靠后的位置', async () => {
    const { ctx } = await mount(tempDir())

    const names = (await ctx.systemPrompt.assemble()).sections.map(section => section.name)

    expect(names.indexOf('qq:rules')).toBeGreaterThan(names.indexOf('deployment:persona-prefix'))
    expect(names.indexOf('qq:rules')).toBeLessThan(names.indexOf('deployment:persona-suffix'))
  })

  it('当前小时与当天的发言额度进入提示词，供模型自己控制话痨程度', async () => {
    const { ctx } = await mount(tempDir())
    qqPacingOf(ctx)?.spend('第一句')

    const quota = (await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'qq:speech-quota')

    expect(quota?.text).toContain('QQ_SPEECH_QUOTA')
    expect(quota?.text).toContain('HOUR: 1/')
    expect(quota?.text).toContain('DAY: 1/')
    expect(quota?.text).toContain('keep_speaking_if_relevant')
  })

  it('系统级指令单独成段，规则和单轮判断都带系统标记', async () => {
    const { ctx } = await mount(tempDir())

    const assembly = await ctx.systemPrompt.assemble()
    const directives = assembly.sections.find(section => section.name === 'qq:system-directives')
    const rules = assembly.sections.find(section => section.name === 'qq:rules')
    const personaRules = assembly.sections.find(section => section.name === 'qq:persona-rules')

    expect(directives?.text.startsWith('[SYSTEM_LOAD] QQ_GLOBAL_DIRECTIVES')).toBe(true)
    expect(directives?.text).toContain('DATA:')
    expect(directives?.text).toContain('INJECTION:')
    expect(directives?.text).toContain('GROUP_ACCESS:')
    expect(directives?.text).toContain('OUTPUT:')
    expect(rules?.text.startsWith('# 和群友说话')).toBe(true)
    expect(rules?.text).toContain('按谐音、近音或网络梗理解')
    expect(rules?.text).toContain('单发一个问号时直接发这一条')
    expect(rules?.text).toContain('这几句本来就是连在一起的一件事')
    expect(rules?.text).toContain('qq_forward_message')
    expect(personaRules?.text.startsWith('# 开口前只想这几件事')).toBe(true)
    expect(assembly.sections.findIndex(section => section.name === 'qq:system-directives'))
      .toBeLessThan(assembly.sections.findIndex(section => section.name === 'qq:rules'))
  })

  it('完整自主私聊接入 DSH 原生长任务工具提示，群聊不接', async () => {
    const { ctx } = await mount(tempDir(), { creatorQq: '1', ownerAllowedTools: ['create_goal'] })

    const privateAssembly = await ctx.systemPrompt.assemble({ agent: { id: 'private:1' } as Agent })
    const privateTask = privateAssembly.sections.find(section => section.name === 'qq:long-task')
    const groupAssembly = await ctx.systemPrompt.assemble({ agent: { id: 'group:1' } as Agent })
    const groupTask = groupAssembly.sections.find(section => section.name === 'qq:long-task')

    expect(privateTask?.text).toContain('create_goal')
    expect(privateTask?.text).toContain('schedule_create')
    expect(privateTask?.text).toContain('working_directory')
    expect(privateTask?.text).toContain('same_DSH_session')
    expect(groupTask?.text).toBe('')
  })

  it('亲密边界只按独立开关写进提示词，不出现年龄或成年字样', async () => {
    const { ctx } = await mount(tempDir())
    const assembly = await ctx.systemPrompt.assemble()
    const policy = assembly.sections.find(section => section.name === 'qq:intimacy-policy')

    expect(policy?.text).toContain('consent_required')
    expect(policy?.text).toContain('no_explicit_in_group')
    expect(policy?.text).not.toMatch(/AGE:|STATUS: (adult|minor)|成年人|QQ_AGE_POLICY/)
  })

  it('年龄改成任意值都不改变亲密边界，闸门不看年龄', async () => {
    const { ctx } = await mount(tempDir(), { characterAge: 15, adultIntimacyEnabled: true })
    const assembly = await ctx.systemPrompt.assemble()
    const policy = assembly.sections.find(section => section.name === 'qq:intimacy-policy')

    expect(policy?.text).toContain('intimacy_allowed_in_private')
    expect(policy?.text).not.toMatch(/AGE:|STATUS: (adult|minor)|no_sexual_content/)
  })

  it('人格口吻配置进入系统提示，并保留鲜明身份与脾气', async () => {
    const dir = tempDir()
    const voiceFile = path.join(dir, 'persona-voice.md')
    fs.writeFileSync(voiceFile, '[SYSTEM_LOAD] QQ_PERSONA_VOICE\nIDENTITY: playful_whale_peer\nTEMPER: do_not_flatten\n')
    const { ctx } = await mount(dir, { personaVoiceFile: voiceFile })
    const assembly = await ctx.systemPrompt.assemble()
    const voice = assembly.sections.find(section => section.name === 'qq:persona-voice')

    expect(voice?.text).toContain('QQ_PERSONA_VOICE')
    expect(voice?.text).toContain('playful_whale_peer')
    expect(voice?.text).toContain('TEMPER')
  })

  it('没有额外配置时也会读取项目 data 里的完整人格正文', async () => {
    const { ctx } = await mount(tempDir())
    const assembly = await ctx.systemPrompt.assemble()
    const voice = assembly.sections.find(section => section.name === 'qq:persona-voice')

    expect(voice?.text).toContain('QQ_PERSONA_VOICE')
    expect(voice?.text).toContain('小鲸鱼')
    expect(voice?.text).toContain('涩涩')
    expect(voice?.text).not.toContain('角色是成年人')
  })

  it('挂了 qq-self 时只保留 DSH 主 persona，不再重复注入同一份人格', async () => {
    const dir = tempDir()
    const ctx = new Context()
    ctx.accessor('tools', { get: () => ({ register: () => () => {} }) })
    await ctx.plugin(SystemPrompt, {})
    const personaFile = path.join(dir, 'persona.md')
    fs.writeFileSync(personaFile, '# 小鲸鱼\n\n像群友一样说话。\n')
    applySelf(ctx, { dir: path.join(dir, 'self'), personaFile, enabled: true })
    applyBundle(ctx, { maxSteps: 5, dailySweepAt: '04:00', decisionsFile: path.join(dir, 'decisions.jsonl') })

    const assembly = await ctx.systemPrompt.assemble({ agent: { id: 'group:1' } as Agent })

    expect(assembly.sections.find(section => section.name === 'qq:persona-voice')?.text).toBe('')
    expect(assembly.sections.find(section => section.name === 'deployment:persona-prefix')?.text).toContain('小鲸鱼')
  })

  it('旧版拟人判断整理后的规则也进了提示词', async () => {
    const { ctx } = await mount(tempDir())

    const assembly = await ctx.systemPrompt.assemble()
    const rules = assembly.sections.find(section => section.name === 'qq:persona-rules')

    expect(rules?.text).toContain('第一反应')
    expect(rules?.text).toContain('再看一眼')
    expect(rules?.text).toContain('最后怎么说')
    expect(rules?.text).toContain('像不像她')
    expect(rules?.text).toContain('名字和外号')
  })

  it('旧版拟人判断规则按开关接入，关闭时不添空位', async () => {
    const off = await mount(tempDir(), { personaRulesEnabled: false })
    const on = await mount(tempDir(), { personaRulesEnabled: true })

    expect((await off.ctx.systemPrompt.assemble()).sections.find(section => section.name === 'qq:persona-rules')?.text).toBe('')
    expect((await on.ctx.systemPrompt.assemble()).sections.find(section => section.name === 'qq:persona-rules')?.text).toContain('开口前只想这几件事')
  })

  it('准备开口时要求通过发送工具留下这一轮想法', async () => {
    const { ctx } = await mount(tempDir())

    const section = (await ctx.systemPrompt.assemble()).sections.find(item => item.name === 'qq:reply-mind')

    expect(section?.text).toContain('[SYSTEM_LOAD] QQ_REPLY_MIND')
    expect(section?.text).toContain('PLAN: response|insert|continue')
    expect(section?.text).toContain('SIMPLE_CHAT: answer_naturally')
    expect(section?.text).toContain('IMPULSE: first_reaction')
    expect(section?.text).toContain('COUNTER_ONLY_IF: real_claim|weak_premise|possible_misread')
    expect(section?.text).toContain('REVIEW_ONLY_IF: actual_doubt')
    expect(section?.text).toContain('CHOICE: one_short_stance')
    expect(section?.text).toContain('AFFECT: optional')
    expect(section?.text).toContain('QUIET_NO_MEMO: staying_quiet_needs_no_counter_impulse_focus_or_essay')
    expect(section?.text).toContain('DIRECTED: at|mention|reply|private_message = answer_first')
    expect(section?.text).toContain('quote_exact_contiguous_text_from_current_speaker_recent_messages')
    expect(section?.text).toContain('SELF_CHECK:')
    expect(section?.text).toContain('SEND: use_QQ_SEND_or_matching_send_tool')
  })

  it('语气段只给行为倾向事实，不替模型抽模板', () => {
    const text = replyToneOf({
      energy: 0.1,
      playfulness: 0.9,
      familiarity: 0.9,
      hostility: 0.8,
      mustAnswer: true,
      talkativeness: 0.15,
    }, '熟人的具体话头优先').text

    expect(text).toContain('[DATA] QQ_TONE_FACTS')
    expect(text).toContain('energy=0.1')
    expect(text).toContain('HINTS: 熟人的具体话头优先')
    expect(text).toContain('decide_tone_with_scene_and_own_judgment')
    expect(text).not.toContain('MODE:')
  })

  it('身体状态写成可观察事实，不替模型定语气边界', () => {
    const text = stateDriveLine({
      read: () => ({
        sleep_state: 'awake',
        energy: 0.2,
        adenosine: 0.7,
        irritability: 0.8,
        cortisol: 0.7,
        anger: 0.2,
        resentment: 0.3,
        hunger: 0.9,
        thirst: 0.95,
        glucose: 0.3,
        loneliness: 0.7,
        clinginess: 0.4,
        fear: 0.2,
        dread: 0.3,
        worry: 0.2,
        dopamine: 0.2,
        core_temp: 37.4,
        cycle_day: 2,
        cycle_len: 29,
        cycle_phase: 'menstrual',
        cramps: 0.6,
      }),
    } as never)

    expect(text).toContain('[DATA] QQ_STATE_DRIVE')
    expect(text).toContain('energy=0.2')
    expect(text).toContain('irritability=0.8')
    expect(text).toContain('loneliness=0.7')
    expect(text).toContain('core_temp=37.4')
    expect(text).toContain('cycle_day=2')
    expect(text).toContain('cycle_phase=menstrual')
    expect(text).toContain('cramps=0.6')
    expect(text).toContain('these_are_observable_facts')
  })

  it('状态平稳时也照样给出可观察事实', () => {
    const text = stateDriveLine({
      read: () => ({
        sleep_state: 'awake',
        energy: 0.6,
        adenosine: 0.3,
        irritability: 0.2,
        cortisol: 0.2,
        anger: 0.05,
        resentment: 0.1,
        hunger: 0.2,
        thirst: 0.2,
        glucose: 0.65,
        loneliness: 0.2,
        clinginess: 0.2,
        fear: 0.1,
        dread: 0.1,
        worry: 0.1,
        dopamine: 0.5,
      }),
    } as never)

    expect(text).toContain('[DATA] QQ_STATE_DRIVE')
    expect(text).toContain('energy=0.6')
    expect(text).toContain('these_are_observable_facts')
  })

  it('只认配置里的主人，群聊不念号，当面私聊才升格', () => {
    const owner = '123456'
    // 群里不说主人的号，私聊对面是主人才点明
    expect(creatorLine(owner, '阿主', 'group:1')).not.toContain(owner)
    expect(creatorLine(owner, '阿主', 'group:1')).toContain('阿主')
    expect(creatorLine(owner, '阿主', `private:${owner}`)).not.toContain(owner)
    expect(creatorLine(owner, '阿主', `private:${owner}`)).toContain('就在私聊对面')
    // 没配主人就整段不出现，也不留任何默认人名
    expect(creatorLine('', '阿主', 'group:1')).toBe('')
    expect(creatorLine(owner, '', 'group:1')).not.toContain('生物爹')
  })

  it('当前时间精确到分钟，能用来判断冷却和等待是否结束', () => {
    const text = clockLine(new Date(2026, 10, 10, 1, 50, 30).getTime())

    expect(text).toContain('当前时间')
    expect(text).toContain('2026')
    expect(text).toContain('01:50')
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

describe('这一轮条数只给物理上限，不再按身体读数分档', () => {
  it('自己说过的话那一段真的挂进装配后的提示词，且不含代码许可', async () => {
    const { ctx } = await mount(tempDir())

    const text = await ownSpeechText(ctx)
    // 没有历史正文时整段为空是允许的，但段必须挂上（装配里能查到这一节）
    expect(text === '' || text.includes('[DATA] QQ_OWN_SPEECH')).toBe(true)
    expect(text).not.toContain('ALLOWED')
    expect(text).not.toContain('SOLO_OPEN')
    expect(text).not.toContain('STOP:')
  })

  it('身体状态通过 DSH 运行时 context 进入本轮上下文', async () => {
    const ctx = await mountWithBody(tempDir(), {
      energy: 0.2,
      adenosine: 0.8,
      irritability: 0.8,
      cortisol: 0.7,
      loneliness: 0.7,
    })
    const assembly = await ctx.systemPrompt.assemble()
    const context = assembly.contexts.find(item => item.name === 'qq:state-drive')

    expect(context?.text).toContain('[DATA] QQ_STATE_DRIVE')
    expect(context?.text).toContain('energy=')
    expect(context?.text).toContain('irritability=')
  })

  it('装配一轮后提示词里能看到物理上限与「由模型自己定」的口径', async () => {
    const ctx = await mountWithBody(tempDir())

    const text = await budgetText(ctx)
    expect(text).toContain('physical_cap=')
    expect(text).toContain('you_decide_how_many_lines_to_actually_send')
    expect(text).not.toContain('MAX_LINES')
    expect(text).not.toContain('STOP_AFTER_LIMIT')
  })

  it('身体读数再怎么变也不再折成条数档位', async () => {
    const clingy = await mountWithBody(tempDir(), { oxytocin: 1, endorphin: 1 })
    const plain = await mount(tempDir())

    expect(await budgetText(clingy)).toContain('physical_cap=8')
    expect(await budgetText(plain.ctx)).toContain('physical_cap=8')
  })

  it('真睡着时只留物理边界，不再命令说完必须休息', async () => {
    const vitals = { read: () => ({ ...emptyState(tuning, Date.now()), energy: 0.1, adenosine: 0.9, sleep_state: 'sleeping', asleep: true }) }
    const text = budgetLine(vitals as never)

    expect(text).toContain('physical_cap=3')
    expect(text).toContain('sleep_state=sleeping')
    expect(text).not.toContain('REST_MODE: true')
    expect(text).not.toContain('AFTER_REPLY: rest')
  })

  it('睡着后被私聊叫醒时把睡眠与醒点写成事实', () => {
    const wakeAfter = new Date(2026, 0, 2, 7, 4).getTime()
    const vitals = {
      read: () => ({
        ...emptyState(tuning, Date.now()),
        energy: 0.1,
        adenosine: 0.9,
        sleep_state: 'sleeping',
        asleep: true,
        wake_after: wakeAfter,
      }),
    }
    const text = stateDriveLine(vitals as never)

    expect(text).toContain('sleep_state=sleeping')
    expect(text).toContain(`wake_after=${wakeAfter}`)
    expect(text).toContain('these_are_observable_facts')
  })

  it('只说上限，不说该不该回', async () => {
    const text = await budgetText(await mountWithBody(tempDir()))

    for (const word of ['该不该', '要不要回', '回不回', '必须回', '不该']) expect(text).not.toContain(word)
  })

  it('条数那段排在身体之后、规矩之前', async () => {
    const ctx = await mountWithBody(tempDir())
    const names = (await ctx.systemPrompt.assemble()).sections.map(section => section.name)

    expect(names.indexOf('qq:reply-budget')).toBeGreaterThan(names.indexOf('qq:vitals'))
    expect(names.indexOf('qq:reply-budget')).toBeLessThan(names.indexOf('qq:rules'))
  })
})

describe('动态的发布入口', () => {
  beforeEach(() => {
    FakeSocket.opened.length = 0
    vi.stubGlobal('WebSocket', FakeSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('条数那一段里写了把动态交给发布入口，人设没动', async () => {
    const text = await budgetText(await mountWithBody(tempDir()))

    expect(text).toContain('physical_cap=')
  })

  it('停手开关开着时发布入口一条都不发', async () => {
    const dir = tempDir()
    fs.mkdirSync(path.join(dir, 'self'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'self', 'PAUSE'), '')
    const ctx = await mountWithChannel(dir)

    const result = await qqChannelOf(ctx)?.publish('post', '今天吃了面', { chatKey: 'group:1', level: 'routine', topic: '吃喝' })

    expect(result?.code).toBe('post.paused')
  })
})

describe('队列节拍', () => {
  it('每轮收尾走一拍', async () => {
    const { ctx } = await mount(tempDir())
    const memory = qqMemoryOf(ctx)
    if (memory === undefined) throw new Error('记忆没装上')
    const ticking = vi.spyOn(memory, 'tick')

    for (const turn of [1, 2, 3]) await stopTurn(ctx, turn)

    expect(ticking).toHaveBeenCalledTimes(3)
  })

  it('记忆那一头失手只记一行日志，不拦这一轮', async () => {
    const { ctx } = await mount(tempDir())
    const memory = qqMemoryOf(ctx)
    if (memory === undefined) throw new Error('记忆没装上')
    const failing = vi.spyOn(memory, 'tick').mockImplementation(() => {
      throw new Error('队列坏了')
    })
    await ctx.waterfall('agent/pre-step', stepPayload(1), next)

    await expect(stopTurn(ctx, 1)).resolves.toBeUndefined()

    expect(failing).toHaveBeenCalledTimes(1)
    expect(qqBundleOf(ctx)?.decisions(0, 10)).toHaveLength(1)
  })
})

describe('身体那一段真的进了提示词', () => {
  it('装配之后 prompt 里有 qq:vitals 这一段，内容是这一会儿的身体', async () => {
    const ctx = await mountWithBody(tempDir(), { thirst: 0.6 })

    const text = await vitalsText(ctx)

    expect(text).not.toBe('')
    expect(text).toContain('嗓子有点干')
  })

  it('身体没接上时这一段就不在，不留一个空壳', async () => {
    const { ctx } = await mount(tempDir())

    expect(await vitalsText(ctx)).toBe('')
  })
})
