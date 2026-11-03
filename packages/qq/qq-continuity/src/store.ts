// 收尾和回想都存一个文件，按群分开

import fs from 'node:fs'
import path from 'node:path'
import { NOTE_MAX_CHARS, type CloseInput, type CloseNote, type Reflection } from './close.ts'

// 存文件的选项
export interface ContinuityStoreOptions {
  file: string
}

// 收尾仓
export interface ContinuityStore {
  close(input: CloseInput): CloseNote
  lastClose(chatKey: string): CloseNote | undefined
  addReflection(chatKey: string, kind: Reflection['kind'], text: string): Reflection
  reflections(chatKey: string, limit?: number): Reflection[]
  flush(): void
}

// 文件里的样子
interface StoredContinuity {
  version: 1
  closes: Record<string, CloseNote>
  reflections: Reflection[]
}

// 读文件
function load(file: string): StoredContinuity {
  const empty: StoredContinuity = { version: 1, closes: {}, reflections: [] }
  try {
    if (!fs.existsSync(file)) return empty
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return empty
    const parsed = JSON.parse(text) as Partial<StoredContinuity>
    return {
      version: 1,
      closes: parsed.closes !== undefined && parsed.closes !== null ? parsed.closes : {},
      reflections: Array.isArray(parsed.reflections) ? parsed.reflections : [],
    }
  } catch {
    return empty
  }
}

// 整份写回
function save(file: string, data: StoredContinuity): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

// 建一个收尾仓
export function createContinuityStore(options: ContinuityStoreOptions): ContinuityStore {
  let data = load(options.file)

  const persist = (): void => {
    save(options.file, data)
  }

  return {
    close(input) {
      const at = input.at ?? Date.now()
      const note: CloseNote = {
        chatKey: input.chatKey,
        closedAt: at,
        summary: String(input.summary ?? '').slice(0, NOTE_MAX_CHARS),
        nextOpening: String(input.nextOpening ?? '').slice(0, NOTE_MAX_CHARS),
        throughSeq: Number(input.throughSeq) || 0,
      }
      data = { ...data, closes: { ...data.closes, [input.chatKey]: note } }
      persist()
      return note
    },
    lastClose(chatKey) {
      return data.closes[chatKey]
    },
    addReflection(chatKey, kind, text) {
      const at = Date.now()
      const item: Reflection = {
        id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        chatKey,
        at,
        kind,
        text: String(text ?? '').slice(0, 300),
      }
      data = { ...data, reflections: [...data.reflections, item].slice(-200) }
      persist()
      return item
    },
    reflections(chatKey, limit) {
      const all = data.reflections.filter((item) => item.chatKey === chatKey)
      const size = Math.max(1, limit ?? 5)
      return all.slice(-size)
    },
    flush() {
      persist()
    },
  }
}
