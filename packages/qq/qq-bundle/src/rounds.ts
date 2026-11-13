// 一轮回复从唤醒、步数、发送到收尾都在这里留下事实

import type { Context } from '@huoli/cordis'
import { createUserMessage, type TokenUsage } from '@huoli/huoli-llm'
import type { OutboundEvent, QqChannelSeam, ReplyMind } from '@huoli/huoli-qq-channel'
import { replyMindOf } from '@huoli/huoli-qq-channel'
import type { QqMemorySeam } from '@huoli/huoli-qq-memory'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import { WRAP_UP_LINE } from './body-tools.ts'
import type { DecisionLog } from './decisions.ts'
import { enqueueSaid, saidTextOf } from './memory-events.ts'
import {
  finishFailedPrivateRound,
  installReplyFallback,
  isPrivateWorkTool,
  sendPrivateWorkingAck,
  type PrivateRoundDelivery,
  type RoundFinishedEvent,
} from './round-finish.ts'
export { REPLY_WAKE_REASONS } from './round-finish.ts'
import { assistantTextOf, blankRound, failedToolOf, type RoundFacts, type WakeFact } from './runtime.ts'

const SAID_TOOLS = new Set([
  'qq_send_message',
  'qq_send_burst',
  'qq_send_messy',
  'qq_send_forward',
  'qq_reply',
  'qq_correct',
  'qq_publish_post',
  'qq_comment_post',
  'qq_send_sticker',
  'qq_send_voice',
  'qq_send_poke',
  'qq_send_reaction',
])
const SEND_RETRY_BLOCKED = new Set(['outbound.not_allowed', 'outbound.quiet', 'outbound.muted', 'outbound.rate'])
/**
 * 这些工具一调，这一轮要说的话就已经说完了（或明确决定不说）。
 * 下一步直接收尾，不再多请求一次模型——否则每次发送/安静都会多烧 25–35 秒。
 */
const TERMINAL_TOOLS = new Set([
  'qq_send_message',
  'qq_send_burst',
  'qq_send_messy',
  'qq_send_forward',
  'qq_send_highlight',
  'qq_send_card',
  'qq_send_voice',
  'qq_reply',
  'qq_correct',
  'qq_unsend',
  'qq_batch_unsend',
  'qq_stay_quiet',
  'qq_deliver_proactive',
  'close_conversation',
])

/** 轮次记录与唤醒理由 */
export interface RoundRuntime {
  /** 给下一轮记一个唤醒理由 */
  addWake(chatKey: string, reason: string, traceIds?: readonly string[]): void
  /** 开不了会话时把刚记下的理由撤回 */
  dropWake(chatKey: string, reason: string): void
  /** 这个聊天现在是不是被入站消息叫醒的 */
  awake(chatKey: string): boolean
  /** 当前轮对应的入站追踪号 */
  traceIdsOf(chatKey: string): readonly string[]
  /** 当前轮次是不是系统安排的自主时刻 */
  isAutonomousNudge(chatKey: string): boolean
  /** 新消息到达时标记旧轮次不再补发 */
  interrupt(chatKey: string, reason: string): boolean
  /** 立即结算一个聊天手上的轮次 */
  flush(chatKey: string): void
  /** 把发送尝试、成功和拦截记到当前轮次 */
  outbound(event: OutboundEvent): void
  /** 记下这一轮真正交给模型的原话 */
  noteInput(chatKey: string, text: string): void
  /** 卸载时结算全部轮次 */
  close(): void
}

