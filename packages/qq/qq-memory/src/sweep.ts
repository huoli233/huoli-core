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
import { cosineSimilarity, encodeVector } from './recall.ts'
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

/** 合并式遗忘的结果 */
export interface MergeResult {
  /** 并掉了几条 */
  merged: number
  /** 被并进别人身上的那些编号 */
  retired: string[]
}

/**
 * 合并式遗忘：又旧又不重要的两条几乎同文时并成一条，重要的那条永不合并
 * @param store - 存放的地方
 * @param tuning - 门槛：多低算不重要、多久算旧、多像算同一条
 * @param now - 现在的时间
 * @returns 并掉几条、并进了哪几条
 */
export function mergeForgotten(store: MemoryStore, tuning: Tuning = DEFAULTS, now = Date.now()): MergeResult {
  const retired: string[] = []
  const old = now - tuning.mergeAfterDays * 86_400_000
  // 只碰又旧又不重要的：重要的、私密的、标成核心的一律不动
  const candidates = store.all().filter(item =>
    item.state === 'active'
    && item.clarity !== 'forgotten'
    && item.importance < tuning.mergeBelow
    && item.at < old
    && item.layer !== 'private'
    && item.secret !== true
    && item.metadata?.core !== true)
  for (const item of candidates) {
    // 以库里现在的状态为准：刚被并掉的那条不能再当自己那一端
    const live = store.byId(item.id)
    if (live === undefined || live.state !== 'active') continue
    // 两两直接比：不能拿自己跟自己比，那样每次都命中自己
    let best: { id: string; similarity: number } | undefined
    const body = encodeVector(item.text)
    for (const other of candidates) {
      if (other.id === item.id || other.state !== 'active' || other.scope !== item.scope) continue
      const similarity = cosineSimilarity(body, encodeVector(other.text))
      if (similarity === null || similarity < tuning.nearDuplicateRatio) continue
      if (best === undefined || similarity > best.similarity) best = { id: other.id, similarity }
    }
    const like = best
    if (like === undefined) continue
    const target = store.byId(like.id)
    if (target === undefined || target.state === 'forgotten') continue
    // 谁重留谁；一样重就留更早那条
    const keep = target.importance >= item.importance ? target : item
    const drop = keep.id === item.id ? target : item
    if (drop.importance >= tuning.mergeBelow) continue
    const merged = store.byId(keep.id)
    if (merged === undefined) continue
    store.update(keep.id, {
      importance: Math.max(merged.importance, drop.importance),
      recallCount: merged.recallCount + drop.recallCount,
      metadata: { ...merged.metadata, mergedFrom: [drop.id] },
    })
    // 被并掉的那条不删，标成已退役，写清并进了谁
    store.update(drop.id, {
      state: 'forgotten',
      clarity: 'forgotten',
      retiredAt: now,
      text: '',
      metadata: { ...drop.metadata, mergedInto: keep.id },
    })
    retired.push(drop.id)
  }
  return { merged: retired.length, retired }
}
