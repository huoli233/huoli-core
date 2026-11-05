// 只读地打开记忆、记录表与队列：读坏了只报告，不修也不写

import fs from 'node:fs'
import path from 'node:path'
import { createMemoryStore } from '../src/store.ts'
import type { MemoryItem } from '../src/types.ts'

/** 一份文件此刻的状态：读得出来、还没建过、坏了读不出来 */
export type FileState = 'ok' | 'absent' | 'broken'

/** 文件头里一个版本字段的读法 */
export interface FileVersion {
  /** 读到的版本号，没有这个字段或读不出来时是 undefined */
  version: number | undefined
  /** 文件在不在 */
  present: boolean
}

/** 记录表文件的名字，跟记忆文件放同一个目录 */
const LEDGER_NAME = 'qq-memory-ledger.json'

/** 待写队列文件的名字，跟记忆文件放同一个目录 */
const QUEUE_NAME = 'qq-memory-queue.json'

/**
 * 认得出是一个对象，不是数组也不是 null
 * @param value - 读回来的值
 * @returns 是对象时为 true
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 读成字符串，读不出来当空文件
function readText(file: string): string | undefined {
  if (!fs.existsSync(file)) return undefined
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
}

/**
 * 跟记忆文件放一起的记录表
 * @param file - 记忆文件
 * @returns 记录表文件的位置
 */
export function ledgerBeside(file: string): string {
  return path.join(path.dirname(file), LEDGER_NAME)
}

/**
 * 跟记忆文件放一起的待写队列
 * @param file - 记忆文件
 * @returns 队列文件的位置
 */
export function queueBeside(file: string): string {
  return path.join(path.dirname(file), QUEUE_NAME)
}

/**
 * 读文件头里的版本字段，缺字段、坏了、没建过都只当没有这个版本
 * @param file - 要读的文件
 * @param key - 版本字段的名字
 * @returns 版本与文件在不在
 */
export function readVersion(file: string, key: string): FileVersion {
  try {
    const text = readText(file)
    if (text === undefined) return { version: undefined, present: false }
    if (text.trim() === '') return { version: undefined, present: true }
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) return { version: undefined, present: true }
    const raw = parsed[key]
    const version = typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : undefined
    return { version, present: true }
  } catch {
    // 读不出来的文件没有可用的版本号，坏了这件事交给状态字段报
    return { version: undefined, present: true }
  }
}

/**
 * 版本高过本包就停下来，一句话说清读到多少、本包认到多少、这次动了什么
 * @param file - 要判的文件
 * @param key - 版本字段的名字
 * @param supported - 本包支持的版本
 * @param label - 报错时怎么称呼这个文件
 */
export function assertSupportedVersion(file: string, key: string, supported: number, label: string): void {
  const found = readVersion(file, key)
  if (found.version === undefined || found.version <= supported) return
  throw new Error(
    `memory.version_ahead: ${label} ${key} 是 ${found.version}，本包只认到 ${supported}`
    + '｜下一步: 先升级到能读这个版本的程序，本次没有写任何文件',
  )
}

/** 读记忆文件的结果 */
export interface MemoryReading {
  /** 读得出来、没建过、还是坏了 */
  state: FileState
  /** 读出来的条目，坏了或没建过时是空的 */
  items: readonly MemoryItem[]
  /** 文件头的版本戳，没有这个字段时是 undefined */
  version: number | undefined
}

/**
 * 读记忆文件，条目字段的补齐照仓的读法走，本函数一个字节都不写
 * @param file - 记忆文件
 * @returns 状态、条目与版本
 */
export function readMemory(file: string): MemoryReading {
  try {
    const text = readText(file)
    if (text === undefined || text.trim() === '') return { state: 'absent', items: [], version: undefined }
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) return { state: 'broken', items: [], version: undefined }
    return { state: 'ok', items: createMemoryStore({ file }).all(), version: readVersion(file, 'version').version }
  } catch {
    return { state: 'broken', items: [], version: undefined }
  }
}

/** 读待写队列的结果 */
export interface QueueReading {
  /** 读得出来、没建过、还是坏了 */
  state: FileState
  /** 队列里还压着几条 */
  pending: number
}

/**
 * 读待写队列，只数条数，读坏了按零条报
 * @param file - 队列文件
 * @returns 状态与积压条数
 */
export function readQueue(file: string): QueueReading {
  try {
    const text = readText(file)
    if (text === undefined || text.trim() === '') return { state: 'absent', pending: 0 }
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return { state: 'broken', pending: 0 }
    return { state: 'ok', pending: parsed.entries.length }
  } catch {
    return { state: 'broken', pending: 0 }
  }
}
