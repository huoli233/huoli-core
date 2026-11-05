// 状态装配入口：把状态写成一段话，放进每轮提示词

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import '@huoli/huoli-system-prompt'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { createSubjectStore, type SubjectStore } from './store.ts'
import { renderSelfSnapshot, SNAPSHOT_DEFAULTS, type SnapshotInput } from './snapshot.ts'

export type { ChatState, GlobalState, SubjectState } from './state.ts'
export { emptyChat, emptySubject, familiarityWord, moodWord } from './state.ts'
export type { SnapshotInput } from './snapshot.ts'
export { renderSelfSnapshot } from './snapshot.ts'
export type { SubjectStore, SubjectStoreOptions } from './store.ts'

/** 一个应用里的状态仓 */
export interface QqSubjectSeam {
  store: SubjectStore
  render(chatKey?: string, thoughts?: readonly string[]): string
  /** 碰到没见过的话题：把好奇心抬一点，抬到顶就夹住 */
  noteNovelty(at: number): void
}

/** 这一行接受的配置 */
export interface Config {
  /** 状态存哪，不填就用主目录下的 data */
  file?: string
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 一段状态最多写多少字 */
  maxChars?: number
  /** 每个群叫什么名字，写快照时用 */
  chatNames?: Record<string, string>
  /** 一次陌生话题把好奇心抬多少，默认零点一二 */
  curiosityNoveltyGain?: number
}

const seams = new WeakMap<Context, QqSubjectSeam>()

/**
 * 取状态仓，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqSubjectOf(ctx: Context): QqSubjectSeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-subject'

/** 要用的内核接口 */
export const inject = ['systemPrompt']

// 提示词里留的那个名字
const VARIABLE = 'qq_self'

/**
 * 装配状态与提示词那一段
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const file = config.file ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-subject.json')
  const maxChars = Math.max(SNAPSHOT_DEFAULTS.minChars, config.maxChars ?? SNAPSHOT_DEFAULTS.maxChars)
  const chatNames = config.chatNames ?? {}
  const store = createSubjectStore({ file })
  const curiosityGain = config.curiosityNoveltyGain ?? 0.12

  const seam: QqSubjectSeam = {
    store,
    // 陌生话题抬一点好奇心：这是它唯一的上升来源，衰减由策略那一层管
    noteNovelty() {
      store.changeGlobal('curiosity', curiosityGain)
    },
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
  seams.set(ctx.root, seam)

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
    seams.delete(ctx.root)
  })
}
