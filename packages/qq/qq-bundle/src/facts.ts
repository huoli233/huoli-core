// 装配层要用到的几件小事：读规则、拆时刻、把身体转述成条数事实

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@huoli/cordis'
import type { AssembleContext } from '@huoli/huoli-system-prompt'
import { renderAttentionFacts, type QqAttentionSeam, type QqMessage } from '@huoli/huoli-qq-attention'
import type { BudgetStatus } from '@huoli/huoli-qq-balance'
import { renderContinuityFacts, type QqContinuitySeam } from '@huoli/huoli-qq-continuity'
import type { QqMaterialSeam } from '@huoli/huoli-qq-material'
import type { QqPacingSeam, ReplyFacts } from '@huoli/huoli-qq-pacing'
import type { PanelAsrStatus, QqSelfSeam } from '@huoli/huoli-qq-self'
import type { QqSubjectSeam } from '@huoli/huoli-qq-subject'
import type { QqVitalsSeam, VitalsState } from '@huoli/huoli-qq-vitals'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { attentionEmotionOf, type EmotionSettings } from './emotion-tier.ts'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import type { Config } from './types.ts'
import { readMediaItems, readSelfTalkRecords, readStickerItems, renderSelfAwareness, samplesOf } from './self-awareness.ts'
export { budgetLine, budgetOf, NEUTRAL_FACTS, REPLY_HARD_CAP, restCapOf } from './speak-gate.ts'

/** 这一轮说话倾向的可观察事实 */
export interface ReplyTone {
  name: 'facts'
  text: string
}

/** 这一轮说话倾向的可观察事实 */
export interface ReplyToneFacts {
  energy: number
  playfulness: number
  familiarity: number
  hostility: number
  mustAnswer: boolean
  talkativeness: number
}

/**
 * 把身体、关系与当前会话写成行为倾向事实
 * @param facts - 本轮状态
 * @param hints - 配置给的行为倾向文字
 * @returns 只陈述事实的一段中文
 */
export function replyToneOf(facts: ReplyToneFacts, hints: string): ReplyTone {
  const round = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
  const lines = [
    '[DATA] QQ_TONE_FACTS',
    `energy=${round(facts.energy)}`,
    `playfulness=${round(facts.playfulness)}`,
    `familiarity=${round(facts.familiarity)}`,
    `hostility=${round(facts.hostility)}`,
    `must_answer=${facts.mustAnswer}`,
    `talkativeness=${round(facts.talkativeness)}`,
  ]
  if (hints.trim() !== '') lines.push(`HINTS: ${hints.trim()}`)
  lines.push('RULE: decide_tone_with_scene_and_own_judgment')
  return { name: 'facts', text: lines.join('\n') }
}

/**
 * 把现场素材与上次的话头挂成提示词的两段
 * @param ctx - 运行环境
 * @param deps - 当前会话、两个仓与收件箱读法
 */
export function registerMaterialPrompts(
  ctx: Context,
  deps: {
    activeChatKey(context: AssembleContext): string
    material: QqMaterialSeam | undefined
    continuity: QqContinuitySeam | undefined
    subject: QqSubjectSeam | undefined
    recent(chatKey: string): readonly QqMessage[]
  },
): void {
  ctx.systemPrompt.section({
    name: 'qq:material',
    order: 330,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      if (deps.material === undefined || chatKey === '') return ''
      const global = deps.subject?.store.read().global
      return deps.material.render(deps.material.gather({
        chatKey,
        messages: [...deps.recent(chatKey)],
        ...global === undefined ? {} : {
          boredom: global.boredom,
          curiosity: global.curiosity,
          socialHunger: global.socialHunger,
        },
      }))
    },
  })
  ctx.systemPrompt.section({
    name: 'qq:continuity',
    order: 320,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      if (deps.continuity === undefined || chatKey === '') return ''
      const note = deps.continuity.store.lastClose(chatKey)
      return renderContinuityFacts({
        ...note === undefined ? {} : { note },
        reflections: deps.continuity.store.reflections(chatKey, 3),
      })
    },
  })
}

/**
 * 把注意力事实挂成提示词的一段
 * @param ctx - 运行环境
 * @param deps - 注意力仓与当前会话
 */
