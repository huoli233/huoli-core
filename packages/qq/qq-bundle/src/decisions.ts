// 每轮的决策痕迹：事后能回答“为什么没说”，只留事实与理由码

import fs from 'node:fs'
import path from 'node:path'

/** 被哪条闸门拦下 */
export interface DecisionBlock {
  code: string
  retryAt: number | null
}

/** 一轮的记录，只有事实与理由码，没有模型原文与用户原文 */
export interface DecisionRecord {
  /** 这一轮开始的时刻 */
  at: number
  /** 哪个会话 */
  chatKey: string
  /** 这一轮是不是被唤醒的 */
  awake: boolean
  /** 唤醒理由码，没有就是空 */
  reason: string | null
  /** 模型有没有调发送工具 */
  attempted: boolean
  /** 真的发出去几条 */
  sent: number
  /** 被哪条闸门拦下、给了什么下次时间 */
  blocked: DecisionBlock | null
}

/** 建记录要用的东西 */
export interface DecisionLogOptions {
  /** 一行一条的文件放哪 */
  file: string
}

/** 轮次记录 */
export interface DecisionLog {
  append(record: DecisionRecord): void
  read(sinceAt: number, limit: number): DecisionRecord[]
}

// 读不到当没有
function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '')
  } catch {
    return ''
  }
}

// 先写同目录临时文件再改名，失败不留半截
function writeAtomically(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, text, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

// 拦下那一段解回来，码不在就整行不认
function blockOf(raw: unknown): DecisionBlock | null {
  if (raw === null || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const code = row.code
  if (typeof code !== 'string' || code === '') return null
  const retry = row.retryAt
  const retryAt = typeof retry === 'number' && Number.isFinite(retry) ? retry : null
  return { code, retryAt }
}

// 一行解回一条记录，字段不对就整行丢掉
function parseLine(line: string): DecisionRecord | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const at = row.at
  const chatKey = row.chatKey
  const reason = row.reason
  const sent = Number(row.sent)
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  if (typeof chatKey !== 'string') return null
  let blocked: DecisionBlock | null = null
  if (row.blocked !== null && row.blocked !== undefined) {
    blocked = blockOf(row.blocked)
    if (blocked === null) return null
  }
  return {
    at,
    chatKey,
    awake: row.awake === true,
    reason: typeof reason === 'string' ? reason : null,
    attempted: row.attempted === true,
    sent: Number.isFinite(sent) ? sent : 0,
    blocked,
  }
}

/**
 * 建一个轮次记录
 * @param options - 文件位置
 * @returns 记录接口
 */
export function createDecisionLog(options: DecisionLogOptions): DecisionLog {
  const file = options.file
  return {
    append(record) {
      const previous = readText(file)
      const head = previous === '' || previous.endsWith('\n') ? previous : `${previous}\n`
      writeAtomically(file, `${head}${JSON.stringify(record)}\n`)
    },
    read(sinceAt, limit) {
      if (limit <= 0) return []
      const kept: DecisionRecord[] = []
      for (const line of readText(file).split('\n')) {
        if (line.trim() === '') continue
        const record = parseLine(line)
        if (record === null || record.at < sinceAt) continue
        kept.push(record)
      }
      return kept.slice(-limit)
    },
  }
}
