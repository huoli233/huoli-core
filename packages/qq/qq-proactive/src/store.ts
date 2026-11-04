// 攒着的想说话：先放这里，等闸门放行再发

import fs from 'node:fs'
import path from 'node:path'
import { PROACTIVE_DEFAULTS, type PendingItem } from './score.ts'

/** 存文件的选项 */
export interface PendingStoreOptions {
  file: string
  now?: () => number
}

/** 攒着的仓 */
export interface PendingStore {
  all(): PendingItem[]
  live(chatKey: string): PendingItem[]
  /** 同一个编号只留一条，重复放进来是覆盖 */
  put(item: PendingItem): void
  markSent(id: string): void
  drop(id: string): void
  flush(): void
}

// 文件里的样子
interface StoredPending {
  version: 1
  items: PendingItem[]
  lastSpokenAt: Record<string, number>
  todayCount: Record<string, number>
}

// 读盘时按可能缺失或为空的字段声明
interface StoredPendingInput {
  items?: PendingItem[]
  lastSpokenAt?: Record<string, number> | null
  todayCount?: Record<string, number> | null
}

// 读文件
function load(file: string): StoredPending {
  const empty: StoredPending = { version: 1, items: [], lastSpokenAt: {}, todayCount: {} }
  try {
    if (!fs.existsSync(file)) return empty
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return empty
    const parsed = JSON.parse(text) as StoredPendingInput
    return {
      version: 1,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      lastSpokenAt: parsed.lastSpokenAt !== undefined && parsed.lastSpokenAt !== null ? parsed.lastSpokenAt : {},
      todayCount: parsed.todayCount !== undefined && parsed.todayCount !== null ? parsed.todayCount : {},
    }
  } catch {
    return empty
  }
}

// 整份写回
function save(file: string, data: StoredPending): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建一个攒着的仓
 * @param options - 选项
 * @returns 处理结果
 */
export function createPendingStore(options: PendingStoreOptions): PendingStore {
  const now = options.now ?? (() => Date.now())
  let data = load(options.file)

  const persist = (): void => {
    save(options.file, data)
  }

  const clean = (): void => {
    const at = now()
    const kept = data.items.filter(item => item.expiresAt > at)
    if (kept.length !== data.items.length) {
      data = { ...data, items: kept }
      persist()
    }
  }

  return {
    all() {
      clean()
      return data.items
    },
    live(chatKey) {
      clean()
      return data.items.filter(item => item.chatKey === chatKey)
    },
    put(item) {
      data = { ...data, items: [...data.items.filter(existing => existing.id !== item.id), item] }
      persist()
    },
    markSent(id) {
      data = { ...data, items: data.items.filter(item => item.id !== id) }
      persist()
    },
    drop(id) {
      data = { ...data, items: data.items.filter(item => item.id !== id) }
      persist()
    },
    flush() {
      persist()
    },
  }
}

/** 本次开口的时间与次数记账 */
export interface TimingStore {
  lastSpokenAt(chatKey: string): number
  todayCount(chatKey: string): number
  noteSpoken(chatKey: string): void
}

/**
 * 建一个时间记账
 * @param options - 选项
 * @returns 处理结果
 */
export function createTimingStore(options: PendingStoreOptions): TimingStore {
  const now = options.now ?? (() => Date.now())
  let data = load(options.file)

  const persist = (): void => {
    save(options.file, data)
  }

  const dayKeyOf = (at: number): string => {
    const date = new Date(at)
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  }

  return {
    lastSpokenAt(chatKey) {
      return data.lastSpokenAt[chatKey] ?? 0
    },
    todayCount(chatKey) {
      return data.todayCount[`${chatKey}@${dayKeyOf(now())}`] ?? 0
    },
    noteSpoken(chatKey) {
      const at = now()
      const key = `${chatKey}@${dayKeyOf(at)}`
      data = {
        ...data,
        lastSpokenAt: { ...data.lastSpokenAt, [chatKey]: at },
        todayCount: { ...data.todayCount, [key]: (data.todayCount[key] ?? 0) + 1 },
      }
      persist()
    },
  }
}

/** 攒着的东西多久算过期 */
export const PENDING_TTL_MS = PROACTIVE_DEFAULTS.pendingTtlMs

/**
 * 把秒数折成一句话
 * @param ms - 毫秒数
 * @returns 拼好的话
 */
export function describeWait(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '随时可以'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟后再试`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时后再试`
  return `${Math.round(hours / 24)} 天后再试`
}