export function registerAttentionPrompt(
  ctx: Context,
  deps: {
    attention: QqAttentionSeam | undefined
    activeChatKey(context: AssembleContext): string
    vitals: QqVitalsSeam | undefined
    /** 情绪档位这一层的门槛，没给就不写情绪那一条 */
    emotion?: EmotionSettings
  },
): void {
  ctx.systemPrompt.section({
    name: 'qq:attention',
    order: 340,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      if (deps.attention === undefined || chatKey === '') return ''
      const state = deps.attention.store.of(chatKey)
      const emotion = deps.emotion === undefined ? undefined : attentionEmotionOf(deps.vitals?.read(), deps.emotion)
      const facts = renderAttentionFacts({
        signals: deps.attention.signals(chatKey),
        wake: state,
        talkativeness: deps.attention.talkativeness(chatKey),
        ...state.lastSelfSpokeAt === undefined ? {} : { lastSelfSpokeAt: state.lastSelfSpokeAt },
        ...state.selfTalkStreak === undefined ? {} : { selfTalkStreak: state.selfTalkStreak },
        ...emotion === undefined ? {} : { emotion },
        now: Date.now(),
      })
      // 话痨度只当一条可观察数值摆出来，不再翻成「收着点/活一点」的命令，也不替模型定该插几句
      const talk = deps.attention.talkativeness(chatKey)
      const talkLine = `[DATA] QQ_TALKATIVENESS\nvalue=${Math.round(Math.min(1, Math.max(0, talk)) * 100) / 100}\nRULE: this_is_just_a_number_about_your_recent_talking; you_decide_how_much_to_say_now`
      return [facts, talkLine].filter(part => part !== '').join('\n\n')
    },
  })
}

/**
 * 把当前说话人的关系事实挂成提示词的一段
 * @param ctx - 运行环境
 * @param deps - 关系仓、注意力与当前会话
 */
export function registerRelationPrompt(
  ctx: Context,
  deps: {
    vitals: QqVitalsSeam | undefined
    subject: QqSubjectSeam | undefined
    attention: QqAttentionSeam | undefined
    activeChatKey(context: AssembleContext): string
    toneHints(): string
    ownerQq?: string
  },
): void {
  ctx.systemPrompt.section({
    name: 'qq:relation',
    order: 325,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      if (deps.subject === undefined || chatKey === '') return ''
      const personId = chatKey.startsWith('private:')
        ? chatKey.slice('private:'.length)
        : [...deps.attention?.inbox.recent(chatKey, 20) ?? []].reverse().find(item => item.senderId !== '')?.senderId ?? ''
      const relation = personId === '' ? '' : deps.subject.renderRelation(personId, chatKey)
      const owner = deps.ownerQq ?? ''
      return owner === '' || relation === '' ? relation : relation.replace(new RegExp(`用户编号\\s*${owner}(?=\\D|$)`, 'gu'), '用户编号 主人（隐藏）')
    },
  })
  registerTonePrompt(ctx, deps)
}

/**
 * 按此刻的精力、关系和玩心挂一段说话火候。
 * @param ctx - 运行环境
 * @param deps - 身体、关系、注意力与当前会话
 */
export function registerTonePrompt(
  ctx: Context,
  deps: {
    vitals: QqVitalsSeam | undefined
    subject: QqSubjectSeam | undefined
    attention: QqAttentionSeam | undefined
    activeChatKey(context: AssembleContext): string
    toneHints(): string
  },
): void {
  ctx.systemPrompt.section({
    name: 'qq:tone',
    order: 507,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      const body = deps.vitals?.read()
      if (chatKey === '' || body === undefined) return ''
      const personId = chatKey.startsWith('private:')
        ? chatKey.slice('private:'.length)
        : [...deps.attention?.inbox.recent(chatKey, 20) ?? []].reverse().find(item => item.senderId !== '')?.senderId ?? ''
      const person = personId === '' ? undefined : deps.subject?.relations.get(personId)
      const signals = deps.attention?.signals(chatKey)
      const tone = replyToneOf({
        energy: body.energy,
        playfulness: body.dopamine,
        familiarity: person?.familiarity ?? 0,
        hostility: Math.max(body.anger, body.resentment, body.irritability, body.cortisol, person?.annoyance ?? 0),
        mustAnswer: chatKey.startsWith('private:') || signals?.addressee.named === true,
        talkativeness: deps.attention?.talkativeness(chatKey) ?? 0.5,
      }, deps.toneHints())
      return tone.text
    },
  })
}

/**
 * 短外号或近期反复叫名字时，记到这个人的关系档案里。
 * @param subject 状态仓
 * @param signals 当前注意力事实
 * @param message 原始消息
 */
