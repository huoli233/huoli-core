// 注意力状态机的装配入口：五个工具 + 落盘状态 + 事实采集

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { createInbox, type QqInbox, type QqMessage } from './inbox.ts'
import { createAttentionStore, type AttentionStore } from './store.ts'
import { collectSignals, type AttentionSignals, type SignalMessage } from './select.ts'
import { registerAttentionTools } from './tools.ts'
import { shouldWake as decideWake, type GroupWakePolicy, type WakeDecision, type WakeMessage } from './wake-policy.ts'

export type { InboxPush, InboxRead, InboxWait, QqInbox, QqMessage } from './inbox.ts'
export type { AttentionState, AttentionEvent, WakeTriggers } from './types.ts'
export { NOTE_MAX_CHARS } from './types.ts'
export type { AttentionStore, AttentionStoreOptions } from './store.ts'
export type { AttentionSignals, Candidate, CollectInput, SignalMessage } from './select.ts'
export { collectSignals } from './select.ts'
export type { AttentionEmotion, AttentionFactsInput, WakePreference } from './facts.ts'
export { renderAttentionFacts } from './facts.ts'
export type { InterjectTuning, SpeakFacts, SpeakVerdict, StopFacts, StopVerdict } from './interject.ts'
export { INTERJECT_DEFAULTS, renderSpeakFacts, renderStopFacts } from './interject.ts'
export { WAIT_MAX_MS, DEFAULT_READ_LIMIT, DEFAULT_QUIET_MS } from './tools.ts'
export { shouldWake } from './wake-policy.ts'
export type { GroupWakePolicy, WakeDecision, WakeMessage } from './wake-policy.ts'

/** 一个应用上下文里的运行件 */
export interface QqAttentionSeam {
  inbox: QqInbox
  store: AttentionStore
  signals(chatKey: string, overrides?: { fatigueLevel?: number; fatigueReason?: string }): AttentionSignals
  shouldWake(
    chatKey: string,
    message: WakeMessage,
    signals?: AttentionSignals,
    now?: number,
    policy?: GroupWakePolicy,
  ): WakeDecision
  /** 当前自适应话痨度 */
  talkativeness(chatKey: string): number
  /** 收到反馈后调整话痨度 */
  noteTalkativeness(chatKey: string, target: number, weight?: number, at?: number): number
  /** 记录一条确认成功的发言 */
  noteSelfSpoke(chatKey: string, at?: number, count?: number): void
  /** 真人发言后清空自己连续说话的计数 */
  noteHumanSpoke(chatKey: string, at?: number): void
}

/** 这一行接受的配置 */
export interface Config {
  /** 状态文件放哪，不填就用主目录下的 data */
  file?: string
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 机器人叫什么，用来认名字 */
  selfNames?: readonly string[]
  /** 群聊按活跃度分层的设置 */
  groupPolicy?: GroupWakePolicy
}

const seams = new WeakMap<Context, QqAttentionSeam>()
const TALKATIVENESS_DECAY_MS = 30 * 60_000

/**
 * 取运行件，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqAttentionOf(ctx: Context): QqAttentionSeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-attention'

/** 需要的内核服务 */
export const inject = ['tools']

// 采集事实看多少条
const SIGNAL_WINDOW = 40

/**
 * 装配注意力状态机与五个工具
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const file = config.file ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-attention.json')
  const inbox = createInbox()
  const store = createAttentionStore({ file })
  const selfNames = config.selfNames ?? []

  const toSignal = (message: QqMessage): SignalMessage => ({
    seq: message.seq,
    senderId: message.senderId,
    ...message.senderName !== undefined ? { senderName: message.senderName } : {},
    text: message.text,
    at: message.at,
    ...message.atMe !== undefined ? { atMe: message.atMe } : {},
    ...message.isPoke !== undefined ? { isPoke: message.isPoke } : {},
    ...message.replyToBot !== undefined ? { replyToBot: message.replyToBot } : {},
  })

  const seam: QqAttentionSeam = {
    inbox,
    store,
    signals(chatKey, overrides = {}) {
      return collectSignals({
        chatKey,
        messages: inbox.recent(chatKey, SIGNAL_WINDOW).filter(message => message.isRecall !== true).map(toSignal),
        selfNames,
        ...overrides.fatigueLevel !== undefined ? { fatigueLevel: overrides.fatigueLevel } : {},
        ...overrides.fatigueReason !== undefined ? { fatigueReason: overrides.fatigueReason } : {},
      })
    },
    shouldWake(chatKey, message, signals, now = Date.now(), policy = {}) {
      return decideWake(store.of(chatKey), message, signals, { ...config.groupPolicy, ...policy }, now, store)
    },
    talkativeness(chatKey) {
      const state = store.of(chatKey)
      const value = Math.min(1, Math.max(0, state.talkativeness ?? 0.5))
      const changedAt = state.talkativenessAt ?? 0
      if (changedAt <= 0) return value
      const elapsed = Math.max(0, Date.now() - changedAt)
      const towardBaseline = 1 - 2 ** (-elapsed / TALKATIVENESS_DECAY_MS)
      return Math.min(1, Math.max(0, value + (0.5 - value) * towardBaseline))
    },
    noteTalkativeness(chatKey, target, weight = 0.15, at = Date.now()) {
      store.append({ type: 'talkativeness', chatKey, target, weight, at })
      return seam.talkativeness(chatKey)
    },
    noteSelfSpoke(chatKey, at = Date.now(), count = 1) {
      store.append({ type: 'self_spoke', chatKey, at, count })
    },
    noteHumanSpoke(chatKey, at = Date.now()) {
      store.append({ type: 'human_spoke', chatKey, at })
    },
  }
  seams.set(ctx.root, seam)

  registerAttentionTools(ctx, {
    inbox,
    store,
    recentOf: chatKey => inbox.recent(chatKey, SIGNAL_WINDOW).map(toSignal),
    selfNames: () => selfNames,
  })

  // 卸载时落一次盘，正常退出不丢最后一次设置
  ctx.effect(() => () => {
    store.flush()
    seams.delete(ctx.root)
  })
}
