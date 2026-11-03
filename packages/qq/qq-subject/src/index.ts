// 状态装配入口：把状态写成一段话，放进每轮提示词

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import '@huoli/huoli-system-prompt'
import { createSubjectStore, type SubjectStore } from './store.ts'
import { renderSelfSnapshot, type SnapshotInput } from './snapshot.ts'

export type { ChatState, GlobalState, SubjectState } from './state.ts'
export { emptyChat, emptySubject, familiarityWord, moodWord } from './state.ts'
export type { SnapshotInput } from './snapshot.ts'
export { renderSelfSnapshot } from './snapshot.ts'
export type { SubjectStore, SubjectStoreOptions } from './store.ts'

/** 一个应用里的状态仓 */
export interface QqSubjectSeam {
  store: SubjectStore
  render(chatKey?: string, thoughts?: readonly string[]): string
}

/** 这一行接受的配置 */
export interface Config {
  /** 状态存哪 */
  file?: string
  /** 一段状态最多写多少字 */
  maxChars?: number
  /** 每个群叫什么名字，写快照时用 */
  chatNames?: Record<string, string>
}

const seams = new WeakMap<Context, QqSubjectSeam>()

/**
 * 取状态仓，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqSubjectOf(ctx: Context): QqSubjectSeam | undefined {
  return seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-subject'

/** 要用的内核接口 */
export const inject = ['systemPrompt']

// 提示词里的占位名
const VARIABLE = 'qq_self'

// 一段状态最多多少字
const DEFAULT_MAX_CHARS = 300

/**
 * 装配状态与提示词那一段
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const file = config.file ?? path.join(process.cwd(), 'data', 'qq-subject.json')
  const maxChars = Math.max(60, config.maxChars ?? DEFAULT_MAX_CHARS)
  const chatNames = config.chatNames ?? {}
  const store = createSubjectStore({ file })

  const seam: QqSubjectSeam = {
    store,
    render(chatKey, thoughts) {
      const state = store.read()
      const key = chatKey ?? state.lastActive
      const input: SnapshotInput = {
        global: state.global,
        ...key !== '' ? { chat: store.forChat(key) } : {},
        ...key !== '' && chatNames[key] !== undefined ? { chatName: chatNames[key] } : {},
        ...thoughts !== undefined ? { thoughts } : {},
        maxChars,
      }
      return renderSelfSnapshot(input)
    },
  }
  seams.set(ctx, seam)

  ctx.systemPrompt.section({
    name: 'qq:self',
    order: 320,
    text: `【此刻的我】{{${VARIABLE}}}`,
  })

  ctx.systemPrompt.variable(VARIABLE, () => {
    const state = store.read()
    if (state.lastActive === '') return '还没有聊过天。'
    const input: SnapshotInput = {
      global: state.global,
      chat: store.forChat(state.lastActive),
      ...chatNames[state.lastActive] !== undefined ? { chatName: chatNames[state.lastActive] } : {},
      maxChars,
    }
    const text = renderSelfSnapshot(input)
    return text.startsWith('【此刻的我】') ? text.slice('【此刻的我】'.length).trim() : text
  })

  // 卸载时把状态写一次盘
  ctx.effect(() => () => {
    store.flush()
    seams.delete(ctx)
  })
}
