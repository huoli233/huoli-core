// 攒着的想说话：先放这里，等关卡放行再发

import fs from 'node:fs'
import path from 'node:path'
import { PROACTIVE_DEFAULTS, type PendingItem } from './score.ts'

/** 存文件的选项 */
export interface PendingStoreOptions {
  file: string
  now?: () => number
}

// 文件里的样子
interface StoredPending {
  version: 2
  items: PendingItem[]
  previewed: string[]
  lastSpokenAt: Record<string, number>
  todayCount: Record<string, number>
}

// 读盘时按可能缺失或为空的字段声明
interface StoredPendingInput {
  version?: number
  items?: PendingItem[]
  previewed?: string[] | null
  lastSpokenAt?: Record<string, number> | null
  todayCount?: Record<string, number> | null
}

/** 这份状态的结构版本，只随结构变化递增 */
export const PROACTIVE_STORE_VERSION = 2

// 一份空状态
function emptyStored(): StoredPending {
  return { version: PROACTIVE_STORE_VERSION, items: [], previewed: [], lastSpokenAt: {}, todayCount: {} }
}

// 读一个文件，读不出或版本对不上就交回 undefined，让调用方逐级回退
function readOne(file: string): StoredPending | undefined {
  try {
    if (!fs.existsSync(file)) return undefined
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return undefined
    const parsed = JSON.parse(text) as StoredPendingInput
    if (parsed.version !== undefined && parsed.version !== PROACTIVE_STORE_VERSION) return undefined
    return {
      version: PROACTIVE_STORE_VERSION,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      previewed: Array.isArray(parsed.previewed) ? parsed.previewed : [],
      lastSpokenAt: parsed.lastSpokenAt !== undefined && parsed.lastSpokenAt !== null ? parsed.lastSpokenAt : {},
      todayCount: parsed.todayCount !== undefined && parsed.todayCount !== null ? parsed.todayCount : {},
    }
  } catch (readError) {
    // 读不动就当这一份不存在，让调用方退到备份；错误本身只在这一层消化，不往上抛
    void readError
    return undefined
  }
}

// 正式文件读不出就退到备份，备份也没有才算空
function load(file: string): StoredPending {
  return readOne(file) ?? readOne(`${file}.bak`) ?? emptyStored()
}

// 整份写回：先把现有文件留一份备份，再原子换掉正式文件
function save(file: string, data: StoredPending): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, `${file}.bak`)
    } catch (backupError) {
      // 备份写不动不拦这一笔，正式文件照原子写走，坏读时再退默认值
      void backupError
    }
  }
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/** 攒着的与记录共用一份文件：只有一个 owner，改一处存一次，两个视图读同一份内存 */
export interface ProactiveStore {
  pending: PendingStore
  timing: TimingStore
  flush(): void
}

/** 本次开口的时间与次数记录 */
export interface TimingStore {
  lastSpokenAt(chatKey: string): number
  todayCount(chatKey: string): number
  noteSpoken(chatKey: string): void
}

/** 攒着的仓 */
export interface PendingStore {
  all(): PendingItem[]
  live(chatKey: string): PendingItem[]
  /** 同一个编号只留一条，重复放进来是覆盖 */
  put(item: PendingItem): void
  /** 已经先给人看过的那几条记下来，投递只认这些 */
  notePreviewed(ids: readonly string[]): void
  /** 这一条是不是先给人看过了 */
  isPreviewed(id: string): boolean
  markSent(id: string): void
  drop(id: string): void
  flush(): void
}

/**
 * 建一个 owner：同一份文件只有一个写入路径，pending 与 timing 只是它的两个视图
 * @param options - 选项
 * @returns 两个视图与一个马上落盘的出口
 */
export function createProactiveStore(options: PendingStoreOptions): ProactiveStore {
  const now = options.now ?? (() => Date.now())
  let data = load(options.file)

  const persist = (): void => {
    save(options.file, data)
  }

  const clean = (): void => {
    const at = now()
    const kept = data.items.filter(item => item.expiresAt > at)
    const lived = new Set(kept.map(item => item.id))
    const stillPreviewed = data.previewed.filter(id => lived.has(id))
    if (kept.length !== data.items.length || stillPreviewed.length !== data.previewed.length) {
      data = { ...data, items: kept, previewed: stillPreviewed }
      persist()
    }
  }

  // 已经不在待发里的编号不再记着看过
  const without = (id: string): StoredPending => ({
    ...data,
    items: data.items.filter(item => item.id !== id),
    previewed: data.previewed.filter(kept => kept !== id),
  })

  const dayKeyOf = (at: number): string => {
    const date = new Date(at)
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  }

  const pending: PendingStore = {
    all() {
      clean()
      return data.items
    },
    live(chatKey) {
      clean()
      return data.items.filter(item => item.chatKey === chatKey)
    },
    put(item) {
      // 同会话同理由的旧冲动先清掉：每轮重新生成一次，别攒成几百条一样的话
      const rest = data.items.filter(existing => existing.id !== item.id
        && !(existing.chatKey === item.chatKey && existing.why.trim() === item.why.trim()))
      data = { ...data, items: [...rest, item] }
      persist()
    },
    notePreviewed(ids) {
      const seen = new Set(data.previewed)
      for (const id of ids) seen.add(id)
      data = { ...data, previewed: [...seen] }
      persist()
    },
    isPreviewed(id) {
      return data.previewed.includes(id)
    },
    markSent(id) {
      data = without(id)
      persist()
    },
    drop(id) {
      data = without(id)
      persist()
    },
    flush() {
      persist()
    },
  }

  const timing: TimingStore = {
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

  return { pending, timing, flush: persist }
}

/**
 * 只拿攒着这一面，单用与用例都方便
 * @param options - 选项
 * @returns 攒着的仓
 */
export function createPendingStore(options: PendingStoreOptions): PendingStore {
  return createProactiveStore(options).pending
}

/**
 * 只拿记一笔这一面
 * @param options - 选项
 * @returns 时间与次数记一笔
 */
export function createTimingStore(options: PendingStoreOptions): TimingStore {
  return createProactiveStore(options).timing
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
