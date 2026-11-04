// 找记忆：按字面切片找出相关的几条，只给事实与理由

import type { Clarity } from '@huoli/huoli-qq-policy'
import { DEFAULTS, resolveTuning, type Tuning } from './defaults.ts'
import type { MemoryStore } from './store.ts'

const DAY_MS = 86_400_000

/** 向量检索路的接口，本包只留接口不实现，接入前这一路整体缺席 */
export interface VectorPath {
  /**
   * 把一段文本编成归一化向量
   * @param text - 要编码的文本
   * @returns 归一化向量
   */
  encode(text: string): readonly number[]
}

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
  /** 查询与正文都命中的字面片段 */
  grams: string[]
  /** 向量路的相似度，这一路没接时是 null */
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
  const queryGrams = keyGrams(query, tuning.gramSize)
  // 短查询放宽到一条，长查询要两条才对得上
  const minHits = plain(query).length <= tuning.shortQueryChars ? tuning.shortQueryMinHits : tuning.longQueryMinHits

  const hits: RecallHit[] = []
  for (const item of store.all()) {
    if (item.forgotten || item.clarity === 'forgotten') continue
    if (input.scope !== undefined && input.scope !== '' && item.scope !== input.scope) continue
    const bodyGrams = new Set(keyGrams(item.text, tuning.gramSize))
    const grams = queryGrams.filter(gram => bodyGrams.has(gram))
    if (queryGrams.length > 0 && grams.length < minHits) continue
    // 关键词路的相似度取命中片段占查询片段的比例，接到向量路后由它给出
    const sim = queryGrams.length === 0 ? 0 : grams.length / queryGrams.length
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
      reasons: { grams, vectorSim: null, importanceTerm, freshnessTerm },
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
