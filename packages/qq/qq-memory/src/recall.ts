// 找记忆：先看字面上有没有，再看重不重要、清不清楚

import { retention } from '@huoli/huoli-qq-policy'
import type { MemoryStore } from './store.ts'
import type { MemoryItem } from './types.ts'

/** 找记忆时给的条件 */
export interface RecallInput {
  query?: string
  scope?: string
  limit?: number
  now?: number
}

/** 找到的一条 */
export interface RecallHit {
  item: MemoryItem
  score: number
}

// 清楚程度的加分
const CLARITY_BONUS: Record<MemoryItem['clarity'], number> = {
  vivid: 12,
  clear: 8,
  fuzzy: 3,
  trace: 0,
  forgotten: -100,
}

// 按字面重合算一点分
function textScore(text: string, query: string): number {
  if (query === '') return 0
  const body = text.toLowerCase()
  const needle = query.toLowerCase()
  if (body.includes(needle)) return 20
  let hit = 0
  for (const part of needle.split(/\s+/).filter((piece) => piece.length >= 2)) {
    if (body.includes(part)) hit += 6
  }
  return Math.min(18, hit)
}

/**
 * 找几条相关的记忆
 * @param store - 存放的地方
 * @param input - 传进来的东西
 * @returns 处理结果
 */
export function recall(store: MemoryStore, input: RecallInput = {}): RecallHit[] {
  const now = input.now ?? Date.now()
  const limit = Math.max(1, input.limit ?? 5)
  const query = String(input.query ?? '').trim()

  const hits: RecallHit[] = []
  for (const item of store.all()) {
    if (item.forgotten) continue
    if (input.scope !== undefined && input.scope !== '' && item.scope !== input.scope) continue
    const textHits = textScore(item.text, query)
    // 给了关键词却一个字都对不上，就不该把它翻出来
    if (query !== '' && textHits === 0) continue
    const base = retention(
      { importance: item.importance, at: item.at, lastSeenAt: item.lastSeenAt, recallCount: item.recallCount },
      now,
    )
    const score = base + CLARITY_BONUS[item.clarity] + textHits
    hits.push({ item, score })
  }

  hits.sort((a, b) => b.score - a.score || b.item.at - a.item.at)
  return hits.slice(0, limit)
}

/**
 * 把找到的记忆写成给模型看的几行字
 * @param hits - 找到的记忆
 * @returns 拼好的话
 */
export function renderRecall(hits: readonly RecallHit[]): string {
  if (hits.length === 0) return '没有想起相关的事。'
  return hits
    .map((hit) => `${new Date(hit.item.at).toISOString().slice(0, 10)} ${hit.item.text}`)
    .join('\n')
}
