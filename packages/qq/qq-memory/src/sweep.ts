// 记忆往上挪和慢慢变淡：往上挪每轮跑，变淡与掉分每天跑一次

import {
  clarityFor,
  importanceAfterDrop,
  importanceAfterRecall,
  importanceDailyDrop,
  retention,
  stepClarity,
} from '@huoli/huoli-qq-policy'
import { DEFAULTS, type Tuning } from './defaults.ts'
import type { MemoryStore } from './store.ts'
import type { MemoryItem } from './types.ts'

// 刚发生的记忆多久后可以变成这段经历
const PROMOTE_AFTER_MS = 30 * 60_000

// 多重要的记忆能直接变成长期印象
const STRONG_IMPORTANCE = 60

// 被提起几次就可以变成长期印象
const PROMOTE_RECALLS = 2

// 本地零点，用来数「当天」回升过几次
function startOfDay(at: number): number {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/**
 * 把该往上挪的记忆挪上一层
 * @param store - 存放的地方
 * @param now - 现在的时间
 * @returns 算出来的数
 */
export function promoteAll(store: MemoryStore, now: number): number {
  let moved = 0
  for (const item of store.all()) {
    if (item.state === 'forgotten') continue
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
 * 每天先把重要度降一遍：受保护的、已遗忘的一分不掉，掉到地板就停
 * @param store - 存放的地方
 * @param tuning - 衰减参数与保护线
 * @returns 这次掉了分的条数
 */
export function decayAll(store: MemoryStore, tuning: Tuning = DEFAULTS): number {
  let dropped = 0
  for (const item of store.all()) {
    if (item.state === 'forgotten') continue
    const drop = importanceDailyDrop(
      { importance: item.importance, recallCount: item.recallCount, emotional: item.emotional },
      tuning.protectLine,
      tuning,
    )
    if (drop <= 0) continue
    const next = importanceAfterDrop(item.importance, drop, tuning.importanceFloor)
    if (next >= item.importance) continue
    store.update(item.id, { importance: next })
    dropped += 1
  }
  return dropped
}

/**
 * 重要度降完再跑：把该淡的往下挪一档，淡到底就退役并清掉正文
 * @param store - 存放的地方
 * @param now - 现在的时间
 * @returns 处理结果
 */
export function sweepOnce(store: MemoryStore, now: number): { stepped: number; forgotten: number } {
  let stepped = 0
  let forgotten = 0
  for (const item of store.all()) {
    if (item.state === 'forgotten') continue
    const target = clarityOf(item, now)
    const next = stepClarity(item.clarity, target)
    if (next !== item.clarity) {
      if (next === 'forgotten') {
        // 退役时刻与清正文同一次写入，落盘后不会出现「有退役没时刻」的中间态
        store.update(item.id, { clarity: next, text: '', state: 'forgotten', retiredAt: now })
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
 * 被再提起一次：记次数与时间，当天第一次还把重要度抬一点
 * @param store - 存放的地方
 * @param id - 编号
 * @param now - 现在的时间
 * @param tuning - 回升参数与保护线
 */
export function touch(store: MemoryStore, id: string, now: number, tuning: Tuning = DEFAULTS): void {
  const item = store.byId(id)
  if (item === undefined || item.state === 'forgotten') return
  const day = startOfDay(now)
  const usedToday = item.recoverDay === day ? item.recoverTimes : 0
  const skipped = item.clarity === 'trace' || usedToday >= tuning.recoverPerDay
  const recovered = skipped ? item.importance : importanceAfterRecall(item.importance, tuning.protectLine, tuning)
  const patch: Partial<MemoryItem> = {
    recallCount: item.recallCount + 1,
    lastSeenAt: now,
  }
  if (recovered > item.importance) {
    patch.importance = recovered
    patch.recoverDay = day
    patch.recoverTimes = usedToday + 1
  }
  store.update(id, patch)
}
