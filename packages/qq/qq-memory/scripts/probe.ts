// 只读探测：把记忆与记录表看一眼，产出一份报告，一个文件都不写

import { CLARITY_ORDER, type Clarity } from '@huoli/huoli-qq-policy'
import { describeLedger, runLedger, type LedgerReport } from '../src/ledger.ts'
import { LAYER_LABEL, type MemoryItem, type MemoryLayer } from '../src/types.ts'
import {
  ledgerBeside,
  queueBeside,
  readMemory,
  readQueue,
  type FileState,
} from './read.ts'

/** 探测时能改的两个旁路文件位置 */
export interface ProbeOptions {
  /** 记录表文件，不填取记忆文件同目录的 qq-memory-ledger.json */
  ledgerFile?: string
  /** 待写队列，不填取记忆文件同目录的 qq-memory-queue.json */
  queueFile?: string
}

/** 报告里那一条最早的记忆 */
export interface EarliestMemory {
  id: string
  text: string
  at: number
}

/** 一次探测看到的东西 */
export interface ProbeReport {
  /** 探测的记忆文件 */
  file: string
  /** 记忆文件读得出来、没建过、还是坏了 */
  memory: FileState
  /** 这次比对的记录表文件 */
  ledgerFile: string
  /** 这次读的队列文件 */
  queueFile: string
  /** 全部条目，已退役的也算 */
  total: number
  /** 还没退役的条数 */
  active: number
  /** 每层各几条，四层都列出来 */
  layers: Readonly<Record<MemoryLayer, number>>
  /** 每档清晰度各几条，五档都列出来 */
  clarity: Readonly<Record<Clarity, number>>
  /** 记录表核对结果 */
  ledger: LedgerReport
  /** 记录表结论写成一句话 */
  ledgerLine: string
  /** 最早的那一条，一条都没有时是 undefined */
  earliest: EarliestMemory | undefined
  /** 队列里还压着几条 */
  pending: number
  /** 队列文件读得出来、没建过、还是坏了 */
  queue: FileState
}

// 层的四档，探测按这张表列全
const LAYERS: readonly MemoryLayer[] = ['ephemeral', 'episodic', 'semantic', 'private']

// 一张全零的表，缺的层与档也要出现在报告里
function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  const counts = {} as Record<K, number>
  for (const key of keys) counts[key] = 0
  return counts
}

// 按条目标签数一遍，标签以外的值不收
function tally<K extends string>(keys: readonly K[], value: string, counts: Record<K, number>): void {
  if (!(keys as readonly string[]).includes(value)) return
  counts[value as K] += 1
}

// 最早的那一条，同刻取先遇到的那条
function earliestOf(items: readonly MemoryItem[]): EarliestMemory | undefined {
  let best: MemoryItem | undefined
  for (const item of items) {
    if (best === undefined || item.at < best.at) best = item
  }
  if (best === undefined) return undefined
  return { id: best.id, text: best.text, at: best.at }
}

/**
 * 只看不碰地探一遍记忆与记录表：条数、层分布、清晰度分布、记录表结论、最早的记忆、待写入
 * @param file - 记忆文件
 * @param options - 记录表与队列的位置，不给就取同目录
 * @returns 探测报告
 */
export function probe(file: string, options: ProbeOptions = {}): ProbeReport {
  const ledgerFile = options.ledgerFile ?? ledgerBeside(file)
  const queueFile = options.queueFile ?? queueBeside(file)
  const memory = readMemory(file)
  const queue = readQueue(queueFile)
  // 核对只走 verify 这条只读路径：读记录表、比对、不写回
  const ledger = runLedger('verify', { file: ledgerFile, items: memory.items }).report
  const layers = zeroed(LAYERS)
  const clarity = zeroed(CLARITY_ORDER)
  let active = 0
  for (const item of memory.items) {
    tally(LAYERS, item.layer, layers)
    tally(CLARITY_ORDER, item.clarity, clarity)
    if (item.state !== 'forgotten') active += 1
  }
  return {
    file,
    memory: memory.state,
    ledgerFile,
    queueFile,
    total: memory.items.length,
    active,
    layers,
    clarity,
    ledger,
    ledgerLine: describeLedger(ledger),
    earliest: earliestOf(memory.items),
    pending: queue.pending,
    queue: queue.state,
  }
}

/**
 * 把探测报告写成给人看的一段话，六件事各占一行
 * @param report - 探测报告
 * @returns 拼好的话
 */
export function describeProbe(report: ProbeReport): string {
  const layers = LAYERS.map(layer => `${LAYER_LABEL[layer]} ${report.layers[layer]}`).join('，')
  const clarity = CLARITY_ORDER.map(one => `${one} ${report.clarity[one]}`).join('，')
  // 最早的记忆坏文件或空库时没有，单独说一句而不是留空
  const earliest = report.earliest === undefined
    ? '最早的一条：没有'
    : `最早的一条：${new Date(report.earliest.at).toISOString().slice(0, 10)} ${report.earliest.text}`
  return [
    `记忆 ${report.file}（${report.memory}）：共 ${report.total} 条，未退役 ${report.active} 条`,
    `层分布：${layers}`,
    `清晰度分布：${clarity}`,
    `账本结论：${report.ledgerLine}`,
    earliest,
    `待写入：${report.pending} 条（队列 ${report.queue}）`,
  ].join('\n')
}
