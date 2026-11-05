// 装配层要用到的几件小事：读规则、拆时刻、把身体转述成条数事实

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@huoli/cordis'
import { renderAttentionFacts, type QqAttentionSeam, type QqMessage } from '@huoli/huoli-qq-attention'
import { renderContinuityFacts, type QqContinuitySeam } from '@huoli/huoli-qq-continuity'
import type { QqMaterialSeam } from '@huoli/huoli-qq-material'
import { replyBudget, type ReplyFacts } from '@huoli/huoli-qq-pacing'
import type { QqVitalsSeam, VitalsState } from '@huoli/huoli-qq-vitals'

/**
 * 把现场素材与上次的话头挂成提示词的两段
 * @param ctx - 运行环境
 * @param deps - 当前会话、两个仓与收件箱读法
 */
export function registerMaterialPrompts(
  ctx: Context,
  deps: {
    activeChatKey(): string
    material: QqMaterialSeam | undefined
    continuity: QqContinuitySeam | undefined
    recent(chatKey: string): readonly QqMessage[]
  },
): void {
  ctx.systemPrompt.section({
    name: 'qq:material',
    order: 330,
    text: () => {
      const chatKey = deps.activeChatKey()
      if (deps.material === undefined || chatKey === '') return ''
      return deps.material.render(deps.material.gather({ chatKey, messages: [...deps.recent(chatKey)] }))
    },
  })
  ctx.systemPrompt.section({
    name: 'qq:continuity',
    order: 320,
    text: () => {
      const chatKey = deps.activeChatKey()
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
  deps: { attention: QqAttentionSeam | undefined; activeChatKey(): string },
): void {
  ctx.systemPrompt.section({
    name: 'qq:attention',
    order: 340,
    text: () => {
      const chatKey = deps.activeChatKey()
      if (deps.attention === undefined || chatKey === '') return ''
      return renderAttentionFacts({
        signals: deps.attention.signals(chatKey),
        wake: deps.attention.store.of(chatKey),
        now: Date.now(),
      })
    },
  })
}

/**
 * 规则文件的位置
 * @returns 包内 prompts/rules.md 的绝对路径，取不到就按当前目录拼
 */
export function defaultRulesPath(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    return path.join(here, '..', 'prompts', 'rules.md')
  } catch {
    return path.join(process.cwd(), 'prompts', 'rules.md')
  }
}

/**
 * 读规则，读不到就用一句兜底
 * @param file - 规则文件路径
 * @returns 规则正文
 */
export function readRules(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
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
 * 睡眠那三项事实原样转述，判不判由被动那一边的闸门定
 * @param state - 身体那一份状态
 * @returns 睡着、预计醒来的时刻、刚被吵醒
 */
export function sleepFactsOf(state: VitalsState): { asleep: boolean; wakeAfter: number; waking: boolean } {
  return { asleep: state.asleep, wakeAfter: state.wake_after, waking: state.sleep_state === 'waking' }
}

/** 身体没接上时按中性的身体算，上限照样是一个数 */
export const NEUTRAL_FACTS: ReplyFacts = { tired: 0.5, annoyed: 0.5, energy: 0.5, clingy: 0.5, lonely: 0.5 }

/**
 * 这一段只说这一轮最多几句，不说该不该回
 * @param vitals - 身体那一面，没接上时按中性事实算
 * @returns 条数上限
 */
export function budgetOf(vitals: QqVitalsSeam | undefined): number {
  const facts = vitals === undefined ? NEUTRAL_FACTS : replyFactsOf(vitals.read())
  return replyBudget(facts)
}

/**
 * 提示词里那一句与发送路径读的是同一个数，两处不会对不上
 * @param vitals - 身体那一面，没接上时按中性事实算
 * @returns 这一轮条数那一段
 */
export function budgetLine(vitals: QqVitalsSeam | undefined): string {
  return `【这一轮的条数】这一轮最多说 ${budgetOf(vitals)} 条，说完就停，不追问，也不凑满。想发动态时把这条交给发布入口。`
}
