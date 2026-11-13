// 三类动作的状态：做过的只留指纹，待确认的短存正文；写盘先临时文件再改名，读坏按备份与默认值回退
// 另有最近一次发送成没成的那一条：发给模型看的，只留结论、时刻、会话、码与几条失败码

import fs from 'node:fs'
import path from 'node:path'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
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

/** 发送状态那一份的版本，结构改动才递增 */
export const SEND_STATE_VERSION = 1

/** 发送状态那一份的默认值 */
export const SEND_STATE_DEFAULTS = {
  /** 留几条失败码，够看出是不是一直卡在同一处 */
  failureKeep: 3,
} as const

/** 一条没发出去的记录 */
export interface SendFailure {
  /** 什么时候没发出去 */
  at: number
  /** 发到哪个会话 */
  chatKey: string
  /** 卡在哪一步的码 */
  code: string
}

/** 最近一次发送的结果，够说清「上一条到底发出去没有」 */
export interface SendRecord {
  /** 这一次发成了没有 */
  ok: boolean
  /** 什么时候 */
  at: number
  /** 发到哪个会话 */
  chatKey: string
  /** 没发出去时的码 */
  code?: string
  /** 没发出去时的人话原因，不留报错栈与本机路径 */
  reason?: string
  /** 最近几条失败码，新的在后 */
  failures: readonly SendFailure[]
}

/** 盘上那份发送状态 */
export interface SendState {
  /** 版本戳 */
  version: number
  /** 最近一次发送，还没发过就没有这一格 */
  last?: SendRecord
}

/** 记一次发送要用的东西 */
export interface SendOutcome {
  /** 这一次发成了没有 */
  ok: boolean
  /** 什么时候出结果的 */
  at: number
  /** 发到哪个会话 */
  chatKey: string
  /** 没发出去时的码 */
  code?: string
  /** 没发出去时的原始说法，由这一层挑着留 */
  reason?: string
}

/** 发送状态在哪、怎么读写 */
export interface SendStateStore {
  /** 读回最近一次发送，没记过或读不出时为 undefined */
  read(): SendState | undefined
  /** 记一次结果，失败码只留最近几条 */
  record(outcome: SendOutcome): void
}

/** 发送状态文件的位置 */
export interface SendStateStoreOptions {
  /** 状态文件放在哪；不给就只存在内存里，进程结束就没了 */
  file?: string
  /** 留几条失败码 */
  failureKeep: number
}

/**
 * 发送状态默认放在哪
 * @param home - 数据根目录，不给就按 HUOLI_HOME 定
 * @returns 状态文件的绝对路径
 */
export function defaultSendStateFile(home?: string): string {
  return path.join(resolveHuoliHome(home), 'data', 'qq-send-state.json')
}

// 记下来的原因只留人话：带盘符、斜杠或过长的一段都不记，免得把本机路径带进提示词
function asSafeReason(value: unknown): string | undefined {
  const text = asText(value)?.trim()
  if (text === undefined || text === '' || text.length > 60) return undefined
  return /[\\/]|[A-Za-z]:/u.test(text) ? undefined : text
}

// 一条失败码：时刻、会话与码缺一不可
function asSendFailure(value: unknown): SendFailure | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const at = asNumber(record.at)
  const chatKey = asText(record.chatKey)
  const code = asText(record.code)
  if (at === undefined || chatKey === undefined || code === undefined) return undefined
  return { at, chatKey, code }
}

// 最近一次发送：成没成、时刻、会话必需，码与原因可以没有
function asSendRecord(value: unknown): SendRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.ok !== 'boolean') return undefined
  const at = asNumber(record.at)
  const chatKey = asText(record.chatKey)
  if (at === undefined || chatKey === undefined) return undefined
  if (!Array.isArray(record.failures)) return undefined
  const failures: SendFailure[] = []
  for (const item of record.failures) {
    const entry = asSendFailure(item)
    if (entry === undefined) return undefined
    failures.push(entry)
  }
  const code = asText(record.code)
  const reason = asText(record.reason)
  return {
    ok: record.ok,
    at,
    chatKey,
    ...code === undefined ? {} : { code },
    ...reason === undefined ? {} : { reason },
    failures,
  }
}

// 整份状态逐字段校验，对不上就当没记过
function parseSendState(text: string): SendState | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    // 半截的文件按没记过处理
    void error
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  if (record.version !== SEND_STATE_VERSION) return undefined
  if (record.last === undefined) return { version: SEND_STATE_VERSION }
  const last = asSendRecord(record.last)
  if (last === undefined) return undefined
  return { version: SEND_STATE_VERSION, last }
}

/**
 * 建一个发送状态读写口
 * @param options - 状态文件放在哪、留几条失败码
 * @returns 读写口
 */
export function createSendStateStore(options: SendStateStoreOptions): SendStateStore {
  const { file } = options
  const failureKeep = Math.max(1, Math.floor(options.failureKeep))
  let memory: SendState | undefined

  const readState = (): SendState | undefined => {
    if (file === undefined) return memory
    const text = readText(file)
    return text === undefined ? undefined : parseSendState(text)
  }

  return {
    read() {
      return readState()
    },
    record(outcome) {
      const previous = readState()?.last
      const failures = [...previous?.failures ?? []]
      const code = asText(outcome.code)
      if (!outcome.ok && code !== undefined) failures.push({ at: outcome.at, chatKey: outcome.chatKey, code })
      const reason = asSafeReason(outcome.reason)
      const state: SendState = {
        version: SEND_STATE_VERSION,
        last: {
          ok: outcome.ok,
          at: outcome.at,
          chatKey: outcome.chatKey,
          ...code === undefined ? {} : { code },
          ...reason === undefined ? {} : { reason },
          failures: failures.slice(Math.max(0, failures.length - failureKeep)),
        },
      }
      if (file === undefined) {
        memory = state
        return
      }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
    },
  }
}

// 这一条给模型看的一句话：发成了就什么都不说，没发成就说清原因
function sendStateBody(record: SendRecord): string {
  const code = record.code ?? 'channel.send_failed'
  const why = record.reason ?? code
  const repeats = record.failures.filter(item => item.code === code).length
  return [
    'STATE: send_failed',
    `CODE: ${code}`,
    `WHY: ${why}`,
    'NOTE: 你上一条想发的话没发出去',
    ...repeats > 1 ? [`REPEATED: ${repeats}`] : [],
    'RULE: do_not_resend_the_same_text; say_it_again_only_if_it_matters',
  ].join('\n')
}

/**
 * 把最近一次发送渲染成提示词里的那一段
 * @param record - 最近一次发送，没记过就给 undefined
 * @returns 要插进提示词的一整段；发成了或没记过时是空串
 */
export function sendStateLine(record: SendRecord | undefined): string {
  if (record === undefined || record.ok) return ''
  return `[SYSTEM_LOAD] QQ_SEND_STATE\n${sendStateBody(record)}`
}
