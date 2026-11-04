// 一场梦写成一条记忆：正文与重要度都取事实里的，同一天同一场只写一条、只发一次

import { localDay, type MemoryItem } from '@huoli/huoli-qq-memory'
import type { DreamFact } from '@huoli/huoli-qq-vitals'
import { memoryImportance } from './importance.ts'

/**
 * 这一场梦的正文：事实里给的那一句，一个字都不编
 * @param fact - 这一场梦的事实
 * @returns 写进记忆与发出去都用这一句
 */
export function dreamText(fact: DreamFact): string {
  return fact.text.trim()
}

/**
 * 跟着这条记忆一起存的附加事实
 * @param fact - 这一场梦的事实
 * @returns metadata 里的四个字段
 */
export function dreamMetadata(fact: DreamFact): Record<string, unknown> {
  return { kind: 'dream', dreamKind: fact.kind, place: fact.place, at: fact.at }
}

/**
 * 写记忆时用的重要度：事实给的是零到一，记忆按百分制存
 * @param fact - 这一场梦的事实
 * @returns 百分制的重要度
 */
export function dreamImportance(fact: DreamFact): number {
  return memoryImportance(fact.importance)
}

/**
 * 一场梦的去重键：日期、梦的类型与地点都相同就算同一场
 * @param fact - 这一场梦的事实
 * @returns 形如 2026-11-04:sweet:天台
 */
export function dreamKey(fact: DreamFact): string {
  return `${localDay(fact.at)}:${fact.kind}:${fact.place}`
}

/**
 * 同一天同一场是不是已经写过一条，判据只读记忆本身，不另存一份
 * @param items - 现有的记忆
 * @param chatKey - 写进哪个会话
 * @param fact - 这一场梦的事实
 * @returns 已经写过就是 true
 */
export function dreamWritten(items: readonly MemoryItem[], chatKey: string, fact: DreamFact): boolean {
  const day = localDay(fact.at)
  return items.some(item =>
    item.scope === chatKey
    && item.metadata?.kind === 'dream'
    && localDay(item.at) === day
    && item.metadata['dreamKind'] === fact.kind
    && item.metadata['place'] === fact.place,
  )
}