/** 装配轮次记录要用的东西 */
export interface RoundRuntimeOptions {
  ctx: Context
  decisions: DecisionLog
  memory: QqMemorySeam | undefined
  channel: QqChannelSeam | undefined
  maxSteps: number
  /** 同一工具重复同一错误的次数上限 */
  maxRepeatedToolErrors?: number
  /** 这一轮收尾时按当轮身体给的情绪分，没接上身体时为空 */
  emotionalOf?: () => number | undefined
  /** 当前互动模式 */
  mode?: () => 'probability' | 'heartflow' | 'autonomous'
  /** 返回原因时拒绝这一轮模型步骤 */
  blocked?: (chatKey: string) => string | undefined
  /** 被点名、引用或私聊时，模型不能用安静收掉这一轮 */
  requireReply?: (chatKey: string) => boolean
  /** 写一条统一诊断 */
  timeline?: (kind: string, chatKey: string, detail?: Record<string, unknown>) => void
  /** 一轮真发出去以后交回可用的事实 */
  onFinished?: (event: RoundFinishedEvent) => void
  /** 这一轮留下了判读时，收尾前写回关系和身体 */
  onMind?: (mind: ReplyMind, chatKey: string, at: number) => void
  /** 模型确实留下复盘时，记一条事后想法 */
  onReflect?: (text: string, chatKey: string, at: number) => void
  /** 模型留下等待、打断或收回时，记一条可观察事实 */
  onPlan?: (plan: { waitMs: number; interrupt: string; cancel: string; settle: string }, chatKey: string, at: number) => void
  /** 每轮结算时清理没有进入回复流程的临时内容 */
  onSettled?: (event: RoundFinishedEvent, willFinish: boolean) => void
  /** 私聊只写了旁白时，把同一件事交回队列再要一次正文 */
  retryPrivate?: (event: {
    chatKey: string
    traceId: string
    text: string
    original: string
  }) => void
  /** 群聊只写了普通文本、漏掉发送工具时，交回同一会话再要一次 */
  retryGroup?: (event: {
    chatKey: string
    traceId: string
    text: string
    original: string
  }) => void
  /** 私聊重试仍只有旁白时，最后发出的真实短句 */
  privateFallbackText?: string
  /** 私聊开始调用工具时，先发一句可见的接手回复 */
  privateWorkingAck?: string
  /** 私聊模型请求失败时发出的简短说明 */
  privateErrorFallbackText?: string
}

/**
 * 建轮次记录并接上内核的三个时点
 * @param options 记录、记忆、通道与步数上限
 * @returns 唤醒理由与结算接口
 */
