// 注意力状态机的装配入口：五个工具 + 落盘状态 + 事实采集

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { createInbox, type QqInbox } from './inbox.ts'
import { createAttentionStore, type AttentionStore } from './store.ts'
import { collectSignals, type AttentionSignals, type SignalMessage } from './select.ts'
import { registerAttentionTools } from './tools.ts'

export type { InboxPush, InboxRead, InboxWait, QqInbox, QqMessage } from './inbox.ts'
export type { AttentionState, AttentionEvent, WakeTriggers } from './types.ts'
export { NOTE_MAX_CHARS } from './types.ts'
export type { AttentionStore, AttentionStoreOptions } from './store.ts'
export type { AttentionSignals, Candidate, CollectInput, SignalMessage } from './select.ts'
export { collectSignals } from './select.ts'
export { WAIT_MAX_MS, DEFAULT_READ_LIMIT, DEFAULT_QUIET_MS } from './tools.ts'

/** 一个应用上下文里的运行件 */
export interface QqAttentionSeam {
  inbox: QqInbox
  store: AttentionStore
  signals(chatKey: string, overrides?: { fatigueLevel?: number; fatigueReason?: string }): AttentionSignals
}

/** 这一行接受的配置 */
export interface Config {
  /** 状态文件放哪，不填就用主目录下的 data */
  file?: string
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 机器人叫什么，用来认名字 */
  selfNames?: readonly string[]
}

const seams = new WeakMap<Context, QqAttentionSeam>()

/**
 * 取运行件，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqAttentionOf(ctx: Context): QqAttentionSeam | undefined {
  return seams.get(ctx)
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

  const toSignal = (message: { seq: number; senderId: string; senderName?: string; text: string; at: number }): SignalMessage => ({
    seq: message.seq,
    senderId: message.senderId,
    ...message.senderName !== undefined ? { senderName: message.senderName } : {},
    text: message.text,
    at: message.at,
  })

  const seam: QqAttentionSeam = {
    inbox,
    store,
    signals(chatKey, overrides = {}) {
      return collectSignals({
        chatKey,
        messages: inbox.recent(chatKey, SIGNAL_WINDOW).map(toSignal),
        selfNames,
        ...overrides.fatigueLevel !== undefined ? { fatigueLevel: overrides.fatigueLevel } : {},
        ...overrides.fatigueReason !== undefined ? { fatigueReason: overrides.fatigueReason } : {},
      })
    },
  }
  seams.set(ctx, seam)

  registerAttentionTools(ctx, {
    inbox,
    store,
    recentOf: chatKey => inbox.recent(chatKey, SIGNAL_WINDOW).map(toSignal),
    selfNames: () => selfNames,
  })

  // 卸载时落一次盘，正常退出不丢最后一次设置
  ctx.effect(() => () => {
    store.flush()
    seams.delete(ctx)
  })
}
