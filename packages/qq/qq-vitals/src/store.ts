// 状态落盘：先写临时文件再改名，坏文件先试备份，都不行就回默认值

import fs from 'node:fs'
import path from 'node:path'
import {
  CYCLE_FIELDS, DERIVED_FIELDS, emptyState, NUMERIC_FIELDS, STAMP_FIELDS, type Tuning,
} from './defaults.ts'
import type { CyclePhase, EmotionBlend, TasteRecord, VitalsState } from './types.ts'

/** 存盘要用的选项 */
export interface VitalsStoreOptions {
  file: string
  tuning: Tuning
  /** 普通状态写入的最短落盘间隔；0 表示每次都写 */
  writeIntervalMs?: number
  now?: () => number
}

export const VITALS_STORE_DEFAULTS = { writeIntervalMs: 5_000 } as const

/** 这一份状态的读写口 */
export interface VitalsStore {
  read(): VitalsState
  write(state: VitalsState, immediate?: boolean): void
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

// 相位只认五个字面量，别的一律当没写过
function toPhase(raw: unknown): CyclePhase | undefined {
  if (raw === 'menstrual' || raw === 'follicular' || raw === 'ovulation') return raw
  if (raw === 'luteal' || raw === 'premenstrual') return raw
  return undefined
}

// 混合层的一条，四个字段缺一个就当没有
function toBlend(raw: unknown): EmotionBlend[] {
  if (raw === null || typeof raw !== 'object') return []
  const record = raw as Record<string, unknown>
  const key = record.key
  const weight = record.weight
  const half = record.half_min
  const why = record.why
  if (typeof key !== 'string' || key === '' || typeof why !== 'string') return []
  if (typeof weight !== 'number' || !Number.isFinite(weight)) return []
  if (typeof half !== 'number' || !Number.isFinite(half)) return []
  return [{ key, weight, half_min: half, why }]
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
  for (const field of CYCLE_FIELDS) {
    const value = record[field]
    if (typeof value === 'number' && Number.isFinite(value)) state[field] = value
  }
  const sleepState = record.sleep_state
  if (sleepState === 'awake' || sleepState === 'sleeping' || sleepState === 'waking') state.sleep_state = sleepState
  // 睡着这一态只有一个来源，读回来之后按它重算睡着那一态，两边不会对不上
  state.asleep = state.sleep_state === 'sleeping'
  const sleepKind = record.sleep_kind
  if (sleepKind === '' || sleepKind === 'night' || sleepKind === 'nap') state.sleep_kind = sleepKind
  const dreamKind = record.dream_kind
  if (dreamKind === '' || dreamKind === 'sweet' || dreamKind === 'nightmare' || dreamKind === 'plain') {
    state.dream_kind = dreamKind
  }
  const dreamPlace = record.dream_place
  if (typeof dreamPlace === 'string') state.dream_place = dreamPlace
  const dreamRepeat = record.dream_repeat
  if (typeof dreamRepeat === 'boolean') state.dream_repeat = dreamRepeat
  const phase = toPhase(record.cycle_phase)
  if (phase !== undefined) state.cycle_phase = phase
  const level = record.emotion_level
  if (typeof level === 'string' && level.length > 0) state.emotion_level = level
  const candidates = record.emotion_candidates
  if (Array.isArray(candidates)) {
    state.emotion_candidates = candidates.flatMap(item => (typeof item === 'string' ? [item] : []))
  }
  const blend = record.emotion_blend
  if (Array.isArray(blend)) state.emotion_blend = blend.flatMap(toBlend)
  const emotionWhy = record.emotion_why
  if (typeof emotionWhy === 'string') state.emotion_why = emotionWhy
  const drinkName = record.last_drink_name
  if (typeof drinkName === 'string') state.last_drink_name = drinkName
  const userText = record.last_user_text
  if (typeof userText === 'string') state.last_user_text = userText
  const taste = toTaste(record.last_taste)
  if (taste !== null) state.last_taste = taste
  return state
}

function validStateRecord(raw: unknown, fallback: VitalsState): raw is Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false
  const record = raw as Record<string, unknown>
  // Version 1 snapshots may predate fields added later; the stable core anchors
  // distinguish a real older snapshot from an empty or unrelated object.
  if (!Object.hasOwn(record, 'last_update') || !Object.hasOwn(record, 'dopamine')) return false
  const fields = Object.keys(fallback).filter((key): key is keyof VitalsState => Object.hasOwn(fallback, key))
  for (const field of fields) {
    if (!Object.hasOwn(record, field)) continue
    const value = record[field]
    const expected: unknown = fallback[field]
    if (expected === null) {
      if (value !== null && toTaste(value) === null) return false
    } else if (Array.isArray(expected)) {
      if (!Array.isArray(value)) return false
    } else if (typeof expected === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false
    } else if (typeof expected === 'string' || typeof expected === 'boolean') {
      if (typeof value !== typeof expected) return false
    } else {
      return false
    }
  }
  return true
}

function restoredState(raw: unknown, fallback: VitalsState): VitalsState | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const stored = raw as Record<string, unknown>
  if (stored.version !== 1 || !validStateRecord(stored.state, fallback)) return undefined
  return sanitize(stored.state, fallback)
}

// 先读本体，再读备份，最后回默认值
function load(file: string, tuning: Tuning, at: number): VitalsState {
  const fallback = emptyState(tuning, at)
  for (const candidate of [file, `${file}.bak`]) {
    const text = readText(candidate)
    if (text === undefined || text.trim().length === 0) continue
    try {
      const parsed: unknown = JSON.parse(text)
      const restored = restoredState(parsed, fallback)
      if (restored !== undefined) return restored
    } catch (error) {
      // 半截的 JSON 直接跳过，去试下一份
      void error
    }
  }
  return fallback
}

// 原子写：只把有效旧状态换成备份，再用临时文件替换主文件
function save(file: string, state: VitalsState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const current = readText(file)
  if (current !== undefined) {
    try {
      const parsed: unknown = JSON.parse(current)
      if (restoredState(parsed, state) !== undefined) {
        const backupTemporary = `${file}.${process.pid}.bak.tmp`
        fs.copyFileSync(file, backupTemporary)
        fs.renameSync(backupTemporary, `${file}.bak`)
      }
    } catch (error) {
      // 主文件无效时保留已有备份，不用坏文件覆盖它
      void error
    }
  }
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
  const writeIntervalMs = options.writeIntervalMs === undefined || !Number.isFinite(options.writeIntervalMs)
    ? VITALS_STORE_DEFAULTS.writeIntervalMs
    : Math.max(0, Math.floor(options.writeIntervalMs))
  let state = load(options.file, options.tuning, now())
  let lastWriteAt = now()
  return {
    read() {
      return state
    },
    write(next, immediate = true) {
      if (immediate || now() - lastWriteAt >= writeIntervalMs) {
        save(options.file, next)
        state = next
        lastWriteAt = now()
      } else {
        state = next
      }
    },
  }
}
