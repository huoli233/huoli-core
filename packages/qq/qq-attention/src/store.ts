// 注意力状态落盘：内存里算，原子写回一个 JSON 文件，重启不丢

import fs from 'node:fs'
import path from 'node:path'
import { applyAttention, emptyAttention, type AttentionEvent, type AttentionState } from './types.ts'

/** 建仓选项 */
export interface AttentionStoreOptions {
  file: string
  now?: () => number
}

/** 按会话读状态、发事件 */
export interface AttentionStore {
  of(chatKey: string): AttentionState
  append(event: AttentionEvent): void
  flush(): void
}

// 文件里的形状
interface StoredState {
  version: 1
  chats: Record<string, AttentionState>
}

// 读盘时按可能缺失或为空的字段声明
interface StoredStateInput {
  chats?: Record<string, AttentionState> | null
}

// 读文件，出错就当空仓
function load(file: string): StoredState {
  try {
    if (!fs.existsSync(file)) return { version: 1, chats: {} }
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return { version: 1, chats: {} }
    const parsed = JSON.parse(text) as StoredStateInput
    return { version: 1, chats: parsed.chats !== undefined && parsed.chats !== null ? parsed.chats : {} }
  } catch {
    return { version: 1, chats: {} }
  }
}

// 先写临时文件再改名，崩在中间也不会写坏
function save(file: string, shape: StoredState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(shape, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建一个落盘的注意力仓
 * @param options - 选项
 * @returns 处理结果
 */
export function createAttentionStore(options: AttentionStoreOptions): AttentionStore {
  const loaded = load(options.file)
  const chats = new Map<string, AttentionState>(Object.entries(loaded.chats))

  return {
    of(chatKey) {
      return chats.get(chatKey) ?? emptyAttention()
    },
    append(event) {
      const current = chats.get(event.chatKey) ?? emptyAttention()
      const next = applyAttention(current, event)
      if (next === current) return
      chats.set(event.chatKey, next)
      save(options.file, { version: 1, chats: Object.fromEntries(chats) })
    },
    flush() {
      save(options.file, { version: 1, chats: Object.fromEntries(chats) })
    },
  }
}
