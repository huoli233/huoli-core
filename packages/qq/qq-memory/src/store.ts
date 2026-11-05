// 记忆存一个文件：读出来先补字段，写回整份，先写临时文件再改名

import fs from 'node:fs'
import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { IMPORTANCE_MAX, IMPORTANCE_MIN } from './guard.ts'
import {
  CLARITY_ORDER,
  clarityFor,
  initialImportance,
  quantizeImportance,
  retention,
  type Clarity,
} from '@huoli/huoli-qq-policy'
import { newId, MEMORY_SOURCES, MEMORY_STATES, type MemoryItem, type MemoryLayer, type MemoryState } from './types.ts'

/** 记忆文件头的版本戳，只有结构变化才动它 */
export const MEMORY_SCHEMA_VERSION = 1

/** 存文件的选项 */
export interface MemoryStoreOptions {
  file: string
}

/** 跟条目一起存的仓状态 */
export interface MemoryStoreState {
  /** 上次每天整理落在哪一天，本地日期，形如 2026-11-04；没整理过就是空串 */
  lastMaintainedDay: string
}

/** 记忆仓 */
export interface MemoryStore {
  all(): readonly MemoryItem[]
  byId(id: string): MemoryItem | undefined
  add(item: MemoryItem): void
  update(id: string, patch: Partial<MemoryItem>): void
  remove(id: string): void
  replaceAll(items: readonly MemoryItem[]): void
  /** 仓级状态，跟条目同一份文件 */
  state(): MemoryStoreState
  setState(patch: Partial<MemoryStoreState>): void
  flush(): void
}

// 文件里的样子
interface StoredMemory {
  version: typeof MEMORY_SCHEMA_VERSION
  lastMaintainedDay: string
  items: MemoryItem[]
}

// 还没写过任何状态
const NO_STATE: MemoryStoreState = { lastMaintainedDay: '' }

const LAYERS: readonly MemoryLayer[] = ['ephemeral', 'episodic', 'semantic', 'private']

// 认得出是一个对象
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

// 只认几个合法值，其余回落到默认
function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback
}

/** 旧版情绪强度是 24 分制，读回来按这个分母折算成零到一 */
const LEGACY_INTENSITY_SCALE = 24

// 情绪强度按 0 到 1 记，旧的 24 分制折算回来
function emotionalOr(value: unknown): number {
  const raw = numberOr(value, 0)
  const scaled = raw > 1 ? raw / LEGACY_INTENSITY_SCALE : raw
  return Math.min(1, Math.max(0, scaled))
}

// 读回来的一条：缺的字段按默认补齐，不认识的字段原样带着
function normalizeItem(raw: Record<string, unknown>, now: number): MemoryItem {
  const at = numberOr(raw.at, now)
  const lastSeenAt = numberOr(raw.lastSeenAt, at)
  const recallCount = Math.max(0, Math.round(numberOr(raw.recallCount, 0)))
  const importanceRaw = numberOr(raw.importance, 0)
  // 重要度每天按小数往下掉，读回来只补到一位小数，不能取整抹掉掉落进度
  const importance = importanceRaw > 0
    ? Math.min(IMPORTANCE_MAX, Math.max(IMPORTANCE_MIN, quantizeImportance(importanceRaw)))
    : initialImportance({ scene: 'group' })
  const computed = clarityFor(retention({ importance, at, lastSeenAt, recallCount }, now))
  const clarity = pick<Clarity>(raw.clarity, CLARITY_ORDER, computed)
  const personId = typeof raw.personId === 'string' && raw.personId !== '' ? raw.personId : undefined
  // 旧的 forgotten 布尔折成两态，读回后不再写回这个键
  const legacyForgotten = raw.forgotten === true
  const state = pick<MemoryState>(raw.state, MEMORY_STATES, legacyForgotten || clarity === 'forgotten' ? 'forgotten' : 'active')
  const kept: Record<string, unknown> = { ...raw }
  delete kept.forgotten
  delete kept.retiredAt
  return {
    ...kept,
    id: textOr(raw.id, newId(at)),
    text: textOr(raw.text, ''),
    layer: pick(raw.layer, LAYERS, 'episodic'),
    scope: textOr(raw.scope, ''),
    importance,
    emotional: emotionalOr(raw.emotional),
    clarity,
    recallCount,
    recoverDay: Math.max(0, numberOr(raw.recoverDay, 0)),
    recoverTimes: Math.max(0, Math.round(numberOr(raw.recoverTimes, 0))),
    at,
    lastSeenAt,
    state,
    // 旧文件里退役过的那条没有时刻，按写入时刻补，免得账本缺一格
    ...state === 'forgotten' ? { retiredAt: Math.max(0, numberOr(raw.retiredAt, at)) } : {},
    source: pick(raw.source, MEMORY_SOURCES, 'chat'),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
    ...personId === undefined ? {} : { personId },
  }
}

// 读文件，出错就当还没记过事
function load(file: string): { items: MemoryItem[]; state: MemoryStoreState } {
  try {
    if (!fs.existsSync(file)) return { items: [], state: NO_STATE }
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return { items: [], state: NO_STATE }
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) return { items: [], state: NO_STATE }
    const now = Date.now()
    return {
      items: parsed.items.filter(isRecord).map(raw => normalizeItem(raw, now)),
      state: { lastMaintainedDay: textOr(parsed.lastMaintainedDay, '') },
    }
  } catch {
    return { items: [], state: NO_STATE }
  }
}

// 整份写回，先写临时文件再改名
function save(file: string, items: readonly MemoryItem[], state: MemoryStoreState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  const body: StoredMemory = { version: MEMORY_SCHEMA_VERSION, lastMaintainedDay: state.lastMaintainedDay, items: [...items] }
  fs.writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 记忆文件默认落在主目录的 data 下
 * @param home - 覆盖主目录，不给按环境变量定
 * @returns 记忆文件的位置
 */
export function defaultMemoryFile(home?: string): string {
  return path.join(resolveHuoliHome(home), 'data', 'qq-memory.json')
}

/**
 * 建一个记忆仓
 * @param options - 选项
 * @returns 处理结果
 */
export function createMemoryStore(options: MemoryStoreOptions): MemoryStore {
  const loaded = load(options.file)
  let items: MemoryItem[] = loaded.items
  let state: MemoryStoreState = loaded.state
  const index = new Map<string, number>()
  const reindex = (): void => {
    index.clear()
    items.forEach((item, at) => index.set(item.id, at))
  }
  reindex()

  const persist = (): void => {
    save(options.file, items, state)
  }

  return {
    all() {
      return items
    },
    byId(id) {
      const at = index.get(id)
      return at === undefined ? undefined : items[at]
    },
    add(item) {
      items = [...items, item]
      index.set(item.id, items.length - 1)
      persist()
    },
    update(id, patch) {
      const at = index.get(id)
      if (at === undefined) return
      const current = items[at]
      if (current === undefined) return
      const next = { ...current, ...patch }
      items = [...items.slice(0, at), next, ...items.slice(at + 1)]
      persist()
    },
    remove(id) {
      const at = index.get(id)
      if (at === undefined) return
      items = [...items.slice(0, at), ...items.slice(at + 1)]
      reindex()
      persist()
    },
    replaceAll(next) {
      items = [...next]
      reindex()
      persist()
    },
    state() {
      return { ...state }
    },
    setState(patch) {
      state = { ...state, ...patch }
      persist()
    },
    flush() {
      persist()
    },
  }
}
