// 一条记忆长什么样，以及它现在有多清楚

import type { Clarity } from '@huoli/huoli-qq-policy'

/** 记忆放在哪一层 */
export type MemoryLayer = 'ephemeral' | 'episodic' | 'semantic' | 'private'

/** 记忆是从哪条路径写进来的，只认这五档 */
export type MemorySource = 'chat' | 'tool' | 'proactive' | 'manual' | 'self'

/** 五档来源，写入时按这张表校验 */
export const MEMORY_SOURCES: readonly MemorySource[] = ['chat', 'tool', 'proactive', 'manual', 'self']

/** 一条记忆现在还在不在用，退役的只留编号与时刻 */
export type MemoryState = 'active' | 'forgotten'

/** 两态，读到别的值一律按 active */
export const MEMORY_STATES: readonly MemoryState[] = ['active', 'forgotten']

/** 镜像的条目归哪一类，与自我层那三份文件一一对应 */
export type MirrorSelfKind = 'claim' | 'project' | 'commitment'

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
  /** 最近一次召回回升落在哪一天的本地零点，没回升过就是 0 */
  recoverDay: number
  /** 那一天已经回升过几次 */
  recoverTimes: number
  at: number
  lastSeenAt: number
  /** 还在用还是已经退役 */
  state: MemoryState
  /** 退役那一刻，没退役就没有这个字段 */
  retiredAt?: number
  source: MemorySource
  personId?: string
  /** 这件事不想让人知道：只在私密空间可见 */
  secret?: boolean
  /** 事后平静下来的时刻，过了这一刻不再紧绷 */
  settledAt?: number
  /** 话题、地点、人物等附加事实，不参与打分，留给自我层镜像 */
  metadata?: Record<string, unknown>
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
  /** 跟着这条一起存的附加事实 */
  metadata?: Record<string, unknown>
  /** 这条跟哪个稳定用户有关 */
  personId?: string
  /** 只在私密层使用的隐藏标记 */
  secret?: boolean
}

/** 镜像一条时给的字段，四项元信息缺一不写 */
export interface RememberSelfEntry {
  /** 镜像的正文 */
  text: string
  /** 记到哪个会话 */
  chatKey: string
  /** 来源文件里的那一条的唯一键，形如 `claims.jsonl#3` */
  selfId: string
  /** 哪一类来源 */
  selfKind: MirrorSelfKind
  /** 一到三条记忆编号或日期 */
  evidence: readonly string[]
  /** 调用方给的重要度，低于镜像下限时按下限写 */
  importance?: number
}

/** 镜像一条的结果 */
export interface RememberSelfResult {
  /** 这一条的编号 */
  id: string
  /** 是这次新写的还是早就镜过的 */
  created: boolean
  /** 落库的那一条 */
  item: MemoryItem
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
