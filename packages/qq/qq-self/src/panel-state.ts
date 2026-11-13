// 只读出口的内容：只从目录、两档账与身体的展示读数算，用户原文、记忆正文与钥匙记录一律不读

import fs from 'node:fs'
import { weeklyReview } from './review.ts'
import type { SelfStore } from './store.ts'
import type { LimitsState } from './index.ts'
import type { LedgerSummary, PanelAsrStatus, PanelLive, PanelState, PanelVitals, SelfSettings } from './types.ts'

/** 面板能用的 QQ 只读查询 */
export interface QqPanelControl {
  relation(personId: string, chatKey: string): unknown
  timeline(traceId: string, limit: number): unknown
}

/** 本地面板的急停、模式和 QQ 设置控制 */
export interface PanelControl {
  state(): { active: boolean; at: number; reason: string }
  stop(reason: string): unknown
  resume(): unknown
  mode?: {
    state(): { mode: string; changedAt: number }
    options: readonly { value: string; label: string; description?: string }[]
    set(mode: string): unknown
  } | undefined
  personas?: {
    list(): readonly { id: string; name: string }[]
    activeId(): string
    setActive(id: string): unknown
    bind(chatKey: string, id: string): unknown
  } | undefined
  qq?: QqPanelControl | undefined
  limits?: {
    state(): LimitsState
    set(patch: Partial<LimitsState>): LimitsState
  } | undefined
}

/** 本地面板出口的参数 */
export interface PanelHttpOptions {
  port: number
  state(now: number): PanelState
  token?: string
  graph?: (pathname: string, search: URLSearchParams) => { type: string; body: string } | undefined
  control?: PanelControl
  warn(message: string): void
}

/** 这一条是不是面板设置里允许 POST 的路径 */
export function isPanelPostPath(path: string): boolean {
  return path === '/api/emergency-stop'
    || path === '/api/emergency-resume'
    || path === '/api/mode'
    || path === '/api/limits'
    || path === '/api/persona-active'
    || path === '/api/persona-bind'
}

/**
 * 处理角色、关系和时间线请求
 * @param path - 请求路径
 * @param url - 带参数的地址
 * @param control - 面板控制
 * @returns 状态码与正文，不归这里管时为空
 */
export function panelSettingsAnswer(
  path: string,
  url: URL,
  control: PanelControl | undefined,
): { status: number; body: string } | undefined {
  if (control?.personas !== undefined && path === '/api/persona-active') {
    const id = url.searchParams.get('value')?.trim() ?? ''
    try {
      control.personas.setActive(id)
      return { status: 200, body: `${JSON.stringify({ ok: true, activeId: id })}\n` }
    } catch {
      return { status: 400, body: '{"ok":false}\n' }
    }
  }
  if (control?.personas !== undefined && path === '/api/persona-bind') {
    const chatKey = url.searchParams.get('chatKey')?.trim() ?? ''
    const id = url.searchParams.get('value')?.trim() ?? ''
    try {
      if (chatKey === '') throw new Error('chat_required')
      control.personas.bind(chatKey, id)
      return { status: 200, body: `${JSON.stringify({ ok: true, chatKey, id })}\n` }
    } catch {
      return { status: 400, body: '{"ok":false}\n' }
    }
  }
  if (control?.qq !== undefined && path === '/api/relation') {
    const personId = url.searchParams.get('personId')?.trim() ?? ''
    return personId === ''
      ? { status: 400, body: '{"ok":false}\n' }
      : { status: 200, body: `${JSON.stringify(control.qq.relation(personId, url.searchParams.get('chatKey') ?? ''))}\n` }
  }
  if (control?.qq !== undefined && path === '/api/timeline') {
    const traceId = url.searchParams.get('traceId')?.trim() ?? ''
    if (traceId === '') return { status: 400, body: '{"ok":false}\n' }
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50) || 50))
    return { status: 200, body: `${JSON.stringify(control.qq.timeline(traceId, limit))}\n` }
  }
  return undefined
}

/** 算一份只读出口内容要用的东西 */
export interface PanelStateInput {
  /** 目录读写口 */
  store: SelfStore
  /** 参数表 */
  settings: SelfSettings
  /** 算汇总的时刻 */
  now: number
  /** 面板正文，还没生成时为空串 */
  panel: string
  /** 面板首行记的生成时间，还没生成时为空串 */
  generatedAt: string
  /** 两档账，由记录表自己算好递进来，两档从不相加 */
  ledger: LedgerSummary
  /** 画条要用的那几个数，没接上身体时不给 */
  vitals?: PanelVitals
  /** 时间线文件放在哪，给了才算出面板现场那一格 */
  timelineFile?: string
  /** 本机语音识别状态，不含路径、音频或凭据 */
  asr?: PanelAsrStatus
  /** DSH 与 QQ 运行身体的真实健康读数 */
  bodyHealth?: {
    score: number
    status: string
    checkedAt: number
    issues: readonly string[]
  }
}

// 现场那一格只读时间线末尾这么多字节，够看清最近几步，不整份读
const LIVE_TAIL_BYTES = 65_536

/** 主人私聊只显示称呼，不把账号带到面板 */
function visibleChatKey(chatKey: string): string {
  const owner = (process.env.QQ_CREATOR_ID ?? '').trim()
  return owner !== '' && chatKey === `private:${owner}` ? '主人私聊' : chatKey
}

// 一轮还开着的那些步骤
const LIVE_STEP_KINDS = new Set([
  'followup_queued', 'model_step', 'model_request', 'model_reply', 'tool_start', 'tool_result',
])

// 一轮已经收尾的那些步骤
const LIVE_END_KINDS = new Set([
  'turn_finished', 'turn_end', 'turn_idle', 'agent_cancelled', 'round_interrupted_by_message', 'emergency_stop',
])

