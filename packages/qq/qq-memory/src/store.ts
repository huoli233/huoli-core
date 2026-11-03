// 记忆存一个文件：读出来是数组，写回整份，先写临时文件再改名

import fs from 'node:fs'
import path from 'node:path'
import type { MemoryItem } from './types.ts'

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

// 读文件，出错就当还没记过事
function load(file: string): MemoryItem[] {
  try {
    if (!fs.existsSync(file)) return []
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return []
    const parsed = JSON.parse(text) as Partial<StoredMemory>
    return Array.isArray(parsed.items) ? parsed.items : []
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
      const next = { ...items[at]!, ...patch }
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
