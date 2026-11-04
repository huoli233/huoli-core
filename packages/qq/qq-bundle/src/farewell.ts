// 遗书写成一条记忆：正文由调用方给的模型文本决定，同一天同一个人只写一条

import { localDay, type MemoryItem } from '@huoli/huoli-qq-memory'
import type { FarewellFact } from '@huoli/huoli-qq-vitals'

/** 没给模型文本时写的那句中性话，措辞固定，不编造具体内容 */
export const FAREWELL_NEUTRAL = '有些话想留给她'

/**
 * 这一条记忆的正文：调用方给了模型文本就用它，没给用中性那句
 * @param text - 调用方给的模型文本，可以不给
 * @returns 写进记忆的那句话
 */
export function farewellText(text?: string): string {
  const given = (text ?? '').trim()
  return given === '' ? FAREWELL_NEUTRAL : given
}

/**
 * 跟着这条记忆一起存的附加事实
 * @param fact - 到线那一刻的事实
 * @returns metadata 里的三个字段
 */
export function farewellMetadata(fact: FarewellFact): Record<string, unknown> {
  return { kind: 'farewell', at: fact.at, mortality: fact.mortality }
}

/**
 * 同一天同一个人是不是已经写过一条，判据只读记忆本身，不另存一份
 * @param items - 现有的记忆
 * @param chatKey - 写进哪个会话
 * @param at - 到线的时刻
 * @returns 当天已经写过就是 true
 */
export function farewellWritten(items: readonly MemoryItem[], chatKey: string, at: number): boolean {
  const day = localDay(at)
  return items.some(item =>
    item.scope === chatKey
    && item.metadata?.kind === 'farewell'
    && localDay(item.at) === day,
  )
}
