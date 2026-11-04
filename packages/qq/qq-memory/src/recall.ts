// 找记忆：关键词与向量两路各出候选，按同一套权重排序，只给事实与理由

import type { Clarity } from '@huoli/huoli-qq-policy'
import { DEFAULTS, resolveTuning, type Tuning } from './defaults.ts'
import type { MemoryStore } from './store.ts'

const DAY_MS = 86_400_000

// 编码维度固定，不随配置改：换维度会让同一段文本的向量长短不一，两次结果就不可比
const VECTOR_BUCKETS = 1024

// FNV-1a 的两个固定参数，属于编码算法本身，不随配置改
const HASH_OFFSET = 0x811c9dc5
const HASH_PRIME = 0x01000193

/** 找记忆时给的条件 */
export interface RecallInput {
  /** 想找的那句话，空串只按重要度与新鲜度排 */
  query?: string
  /** 只看这个会话键下的条目 */
  scope?: string
  /** 最多几条，不填按 tuning 里的 recallLimit */
  limit?: number
  /** 现在的时间 */
  now?: number
  /** 想改哪些默认参数，装配时传一次 */
  tuning?: Partial<Tuning>
}

/** 一条命中的理由，四项都能拿同样输入重算 */
export interface RecallReasons {
  /** 关键词路命中的字面片段，空数组表示这一路没命中 */
  grams: string[]
  /** 向量路的相似度，没有向量可用时是 null */
  vectorSim: number | null
  /** 重要度那一项的加分 */
  importanceTerm: number
  /** 新鲜度那一项的加分 */
  freshnessTerm: number
}

/** 找到的一条，只带事实与理由，不带「该不该说」 */
export interface RecallHit {
  id: string
  text: string
  at: number
  clarity: Clarity
  score: number
  reasons: RecallReasons
}

