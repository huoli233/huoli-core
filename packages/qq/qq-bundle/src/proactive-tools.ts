// 主动开口的两个出口：攒着的候选摆给模型看，投递也由模型点名

import type { Context } from '@huoli/cordis'
import type { QqAttentionSeam } from '@huoli/huoli-qq-attention'
import { defineTool } from '@huoli/huoli-tools'
import { localDay } from '@huoli/huoli-qq-memory'
import type { Candidate, QqProactiveSeam } from '@huoli/huoli-qq-proactive'
import type { VitalsState } from '@huoli/huoli-qq-vitals'
import type { AssembleContext } from '@huoli/huoli-system-prompt'
import { shouldAutonomousNudge, type AutonomousNudgeInput } from './runtime.ts'

/** 摆给模型看的一条候选 */
export interface PendingLine {
  id: string
  why: string
  text: string
  source: string
  kind: string
  postWant?: number
  confidence?: number
  value?: number
  risk?: number
}

/** 没人说话时给模型的一次自主机会：只摆现场事实，说不说、说什么、说几句全由模型自己定 */
export const AUTONOMOUS_NUDGE_LINE = '[SYSTEM_LOAD] QQ_AUTONOMOUS_MOMENT\nCONTEXT: no_new_user_command; nobody_waiting\nCHECK: recent_chat|body_state|memory|relationships|your_own_past_words|pending_candidates|idle_time|bili_share\nEXAMPLES: small_grumble_about_a_real_state_or_event|share_one_thing_you_really_saw|pick_up_a_live_thread|stay_quiet\nACTION: speak_via_QQ_SEND_or_QQ_SEND_CARD or stay_quiet_with_QQ_STAY_QUIET\nRULE: facts_are_facts_only; you_decide_whether_to_speak_what_to_say_how_many_and_when_to_stop; no_code_veto; no_sampling; quiet_is_a_choice_not_a_requirement; do_not_read_these_facts_aloud'

/** 自主时刻要看的现场与这一刻；全是事实，没有一条是「该不该说」的判定 */
export interface AutonomousNudgeRequest extends AutonomousNudgeInput {
  at: number
  /** 这一小时已经主动说过几次，只作为事实 */
  proactiveThisHour?: number
  /** 面板允许的每会话每小时主动发送上限，只作为事实 */
  proactivePerHour?: number
}

/** 主动开口的每小时计数：面板上的「每小时最多主动说」要真能挡住 */
/** 只把自主时刻确实发出的正文记进主动开口次数 */
export function noteAutonomousSend(
  event: { chatKey: string; reason: string | null; sent: number },
  proactive: Pick<QqProactiveSeam, 'timing'> | undefined,
  alreadyCounted: number,
  warn: (error: unknown) => void,
): void {
  if (event.reason !== 'autonomous-nudge' || event.sent <= alreadyCounted) return
  try {
    proactive?.timing.noteSpoken(event.chatKey)
  } catch (error) {
    warn(error)
  }
}

/** 记下本轮已经由候选发送计入的次数 */
export function countProactiveDelivery(deliveries: Map<string, number>, chatKey: string): void {
  deliveries.set(chatKey, (deliveries.get(chatKey) ?? 0) + 1)
}

/**
 * 建一个按间隔放行的自主时刻
 * @param options 间隔、诊断与唤醒出口
 * @returns 一次判断；真放行时已经排好唤醒
 */
export function createAutonomousNudger(options: {
  intervalMs: number
  note(kind: string, chatKey: string, detail?: Record<string, unknown>): void
  wake(
    chatKey: string,
    text: string,
    reason: string,
    media?: readonly unknown[],
    traceIds?: readonly string[],
    recordedText?: string,
  ): boolean
}): (request: AutonomousNudgeRequest) => boolean {
  const last = new Map<string, number>()
  return (request) => {
    if (!shouldAutonomousNudge(request)) return false
    // 轮询间隔只决定多久看一次候选；没有具体由头就不凭空叫醒模型巡场
    if (request.at - (last.get(request.chatKey) ?? 0) < options.intervalMs) return false
    if (!options.wake(request.chatKey, `${AUTONOMOUS_NUDGE_LINE}${selfMomentLine(request)}`, 'autonomous-nudge')) return false
    last.set(request.chatKey, request.at)
    options.note('autonomous_nudge', request.chatKey, { hasCandidate: request.hasCandidate })
    return true
  }
}

