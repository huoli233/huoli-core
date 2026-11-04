// 动态状态：正文只留指纹，不落原文；写盘先写临时文件再改名，读坏按备份与默认值回退

import fs from 'node:fs'
import path from 'node:path'

/** 状态文件的版本，结构改动才递增 */
export const POST_STATE_VERSION = 1

/** 一条发过的正文的指纹 */
export interface PostFingerprint {
  /** 正文的摘要，正文本身不落盘 */
  sha: string
  /** 发出去的时刻 */
  at: number
}

/** 盘上那份状态 */
export interface PostState {
  /** 版本戳 */
  version: number
  /** 当天计数从哪个零点算起 */
  dayStart: number
  /** 当天发了几条 */
  dayCount: number
  /** 上一次发出的时刻，零表示还没发过 */
  lastPostedAt: number
  /** 发过的正文指纹，新的在后 */
  fingerprints: readonly PostFingerprint[]
}

/**
 * 什么都没读出来时的状态
 * @param dayStart - 当天从哪个零点算起
 * @returns 一份空状态
 */
export function emptyPostState(dayStart: number): PostState {
  return { version: POST_STATE_VERSION, dayStart, dayCount: 0, lastPostedAt: 0, fingerprints: [] }
}

/** 状态在哪、怎么读写 */
export interface PostStore {
  /** 读回上一次的状态，读不出时为 undefined */
  read(): PostState | undefined
  /** 盖写一份状态，先留备份 */
  write(state: PostState): void
}

/** 状态文件的位置 */
export interface PostStoreOptions {
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

// 原子写：先写同目录的临时文件，再改名顶上
function writeAtomic(file: string, text: string): void {
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

// 一条指纹：摘要非空、时刻有限，缺一样整份当没读过
function asFingerprint(value: unknown): PostFingerprint | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const sha = record.sha
  const at = asNumber(record.at)
  if (typeof sha !== 'string' || sha === '' || at === undefined) return undefined
  return { sha, at }
}

// 逐字段校验，结构对不上就当这一份没读过，交给下一级回退
function parseState(text: string): PostState | undefined {
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
  if (record.version !== POST_STATE_VERSION) return undefined
  const dayStart = asNumber(record.dayStart)
  const dayCount = asNumber(record.dayCount)
  const lastPostedAt = asNumber(record.lastPostedAt)
  if (dayStart === undefined || dayCount === undefined || lastPostedAt === undefined) return undefined
  if (!Array.isArray(record.fingerprints)) return undefined
  const fingerprints: PostFingerprint[] = []
  for (const item of record.fingerprints) {
    const entry = asFingerprint(item)
    if (entry === undefined) return undefined
    fingerprints.push(entry)
  }
  return { version: POST_STATE_VERSION, dayStart, dayCount, lastPostedAt, fingerprints }
}

/**
 * 建一个状态读写口
 * @param options - 状态文件放在哪
 * @returns 读写口
 */
export function createPostStore(options: PostStoreOptions): PostStore {
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
