/** 带嵌入向量的回想：先问向量仓拿候选，再按同一套权重排序 */

import type { Tuning } from './defaults.ts'
import { recall, type RecallHit } from './recall.ts'
import type { MemoryStore } from './store.ts'
import type { VectorStore } from './vector-store.ts'

/** 一次带向量的回想要什么 */
export interface FindWithVectorsInput {
  /** 记忆库 */
  store: MemoryStore
  /** 向量仓，已经开好了 */
  vectors: VectorStore
  /** 把一句话换成向量 */
  embed: (text: string) => Promise<readonly number[]>
  /** 想找的那句话 */
  query: string
  /** 只看这个会话键下的条目 */
  scope: string
  /** 最多几条 */
  limit?: number
  /** 参数表 */
  tuning: Tuning
  /** 星链 */
  edges: readonly { a: string; b: string; weight: number }[]
  /** 现在的时间 */
  now?: number
}

/**
 * 用真向量找一遍，再和关键词那条路合成一个排序
 * @param input 记忆库、向量仓、查询与参数
 * @returns 按分数从高到低的命中
 */
export async function findWithVectors(input: FindWithVectorsInput): Promise<RecallHit[]> {
  const embedding = await input.embed(input.query)
  // 多取几条候选：向量仓只按远近给，最后还要和重要度、新鲜度一起排
  const near = await input.vectors.search(embedding, {
    scope: input.scope,
    limit: Math.max(8, (input.limit ?? 8) * 3),
  })
  const vectorSims = new Map(near.map(hit => [hit.id, hit.score]))
  return recall(input.store, {
    query: input.query,
    scope: input.scope,
    tuning: input.tuning,
    edges: input.edges,
    vectorSims,
    ...input.limit === undefined ? {} : { limit: input.limit },
    ...input.now === undefined ? {} : { now: input.now },
  })
}