/**
 * 按固定间隔重新检查已知会话；计时器只触发检查，不绕过主动开口关卡。
 * @param options - 检查间隔、处理函数与错误记录
 * @returns 注册会话与关闭计时器的接口
 */
export function createProactiveTicker(options: {
  intervalMs: number
  tick(chatKey: string): void
  warn(error: unknown): void
}): { add(chatKey: string): void; close(): void } {
  const chats = new Set<string>()
  const timer = setInterval(() => {
    for (const chatKey of chats) {
      try {
        options.tick(chatKey)
      } catch (error) {
        options.warn(error)
      }
    }
  }, Math.max(1, options.intervalMs))
  timer.unref()
  return {
    add(chatKey) {
      if (chatKey !== '') chats.add(chatKey)
    },
    close() {
      clearInterval(timer)
      chats.clear()
    },
  }
}

/** 自主时刻只摆现场事实，包括自己刚说过几句、有没有人在聊、有没有攒住的由头；判断全归模型 */
export function selfMomentLine(request: AutonomousNudgeRequest): string {
  const lines: string[] = []
  if (request.internalMotive !== undefined && request.internalMotive !== '') lines.push(`INTERNAL_MOTIVE: ${request.internalMotive}`)
  if (request.activity !== undefined && request.activity !== '') lines.push(`ACTIVITY: ${request.activity}`)
  if (request.focus !== undefined && request.focus !== '') lines.push(`FOCUS: ${request.focus}`)
  if (request.humanActive !== undefined) lines.push(`PEOPLE_TALKING_RECENTLY: ${request.humanActive ? 'yes' : 'no'}`)
  if (request.selfTalkStreak !== undefined) lines.push(`YOUR_OWN_CONSECUTIVE_LINES: ${request.selfTalkStreak}`)
  if (request.proactiveThisHour !== undefined) lines.push(`PROACTIVE_LINES_THIS_HOUR: ${request.proactiveThisHour}`)
  if (request.proactivePerHour !== undefined) lines.push(`PROACTIVE_LINES_ALLOWED_THIS_HOUR: ${request.proactivePerHour}`)
  lines.push(`PENDING_CANDIDATES: ${request.hasCandidate ? 'yes' : 'no'}`)
  lines.push(`WAITING_FOR_A_REASON: ${request.waitingForReason ? 'yes' : 'no'}`)
  if (request.resting === true) lines.push('BODY_FEELS_LIKE_RESTING: yes')
  lines.push('RULE: all_above_are_observable_facts; you_decide_whether_to_speak_whether_to_repeat_yourself_and_whether_to_let_an_old_thing_go; do_not_read_these_facts_aloud')
  return lines.length === 0 ? '' : `\n[DATA] AUTONOMOUS_CONTEXT\n${lines.join('\n')}`
}

/** 投递回来的结论，只把这几个字段给模型 */
export interface DeliverReply {
  ok: boolean
  code?: string
  reason?: string
  hint?: string
  pendingBody?: string
}

/** 装配层要交给这一层的三件事 */
export interface ProactivePorts {
  /** 当前活跃会话是哪一个 */
  activeChatKey(context: AssembleContext): string
  /** 这个会话攒着还没投的候选 */
  pending(chatKey: string): readonly PendingLine[]
  /** 按编号投一条，正文可由模型改写 */
  deliver(chatKey: string, id: string, body?: string): Promise<DeliverReply>
  /** 候选没有正文时，请模型在同一会话写出并重新投这一条 */
  requestBody(chatKey: string, line: PendingLine): boolean
}