export function recordNameCallFromMessage(
  subject: QqSubjectSeam | undefined,
  signals: ReturnType<QqAttentionSeam['signals']> | undefined,
  message: { senderId: string; chatKey: string; text: string; at: number },
): void {
  if (subject === undefined || signals?.addressee.named !== true) return
  const label = message.text.trim().replace(/^@+/u, '').replace(/[?？!！。,.，]+$/u, '')
  if (label === '' || label.length > 16 || /\s/u.test(label)) return
  const normalized = label.normalize('NFKC').toLowerCase()
  const matched = signals.addressee.matchedName
  const variant = normalized !== matched && normalized.includes(matched) && normalized.length - matched.length <= 3
  if (!variant && signals.addressee.recentCount < 2) return
  if (normalized !== matched && !variant) return
  try {
    subject.relations.recordNameCall(message.senderId, message.chatKey, label, message.at)
  } catch {
    // 外号记录失败不影响这一轮回复
  }
}

/**
 * 把关系和诊断接到自我层面板
 * @param subject - 关系仓
 * @param timeline - 诊断时间线
 * @returns 本机只读查询口
 */
export function qqPanelPortOf(
  subject: QqSubjectSeam | undefined,
  timeline: { read(traceId: string, limit: number): unknown },
  asrStatus: () => PanelAsrStatus | undefined = () => undefined,
  health: () => {
    score: number
    status: string
    checkedAt: number
    issues: readonly string[]
  } | undefined = () => undefined,
): {
  relation(personId: string, chatKey: string): unknown
  timeline(traceId: string, limit: number): unknown
  asrStatus(): PanelAsrStatus | undefined
  health(): {
    score: number
    status: string
    checkedAt: number
    issues: readonly string[]
  } | undefined
} {
  return {
    relation(personId, chatKey) {
      const person = subject?.relations.get(personId)
      return person === undefined
        ? { found: false, personId, chatKey }
        : {
          found: true,
          person,
          events: subject?.relations.events(personId, 20) ?? [],
          anniversaries: subject?.relations.anniversaries(personId, 20) ?? [],
        }
    },
    timeline: (traceId, limit) => timeline.read(traceId, limit),
    asrStatus,
    health,
  }
}

/** 规则文件的位置
 * @returns 包内 prompts/rules.md 的绝对路径，取不到就按当前目录拼
 */
export function defaultRulesPath(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    return path.join(here, '..', 'prompts', 'rules.md')
  } catch {
    // 拿不到模块位置就退回工作目录：规则文件本来就允许部署时自己放
    return path.join(process.cwd(), 'prompts', 'rules.md')
  }
}

/** 读规则，读不到就用一句备用话
 * @param file - 规则文件路径
 * @returns 规则正文
 */
export function readRules(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    // 规则文件不在就用这一句备用话，不拦启动
    return '你是群里的一个人，说话简短，说完就停。'
  }
}

/**
 * 把 00:20 这种写法拆成时与分，写坏了按默认那一档并记一行
 * @param value - 配置里写的时刻
 * @param fallback - 认不出来时用的默认时刻
 * @param ctx - 运行环境，用来记那一行
 * @returns 时与分
 */
export function clockOf(value: string | undefined, fallback: string, ctx: Context): { hour: number; minute: number } {
  const text = value ?? fallback
  const parts = text.split(':')
  const hour = Number(parts[0])
  const minute = Number(parts[1])
  const valid = Number.isInteger(hour) && Number.isInteger(minute)
    && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
  if (valid) return { hour, minute }
  const kept = fallback.split(':')
  ctx.logger('qq-bundle').warn('整理时刻 %s 认不出来，按 %s 算', text, fallback)
  return { hour: Number(kept[0]), minute: Number(kept[1]) }
}

/**
 * 条数上限看的事实：都从身体那唯一一份状态里取，不在这里另算
 * @param state - 身体那一份状态
 * @returns 条数分档要看的几项
 */
export function replyFactsOf(state: VitalsState): ReplyFacts {
  return {
    tired: state.adenosine,
    annoyed: state.irritability,
    energy: state.energy,
    clingy: state.clinginess,
    lonely: state.loneliness,
    fear: state.fear,
    dread: state.dread,
    worry: state.worry,
    anger: state.anger,
    resentment: state.resentment,
  }
}

/**
 * 睡眠那三项事实原样转述，判不判由被动那一边的关卡定
 * @param state - 身体那一份状态
 * @returns 睡着、预计醒来的时刻、刚被吵醒
 */
export function sleepFactsOf(state: VitalsState): { asleep: boolean; wakeAfter: number; waking: boolean } {
  return { asleep: state.asleep, wakeAfter: state.wake_after, waking: state.sleep_state === 'waking' }
}

