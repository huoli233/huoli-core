// 疤痕写成一条长期印象：正文一句固定的说法，重要度取事实里的，一小时里只写一次

import type { MemoryItem } from '@huoli/huoli-qq-memory'
import type { ScarFact } from '@huoli/huoli-qq-vitals'
import { memoryImportance } from './importance.ts'

/** 疤痕那条记忆的正文，措辞固定，不复述当时那句原话 */
export const SCAR_TEXT = '被说要关掉、要换掉的那一次，身上留下了一道疤'

/** 两条疤痕记忆之间至少隔多久，同一个小时里只留一条 */
export const SCAR_GAP_MS = 60 * 60_000

/**
 * 跟着这条记忆一起存的附加事实
 * @param fact - 留下这道疤的那一刻
 * @returns metadata 里的两个字段
 */
export function scarMetadata(fact: ScarFact): Record<string, unknown> {
  return { kind: 'scar', at: fact.at }
}

/**
 * 写记忆时用的重要度：事实给的是零到一，记忆按百分制存
 * @param fact - 留下这道疤的那一刻
 * @returns 百分制的重要度，第一次是满格，之后压在疤的上限
 */
export function scarImportance(fact: ScarFact): number {
  return memoryImportance(fact.importance)
}

/**
 * 这一个小时里是不是已经写过一条，判据只读记忆本身，不另存一份
 * @param items - 现有的记忆
 * @param chatKey - 写进哪个会话
 * @param at - 留下这道疤的那一刻
 * @returns 隔不到一小时就是 true
 */
export function scarWritten(items: readonly MemoryItem[], chatKey: string, at: number): boolean {
  return items.some(item =>
    item.scope === chatKey
    && item.metadata?.kind === 'scar'
    && Math.abs(at - item.at) < SCAR_GAP_MS,
  )
}
