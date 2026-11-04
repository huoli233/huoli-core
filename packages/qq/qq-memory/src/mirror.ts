// 镜像的读：哪些来源已经镜过了，同一个来源键只写一条

import type { MemoryStore } from './store.ts'
import type { MemoryItem } from './types.ts'

/**
 * 一条记忆的镜像来源键
 * @param item - 一条记忆
 * @returns 不是镜像条目时为空串
 */
export function selfIdOf(item: MemoryItem): string {
  const value = item.metadata?.self_id
  return typeof value === 'string' ? value : ''
}

/**
 * 已经镜像过的来源键
 * @param store - 存放的地方
 * @returns 按写入顺序排好的来源键
 */
export function mirroredSelfIds(store: MemoryStore): string[] {
  const ids: string[] = []
  for (const item of store.all()) {
    if (item.source !== 'self') continue
    const selfId = selfIdOf(item)
    if (selfId !== '') ids.push(selfId)
  }
  return ids
}

/**
 * 某个来源键已经写成的那一条
 * @param store - 存放的地方
 * @param selfId - 来源键
 * @returns 没镜过时为 undefined
 */
export function mirroredBy(store: MemoryStore, selfId: string): MemoryItem | undefined {
  return store.all().find(item => item.source === 'self' && selfIdOf(item) === selfId)
}