/**
 * 收件箱里最近有没有别人说话
 * @param attention - 注意力状态
 * @param windowMs - 往前看多久
 * @param chatKey - 哪个聊天
 * @param at - 从什么时候往前算
 * @returns 有别人说话就是真
 */
export function humanActiveOf(
  attention: QqAttentionSeam | undefined,
  windowMs: number,
  chatKey: string,
  at: number,
): boolean {
  if (attention === undefined) return false
  return attention.inbox.recent(chatKey, 40).some(message =>
    message.senderId !== '' && at - message.at >= 0 && at - message.at < windowMs)
}

/**
 * 想发动态的劲够高时攒一条没有正文的候选
 * @param input - 聊天、时刻、身体读数、阈值和今天已经攒过几条
 * @returns 够高时返回候选
 */
export function postWantCandidateOf(input: {
  chatKey: string
  at: number
  body: VitalsState
  min: number
  dailyMax: number
  gathered: number
}): Candidate | undefined {
  if (!(input.body.post_want > input.min) || input.gathered >= input.dailyMax) return undefined
  return {
    id: `post-want:${localDay(input.at)}`,
    kind: 'share',
    why: `想发一条动态的劲压不住了，眼下${input.body.emotion_level}`,
    text: '',
    postWant: input.body.post_want,
    source: 'post_want',
    at: input.at,
  }
}

/**
 * 按一组固定规则判断要不要攒动态候选
 * @param min - 读数阈值
 * @param dailyMax - 一天最多几条
 * @param gathered - 这个会话当天已攒几条
 * @returns 按会话和身体读数取候选
 */
export function postWantRule(
  min: number,
  dailyMax: number,
  gathered: (chatKey: string, at: number) => number,
): (chatKey: string, at: number, body: VitalsState) => Candidate | undefined {
  return (chatKey, at, body) => postWantCandidateOf({
    chatKey,
    at,
    body,
    min,
    dailyMax,
    gathered: gathered(chatKey, at),
  })
}

/** 主动候选段的收口配置 */
export interface PendingSectionLimits {
  /** 最多摆几条候选 */
  maxLines: number
  /** 整段最多多少字 */
  maxChars: number
  /** 理由一字不差地重复时只留一条 */
  dedupeByWhy: boolean
}

/** 候选段的默认收口：别让攒下来的旧候选把提示词撑大 */
export const PENDING_SECTION_DEFAULTS: PendingSectionLimits = {
  maxLines: 3,
  maxChars: 600,
  dedupeByWhy: true,
}

/**
 * 没有候选时这段整段不出现，别让模型对着空表空转
 * @param ports - 候选来源
 * @param chatKey - 当前会话
 * @param limits - 条数、字数与去重口径，不给就用默认
 * @returns 提示词那一段，没候选时是空串
 */
export function pendingSection(ports: ProactivePorts, chatKey: string, limits: PendingSectionLimits = PENDING_SECTION_DEFAULTS): string {
  const all = chatKey === '' ? [] : ports.pending(chatKey)
  if (all.length === 0) return ''
  const maxLines = Math.max(1, Math.floor(limits.maxLines))
  const maxChars = Math.max(80, Math.floor(limits.maxChars))
  const seen = new Set<string>()
  const kept: PendingLine[] = []
  for (const line of all) {
    if (limits.dedupeByWhy) {
      const key = line.why.trim()
      if (seen.has(key)) continue
      seen.add(key)
    }
    kept.push(line)
    if (kept.length >= maxLines) break
  }
  const head = '[DATA] PROACTIVE_PENDING\nRULE: candidates_are_options_only; do_not_force_send_to_clear\nOLD_THOUGHTS: source=thought_only_pick_with_current_hook\nUSE: pick_one_only_if_you_can_say_it_as_your_own_short_line; small_grumble_and_recent_bili_find_are_valid_hooks; rewrite_the_wording; skipping_all_of_them_is_fine'
  let body = ''
  for (const line of kept) {
    const row = [
      `- ${line.id}｜${line.why}｜${line.text === '' ? 'body_not_written' : line.text}`,
      `FACTS: kind=${line.kind}; source=${line.source}`,
      ...line.postWant === undefined ? [] : [`post_want=${line.postWant}`],
      ...line.confidence === undefined ? [] : [`confidence=${line.confidence}`],
      ...line.value === undefined ? [] : [`value=${line.value}`],
      ...line.risk === undefined ? [] : [`risk=${line.risk}`],
    ].join('\n')
    if (head.length + body.length + row.length + 1 > maxChars) break
    body += body === '' ? row : `\n${row}`
  }
  return `${head}\n${body}`
}

