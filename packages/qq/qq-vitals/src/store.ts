// 状态落盘：先写临时文件再改名，坏文件先试备份，都不行就回默认值

import fs from 'node:fs'
import path from 'node:path'
import { DERIVED_FIELDS, emptyState, NUMERIC_FIELDS, STAMP_FIELDS, type Tuning } from './defaults.ts'
import type { TasteRecord, VitalsState } from './types.ts'

/** 存盘要用的选项 */
export interface VitalsStoreOptions {
  file: string
  tuning: Tuning
  now?: () => number
}

/** 这一份状态的读写口 */
export interface VitalsStore {
  read(): VitalsState
  write(state: VitalsState): void
}

// 文件里的样子，带版本号方便以后改格式
interface StoredVitals {
  version: 1
  state: VitalsState
}

// 读一个文件，读不动就当不存在
function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  } catch (error) {
    // 不在、没权限、读一半坏了都算没有；下一轮心跳会重写
    void error
    return undefined
  }
}

// 最近尝到的那次记录，字段不全就当没有
function toTaste(raw: unknown): TasteRecord | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const name = record.name
  const desc = record.desc
  const feel = record.feel
  const label = record.emotion_label
  const source = record.source
  const preference = record.preference
  if (typeof name !== 'string' || typeof desc !== 'string' || typeof feel !== 'string') return null
  if (typeof label !== 'string' || typeof source !== 'string') return null
  return {
    name,
    desc,
    feel,
    preference: typeof preference === 'number' ? preference : 0,
    emotion_label: label,
    source,
  }
}

// 缺字段用默认值补，类型不对也退回默认值
function sanitize(raw: unknown, fallback: VitalsState): VitalsState {
  if (raw === null || typeof raw !== 'object') return fallback
  const record = raw as Record<string, unknown>
  const state: VitalsState = { ...fallback }
  for (const field of NUMERIC_FIELDS) {
    const value = record[field]
    if (typeof value === 'number' && Number.isFinite(value)) state[field] = value
  }
  for (const field of DERIVED_FIELDS) {
    const value = record[field]
    if (typeof value === 'number' && Number.isFinite(value)) state[field] = value
  }
  for (const field of STAMP_FIELDS) {
    const value = record[field]
    if (typeof value === 'number' && Number.isFinite(value)) state[field] = value
  }
  const level = record.emotion_level
  if (typeof level === 'string' && level.length > 0) state.emotion_level = level
  const candidates = record.emotion_candidates
  if (Array.isArray(candidates)) {
    state.emotion_candidates = candidates.flatMap(item => (typeof item === 'string' ? [item] : []))
  }
  const drinkName = record.last_drink_name
  if (typeof drinkName === 'string') state.last_drink_name = drinkName
  const userText = record.last_user_text
  if (typeof userText === 'string') state.last_user_text = userText
  const taste = toTaste(record.last_taste)
  if (taste !== null) state.last_taste = taste
  return state
}

// 先读本体，再读备份，最后回默认值
function load(file: string, tuning: Tuning, at: number): VitalsState {
  const fallback = emptyState(tuning, at)
  for (const candidate of [file, `${file}.bak`]) {
    const text = readText(candidate)
    if (text === undefined || text.trim().length === 0) continue
    try {
      const parsed = JSON.parse(text) as { state?: unknown }
      return sanitize(parsed.state, fallback)
    } catch (error) {
      // 半截的 JSON 直接跳过，去试下一份
      void error
    }
  }
  return fallback
}

// 原子写：留旧文件当备份，临时文件改名顶上
function save(file: string, state: VitalsState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
  const temporary = `${file}.${process.pid}.tmp`
  const body: StoredVitals = { version: 1, state }
  fs.writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建一个状态仓
 * @param options - 文件位置与参数
 * @returns 读写口
 */
export function createVitalsStore(options: VitalsStoreOptions): VitalsStore {
  const now = options.now ?? (() => Date.now())
  let state = load(options.file, options.tuning, now())
  return {
    read() {
      return state
    },
    write(next) {
      state = next
      save(options.file, state)
    },
  }
}