export function createRoundRuntime(options: RoundRuntimeOptions): RoundRuntime {
  const { ctx, decisions, memory, channel } = options
  const rounds = new Map<string, RoundFacts>()
  const wakes = new Map<string, WakeFact[]>()
  const inputs = new Map<string, string>()
  const pendingTools = new Map<string, { name: string; startedAt: number }>()
  const assistantAttempts = new Map<string, {
    chatKey: string
    traceId?: string
    startedAt: number
    provider: string | null
    model: string | null
    firstChunkMs?: number
    usage?: TokenUsage
  }>()
  const errorCounts = new Map<string, Map<string, number>>()
  const settlingFailures = new Map<string, Promise<void>>()
  const privateDelivery: PrivateRoundDelivery = {
    channel,
    privateWorkingAck: options.privateWorkingAck,
    privateErrorFallbackText: options.privateErrorFallbackText,
    timeline: options.timeline,
    warn: (message, error) => { ctx.logger('qq-bundle').warn(message, String(error)) },
  }

  if (typeof ctx.tools.guard === 'function') {
    ctx.effect(() => ctx.tools.guard((exec) => {
      const chatKey = String(exec.agent?.id ?? '')
      const round = rounds.get(chatKey)
      const code = round?.blocked?.code ?? ''
      if (round === undefined || !SAID_TOOLS.has(exec.name)
        || (!SEND_RETRY_BLOCKED.has(code) && !code.startsWith('channel.'))) return undefined
      const retryAt = round.blocked?.retryAt
      return `QQ_SEND_ALREADY_BLOCKED: ${code}; 这一轮不要再换发送工具重试${retryAt === null || retryAt === undefined ? '' : `，${new Date(retryAt).toLocaleTimeString('zh-CN', { hour12: false })} 之后再看`}; NEXT: read|stay_quiet|end_turn`
    }))
  }

  const flush = (chatKey: string): void => {
    const round = rounds.get(chatKey)
    if (round === undefined) return
    rounds.delete(chatKey)
    errorCounts.delete(chatKey)
    for (const key of pendingTools.keys()) {
      if (key.startsWith(`${chatKey}:`)) pendingTools.delete(key)
    }
    if (round.sent > 0) {
      const emotional = options.emotionalOf?.()
      enqueueSaid(ctx, memory, chatKey, {
        said: round.said,
        at: round.at,
        ...emotional === undefined || emotional <= 0 ? {} : { emotional },
      })
    }
    const input = inputs.get(chatKey) ?? ''
    inputs.delete(chatKey)
    const event: RoundFinishedEvent = {
      chatKey,
      reason: round.reason,
      sent: round.sent,
      traceIds: [...round.traceIds],
      input,
      draft: round.draft,
      said: round.said,
      outcome: round.outcome,
      ...round.mind === null ? {} : { mind: round.mind },
      ...round.closeNote === null ? {} : { closeNote: round.closeNote },
    }
    if (round.mind !== null) {
      try {
        options.onMind?.(round.mind, chatKey, Date.now())
      } catch (error) {
        ctx.logger('qq-bundle').warn('这一轮判断没写回：%s', String(error))
      }
    }
    if (round.mind?.reflect !== undefined && round.mind.reflect !== '') {
      try {
        options.onReflect?.(round.mind.reflect, chatKey, Date.now())
      } catch (error) {
        ctx.logger('qq-bundle').warn('这一轮复盘没记下：%s', String(error))
      }
    }
    if (round.mind !== null && (round.mind.waitMs > 0 || round.mind.interrupt !== '' || round.mind.cancel !== '' || round.mind.settle !== '')) {
      try {
        options.onPlan?.({
          waitMs: round.mind.waitMs,
          interrupt: round.mind.interrupt,
          cancel: round.mind.cancel,
          settle: round.mind.settle,
        }, chatKey, Date.now())
      } catch (error) {
        ctx.logger('qq-bundle').warn('这一轮动作没记下：%s', String(error))
      }
    }
    const willFinish = (round.sent > 0 || round.closeNote !== null || round.held) && round.outcome === 'completed'
    try {
      const {
        at, awake, reason, attempted, sent, blocked, steps, wrapped, held,
        lastTool, outcome, failureCode, provider, model, requestAt,
      } = round
      decisions.append({
        kind: 'round',
        at,
        chatKey,
        awake,
        reason,
        attempted,
        sent,
        blocked,
        steps,
        wrapped,
        held,
        lastTool,
        ...options.mode === undefined ? {} : { mode: options.mode() },
        outcome,
        ...failureCode === null ? {} : { failureCode },
        ...provider === null ? {} : { provider },
        ...model === null ? {} : { model },
        ...requestAt === null ? {} : { requestAt },
        ...round.traceIds.length === 0 ? {} : { traceIds: [...round.traceIds] },
      })
      options.timeline?.('turn_finished', chatKey, {
        outcome,
        attempted,
        sent,
        ...round.traceIds.at(-1) === undefined ? {} : { traceId: round.traceIds.at(-1) },
        ...blocked === null ? {} : { code: blocked.code },
      })
    } catch (error) {
      ctx.logger('qq-bundle').warn('轮次记录写不进去：%s', String(error))
    }
    try {
      options.onSettled?.(event, willFinish)
      if (willFinish) options.onFinished?.(event)
    } catch (error) {
      ctx.logger('qq-bundle').warn('轮次收尾没做完：%s', String(error))
    }
  }

  const roundOf = (chatKey: string, at: number): RoundFacts => {
    const kept = rounds.get(chatKey) ?? blankRound(at, chatKey, null)
    rounds.set(chatKey, kept)
    return kept
  }

  const openRound = (chatKey: string, at: number): void => {
    const reasons = wakes.get(chatKey)
    const reason = reasons?.shift() ?? null
    if (reasons?.length === 0) wakes.delete(chatKey)
    rounds.set(chatKey, blankRound(at, chatKey, reason))
  }

  const maxSteps = Math.max(1, options.maxSteps)
  const wrapUpAt = maxSteps - Math.min(BUNDLE_DEFAULTS.wrapUpSteps, Math.max(1, Math.floor(maxSteps / 2)))
  ctx.on('agent/pre-step', async (payload, next) => {
    const chatKey = payload.agent.id
    await settlingFailures.get(chatKey)
    const blocked = options.blocked?.(chatKey)
    if (blocked !== undefined) {
      openRound(chatKey, Date.now())
      const round = roundOf(chatKey, Date.now())
      round.blocked = { code: 'bundle.emergency_stop', retryAt: null, hint: blocked }
      options.timeline?.('model_blocked', chatKey, {
        code: round.blocked.code,
        ...round.traceIds.at(-1) === undefined ? {} : { traceId: round.traceIds.at(-1) },
      })
      flush(chatKey)
      return { kind: 'reject' as const }
    }
    if (roundOf(chatKey, Date.now()).blocked?.code === 'bundle.repeated_tool_error') {
      flush(chatKey)
      return { kind: 'reject' as const }
    }
    if (payload.step === 1) openRound(chatKey, Date.now())
    const round = roundOf(chatKey, Date.now())
    round.steps = payload.step
    // 上一步已经说完/决定安静：不再请求模型，直接收尾
    if (round.stopped) {
      round.outcome = 'completed'
      flush(chatKey)
      return { kind: 'reject' as const }
    }
    options.timeline?.('model_step', chatKey, {
      step: payload.step,
      ...round.traceIds.at(-1) === undefined ? {} : { traceId: round.traceIds.at(-1) },
    })
    if (payload.step === wrapUpAt) {
      round.wrapped = true
      const nudge = createUserMessage({ content: [{ type: 'text', text: WRAP_UP_LINE }], source: { kind: 'user' } })
      return { kind: 'enter' as const, messages: [...payload.messages, nudge] }
    }
    if (payload.step <= maxSteps) return next()
    round.blocked = { code: 'bundle.step_cap', retryAt: null, hint: '这一轮已经走到步数上限，下一轮再说' }
    flush(chatKey)
    return { kind: 'reject' as const }
  })

  ctx.on('session/event', (session, event) => {
    const round = rounds.get(String(session.id))
    if (round === undefined) return
    const traceId = round.traceIds.at(-1)
    const trace = traceId === undefined ? {} : { traceId }
    if (event.type === 'turn/end') {
      const reason = event.data.reason
      round.outcome = reason.kind
      if (reason.kind === 'error') round.failureCode = reason.error.code
      options.timeline?.('turn_end', String(session.id), {
        ...trace,
        outcome: reason.kind,
        ...reason.kind === 'error' ? { code: reason.error.code } : {},
      })
      // 正常完成先交给 turn-stopping 或本轮兜底结算。图片深看等程序化回合
      // 可能只发 turn/end，提前 flush 会把模型刚写的正文一起抹掉。
      if (reason.kind !== 'error') return
      const chatKey = String(session.id)
      if (
        round.awake
        && (round.reason === 'incoming' || round.reason === 'private-retry')
        && chatKey.startsWith('private:')
        && !round.finalSent
        && round.blocked === null
        && options.privateErrorFallbackText !== undefined
        && !settlingFailures.has(chatKey)
      ) {
        const settling = Promise.resolve().then(() => finishFailedPrivateRound(
          privateDelivery,
          chatKey,
          round,
          () => {
            settlingFailures.delete(chatKey)
            flush(chatKey)
          },
        ))
        settlingFailures.set(chatKey, settling)
        return
      }
      flush(chatKey)
      return
    }
    if (event.type === 'request/header') {
      round.provider = event.data.header.config.provider
      round.model = event.data.header.config.model
      round.requestAt ??= event.time
      options.timeline?.('model_request', String(session.id), {
        ...trace,
        provider: round.provider,
        model: round.model,
      })
      return
    }
    if (event.type === 'tool/result') {
      const sessionId = String(session.id)
      const callId = String(event.data.message.toolCallId)
      const pending = pendingTools.get(`${sessionId}:${callId}`)
      pendingTools.delete(`${sessionId}:${callId}`)
      if (pending !== undefined) {
        const failed = failedToolOf(event.data)
        if (!failed && SAID_TOOLS.has(pending.name)) round.finalSent = true
        options.timeline?.('tool_finished', sessionId, {
          ...trace,
          tool: pending.name,
          callId,
          durationMs: Math.max(0, event.time - pending.startedAt),
          outcome: failed === undefined ? 'completed' : 'failed',
        })
      }
      const failed = failedToolOf(event.data)
      if (failed === undefined) return
      const tool = pending?.name ?? round.lastTool
      const fingerprint = `${tool}:${failed.error}`
      const counts = errorCounts.get(sessionId) ?? new Map<string, number>()
      const count = (counts.get(fingerprint) ?? 0) + 1
      counts.set(fingerprint, count)
      errorCounts.set(sessionId, counts)
      if (count >= Math.max(1, options.maxRepeatedToolErrors ?? 3)) {
        round.blocked = {
          code: 'bundle.repeated_tool_error',
          retryAt: null,
          hint: `${tool} 带着同一个错误重复了 ${count} 次，这一轮先停`,
        }
      }
      options.timeline?.('tool_result', sessionId, {
        ...trace,
        tool,
        callId: failed.callId,
        code: errorCodeOf(failed.error) ?? 'tool.failure',
        failed: true,
      })
      return
    }
    if (event.type === 'assistant/message') {
      const text = assistantTextOf(event.data)
      if (text !== '') round.draft = text
      options.timeline?.('model_reply', String(session.id), { ...trace, hasText: text !== '' })
      return
    }
    if (event.type !== 'tool/call') return
    round.lastTool = event.data.name
    if (isPrivateWorkTool(event.data.name)) sendPrivateWorkingAck(privateDelivery, String(session.id), round)
    pendingTools.set(`${String(session.id)}:${String(event.data.callId)}`, { name: event.data.name, startedAt: event.time })
    options.timeline?.('tool_start', String(session.id), {
      ...trace,
      tool: event.data.name,
      callId: event.data.callId,
    })
    let args: Record<string, unknown> | null = null
    try {
      const parsed: unknown = JSON.parse(event.data.arguments)
      if (parsed !== null && typeof parsed === 'object') args = parsed as Record<string, unknown>
    } catch {
      // 参数坏了由工具自己拒绝，这里不留假记录
    }
    if (args !== null) {
      const mind = replyMindOf(args.mind)
      if (mind !== undefined) round.mind = mind
    }
    if (event.data.name === 'close_conversation' && args !== null) {
      round.closeNote = {
        summary: typeof args.summary === 'string' ? args.summary : '',
        nextOpening: typeof args.nextOpening === 'string' ? args.nextOpening : '',
        throughSeq: typeof args.throughSeq === 'number' && Number.isInteger(args.throughSeq) ? args.throughSeq : 0,
      }
    }
    if (event.data.name === 'qq_stay_quiet') round.held = true
    // 说完就收尾：发送、撤回、安静、投递都是完整动作，不需要再让模型补一句
    if (TERMINAL_TOOLS.has(event.data.name)) round.stopped = true
    if (!SAID_TOOLS.has(event.data.name)) return
    const said = saidTextOf(event.data.arguments, event.data.name)
    if (said !== '') round.said = round.said === '' ? said : `${round.said}\n${said}`
  })

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    const chatKey = String(agent.id)
    const round = rounds.get(chatKey)
    if (round === undefined) return
    const attemptId = String(frame.attemptId)
    if (frame.type === 'start') {
      const traceId = round.traceIds.at(-1)
      const attempt = {
        chatKey,
        ...(traceId === undefined ? {} : { traceId }),
        startedAt: Date.now(),
        provider: round.provider,
        model: round.model,
      }
      assistantAttempts.set(attemptId, attempt)
      options.timeline?.('model_call_started', chatKey, {
        ...attempt.traceId === undefined ? {} : { traceId: attempt.traceId },
        ...attempt.provider === null ? {} : { provider: attempt.provider },
        ...attempt.model === null ? {} : { model: attempt.model },
        step: frame.step,
      })
      return
    }
    const attempt = assistantAttempts.get(attemptId)
    if (attempt === undefined) return
    if (frame.type === 'chunk') {
      if (attempt.firstChunkMs === undefined) {
        attempt.firstChunkMs = Math.max(0, frame.time - attempt.startedAt)
      }
      if (frame.chunk.type === 'usage') attempt.usage = frame.chunk.usage
      return
    }
    assistantAttempts.delete(attemptId)
    const usage = attempt.usage
    options.timeline?.('model_call_finished', chatKey, {
      ...attempt.traceId === undefined ? {} : { traceId: attempt.traceId },
      ...attempt.provider === null ? {} : { provider: attempt.provider },
      ...attempt.model === null ? {} : { model: attempt.model },
      durationMs: Math.max(0, Date.now() - attempt.startedAt),
      ...attempt.firstChunkMs === undefined ? {} : { firstChunkMs: attempt.firstChunkMs },
      ...usage === undefined ? {} : {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens },
        ...usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens },
        ...usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens },
        ...usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens },
      },
      outcome: frame.outcome.kind,
      ...frame.outcome.kind === 'committed' ? { eventType: frame.outcome.eventType } : {},
    })
  })

  const tickQueue = (): void => {
    try {
      memory?.tick(Date.now())
    } catch (error) {
      ctx.logger('qq-bundle').warn('队列节拍没走完：%s', String(error))
    }
  }

  installReplyFallback({
    ctx,
    channel,
    timeline: options.timeline,
    retryPrivate: options.retryPrivate,
    retryGroup: options.retryGroup,
    privateFallbackText: options.privateFallbackText,
    requireReply: options.requireReply,
    roundOf: chatKey => rounds.get(chatKey),
    inputOf: chatKey => inputs.get(chatKey) ?? '',
    settle: (chatKey) => {
      flush(chatKey)
      tickQueue()
    },
  })

  return {
    addWake(chatKey, reason, traceIds = []) {
      const reasons = wakes.get(chatKey) ?? []
      reasons.push({ reason, traceIds: [...traceIds] })
      wakes.set(chatKey, reasons)
    },
    dropWake(chatKey, reason) {
      const reasons = wakes.get(chatKey)
      const at = reasons?.findLastIndex(item => item.reason === reason) ?? -1
      if (at < 0) return
      reasons?.splice(at, 1)
      if (reasons?.length === 0) wakes.delete(chatKey)
    },
    awake(chatKey) {
      return rounds.get(chatKey)?.awake === true
    },
    traceIdsOf(chatKey) {
      return [...(rounds.get(chatKey)?.traceIds ?? [])]
    },
    isAutonomousNudge(chatKey) {
      const reason = rounds.get(chatKey)?.reason
      return reason === 'autonomous-nudge' || reason === 'bili-share'
    },
    interrupt(chatKey, reason) {
      const round = rounds.get(chatKey)
      if (round === undefined || round.blocked?.code === 'bundle.interrupted_by_message') return false
      round.blocked = {
        code: 'bundle.interrupted_by_message',
        retryAt: null,
        hint: reason,
      }
      options.timeline?.('round_interrupted_by_message', chatKey, {
        ...round.traceIds.at(-1) === undefined ? {} : { traceId: round.traceIds.at(-1) },
        sent: round.sent,
      })
      return true
    },
    flush,
    outbound(event) {
      const round = rounds.get(event.chatKey)
      if (round === undefined) return
      const firstSend = event.kind === 'sent' && event.count > 0 && round.sent === 0
      const firstSentAt = event.firstSentAt ?? event.at
      options.timeline?.(`outbound_${event.kind}`, event.chatKey, {
        ...round.traceIds.at(-1) === undefined ? {} : { traceId: round.traceIds.at(-1) },
        count: event.count,
        ...(firstSend ? {
          firstSendAt: firstSentAt,
          ...round.requestAt === null ? {} : { modelToFirstSendMs: Math.max(0, firstSentAt - round.requestAt) },
        } : {}),
        ...event.code === undefined ? {} : { code: event.code },
        ...event.retryAt === undefined ? {} : { retryAt: event.retryAt },
      })
      if (event.kind === 'attempt' && !round.workingAckInFlight) round.attempted = true
      else if (event.kind === 'sent') round.sent += event.count
      else if (event.kind === 'blocked' && !round.workingAckInFlight && round.blocked === null) {
        round.blocked = { code: event.code ?? 'outbound.blocked', retryAt: event.retryAt ?? null }
      }
    },
    noteInput(chatKey, text) {
      if (text.trim() !== '') inputs.set(chatKey, text.trim())
    },
    close() {
      for (const chatKey of [...rounds.keys()]) flush(chatKey)
      inputs.clear()
      assistantAttempts.clear()
    },
  }
}

function errorCodeOf(error: string): string | undefined {
  const head = error.split('｜', 1)[0]?.trim() ?? ''
  const match = /^([a-z][a-z0-9_.-]*):/iu.exec(head)
  return match?.[1]
}