/** 取一段非空正文，空串按没给算 */
function bodyOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 把发送那一路的拒绝原样转成投递的拒绝，缺的字段不补默认值
 * @param result - 发送那一路的结果
 * @param fallbackHint - 它自己没给下一步时用哪句
 * @returns 投递的拒绝
 */
export function refusalOf(
  result: { code?: string; reason?: string; hint?: string },
  fallbackHint: string,
): { ok: false; code?: string; reason?: string; hint: string } {
  return {
    ok: false,
    ...result.code === undefined ? {} : { code: result.code },
    ...result.reason === undefined ? {} : { reason: result.reason },
    hint: result.hint ?? fallbackHint,
  }
}

/**
 * 挂上主动开口的投递工具
 * @param ctx - 运行环境
 * @param ports - 候选来源与投递出口
 * @returns 撤下函数
 */
export function registerProactiveTools(ctx: Context, ports: ProactivePorts): () => void {
  // 测试用的最小上下文没有工具服务，这时只记一行，不让整条装配塌掉
  const tools = ctx.get('tools')
  if (tools === undefined) {
    ctx.logger('qq-bundle').warn('工具服务没装上，主动开口的投递工具不注册')
    return () => {}
  }
  return tools.register(defineTool({
    name: 'qq_deliver_proactive',
    description: '把攒着的某一条由头投出去：先摆给你看过才能投，正文可以自己改写。没有正文时会叫醒同一会话写出正文再投。不发就别调这个工具。',
    parameters: {
      id: { type: 'string', description: '候选编号，就是提示词里那一行的第一段。' },
      body: { type: 'string', description: '改写后的正文，不填就用攒着的那句。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec): Promise<Record<string, string | boolean>> {
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      const chatKey = ports.activeChatKey(exec.agent === undefined ? {} : { agent: exec.agent })
      if (id === '') return { ok: false, code: 'bundle.no_id', reason: '没说是哪一条由头', hint: '把提示词里那一行的编号抄过来' }
      if (chatKey === '') return { ok: false, code: 'bundle.no_chat', reason: '现在没有活跃会话', hint: '等这个群里有人说话再投' }
      const result = await ports.deliver(chatKey, id, bodyOf(args.body))
      if (result.ok) {
        return {
          ok: true,
          ...result.code === undefined ? {} : { code: result.code },
          ...result.reason === undefined ? {} : { reason: result.reason },
          ...result.hint === undefined ? {} : { hint: result.hint },
          ...result.pendingBody === undefined ? {} : { pendingBody: result.pendingBody },
        }
      }
      const line = ports.pending(chatKey).find(item => item.id === id)
      if (result.code !== 'bundle.no_body' || line === undefined || !ports.requestBody(chatKey, line)) {
        return {
          ok: false,
          ...result.code === undefined ? {} : { code: result.code },
          ...result.reason === undefined ? {} : { reason: result.reason },
          ...result.hint === undefined ? {} : { hint: result.hint },
          ...result.pendingBody === undefined ? {} : { pendingBody: result.pendingBody },
        }
      }
      return {
        ok: true,
        pendingBody: '这一条还没有正文，已经叫醒同一会话写出正文再投',
      }
    },
  }))
}
