// 遗书写成一条记忆：正文先用模型自己在暂存槽里写的，没写才用配置或中性那句，同一天同一个人只写一条

import type { MemoryItem } from '@huoli/huoli-qq-memory'
import type { FarewellFact } from '@huoli/huoli-qq-vitals'

/** 正文是谁写的：模型自己写过就是 model，没写才走到 fallback */
export type FarewellAuthor = 'model' | 'fallback'

/** 没给模型文本时写的那句中性话，措辞固定，不编造具体内容 */
export const FAREWELL_NEUTRAL = '有些话想留给她'

/**
 * 这一条记忆的正文：模型写过用它的，没写才用调用方给的文本，再没有就用中性那句
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
 * @param authoredBy - 正文是模型自己写的还是用的是备用话
 * @returns metadata 里的四个字段
 */
export function farewellMetadata(fact: FarewellFact, authoredBy: FarewellAuthor): Record<string, unknown> {
  return { kind: 'farewell', at: fact.at, mortality: fact.mortality, authoredBy }
}

/**
 * 这一条事实是不是已经写过了，判据只读记忆本身，不另存一份
 * @param items - 现有的记忆
 * @param chatKey - 写进哪个会话
 * @param at - 到线的时刻
 * @returns 同一时刻的那条已经写过就是 true
 */
export function farewellWritten(items: readonly MemoryItem[], chatKey: string, at: number): boolean {
  // 只挡「同一条事实写第二遍」；隔多久再产一封由身体那边按十二小时窗口管
  return items.some(item =>
    item.scope === chatKey
    && item.metadata?.kind === 'farewell'
    && item.at === at,
  )
}
