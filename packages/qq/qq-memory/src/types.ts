// 一条记忆长什么样，以及它现在有多清楚

import type { Clarity } from '@huoli/huoli-qq-policy'

/** 记忆放在哪一层 */
export type MemoryLayer = 'ephemeral' | 'episodic' | 'semantic' | 'private'

/** 一条记忆 */
export interface MemoryItem {
  id: string
  text: string
  layer: MemoryLayer
  scope: string
  importance: number
  emotional: number
  clarity: Clarity
  recallCount: number
  at: number
  lastSeenAt: number
  forgotten: boolean
  source: 'chat' | 'tool' | 'proactive' | 'manual'
  personId?: string
}

/** 写一条记忆时能给的选项 */
export interface RememberOptions {
  layer?: MemoryLayer
  /** 调用方算好的重要度，给了就用它，不再自己算 */
  importance?: number
  /** 这话里的情绪强度，0 到 24 */
  emotional?: number
  /** 这话是不是直接冲着她说的 */
  directed?: boolean
  source?: MemoryItem['source']
  at?: number
}

/** 层的中文说法 */
export const LAYER_LABEL: Record<MemoryLayer, string> = {
  ephemeral: '刚发生',
  episodic: '这段经历',
  semantic: '长期印象',
  private: '私下的事',
}

/** 清晰度的中文说法 */
export const CLARITY_LABEL: Record<Clarity, string> = {
  vivid: '清晰',
  clear: '清楚',
  fuzzy: '模糊',
  trace: '只剩印象',
  forgotten: '已遗忘',
}

/** 由大到小的层顺序，晋升时按这个走 */
export const LAYER_ORDER: readonly MemoryLayer[] = ['ephemeral', 'episodic', 'semantic']

/**
 * 生成一个不重复的编号
 * @param now - 现在的时间
 * @returns 拼好的话
 */
export function newId(now: number): string {
  const tail = Math.random().toString(36).slice(2, 8)
  return `${now.toString(36)}-${tail}`
}
