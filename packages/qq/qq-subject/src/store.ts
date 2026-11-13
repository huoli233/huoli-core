// 状态落盘：读出来先按过去的时长把状态放平，再写回文件

import fs from 'node:fs'
import path from 'node:path'
import { emptyChat, emptySubject, settleChat, settleGlobal, tickGlobal, type ChatState, type GlobalState, type SubjectState } from './state.ts'

/** 存盘的选项 */
export interface SubjectStoreOptions {
  file: string
  now?: () => number
}

/** 按会话读写状态 */
export interface SubjectStore {
  read(): SubjectState
  forChat(chatKey: string): ChatState
  setActive(chatKey: string): void
  changeGlobal(field: keyof GlobalState, delta: number): void
  changeChat(chatKey: string, field: keyof ChatState, delta: number): void
  /** 按当前时刻结算一次安静时间里累积的动机并落盘 */
  tick(at?: number): void
  flush(): void
}

// 文件里的样子，读盘时按可能缺失或为空的字段声明
interface StoredState {
  version: 1
  global: GlobalState
  chats: Record<string, ChatState>
  lastActive: string
}

interface StoredStateInput {
  global?: GlobalState | null
  chats?: Record<string, ChatState> | null
  lastActive?: unknown
}

// 读文件，出错就当没用过
function load(file: string, now: number): SubjectState {
  try {
    if (!fs.existsSync(file)) return emptySubject(now)
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim().length === 0) return emptySubject(now)
    const parsed = JSON.parse(text) as StoredStateInput
    return {
      global: parsed.global !== undefined && parsed.global !== null ? parsed.global : emptySubject(now).global,
      chats: parsed.chats !== undefined && parsed.chats !== null ? parsed.chats : {},
      lastActive: typeof parsed.lastActive === 'string' ? parsed.lastActive : '',
    }
  } catch (readError) {
    // 状态读坏了按没用过重建，写回时由原子写覆盖，不删原文件也不假装恢复成功
    void readError
    return emptySubject(now)
  }
}

// 先写临时文件再改名，中途出错也不会写坏
function save(file: string, state: SubjectState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  const body: StoredState = { version: 1, global: state.global, chats: state.chats, lastActive: state.lastActive }
  fs.writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建一个状态仓
 * @param options - 选项
 * @returns 处理结果
 */
export function createSubjectStore(options: SubjectStoreOptions): SubjectStore {
  const now = options.now ?? (() => Date.now())
  let state = load(options.file, now())
  let lastPersistAt = now()
  let dirty = false

  const flatten = (): SubjectState => {
    const at = now()
    const chats: Record<string, ChatState> = {}
    for (const [key, value] of Object.entries(state.chats)) chats[key] = settleChat(value, at)
    state = { ...state, global: settleGlobal(state.global, at), chats }
    return state
  }

  const persist = (): void => {
    save(options.file, state)
    lastPersistAt = now()
    dirty = false
  }

  return {
    read() {
      return flatten()
    },
    forChat(chatKey) {
      flatten()
      const existing = state.chats[chatKey]
      if (existing !== undefined) return existing
      const created = emptyChat(now())
      state = { ...state, chats: { ...state.chats, [chatKey]: created } }
      dirty = true
      return created
    },
    setActive(chatKey) {
      flatten()
      if (state.lastActive === chatKey) return
      const previous = state.lastActive
      state = { ...state, lastActive: chatKey }
      if (previous === '' || now() - lastPersistAt >= 5_000) persist()
      else dirty = true
    },
    changeGlobal(field, delta) {
      flatten()
      const current = state.global[field] || 0
      const value = Math.min(1, Math.max(0, current + delta))
      state = { ...state, global: { ...state.global, [field]: value, updatedAt: now() } }
      persist()
    },
    changeChat(chatKey, field, delta) {
      flatten()
      const chat = state.chats[chatKey] ?? emptyChat(now())
      const current = chat[field] || 0
      const value = Math.min(1, Math.max(0, current + delta))
      state = { ...state, chats: { ...state.chats, [chatKey]: { ...chat, [field]: value, updatedAt: now() } } }
      persist()
    },
    tick(at) {
      state = { ...state, global: tickGlobal(state.global, at ?? now()) }
      persist()
    },
    flush() {
      if (dirty) persist()
    },
  }
}
