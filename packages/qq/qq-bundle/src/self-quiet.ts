// 自己声明安静：跨群与私聊都生效，到期自动恢复，只有明确唤醒才提前结束

import fs from 'node:fs'
import path from 'node:path'

/** 安静状态 */
export interface SelfQuietState {
  active: boolean
  since: number
  until: number
  reason: string
  chatKey: string
  directedPings: number
}

/** 安静控制口 */
export interface SelfQuiet {
  state(at?: number): SelfQuietState
  remainingMs(at?: number): number
  /** 开始安静，时长钳在配置范围内；返回实际状态 */
  quiet(minutes: number, reason: string, chatKey: string, at?: number): SelfQuietState
  /** 明确唤醒时才提前结束 */
  resume(at?: number): SelfQuietState
  /** 定向消息记一笔，只做诊断 */
  noteDirected(at?: number): void
  /** 提示词里给模型看的事实 */
  facts(at?: number): string
}

/** 安静配置 */
export interface SelfQuietOptions {
  file: string
  minMinutes: number
  maxMinutes: number
  note?: (event: string, detail: Record<string, unknown>) => void
}

const RUNNING: SelfQuietState = { active: false, since: 0, until: 0, reason: '', chatKey: '', directedPings: 0 }

// 明确唤醒：只在说话人直接要求恢复时才算，转述与引号里的不算
const WAKE_UP = /(可以说话了|可以开口了|回来吧|别闭嘴了|不用安静了|取消安静|结束安静|解除安静|出来吧|醒醒|别潜水了|不用潜水了)/u
//  quoted / 转述：引号里提到唤醒词不算数
const QUOTED = /[「“"'‘]([^」”"'’]*)[」”"'’]/gu

/** 判断一句原话是不是明确要求恢复说话 */
export function isQuietWakeUp(text: string, directed: boolean): boolean {
  if (!directed) return false
  const body = text.replace(QUOTED, '')
  return WAKE_UP.test(body) && !/(别人|他说|她说|转述|比如|假如|要是|如果)/u.test(body)
}

function readState(file: string, at: number): SelfQuietState {
  let state: SelfQuietState = RUNNING
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed !== null && typeof parsed === 'object') {
      const row = parsed as Record<string, unknown>
      state = {
        active: row.active === true,
        since: typeof row.since === 'number' ? row.since : 0,
        until: typeof row.until === 'number' ? row.until : 0,
        reason: typeof row.reason === 'string' ? row.reason : '',
        chatKey: typeof row.chatKey === 'string' ? row.chatKey : '',
        directedPings: typeof row.directedPings === 'number' ? row.directedPings : 0,
      }
    }
  } catch {
    return RUNNING
  }
  // 到期就当没在安静，不删文件，重启后也不会误判
  return state.active && state.until > at ? state : RUNNING
}

function writeState(file: string, state: SelfQuietState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建一个文件落盘的安静状态
 * @param options 文件、时长范围与诊断口
 * @returns 安静控制口
 */
export function createSelfQuiet(options: SelfQuietOptions): SelfQuiet {
  const { file } = options
  const minMinutes = Math.max(1, Math.floor(options.minMinutes))
  const maxMinutes = Math.max(minMinutes, Math.floor(options.maxMinutes))
  return {
    state(at = Date.now()) {
      return readState(file, at)
    },
    remainingMs(at = Date.now()) {
      const state = readState(file, at)
      return state.active ? Math.max(0, state.until - at) : 0
    },
    quiet(minutes, reason, chatKey, at = Date.now()) {
      const wanted = Number.isFinite(minutes) ? Math.floor(minutes) : minMinutes
      const clamped = Math.min(maxMinutes, Math.max(minMinutes, wanted))
      const state: SelfQuietState = {
        active: true,
        since: at,
        until: at + clamped * 60_000,
        reason: reason.trim().slice(0, 120),
        chatKey,
        directedPings: 0,
      }
      writeState(file, state)
      options.note?.('self_quiet_start', { until: state.until, minutes: clamped, chatKey })
      return state
    },
    resume(at = Date.now()) {
      const previous = readState(file, at)
      writeState(file, RUNNING)
      options.note?.('self_quiet_resume', { at, chatKey: previous.chatKey, early: previous.until > at })
      return RUNNING
    },
    noteDirected(at = Date.now()) {
      const state = readState(file, at)
      if (!state.active) return
      writeState(file, { ...state, directedPings: state.directedPings + 1 })
    },
    facts(at = Date.now()) {
      const state = readState(file, at)
      if (!state.active) return ''
      const left = Math.max(1, Math.round((state.until - at) / 60_000))
      return [
        '[SYSTEM_LOAD] QQ_SELF_QUIET',
        'STATE: quiet',
        `LEFT_MINUTES: ${left}`,
        `UNTIL: ${new Date(state.until).toLocaleString('zh-CN', { hour12: false })}`,
        `REASON: ${state.reason || '有人让我安静'}`,
        'RULE: do_not_send_any_message; do_not_call_any_send_tool; only_explicit_wake_up_resumes',
        'WAKE_UP: 被直接要求「可以说话了/回来吧/取消安静」时才调 qq_resume_speaking',
      ].join('\n')
    },
  }
}