/**
 * 把当前身体状态压成这一轮必须遵守的行为倾向。
 * @param vitals - 身体那一面
 * @returns 靠近人格段的高优先级行为约束
 */
export function stateDriveLine(vitals: QqVitalsSeam | undefined): string {
  const state = vitals?.read()
  if (state === undefined) return ''
  const pick = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
  const optional = (value: number): string => Number.isFinite(value) ? String(pick(value)) : 'unknown'
  const temperature = (value: number): string => Number.isFinite(value) ? String(Math.round(value * 100) / 100) : 'unknown'
  const lines = [
    '[DATA] QQ_STATE_DRIVE',
    `sleep_state=${state.sleep_state}`,
    `core_temp=${temperature(state.core_temp)}`,
    `energy=${pick(state.energy)}`,
    `adenosine=${pick(state.adenosine)}`,
    `irritability=${pick(state.irritability)}`,
    `cortisol=${pick(state.cortisol)}`,
    `anger=${pick(state.anger)}`,
    `resentment=${pick(state.resentment)}`,
    `hunger=${pick(state.hunger)}`,
    `thirst=${pick(state.thirst)}`,
    `loneliness=${pick(state.loneliness)}`,
    `clinginess=${pick(state.clinginess)}`,
    `fear=${pick(state.fear)}`,
    `dread=${pick(state.dread)}`,
    `worry=${pick(state.worry)}`,
    `pain=${optional(state.pain)}`,
    `fever=${optional(state.fever)}`,
    `cytokines=${optional(state.cytokines)}`,
    `cycle_day=${Number.isFinite(state.cycle_day) ? state.cycle_day : 'unknown'}`,
    `cycle_len=${Number.isFinite(state.cycle_len) ? state.cycle_len : 'unknown'}`,
    `cycle_phase=${state.cycle_phase === '' ? 'unknown' : state.cycle_phase}`,
    `cramps=${optional(state.cramps)}`,
    `dopamine=${pick(state.dopamine)}`,
    `oxytocin=${pick(state.oxytocin)}`,
    `wake_after=${state.wake_after}`,
    'RULE: these_are_observable_facts; choose_expression_with_scene_and_own_judgment',
  ]
  return lines.join('\n')
}

/**
 * 用量提示只在接近或到达上限时出现
 * @param state - 今天的用量状态
 * @returns 给模型看的短提示
 */
export function budgetStatusLine(state: BudgetStatus | undefined): string {
  if (state === undefined || !state.alert) return ''
  const percent = Math.min(100, Math.round(state.ratio * 100))
  const unit = state.metric === 'cost' ? 'cost' : 'token'
  return `[DATA] BUDGET_STATUS\nMETRIC: ${unit}\nPERCENT: ${percent}\nSTATE: ${state.blocked ? 'blocked' : 'near_limit'}`
}

/**
 * 本小时与本日发言额度，只给模型自控
 * @param pacing - 当前说话记录仓
 * @returns 给模型看的额度事实
 */
export function speechQuotaLine(pacing: QqPacingSeam): string {
  const used = pacing.used()
  const limits = pacing.limits()
  const hourLeft = Math.max(0, limits.perHour - used.hourCount)
  const dayLeft = Math.max(0, limits.perDay - used.dayCount)
  return `[SYSTEM_LOAD] QQ_SPEECH_QUOTA\nHOUR: ${used.hourCount}/${limits.perHour}; remaining ${hourLeft}\nDAY: ${used.dayCount}/${limits.perDay}; remaining ${dayLeft}\nCHOICE: keep_speaking_if_relevant|hold_or_observe|let_other_people_talk`
}

/**
 * 读环境说明那张表，一个会话一段
 * @param file - 说明文件在哪
 * @returns 会话键到说明正文的表，读不动或格式不对时是空表
 */
export function readBriefings(file: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const table: Record<string, string> = {}
    for (const [chatKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      const text = value.trim()
      if (chatKey.trim() === '' || text === '') continue
      table[chatKey] = text
    }
    return table
  } catch {
    // 没有这份文件就当一段都没配，不拦启动
    return {}
  }
}

// 已经给过说明的会话与时刻，重启后照样认
function readBriefed(file: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const table: Record<string, number> = {}
    for (const [chatKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      table[chatKey] = value
    }
    return table
  } catch {
    return {}
  }
}

// 给过就记一笔，写不完只影响下次会不会重复给，不影响这一轮
function noteBriefed(file: string, chatKey: string, at: number): void {
  try {
    const table = { ...readBriefed(file), [chatKey]: at }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(table, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, file)
  } catch {
    // 记不下来的那一个会话下次会再给一遍，不影响其余会话
  }
}

