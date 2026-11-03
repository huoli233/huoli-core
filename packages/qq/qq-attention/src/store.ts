/**
 * Durable attention state: an append-only event log held in memory and
 * flushed atomically to one JSON file, so a restart keeps read watermarks,
 * close notes, and wake settings.
 *
 * @module @huoli/huoli-qq-attention
 */

import fs from 'node:fs'
import path from 'node:path'
import { applyAttention, emptyAttention, type AttentionEvent, type AttentionState } from './types.ts'

/** Store options. */
export interface AttentionStoreOptions {
  /** Absolute path of the JSON file holding the state. */
  file: string
  /** Clock, for tests. */
  now?: () => number
}

/** One chat's attention state, readable and appendable. */
export interface AttentionStore {
  /** State for one chat; a chat never touched reads as empty. */
  of(chatKey: string): AttentionState
  /** Apply one event and persist it. */
  append(event: AttentionEvent): void
  /** Write the current state to disk now. */
  flush(): void
}

interface PersistedShape {
  version: 1
  chats: Record<string, AttentionState>
}

/** Load a persisted file, returning an empty state for any read or parse failure. */
function load(file: string): PersistedShape {
  try {
    if (!fs.existsSync(file)) return { version: 1, chats: {} }
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return { version: 1, chats: {} }
    const parsed = JSON.parse(text) as Partial<PersistedShape>
    return { version: 1, chats: parsed.chats !== undefined && parsed.chats !== null ? parsed.chats : {} }
  } catch {
    return { version: 1, chats: {} }
  }
}

/** Write through a sibling temporary file, then rename, so a crash never truncates the file. */
function save(file: string, shape: PersistedShape): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(shape, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * Create the attention store.
 * @param options - file location and clock.
 * @returns the store; every append is durable before it returns.
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
