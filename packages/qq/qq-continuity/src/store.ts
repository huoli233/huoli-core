// 收尾和回想都存一个文件，按群分开

import fs from 'node:fs'
import path from 'node:path'
import { NOTE_MAX_CHARS, closeFacts, type CloseInput, type CloseNote, type Reflection } from './close.ts'

/** 存文件的选项 */
export interface ContinuityStoreOptions {
  file: string
}

/** 回想最多留几条，多了就丢最旧的 */
export const REFLECTIONS_KEEP = 200

/** 问回想时默认给几条 */
export const REFLECTIONS_DEFAULT_LIMIT = 5

/** 收尾仓 */
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

// 读盘时按可能缺失或为空的字段声明
interface StoredContinuityInput {
  closes?: Record<string, CloseNote> | null
  reflections?: Reflection[]
}

// 读文件
function load(file: string): StoredContinuity {
  const empty: StoredContinuity = { version: 1, closes: {}, reflections: [] }
  try {
    if (!fs.existsSync(file)) return empty
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return empty
    const parsed = JSON.parse(text) as StoredContinuityInput
    return {
      version: 1,
      closes: parsed.closes !== undefined && parsed.closes !== null ? parsed.closes : {},
      reflections: Array.isArray(parsed.reflections) ? parsed.reflections : [],
    }
  } catch (readError) {
    // 收尾文件读坏了按空仓继续，回想下次写入会补回，正式文件不由这里删
    void readError
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

/**
 * 建一个收尾仓
 * @param options - 选项
 * @returns 处理结果
 */
export function createContinuityStore(options: ContinuityStoreOptions): ContinuityStore {
  let data = load(options.file)

  const persist = (): void => {
    save(options.file, data)
  }

  return {
    close(input) {
      const note = closeFacts({ ...input, at: input.at ?? Date.now() })
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
        text: text.slice(0, NOTE_MAX_CHARS),
      }
      data = { ...data, reflections: [...data.reflections, item].slice(-REFLECTIONS_KEEP) }
      persist()
      return item
    },
    reflections(chatKey, limit) {
      const all = data.reflections.filter(item => item.chatKey === chatKey)
      const size = Math.max(1, limit ?? REFLECTIONS_DEFAULT_LIMIT)
      return all.slice(-size)
    },
    flush() {
      persist()
    },
  }
}
