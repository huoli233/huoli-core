// 心里惦记的事：模型自己写、自己删，放久了自动过期

import fs from 'node:fs'
import path from 'node:path'
import { THOUGHT_TTL_MS, type Thought } from './collect.ts'

/** 存念头 */
export interface ThoughtStoreOptions {
  file: string
  now?: () => number
}

/** 念头仓 */
export interface ThoughtStore {
  all(): Thought[]
  live(chatKey: string): Thought[]
  add(text: string, chatKey: string): Thought
  drop(id: string): boolean
  flush(): void
}

// 文件里的样子
interface StoredThoughts {
  version: 1
  items: Array<Thought & { chatKey: string }>
}

// 读文件，出错就当没有
function load(file: string): Array<Thought & { chatKey: string }> {
  try {
    if (!fs.existsSync(file)) return []
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return []
    const parsed = JSON.parse(text) as Partial<StoredThoughts>
    return Array.isArray(parsed.items) ? parsed.items : []
  } catch {
    return []
  }
}

// 整份写回
function save(file: string, items: Array<Thought & { chatKey: string }>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  const body: StoredThoughts = { version: 1, items }
  fs.writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建一个念头仓
 * @param options - 选项
 * @returns 处理结果
 */
export function createThoughtStore(options: ThoughtStoreOptions): ThoughtStore {
  const now = options.now ?? (() => Date.now())
  let items = load(options.file)

  const persist = (): void => {
    save(options.file, items)
  }

  const clean = (): void => {
    const at = now()
    const kept = items.filter((item) => item.expiresAt > at)
    if (kept.length !== items.length) {
      items = kept
      persist()
    }
  }

  return {
    all() {
      clean()
      return items
    },
    live(chatKey) {
      clean()
      return items.filter((item) => item.chatKey === chatKey)
    },
    add(text, chatKey) {
      const at = now()
      const item: Thought & { chatKey: string } = {
        id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        at,
        expiresAt: at + THOUGHT_TTL_MS,
        chatKey,
      }
      items = [...items, item].slice(-50)
      persist()
      return { id: item.id, text: item.text, at: item.at, expiresAt: item.expiresAt }
    },
    drop(id) {
      const before = items.length
      items = items.filter((item) => item.id !== id)
      if (items.length === before) return false
      persist()
      return true
    },
    flush() {
      persist()
    },
  }
}
