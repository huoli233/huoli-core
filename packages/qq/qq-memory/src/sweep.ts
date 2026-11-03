// 记忆往上挪和慢慢变淡：往上挪每轮跑，变淡每天跑一次

import { clarityFor, retention, stepClarity } from '@huoli/huoli-qq-policy'
import type { MemoryStore } from './store.ts'
import type { MemoryItem } from './types.ts'

// 刚发生的记忆多久后可以变成这段经历
const PROMOTE_AFTER_MS = 30 * 60_000

// 多重要的记忆能直接变成长期印象
const STRONG_IMPORTANCE = 60

// 被提起几次就可以变成长期印象
const PROMOTE_RECALLS = 2

/**
 * 把该往上挪的记忆挪上一层
 * @param store - 存放的地方
 * @param now - 现在的时间
 * @returns 算出来的数
 */
export function promoteAll(store: MemoryStore, now: number): number {
  let moved = 0
  for (const item of store.all()) {
    if (item.forgotten) continue
    if (item.layer === 'ephemeral') {
      if (now - item.at < PROMOTE_AFTER_MS) continue
      store.update(item.id, { layer: 'episodic' })
      moved += 1
      continue
    }
    if (item.layer === 'episodic') {
      const strong = item.importance >= STRONG_IMPORTANCE || item.recallCount >= PROMOTE_RECALLS
      if (!strong) continue
      store.update(item.id, { layer: 'semantic' })
      moved += 1
    }
  }
  return moved
}

// 按现在的样子算一次它该有多清楚
function clarityOf(item: MemoryItem, now: number) {
  const score = retention(
    { importance: item.importance, at: item.at, lastSeenAt: item.lastSeenAt, recallCount: item.recallCount },
    now,
  )
  return clarityFor(score)
}

/**
 * 每天跑一次：把该淡的往下挪一档，淡到底就只留个坑
 * @param store - 存放的地方
 * @param now - 现在的时间
 * @returns 处理结果
 */
export function sweepOnce(store: MemoryStore, now: number): { stepped: number; forgotten: number } {
  let stepped = 0
  let forgotten = 0
  for (const item of store.all()) {
    if (item.forgotten) continue
    const target = clarityOf(item, now)
    const next = stepClarity(item.clarity, target)
    if (next !== item.clarity) {
      if (next === 'forgotten') {
        store.update(item.id, { clarity: next, text: '', forgotten: true })
        forgotten += 1
      } else {
        store.update(item.id, { clarity: next })
        stepped += 1
      }
      continue
    }
  }
  return { stepped, forgotten }
}

/**
 * 被再提起一次：记住次数与时间，可能重新变清楚
 * @param store - 存放的地方
 * @param id - 编号
 * @param now - 现在的时间
 */
export function touch(store: MemoryStore, id: string, now: number): void {
  const item = store.byId(id)
  if (item === undefined || item.forgotten) return
  store.update(id, {
    recallCount: item.recallCount + 1,
    lastSeenAt: now,
    clarity: item.clarity === 'forgotten' ? 'trace' : item.clarity,
  })
}
