// 看视频的线索：只从既有接缝取原话与话题，摆样本和次数，判断权归模型

import fs from 'node:fs'
import type { Context } from '@huoli/cordis'
import type { AssembleContext } from '@huoli/huoli-system-prompt'
import type { QqMessage } from '@huoli/huoli-qq-attention'
import type { QqMaterialSeam } from '@huoli/huoli-qq-material'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import type { Config } from './types.ts'
import { samplesOf, type SelfSample } from './self-awareness.ts'

/** 拼这一段要用的既有数据 */
export interface VideoInterestInput {
  now: number
  /** 原话样本最多几条 */
  maxSamples: number
  /** 整段最多几个字符 */
  maxChars: number
  /** 收件箱里的群友原话 */
  samples: readonly SelfSample[]
  /** 素材层给出的最近话题 */
  topics: readonly string[]
  /** 诊断时间线里带文字的少量线索 */
  timeline: readonly string[]
}

/** 时间线里已经会写的文字字段，只认这几个，不猜内容 */
const TEXT_FIELDS = ['text', 'topic', 'caption', 'interest'] as const

/** 一行解成对象，坏行丢掉 */
function rowOf(line: string): Record<string, unknown> | null {
  if (line.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(line)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/** 收成一行：网址、本机路径与控制字符都不带进事实 */
function clip(value: string, limit: number): string {
  const text = value
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/[A-Za-z]:[\\/][^\s]+/gu, '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const chars = Array.from(text)
  return chars.length <= limit ? text : `${chars.slice(0, Math.max(0, limit - 1)).join('')}…`
}

/**
 * 读诊断时间线里带文字的行；现在的时间线只记事件不存原话，取不到就是空表
 * @param file - 既有诊断时间线
 * @param chatKey - 当前会话
 * @param maxSamples - 最多取几条
 * @returns 去重后的短句，读不到或没带文字时是空表
 */
export function readTimelineClues(file: string, chatKey: string, maxSamples: number): string[] {
  if (maxSamples <= 0) return []
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
  } catch {
    return []
  }
  const lines = text.split('\n').slice(-Math.max(20, maxSamples * 20))
  const clues: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const row = rowOf(line)
    if (row === null) continue
    const scope = row.chatKey
    if (typeof scope === 'string' && scope !== '' && scope !== chatKey) continue
    for (const field of TEXT_FIELDS) {
      const value = row[field]
      if (typeof value !== 'string' || value.trim() === '') continue
      const short = clip(value, 40)
      if (short === '' || seen.has(short)) continue
      seen.add(short)
      clues.push(short)
      if (clues.length >= maxSamples) return clues
    }
  }
  return clues
}

/**
 * 从既有素材层取最近话题，不另算话题、不按词判兴趣
 * @param material - 素材仓
 * @param messages - 收件箱里的最近消息
 * @param selfId - 机器人自己的号
 * @param chatKey - 当前会话
 * @returns 最近话题与心里惦记的事，取不到时是空表
 */
export function recentTopicsOf(
  material: QqMaterialSeam | undefined,
  messages: readonly QqMessage[],
  selfId: string,
  chatKey: string,
): string[] {
  if (material === undefined) return []
  const gathered = material.gather({
    chatKey,
    messages: messages.map(message => ({
      seq: message.seq,
      senderId: message.senderId,
      ...message.senderName === undefined ? {} : { senderName: message.senderName },
      text: message.text,
      at: message.at,
      self: selfId !== '' && message.senderId === selfId,
      ...message.atMe === undefined ? {} : { atMe: message.atMe },
    })),
  })
  return [gathered.situation.topic, ...gathered.thoughts.map(thought => thought.text)]
    .map(value => clip(value, 40))
    .filter(value => value !== '')
}

/**
 * 把「可以顺着找什么」压成极短一段事实：只摆原话样本与频次
 * @param input - 既有接缝取来的数据
 * @returns 给模型看的一段；上限为零或全无线索时是空串
 */
export function renderVideoInterest(input: VideoInterestInput): string {
  const maxChars = Math.max(0, Math.floor(input.maxChars))
  if (maxChars === 0) return ''
  const budget = Math.max(0, Math.floor(input.maxSamples))
  const perLine = Math.max(8, Math.floor(maxChars / 6))
  const lines = [
    '[DATA] QQ_VIDEO_INTEREST',
    '只是可以顺着找什么的线索，不是让你去看、去搜、去分享的指令；看不看、找什么、说不说都由你自己定。',
  ]
  const topics = [...new Set(input.topics)].filter(value => value !== '').slice(0, 2)
  for (const topic of topics) lines.push(`群里在聊：${clip(topic, perLine)}`)
  const counts = new Map<string, number>()
  for (const sample of input.samples) counts.set(sample.text, (counts.get(sample.text) ?? 0) + 1)
  const perSender = new Map<string, number>()
  for (const sample of input.samples) perSender.set(sample.senderId, (perSender.get(sample.senderId) ?? 0) + 1)
  const samples: string[] = []
  const repeated = [...counts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1])
  for (const [text, count] of repeated) samples.push(`原话「${clip(text, perLine)}」出现 ${count} 次`)
  const shown = new Set<string>()
  const fresh = input.samples.filter(sample => sample.text !== '' && sample.senderId !== '')
  for (const sample of [...fresh].reverse()) {
    if (shown.has(sample.text)) continue
    shown.add(sample.text)
    const name = sample.senderName === '' ? sample.senderId : sample.senderName
    samples.push(`${clip(name, 12)}这一阵说了 ${perSender.get(sample.senderId) ?? 1} 条：原话「${clip(sample.text, perLine)}」`)
  }
  for (const clue of input.timeline) samples.push(`时间线里的一句：「${clip(clue, perLine)}」`)
  lines.push(...samples.slice(0, budget))
  const chars = Array.from(lines.join('\n'))
  return chars.length <= maxChars ? chars.join('') : chars.slice(0, maxChars).join('')
}

/** 挂这一段要用的既有接缝 */
export interface VideoInterestPromptDeps {
  /** 配置 */
  config: Config
  /** 当前会话的键，概率闲聊里是空串 */
  activeChatKey(context: AssembleContext): string
  /** 既有收件箱里的最近消息 */
  recent(chatKey: string): readonly QqMessage[]
  /** 机器人自己的号 */
  selfId(): string
  /** 素材层，给最近话题用 */
  material: QqMaterialSeam | undefined
  /** 既有诊断时间线，取不到原话就是空表 */
  timelineFile: string
}

/** 把「可以顺着找什么」挂成极短一段事实，默认关，判断权归模型 */
export function registerVideoInterestPrompt(ctx: Context, deps: VideoInterestPromptDeps): void {
  const { config } = deps
  if (!(config.videoInterestEnabled ?? BUNDLE_DEFAULTS.videoInterestEnabled)) return
  const maxSamples = Math.max(0, config.videoInterestMaxSamples ?? BUNDLE_DEFAULTS.videoInterestMaxSamples)
  const maxChars = Math.max(0, config.videoInterestMaxChars ?? BUNDLE_DEFAULTS.videoInterestMaxChars)
  ctx.systemPrompt.section({
    name: 'qq:video-interest',
    order: 347,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      if (chatKey === '') return ''
      const messages = deps.recent(chatKey)
      const selfId = deps.selfId()
      return renderVideoInterest({
        now: Date.now(),
        maxSamples,
        maxChars,
        samples: samplesOf(messages, selfId),
        topics: recentTopicsOf(deps.material, messages, selfId, chatKey),
        timeline: readTimelineClues(deps.timelineFile, chatKey, maxSamples),
      })
    },
  })
}
