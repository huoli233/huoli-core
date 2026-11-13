// 记忆存一个文件：读出来先补字段，写回整份，先写临时文件再改名

import fs from 'node:fs'
import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { assertPrivateMemoryItem, IMPORTANCE_MAX, IMPORTANCE_MIN } from './guard.ts'
import { DEFAULTS } from './defaults.ts'
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
  /** 私密记忆事后状态持续多久，默认三十分钟 */
  privateSettleMs?: number
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

function assertPrivacyTransition(previous: MemoryItem, next: MemoryItem): void {
  if (previous.layer !== 'private' && previous.secret !== true) return
  if (next.layer === 'private'
    && next.secret === true
    && next.scope === previous.scope
    && next.personId === previous.personId) return
  throw new Error('memory.private_scope_change: 已保存的私密记忆不能改成公开或转给其他用户｜下一步: 保留原私聊范围')
}

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
function normalizeItem(raw: Record<string, unknown>, now: number, privateSettleMs: number): MemoryItem {
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
  const layer = pick(raw.layer, LAYERS, 'episodic')
  const settledAt = typeof raw.settledAt === 'number' && Number.isFinite(raw.settledAt)
    ? raw.settledAt
    : layer === 'private' ? at + privateSettleMs : undefined
  const kept: Record<string, unknown> = { ...raw }
  delete kept.forgotten
  delete kept.retiredAt
  return {
    ...kept,
    id: textOr(raw.id, newId(at)),
    text: textOr(raw.text, ''),
    layer,
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
    // 旧文件里退役过的那条没有时刻，按写入时刻补，免得记录表缺一格
    ...state === 'forgotten' ? { retiredAt: Math.max(0, numberOr(raw.retiredAt, at)) } : {},
    source: pick(raw.source, MEMORY_SOURCES, 'chat'),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
    ...personId === undefined ? {} : { personId },
    ...settledAt === undefined ? {} : { settledAt },
  }
}

// 单份候选文件读不出来就抛错，让 load 按正式文件、备份、默认值的顺序回退
function readCandidate(file: string, privateSettleMs: number): { items: MemoryItem[]; state: MemoryStoreState } | undefined {
  if (!fs.existsSync(file)) return undefined
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  if (text.trim() === '') return { items: [], state: NO_STATE }
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) throw new Error(`记忆文件结构不合法：${file}`)
  const now = Date.now()
  const items: MemoryItem[] = []
  for (const raw of parsed.items) {
    if (!isRecord(raw)) continue
    const item = normalizeItem(raw, now, privateSettleMs)
    try {
      assertPrivateMemoryItem(item)
      items.push(item)
    } catch {
      // 只跳过坐标不合法的私密行，不记录正文，也不丢弃同文件的其他记忆
    }
  }
  return {
    items,
    state: { lastMaintainedDay: textOr(parsed.lastMaintainedDay, '') },
  }
}

// 主文件损坏时优先读备份；两份都坏时保留原文件并停下来，不用空库覆盖它
function load(file: string, privateSettleMs: number): { items: MemoryItem[]; state: MemoryStoreState } {
  const backup = `${file}.bak`
  try {
    return readCandidate(file, privateSettleMs) ?? readCandidate(backup, privateSettleMs) ?? { items: [], state: NO_STATE }
  } catch (primaryError) {
    try {
      const recovered = readCandidate(backup, privateSettleMs)
      if (recovered !== undefined) return recovered
    } catch (backupError) {
      throw new Error(`记忆文件与备份都读不出来：${file}`, { cause: backupError })
    }
    throw new Error(`记忆文件读不出来且没有可用备份：${file}`, { cause: primaryError })
  }
}

// 整份写回前保留上一份可解析文件，正式文件仍通过同目录临时文件原子替换
function save(file: string, items: readonly MemoryItem[], state: MemoryStoreState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  const backup = `${file}.bak`
  const backupTemporary = `${backup}.${process.pid}.tmp`
  const body: StoredMemory = { version: MEMORY_SCHEMA_VERSION, lastMaintainedDay: state.lastMaintainedDay, items: [...items] }
  if (fs.existsSync(file)) {
    try {
      const previous: unknown = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
      if (isRecord(previous) && Array.isArray(previous.items)) {
        fs.copyFileSync(file, backupTemporary)
        fs.renameSync(backupTemporary, backup)
      }
    } catch {
      // 损坏的正式文件不能替换掉可能仍可用的备份
      try { fs.rmSync(backupTemporary, { force: true }) } catch { /* 留给下一次启动报告 */ }
    }
  }
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
  const privateSettleMs = options.privateSettleMs ?? DEFAULTS.privateSettleMs
  if (!Number.isFinite(privateSettleMs) || privateSettleMs < 0) {
    throw new Error('qq-memory.privateSettleMs must be a finite non-negative number')
  }
  const loaded = load(options.file, privateSettleMs)
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
      assertPrivateMemoryItem(item)
      const stored = item.layer === 'private' ? { ...item, settledAt: item.at + privateSettleMs } : item
      items = [...items, stored]
      index.set(stored.id, items.length - 1)
      persist()
    },
    update(id, patch) {
      const at = index.get(id)
      if (at === undefined) return
      const current = items[at]
      if (current === undefined) return
      const next = { ...current, ...patch }
      const privacyChanged = current.scope !== next.scope
        || current.layer !== next.layer
        || current.secret !== next.secret
        || current.personId !== next.personId
      if (privacyChanged) {
        assertPrivacyTransition(current, next)
        assertPrivateMemoryItem(next)
        if (next.layer === 'private') next.settledAt = next.at + privateSettleMs
      }
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
      items = next.map((item) => {
        const previousIndex = index.get(item.id)
        const previous = previousIndex === undefined ? undefined : items[previousIndex]
        const privacyChanged = previous === undefined
          || previous.scope !== item.scope
          || previous.layer !== item.layer
          || previous.secret !== item.secret
          || previous.personId !== item.personId
        if (!privacyChanged) return item
        if (previous !== undefined) assertPrivacyTransition(previous, item)
        assertPrivateMemoryItem(item)
        return item.layer === 'private' ? { ...item, settledAt: item.at + privateSettleMs } : item
      })
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