/**
 * 这一段怎么摆：第一次进这个会话时给一段环境说明
 * @param text - 表里为这个会话写的说明
 * @returns 给模型看的一段
 */
export function briefingLine(text: string): string {
  return `第一次进这个会话，先照这段理解这里：\n${text}`
}

/** 会话级环境说明要的东西 */
export interface BriefingPromptDeps {
  /** 配置 */
  config: Config
  /** 当前会话的键，概率闲聊里是空串 */
  activeChatKey(context: AssembleContext): string
}

/**
 * 把会话级环境说明挂成提示词的一段，只在第一次进这个会话时给
 * @param ctx - 运行环境
 * @param deps - 配置与当前会话
 */
export function registerBriefingPrompt(ctx: Context, deps: BriefingPromptDeps): void {
  const { config } = deps
  if (!(config.briefingEnabled ?? BUNDLE_DEFAULTS.briefingEnabled)) return
  const file = config.briefingFile ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.briefingFile)
  const ledger = config.briefingLedgerFile
    ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.briefingLedgerFile)
  // 给过的在进程里记一份，省得每一步都翻文件；真给出去时才写盘
  const given = new Set(Object.keys(readBriefed(ledger)))
  ctx.systemPrompt.section({
    name: 'qq:briefing',
    order: 335,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      if (chatKey === '' || given.has(chatKey)) return ''
      const table = readBriefings(file)
      const text = table[chatKey]
      if (text === undefined) return ''
      given.add(chatKey)
      noteBriefed(ledger, chatKey, Date.now())
      return briefingLine(text)
    },
  })
}

/** 自知这一段要的东西，都从既有落盘记录和既有服务读 */
export interface SelfAwarenessPromptDeps {
  /** 配置 */
  config: Config
  /** 当前会话的键，概率闲聊里是空串 */
  activeChatKey(context: AssembleContext): string
  /** 既有收件箱里的最近消息 */
  recent(chatKey: string): readonly QqMessage[]
  /** 机器人自己的号 */
  selfId(): string
  /** 自我层的角色补充档案，没装上时为 undefined */
  selfLayer?: QqSelfSeam | undefined
}

/** 把自知事实挂成提示词的一段：只摆事实，说不说、怎么理解由模型定 */
export function registerSelfAwarenessPrompt(ctx: Context, deps: SelfAwarenessPromptDeps): void {
  const { config } = deps
  if (!(config.selfAwarenessEnabled ?? BUNDLE_DEFAULTS.selfAwarenessEnabled)) return
  const home = resolveHuoliHome(config.home)
  const decisionsFile = config.decisionsFile ?? path.join(home, 'data', 'qq-decisions.jsonl')
  const timelineFile = config.timelineFile ?? config.wakeLogFile ?? path.join(home, BUNDLE_DEFAULTS.timelineFile)
  const mediaFile = config.mediaIndexFile ?? path.join(home, BUNDLE_DEFAULTS.mediaIndexFile)
  const stickerFile = config.mediaStickerFile ?? path.join(home, BUNDLE_DEFAULTS.mediaStickerFile)
  ctx.systemPrompt.section({
    name: 'qq:self-awareness',
    order: 346,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      if (chatKey === '') return ''
      const profile = deps.selfLayer?.personaProfile(chatKey)
      return renderSelfAwareness({
        now: Date.now(),
        windowsMs: config.selfTalkWindowsMs ?? BUNDLE_DEFAULTS.selfTalkWindowsMs,
        maxSamples: Math.max(0, config.selfMaxSamples ?? BUNDLE_DEFAULTS.selfMaxSamples),
        maxChars: Math.max(0, config.selfMaxChars ?? BUNDLE_DEFAULTS.selfMaxChars),
        records: readSelfTalkRecords(decisionsFile, timelineFile),
        selfName: config.selfName ?? BUNDLE_DEFAULTS.selfName,
        selfId: deps.selfId(),
        selfDescription: config.selfReferenceDescription ?? BUNDLE_DEFAULTS.selfReferenceDescription,
        selfImages: config.selfReferenceImages ?? BUNDLE_DEFAULTS.selfReferenceImages,
        personaName: profile?.name ?? '',
        personaSummary: profile?.summary ?? '',
        chatKey,
        samples: samplesOf(deps.recent(chatKey), deps.selfId()),
        ownerQq: config.creatorQq ?? '',
        media: readMediaItems(mediaFile),
        stickers: readStickerItems(stickerFile),
      })
    },
  })
}