// 叫醒被挡下的那些步骤
const LIVE_BLOCKED_KINDS = new Set([
  'wake_skipped', 'mode_skipped', 'rest_skipped', 'budget_stop', 'emergency_stop_skipped', 'followup_skipped',
])

// 叫醒被放行的那些步骤
const LIVE_OPENED_KINDS = new Set(['followup_request', 'autonomous_nudge', 'inbound_received'])

// 时间线末尾那几行；文件还没写过或读不到时给空串
function tailText(file: string, bytes: number): string {
  let handle: number | undefined
  try {
    handle = fs.openSync(file, 'r')
    const size = fs.fstatSync(handle).size
    const from = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(size - from)
    fs.readSync(handle, buffer, 0, buffer.length, from)
    const text = buffer.toString('utf8')
    // 从中间切进来时第一行只剩半句，整行不要
    return from === 0 ? text : text.slice(text.indexOf('\n') + 1)
  } catch {
    // 时间线还没写过或读不到，这一格就当没有
    return ''
  } finally {
    if (handle !== undefined) fs.closeSync(handle)
  }
}

/**
 * 从时间线末尾算出面板现场那一格
 * @param file - 时间线文件在哪
 * @param now - 这一份现场取自哪个时刻
 * @returns 正在写哪一条、刚收到什么、叫醒判断最近一次的结果；一行都没有时只带时刻
 */
export function panelLiveOf(file: string, now: number): PanelLive {
  const live: PanelLive = { at: now }
  const typing = new Map<string, { chatKey: string; since: number; step: number; lastAt: number }>()
  let inbound: PanelLive['inbound']
  let proactive: PanelLive['proactive']
  for (const line of tailText(file, LIVE_TAIL_BYTES).split('\n')) {
    if (line.trim() === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    if (raw === null || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const kind = typeof row.kind === 'string' ? row.kind : ''
    const at = typeof row.at === 'number' ? row.at : 0
    const chatKey = typeof row.chatKey === 'string' ? row.chatKey : ''
    const traceId = typeof row.traceId === 'string' ? row.traceId : ''
    if (kind === 'merge_flushed' || kind === 'inbound_received') {
      inbound = { chatKey: visibleChatKey(chatKey), at, count: typeof row.count === 'number' ? row.count : 1 }
      continue
    }
    if (LIVE_BLOCKED_KINDS.has(kind) || LIVE_OPENED_KINDS.has(kind)) {
      const reason = typeof row.reason === 'string' && row.reason !== ''
        ? row.reason
        : typeof row.mode === 'string' && row.mode !== '' ? row.mode : kind
      proactive = { blocked: LIVE_BLOCKED_KINDS.has(kind), reason, at }
      continue
    }
    if (traceId === '') continue
    if (LIVE_END_KINDS.has(kind)) {
      typing.delete(traceId)
      continue
    }
    if (!LIVE_STEP_KINDS.has(kind)) continue
    const step = typeof row.step === 'number' ? row.step : 0
    const kept = typing.get(traceId)
    typing.set(traceId, kept === undefined
      ? { chatKey: visibleChatKey(chatKey), since: at, step, lastAt: at }
      : { ...kept, step: Math.max(kept.step, step), lastAt: at })
  }
  const newest = [...typing.values()].sort((left, right) => right.lastAt - left.lastAt)[0]
  if (newest !== undefined) live.typing = { chatKey: newest.chatKey, since: newest.since, step: newest.step }
  if (inbound !== undefined) live.inbound = inbound
  if (proactive !== undefined) live.proactive = proactive
  return live
}

// 健康那一行：只把数得出来的事实摆成一句，永远只有一行
function healthLineOf(
  wrote: number,
  skipped: number,
  missing: number,
  errors: number,
  ledger: LedgerSummary,
  bodyHealth: PanelStateInput['bodyHealth'],
): string {
  const head = `健康：近七天写了 ${wrote} 天、跳过 ${skipped} 天、缺 ${missing} 天`
  const body = bodyHealth === undefined
    ? ''
    : `，身体 ${bodyHealth.score}% ${bodyHealth.status}${bodyHealth.issues.length === 0 ? '' : `，待处理 ${bodyHealth.issues.length} 项`}`
  return `${head}，错处 ${errors} 条，账本 drive ${ledger.drive} 条 / agency ${ledger.agency} 条${body}`
}

/**
 * 算一份只读出口的内容
 * @param input - 目录、参数、时刻、面板那两份已知值、身体的展示读数与时间线
 * @returns 面板、现场、身体读数、身份主张、两档账、近七天三行与健康一行
 */
export function panelStateOf(input: PanelStateInput): PanelState {
  const review = weeklyReview({ store: input.store, settings: input.settings, now: input.now, ledger: input.ledger })
  const wrote = review.days.filter(row => !row.skipped).length
  const identity = review.identity
  const live = input.timelineFile === undefined ? undefined : panelLiveOf(input.timelineFile, input.now)
  return {
    panel: { body: input.panel, generatedAt: input.generatedAt },
    ...live === undefined ? {} : { live },
    ...input.vitals === undefined ? {} : { vitals: input.vitals },
    ...input.asr === undefined ? {} : { asr: input.asr },
    ...identity === undefined ? {} : { identity: { claim: identity.claim, why: identity.why, at: identity.at } },
    ledger: review.ledger,
    days: review.days.map(row => ({ at: row.at, lines: row.lines, skipped: row.skipped })),
    health: healthLineOf(wrote, review.days.length - wrote, review.missingDays, review.errors.length, review.ledger, input.bodyHealth),
  }
}
