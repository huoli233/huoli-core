// 把这一轮的表情候选写成一段事实：配不配、发哪张都由模型自己定

import type { Context } from '@huoli/cordis'
import type { AssembleContext } from '@huoli/huoli-system-prompt'
import type { QqAttentionSeam } from '@huoli/huoli-qq-attention'
import type { QqVitalsSeam } from '@huoli/huoli-qq-vitals'
import { defaultStickerFile, defaultStickerUsageFile, suggestStickers } from '@huoli/huoli-qq-channel/src/stickers.ts'
import type { StickerSuggestOutcome } from '@huoli/huoli-qq-channel/src/stickers.ts'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import type { Config } from './types.ts'

/** 发一张表情包的那个工具名 */
export const STICKER_SEND_TOOL = 'qq_send_sticker'

/**
 * 把候选写成给模型看的一段中文事实
 * @param outcome - 这一轮算出来的候选、空库或刚发过
 * @returns 一段事实，没什么可说时是空串
 */
export function stickerCandidateFacts(outcome: StickerSuggestOutcome): string {
  if (!outcome.ok) return ''
  if (outcome.librarySize === 0) return '库里还没有表情包，这一轮不用配图。'
  if (outcome.candidates.length === 0) return ''
  const lines = outcome.candidates.map(candidate => `- ${candidate.id} 因为 ${candidate.reasons.join('；')}`
    + (candidate.usage === '' ? '' : `，用的时候：${candidate.usage}`))
  return [
    outcome.fallback === true
      ? '没有完全对上的表情，这几张是现在最接近的，发不发你自己判断：'
      : '现在很适合配一张表情包，发不发你自己判断：',
    ...lines,
    `想发就把编号交给 ${STICKER_SEND_TOOL}，不想发就只说话。`,
  ]
    .join('\n')
}

/** 接这一路要的东西 */
export interface StickerPromptDeps {
  /** 配置 */
  config: Config
  /** 当前会话的键，概率闲聊里是空串 */
  activeChatKey(context: AssembleContext): string
  /** 身体那一路，情绪与强度从它读 */
  vitals?: QqVitalsSeam | undefined
  /** 注意力那一路，场景从最近几条取 */
  attention?: QqAttentionSeam | undefined
}

/**
 * 把这一轮合适的表情候选挂成提示词的一段，只在真有信号时出现
 * @param ctx - 运行环境
 * @param deps - 配置、当前会话、身体与注意力
 */
export function registerStickerPrompts(ctx: Context, deps: StickerPromptDeps): void {
  const { config } = deps
  if (!(config.stickerSuggest ?? BUNDLE_DEFAULTS.stickerSuggest)) return
  // 这一处刚发过就记下时刻，反向约束靠它；窗口只有十分钟，重启后从零算
  const recent = new Map<string, number>()
  ctx.on('tools/result', (exec, result) => {
    if (exec.name !== STICKER_SEND_TOOL || result.isError) return
    const chatKey = String(exec.agent?.id ?? '')
    if (chatKey !== '') recent.set(chatKey, Date.now())
  })
  const file = config.stickerFile ?? defaultStickerFile(config.home)
  const usageFile = config.stickerUsageFile ?? defaultStickerUsageFile(config.home)
  ctx.systemPrompt.section({
    name: 'qq:sticker-candidates',
    order: 344,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      if (chatKey === '') return ''
      const body = deps.vitals?.read()
      const emotion = body?.emotion_candidates[0]
      const intensity = body?.emotion_blend[0]?.weight
      const said = [...deps.attention?.inbox.recent(chatKey, 6) ?? []].map(item => item.text).join('；')
      const outcome = suggestStickers(file, usageFile, {
        ...emotion === undefined ? {} : { emotion },
        ...intensity === undefined ? {} : { intensity },
        ...said === '' ? {} : { context: said },
      }, {
        at: Date.now(),
        limit: Math.max(1, config.stickerCandidateLimit ?? BUNDLE_DEFAULTS.stickerCandidateLimit),
        recentSentAt: recent.get(chatKey) ?? 0,
        recentWindowMs: Math.max(0, config.stickerRecentWindowMs ?? BUNDLE_DEFAULTS.stickerRecentWindowMs),
      })
      return stickerCandidateFacts(outcome)
    },
  })
}
