// 记忆之间的星链：两个星点因为同一件事被连起来，权重只涨不消

import fs from 'node:fs'
import path from 'node:path'

/** 边是怎么来的，只有这五种，都靠事实不靠词 */
export type EdgeWhy = 'sameTurn' | 'sameTopic' | 'sameWho' | 'sameDay' | 'recalledTogether'

/** 一条星链 */
export interface MemoryEdge {
  /** 小号那一端 */
  a: string
  /** 大号那一端 */
  b: string
  /** 强度，只会涨 */
  weight: number
  /** 怎么连上的 */
  why: EdgeWhy
  /** 最后一次加强的时刻 */
  at: number
}

/** 星链的默认规矩 */
export const EDGE_DEFAULTS = {
  /** 连一次涨多少 */
  gain: 1,
  /** 一条边的上限，到顶不再涨 */
  maxWeight: 20,
}

/**
 * 两点规范化：小号在前，同一条边只存一次
 * @param a - 一个编号
 * @param b - 另一个编号
 * @returns 排好序的两个编号
 */
export function pairOf(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a]
}

/**
 * 边文件放哪：跟记忆文件同目录
 * @param memoryFile - 记忆文件全路径
 * @returns 边文件全路径
 */
export function edgesFileOf(memoryFile: string): string {
  return path.join(path.dirname(memoryFile), 'edges.jsonl')
}

/**
 * 读所有边，坏行跳过
 * @param file - 边文件
 * @returns 边列表
 */
export function readEdges(file: string): MemoryEdge[] {
  if (!fs.existsSync(file)) return []
  const out: MemoryEdge[] = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const raw = JSON.parse(line) as Partial<MemoryEdge>
      if (typeof raw.a !== 'string' || typeof raw.b !== 'string') continue
      if (typeof raw.weight !== 'number') continue
      out.push({
        a: raw.a,
        b: raw.b,
        weight: raw.weight,
        why: raw.why ?? 'sameTurn',
        at: typeof raw.at === 'number' ? raw.at : 0,
      })
    } catch {
      // 坏行跳过：一条写坏了不该让整份边读不出来
    }
  }
  return out
}

// 整份写回，先写临时文件再改名
function writeEdges(file: string, edges: readonly MemoryEdge[]): void {
  const text = edges.map(edge => JSON.stringify(edge)).join('\n')
  const temporary = `${file}.tmp`
  fs.writeFileSync(temporary, text === '' ? '' : `${text}\n`, 'utf8')
  fs.renameSync(temporary, file)
}

/**
 * 连一条边，已经有了就加强
 * @param file - 边文件
 * @param from - 一端编号
 * @param to - 另一端编号
 * @param why - 怎么连上的
 * @param at - 什么时候
 * @returns 连完之后的这一条边
 */
export function linkPoints(file: string, from: string, to: string, why: EdgeWhy, at: number): MemoryEdge {
  const [a, b] = pairOf(from, to)
  const edges = readEdges(file)
  const found = edges.find(edge => edge.a === a && edge.b === b)
  if (found !== undefined) {
    found.weight = Math.min(EDGE_DEFAULTS.maxWeight, found.weight + EDGE_DEFAULTS.gain)
    found.at = at
    writeEdges(file, edges)
    return found
  }
  const made: MemoryEdge = { a, b, weight: EDGE_DEFAULTS.gain, why, at }
  edges.push(made)
  writeEdges(file, edges)
  return made
}

/**
 * 一个星点连出去的所有边
 * @param file - 边文件
 * @param id - 星点编号
 * @returns 与它相连的边
 */
export function edgesOfPoint(file: string, id: string): MemoryEdge[] {
  return readEdges(file).filter(edge => edge.a === id || edge.b === id)
}

/**
 * 一个星点的邻居编号，权重高的在前
 * @param file - 边文件
 * @param id - 星点编号
 * @param limit - 最多几个
 * @returns 邻居编号
 */
export function neighboursOf(file: string, id: string, limit = 5): string[] {
  return edgesOfPoint(file, id)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, limit)
    .map(edge => (edge.a === id ? edge.b : edge.a))
}

/**
 * 把几个编号两两连起来：同一轮写进来的东西彼此都算相关
 * @param file - 边文件
 * @param ids - 这一轮的编号
 * @param why - 怎么连上的
 * @param at - 什么时候
 * @returns 连了几条
 */
export function linkTogether(file: string, ids: readonly string[], why: EdgeWhy, at: number): number {
  let made = 0
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const left = ids[i]
      const right = ids[j]
      if (left === undefined || right === undefined || left === right) continue
      linkPoints(file, left, right, why, at)
      made += 1
    }
  }
  return made
}
