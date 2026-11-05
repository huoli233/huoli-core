// 每轮的决策痕迹：事后能回答“为什么没说”，只留事实与理由码

import fs from 'node:fs'
import path from 'node:path'

/** 被哪条关卡拦下 */
export interface DecisionBlock {
  code: string
  retryAt: number | null
  /** 这一条被拦下之后该做什么，排查时照着看 */
  hint?: string
}

/** 一轮的记录，只有事实与理由码，没有模型原文与用户原文 */
export interface DecisionRecord {
  /** 这一行是什么：跑完的一轮，还是主动开口的一次考虑 */
  kind?: 'round' | 'considered'
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
  /** 被哪条关卡拦下、给了什么下次时间 */
  blocked: DecisionBlock | null
  /** 这一轮走到第几步，排查空转用 */
  steps?: number
  /** 有没有给过收尾提醒 */
  wrapped?: boolean
  /** 最后调的是哪个工具，没调过就是空 */
  lastTool?: string
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
    // 决策日志读不到就当没有：它是排查线，不该把主流程拖住
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
    // 坏行跳过：一条写坏了不该让整份日志都读不出来
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
  const record: DecisionRecord = {
    at,
    chatKey,
    awake: row.awake === true,
    reason: typeof reason === 'string' ? reason : null,
    attempted: row.attempted === true,
    sent: Number.isFinite(sent) ? sent : 0,
    blocked,
  }
  // 老记录里没有这几栏，读回来也不凭空补，免得旧日志看起来像新的
  if (row.kind === 'round' || row.kind === 'considered') record.kind = row.kind
  const steps = Number(row.steps)
  if (row.steps !== undefined && Number.isFinite(steps)) record.steps = steps
  if (row.wrapped === true) record.wrapped = true
  if (typeof row.lastTool === 'string' && row.lastTool !== '') record.lastTool = row.lastTool
  return record
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

/** 一次主动开口考虑的结论 */
export interface Verdict {
  /** 攒成了没有 */
  ok: boolean
  /** 没攒成时的结果码 */
  code?: string
  /** 下次什么时候再看 */
  retryAt?: number | null
  /** 下一步该做什么 */
  hint?: string
}

// 结果码进记录时写成 proactive:<原因>，点只留在代码里
function reasonOf(code: string): string {
  const cut = code.indexOf('.')
  return `proactive:${cut < 0 ? code : code.slice(cut + 1)}`
}

/**
 * 每考虑一次落一条：攒到、拦下、没攒到都落
 * @param log - 决策记录
 * @param warn - 写不进去时往哪报
 * @param chatKey - 哪个会话
 * @param at - 什么时候
 * @param verdict - 这一次的结论
 */
export function appendConsidered(
  log: DecisionLog,
  warn: { warn: (message: string, ...rest: unknown[]) => void },
  chatKey: string,
  at: number,
  verdict: Verdict,
): void {
  const code = verdict.code ?? 'proactive.no_candidate'
  // 被拦下时把码、下次时刻与下一步一起记进这一条，排查照着看
  const blocked = verdict.ok
    ? null
    : { code, retryAt: verdict.retryAt ?? null, ...verdict.hint === undefined ? {} : { hint: verdict.hint } }
  try {
    log.append({ kind: 'considered', at, chatKey, awake: false, reason: reasonOf(code), attempted: false, sent: 0, blocked })
  } catch (error) {
    warn.warn('主动开口的记录写不进去：%s', String(error))
  }
}
