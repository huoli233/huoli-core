// 三类动作的状态：做过的只留指纹，待确认的短存正文；写盘先临时文件再改名，读坏按备份与默认值回退

import fs from 'node:fs'
import path from 'node:path'
import { ACTION_KINDS, type ActionKind } from '@huoli/huoli-qq-self'

/** 状态文件的版本，结构改动才递增 */
export const ACTION_STATE_VERSION = 2

/** 一条做过的正文的指纹 */
export interface ActionFingerprint {
  /** 正文的摘要，正文本身不落盘 */
  sha: string
  /** 做出去的时刻 */
  at: number
}

/** 一类动作在盘上那一格，三类互不共用 */
export interface ActionKindState {
  /** 当天计数从哪个零点算起 */
  dayStart: number
  /** 当天做了几次 */
  dayCount: number
  /** 上一次做成的时刻，零表示还没做过 */
  lastAt: number
  /** 做过的正文指纹，新的在后 */
  fingerprints: readonly ActionFingerprint[]
}

/** 一条等着点头的正文，过期就失效 */
export interface PendingAction {
  /** 这一条的编号 */
  confirmId: string
  /** 属于哪一类动作 */
  action: ActionKind
  /** 正文的指纹 */
  sha: string
  /** 正文本身，放行或过期之后就不再留着 */
  text: string
  /** 提出确认的时刻 */
  at: number
  /** 到这个时刻没人点头就失效 */
  expiresAt: number
  /** 点头的时刻 */
  confirmedAt?: number
}

/** 盘上那份状态 */
export interface ActionState {
  /** 版本戳 */
  version: number
  /** 三类动作各一格 */
  kinds: Readonly<Record<ActionKind, ActionKindState>>
  /** 等着点头的那几条 */
  pending: readonly PendingAction[]
}

/**
 * 什么都没读出来时的状态
 * @param dayStart - 当天从哪个零点算起
 * @returns 三类都空、没有待确认项的一份状态
 */
export function emptyActionState(dayStart: number): ActionState {
  const blank = (): ActionKindState => ({ dayStart, dayCount: 0, lastAt: 0, fingerprints: [] })
  return {
    version: ACTION_STATE_VERSION,
    kinds: { post: blank(), comment: blank(), private: blank() },
    pending: [],
  }
}

/** 状态在哪、怎么读写 */
export interface ActionStore {
  /** 读回上一次的状态，读不出时为 undefined */
  read(): ActionState | undefined
  /** 盖写一份状态，先留备份 */
  write(state: ActionState): void
}

/** 状态文件的位置 */
export interface ActionStoreOptions {
  /** 状态文件放在哪 */
  file: string
}

// 读一份文件，读不动就当没有
function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  } catch (error) {
    // 不在、没权限、读一半坏了都算没有
    void error
    return undefined
  }
}

/**
 * 原子写：先写同目录的临时文件，再改名顶上
 * @param file - 要盖写的文件
 * @param text - 要写进去的整段文本
 */
export function writeAtomic(file: string, text: string): void {
  const temporary = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, text, { mode: 0o600 })
    fs.renameSync(temporary, file)
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true })
    } catch (cleanup) {
      // 临时文件删不掉也留着，正本没被动过
      void cleanup
    }
    throw error
  }
}

// 取一个有限数，类型不对或不是有限数都算没有
function asNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

// 取一个非空字符串，类型不对或空串都算没有
function asText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  return value
}

// 一条指纹：摘要非空、时刻有限，缺一样整份当没读过
function asFingerprint(value: unknown): ActionFingerprint | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const sha = asText(record.sha)
  const at = asNumber(record.at)
  if (sha === undefined || at === undefined) return undefined
  return { sha, at }
}

// 一类动作那一格：日界、条数、上次时刻与指纹表全要对得上
function asKindState(value: unknown): ActionKindState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const dayStart = asNumber(record.dayStart)
  const dayCount = asNumber(record.dayCount)
  const lastAt = asNumber(record.lastAt)
  if (dayStart === undefined || dayCount === undefined || lastAt === undefined) return undefined
  if (!Array.isArray(record.fingerprints)) return undefined
  const fingerprints: ActionFingerprint[] = []
  for (const item of record.fingerprints) {
    const entry = asFingerprint(item)
    if (entry === undefined) return undefined
    fingerprints.push(entry)
  }
  return { dayStart, dayCount, lastAt, fingerprints }
}

// 取一个三类动作之一的名字，别的写法都算没有
function asActionKind(value: unknown): ActionKind | undefined {
  if (typeof value !== 'string') return undefined
  return ACTION_KINDS.find(kind => kind === value)
}

// 一条待确认项：编号、品类、指纹、正文、提出时刻与失效时刻缺一不可
function asPending(value: unknown): PendingAction | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const confirmId = asText(record.confirmId)
  const action = asActionKind(record.action)
  const sha = asText(record.sha)
  const text = asText(record.text)
  const at = asNumber(record.at)
  const expiresAt = asNumber(record.expiresAt)
  if (confirmId === undefined || sha === undefined || text === undefined) return undefined
  if (action === undefined || at === undefined || expiresAt === undefined) return undefined
  const confirmedAt = asNumber(record.confirmedAt)
  return { confirmId, action, sha, text, at, expiresAt, ...confirmedAt === undefined ? {} : { confirmedAt } }
}

// 逐字段校验，结构对不上就当这一份没读过，交给下一级回退
function parseState(text: string): ActionState | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // 半截的文件按没读过处理
    void error
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  if (record.version !== ACTION_STATE_VERSION) return undefined
  const kinds = record.kinds
  if (typeof kinds !== 'object' || kinds === null || Array.isArray(kinds)) return undefined
  const slots = kinds as Record<string, unknown>
  const post = asKindState(slots.post)
  const comment = asKindState(slots.comment)
  const privateSlot = asKindState(slots.private)
  if (post === undefined || comment === undefined || privateSlot === undefined) return undefined
  if (!Array.isArray(record.pending)) return undefined
  const pending: PendingAction[] = []
  for (const item of record.pending) {
    const entry = asPending(item)
    if (entry === undefined) return undefined
    pending.push(entry)
  }
  return { version: ACTION_STATE_VERSION, kinds: { post, comment, private: privateSlot }, pending }
}

/**
 * 建一个状态读写口
 * @param options - 状态文件放在哪
 * @returns 读写口
 */
export function createActionStore(options: ActionStoreOptions): ActionStore {
  const { file } = options
  const backup = `${file}.bak`

  return {
    read() {
      const formal = readText(file)
      if (formal !== undefined) {
        const state = parseState(formal)
        if (state !== undefined) return state
      }
      const copied = readText(backup)
      if (copied !== undefined) {
        const state = parseState(copied)
        if (state !== undefined) return state
      }
      return undefined
    },
    write(state) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      if (fs.existsSync(file)) fs.copyFileSync(file, backup)
      writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
    },
  }
}
