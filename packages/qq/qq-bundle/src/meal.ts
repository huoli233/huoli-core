// 一顿饭写成一条记忆：一句人话的正文、一项去重口径，同一天同一顿只写一条

import { localDay, type MemoryItem } from '@huoli/huoli-qq-memory'
import type { MealFact } from '@huoli/huoli-qq-vitals'

/** 时段词表：小时落在哪一段就用哪个词，措辞固定，不跟着参数走 */
const MEAL_WORDS: readonly { from: number; word: string }[] = [
  { from: 5, word: '早上' },
  { from: 11, word: '中午' },
  { from: 15, word: '下午' },
  { from: 18, word: '晚上' },
]

// 没落到任何一段就是这一档，半夜吃的那顿也说得出口
const NIGHT_WORD = '夜里'

/**
 * 这一顿落在哪个时段，同一个词就算同一顿
 * @param at - 这一顿的时刻
 * @returns 时段词
 */
export function mealWord(at: number): string {
  const hour = new Date(at).getHours()
  let word = NIGHT_WORD
  for (const slot of MEAL_WORDS) {
    if (hour >= slot.from) word = slot.word
  }
  return word
}

/**
 * 这一顿的正文：一句人话，带时刻与吃的是什么
 * @param fact - 这一顿的事实
 * @returns 写进记忆的那句话
 */
export function mealText(fact: MealFact): string {
  const name = fact.name.trim()
  return `${mealWord(fact.at)}吃了${name === '' ? '饭' : name}`
}

/**
 * 跟着这条记忆一起存的附加事实
 * @param fact - 这一顿的事实
 * @returns metadata 里的三个字段
 */
export function mealMetadata(fact: MealFact): Record<string, unknown> {
  return { kind: 'meal', at: fact.at, name: fact.name }
}

/**
 * 同一天同一顿是不是已经写过一条，判据只读记忆本身，不另存一份
 * @param items - 现有的记忆
 * @param chatKey - 写进哪个会话
 * @param at - 这一顿的时刻
 * @returns 已经写过就是 true
 */
export function mealWritten(items: readonly MemoryItem[], chatKey: string, at: number): boolean {
  const day = localDay(at)
  const word = mealWord(at)
  return items.some(item =>
    item.scope === chatKey
    && item.metadata?.kind === 'meal'
    && localDay(item.at) === day
    && mealWord(item.at) === word,
  )
}
