// 记忆存一个文件：读出来先补字段，写回整份，先写临时文件再改名

import fs from 'node:fs'
import path from 'node:path'
import {
  CLARITY_ORDER,
  clarityFor,
  initialImportance,
  retention,
  type Clarity,
} from '@huoli/huoli-qq-policy'
import { newId, type MemoryItem, type MemoryLayer } from './types.ts'

/** 存文件的选项 */
export interface MemoryStoreOptions {
  file: string
}

/** 记忆仓 */
export interface MemoryStore {
  all(): readonly MemoryItem[]
  byId(id: string): MemoryItem | undefined
  add(item: MemoryItem): void
  update(id: string, patch: Partial<MemoryItem>): void
  remove(id: string): void
  replaceAll(items: readonly MemoryItem[]): void
  flush(): void
}

// 文件里的样子
interface StoredMemory {
  version: 1
  items: MemoryItem[]
}

const LAYERS: readonly MemoryLayer[] = ['ephemeral', 'episodic', 'semantic', 'private']

const SOURCES: readonly MemoryItem['source'][] = ['chat', 'tool', 'proactive', 'manual']

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

// 情绪强度按 0 到 1 记，旧的 24 分制折算回来
function emotionalOr(value: unknown): number {
  const raw = numberOr(value, 0)
  const scaled = raw > 1 ? raw / 24 : raw
  return Math.min(1, Math.max(0, scaled))
}

// 读回来的一条：缺的字段按默认补齐，不认识的字段原样带着
function normalizeItem(raw: Record<string, unknown>, now: number): MemoryItem {
  const at = numberOr(raw.at, now)
  const lastSeenAt = numberOr(raw.lastSeenAt, at)
  const recallCount = Math.max(0, Math.round(numberOr(raw.recallCount, 0)))
  const importanceRaw = numberOr(raw.importance, 0)
  const importance = importanceRaw > 0
    ? Math.min(100, Math.max(1, Math.round(importanceRaw)))
    : initialImportance({ scene: 'group' })
  const computed = clarityFor(retention({ importance, at, lastSeenAt, recallCount }, now))
  const clarity = pick<Clarity>(raw.clarity, CLARITY_ORDER, computed)
  const personId = typeof raw.personId === 'string' && raw.personId !== '' ? raw.personId : undefined
  return {
    ...raw,
    id: textOr(raw.id, newId(at)),
    text: textOr(raw.text, ''),
    layer: pick(raw.layer, LAYERS, 'episodic'),
    scope: textOr(raw.scope, ''),
    importance,
    emotional: emotionalOr(raw.emotional),
    clarity,
    recallCount,
    at,
    lastSeenAt,
    forgotten: raw.forgotten === true || clarity === 'forgotten',
    source: pick(raw.source, SOURCES, 'chat'),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
    ...personId === undefined ? {} : { personId },
  }
}

// 读文件，出错就当还没记过事
function load(file: string): MemoryItem[] {
  try {
    if (!fs.existsSync(file)) return []
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return []
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) return []
    const now = Date.now()
    return parsed.items.filter(isRecord).map(raw => normalizeItem(raw, now))
  } catch {
    return []
  }
}

// 整份写回，先写临时文件再改名
function save(file: string, items: readonly MemoryItem[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  const body: StoredMemory = { version: 1, items: [...items] }
  fs.writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建一个记忆仓
 * @param options - 选项
 * @returns 处理结果
 */
export function createMemoryStore(options: MemoryStoreOptions): MemoryStore {
  let items: MemoryItem[] = load(options.file)
  const index = new Map<string, number>()
  const reindex = (): void => {
    index.clear()
    items.forEach((item, at) => index.set(item.id, at))
  }
  reindex()

  const persist = (): void => {
    save(options.file, items)
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
    flush() {
      persist()
    },
  }
}