// 去掉标点与空白，只留能切成字面片段的字符
function plain(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/**
 * 把一句话切成字面片段集合，去重
 * @param text - 要切的话
 * @param size - 每段几个字，默认取 gramSize
 * @returns 切出来的片段，按出现顺序
 */
export function keyGrams(text: string, size: number = DEFAULTS.gramSize): string[] {
  const body = plain(text)
  const width = Math.max(1, Math.floor(size))
  if (body === '') return []
  if (body.length <= width) return [body]
  const grams = new Set<string>()
  for (let at = 0; at + width <= body.length; at += 1) grams.add(body.slice(at, at + width))
  return [...grams]
}

// 把一段特征落到固定桶上，同一段文本每次落到同一个桶
function bucketOf(feature: string): number {
  let hash = HASH_OFFSET
  for (let at = 0; at < feature.length; at += 1) {
    hash ^= feature.charCodeAt(at)
    hash = Math.imul(hash, HASH_PRIME)
  }
  return (hash >>> 0) % VECTOR_BUCKETS
}

/**
 * 把一段文本编成固定维度的稀疏向量，纯本地计算
 * @param text - 要编码的文本
 * @returns 长度恒为编码维度的归一化向量，没有可用特征时是零向量
 */
export function encodeVector(text: string): readonly number[] {
  const body = plain(text)
  const counts = new Map<number, number>()
  // 两个相邻的字一起出现，说明这两个字都跟这件事有关，所以 2-gram 除了自己进桶，也给这两个字各记一次
  const mark = (feature: string): void => {
    const at = bucketOf(feature)
    counts.set(at, (counts.get(at) ?? 0) + 1)
  }
  for (let at = 0; at < body.length; at += 1) mark(body.slice(at, at + 1))
  for (let at = 0; at + 1 < body.length; at += 1) {
    mark(body.slice(at, at + 2))
    mark(body.slice(at, at + 1))
    mark(body.slice(at + 1, at + 2))
  }
  const values = new Array<number>(VECTOR_BUCKETS).fill(0)
  for (const [at, count] of counts) values[at] = count
  let squares = 0
  for (const value of values) squares += value * value
  if (squares === 0) return values
  const scale = 1 / Math.sqrt(squares)
  return values.map(value => value * scale)
}

/**
 * 两段向量的余弦相似度，归一化向量的余弦等于规范里的「1 减平方距离的一半」
 * @param left - 一段向量
 * @param right - 另一段向量
 * @returns 相似度，任一段是零向量时给 null
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number | null {
  let dot = 0
  let leftSquares = 0
  let rightSquares = 0
  for (let at = 0; at < left.length; at += 1) {
    const value = left[at] ?? 0
    const other = right[at] ?? 0
    dot += value * other
    leftSquares += value * value
    rightSquares += other * other
  }
  if (leftSquares === 0 || rightSquares === 0) return null
  return dot / Math.sqrt(leftSquares * rightSquares)
}

/**
 * 找几条相关的记忆
 * @param store - 存放的地方
 * @param input - 传进来的东西
 * @returns 找到的几条，没有就是空数组
 */
export function recall(store: MemoryStore, input: RecallInput = {}): RecallHit[] {
  const tuning = resolveTuning(input.tuning)
  const now = input.now ?? Date.now()
  const limit = Math.max(1, Math.floor(input.limit ?? tuning.recallLimit))
  const query = (input.query ?? '').trim()
  const plainQuery = plain(query)
  const queryGrams = keyGrams(query, tuning.gramSize)
  const queryVector = plainQuery === '' ? [] : encodeVector(query)
  // 短查询放宽到一条，长查询要两条才对得上
  const minHits = plainQuery.length <= tuning.shortQueryChars ? tuning.shortQueryMinHits : tuning.longQueryMinHits

  const hits: RecallHit[] = []
  for (const item of store.all()) {
    if (item.state === 'forgotten' || item.clarity === 'forgotten') continue
    if (input.scope !== undefined && input.scope !== '' && item.scope !== input.scope) continue
    const bodyGrams = new Set(keyGrams(item.text, tuning.gramSize))
    const grams = queryGrams.filter(gram => bodyGrams.has(gram))
    // 关键词路只看命中数门槛，命中之后不受相似度门槛约束
    const keywordHit = queryGrams.length > 0 && grams.length >= minHits
    const vectorSim = plainQuery === '' ? null : cosineSimilarity(queryVector, encodeVector(item.text))
    const vectorHit = vectorSim !== null && vectorSim >= tuning.minSimilarity
    // 空查询既不按字面也不按方向筛，剩下的只由重要度与新鲜度排序
    if (plainQuery !== '' && !keywordHit && !vectorHit) continue
    // 两路都命中时取较大的相似度，不叠加、不重复计分
    const sim = Math.max(queryGrams.length === 0 ? 0 : grams.length / queryGrams.length, vectorSim ?? 0)
    const ageDays = Math.max(0, (now - item.at) / DAY_MS)
    const freshness = 1 / (1 + ageDays / tuning.freshnessDays)
    const importanceTerm = tuning.weightImportance * (item.importance / 100)
    const freshnessTerm = tuning.weightFreshness * freshness
    const score = tuning.weightSim * sim + importanceTerm + freshnessTerm
    hits.push({
      id: item.id,
      text: item.text,
      at: item.at,
      clarity: item.clarity,
      score,
      reasons: { grams, vectorSim, importanceTerm, freshnessTerm },
    })
  }

  hits.sort((a, b) => b.score - a.score || b.at - a.at)
  return hits.slice(0, limit)
}

// 本地时间的 yyyy-mm-dd
function localDate(at: number): string {
  const day = new Date(at)
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

/**
 * 把找到的记忆写成给模型看的几行字
 * @param hits - 找到的记忆
 * @returns 拼好的话
 */
export function renderRecall(hits: readonly RecallHit[]): string {
  if (hits.length === 0) return '没有想起相关的事。'
  return hits.map(hit => `${localDate(hit.at)} ${hit.text}`).join('\n')
}
