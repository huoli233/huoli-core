// 喝一杯水写成一条记忆：一句人话的正文、一项去重口径，二十分钟内只写一条

import type { MemoryItem } from '@huoli/huoli-qq-memory'
import type { DrinkFact } from '@huoli/huoli-qq-vitals'

// 喝水的记忆在这个窗口里只想要一条，不然后半天全是喝水
const DRINK_MEMORY_WINDOW_MS = 20 * 60_000

/**
 * 这一杯的正文：一句人话，带喝的是什么
 * @param fact - 这一杯的事实
 * @returns 写进记忆的那句话
 */
export function drinkText(fact: DrinkFact): string {
  const name = fact.name.trim()
  return name === '' ? '喝了点水' : `喝了${name}`
}

/**
 * 跟着这条记忆一起存的附加事实
 * @param fact - 这一杯的事实
 * @returns metadata 里的三个字段
 */
export function drinkMetadata(fact: DrinkFact): Record<string, unknown> {
  return { kind: 'drink', at: fact.at, name: fact.name }
}

/**
 * 这个窗口里是不是已经写过一条喝水，判据只读记忆本身，不另存一份
 * @param items - 现有的记忆
 * @param chatKey - 写进哪个会话
 * @param at - 这一杯的时刻
 * @returns 窗口里已经有就是 true
 */
export function drinkWritten(items: readonly MemoryItem[], chatKey: string, at: number): boolean {
  return items.some(item =>
    item.scope === chatKey
    && item.metadata?.kind === 'drink'
    && at - item.at < DRINK_MEMORY_WINDOW_MS,
  )
}
