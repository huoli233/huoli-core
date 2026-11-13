// 轮次结束后记录话头，并安排图片深看结果回流

import type { Context } from '@huoli/cordis'
import type { ContentBlock } from '@huoli/huoli-llm'
import type { QqChannelSeam, ReplyMind } from '@huoli/huoli-qq-channel'
import { finalTextOf, hasWords, isBareReply } from '@huoli/huoli-qq-channel'
import type { QqContinuitySeam } from '@huoli/huoli-qq-continuity'
import type { DecisionRecord } from './decisions.ts'
import { renderExternalMaterial, type ExternalMaterial } from './external-material.ts'
import type { RoundFacts } from './runtime.ts'

const PRIVATE_WORK_TOOLS = new Set([
  'web_search',
  'web_fetch',
  'bili_look',
  'bili_look_zoom',
  'bili_find',
  'bili_feed',
  'bili_comments',
  'bili_surf',
  'bili_inbox',
  'bili_interest',
  'bili_highlight',
  'qq_image_list',
  'qq_image_view',
  'qq_image_annotate',
  'read_image',
  'memory_query',
  'qq_memory_detail',
  'qq_memory_profile',
  'self_lesson',
  'self_evolve',
  'self_diary',
  'qq_generate_image',
  'qq_body_doctor',
  'create_goal',
  'update_goal',
  'get_goal',
  'todo_write',
  'job_output',
  'job_list',
  'job_kill',
  'schedule_create',
  'schedule_update',
  'schedule_list',
  'schedule_view',
  'schedule_edit',
])

/** 这个工具开始时，私聊应当先让对方知道已经接住了 */
export function isPrivateWorkTool(name: string): boolean {
  return PRIVATE_WORK_TOOLS.has(name)
}

/** 私聊交付要用到的通道、文案与诊断 */
export interface PrivateRoundDelivery {
  channel: QqChannelSeam | undefined
  privateWorkingAck?: string | undefined
  privateErrorFallbackText?: string | undefined
  timeline?: ((kind: string, chatKey: string, detail?: Record<string, unknown>) => void) | undefined
  warn(message: string, error: unknown): void
}

/** 搜索、看图、刷 B站或跑长任务时，先发一次可见的接手回复 */
export function sendPrivateWorkingAck(
  delivery: PrivateRoundDelivery,
  chatKey: string,
  round: RoundFacts,
): void {
  const { channel } = delivery
  if (channel === undefined
    || !chatKey.startsWith('private:')
    || round.workingAckSent
    || round.workingAckInFlight
    || round.finalSent
    || round.blocked !== null) return
  const text = finalTextOf(delivery.privateWorkingAck ?? '')
  if (text === '') return
  round.workingAckSent = true
  round.workingAckInFlight = true
  void channel.send(text, chatKey, true).then((sent) => {
    round.workingAckInFlight = false
    if (!sent.ok) return
    round.said = round.said === '' ? text : `${text}\n${round.said}`
    delivery.timeline?.('private_working_ack', chatKey, {
      ...round.traceIds.at(-1) === undefined ? {} : { traceId: round.traceIds.at(-1) },
    })
  }, () => {
    round.workingAckInFlight = false
  })
}

/** 私聊模型失败时补发说明；发送完成后再结算这一轮 */
export async function finishFailedPrivateRound(
  delivery: PrivateRoundDelivery,
  chatKey: string,
  round: RoundFacts,
  complete: () => void,
): Promise<void> {
  const { channel } = delivery
  const configured = delivery.privateErrorFallbackText
  const fallback = configured === undefined ? '' : finalTextOf(configured)
  if (channel === undefined || fallback === '') {
    complete()
    return
  }
  round.attempted = true
  try {
    const sent = await channel.send(fallback, chatKey, true)
    if (sent.ok) {
      round.said = round.said === '' ? fallback : `${round.said}\n${fallback}`
      round.finalSent = true
      delivery.timeline?.('private_model_error_fallback', chatKey, {
        ...round.traceIds.at(-1) === undefined ? {} : { traceId: round.traceIds.at(-1) },
        ...round.failureCode === null ? {} : { code: round.failureCode },
      })
    } else {
      round.blocked = {
        code: sent.code ?? 'outbound.blocked',
        retryAt: sent.retryAt ?? null,
        ...sent.hint === undefined ? {} : { hint: sent.hint },
      }
      delivery.timeline?.('private_model_error_fallback_failed', chatKey, {
        ...round.traceIds.at(-1) === undefined ? {} : { traceId: round.traceIds.at(-1) },
        ...round.failureCode === null ? {} : { code: round.failureCode },
        sendCode: sent.code ?? 'outbound.blocked',
      })
    }
  } catch (error) {
    round.blocked = { code: 'outbound.error', retryAt: null }
    delivery.timeline?.('private_model_error_fallback_failed', chatKey, {
      ...round.traceIds.at(-1) === undefined ? {} : { traceId: round.traceIds.at(-1) },
      ...round.failureCode === null ? {} : { code: round.failureCode },
      sendCode: 'outbound.error',
    })
    delivery.warn('私聊故障说明没发出去：%s', error)
  } finally {
    complete()
  }
}

/** 一轮完成后交给装配层的事实 */
export interface RoundFinishedEvent {
  chatKey: string
  reason: string | null
  sent: number
  traceIds: readonly string[]
  input: string
  draft: string
  said: string
  outcome: NonNullable<DecisionRecord['outcome']>
  mind?: ReplyMind
  closeNote?: ClosePlan
}

/** 模型明确留下的收尾信息 */
export interface ClosePlan {
  summary: string
  nextOpening: string
  throughSeq: number
}

/**
 * 会让人等着回一句的唤醒理由：戳一戳、撤回通知和两档重排都算。
 * 这些理由下模型写了正文却没调发送工具时，兜底链会真的发出去一条，不再静默丢掉。
 */
export const REPLY_WAKE_REASONS: readonly string[] = [
  'incoming',
  'private-retry',
  'group-retry',
  'poke',
  'recall',
  'link-fetch',
  'image-deep',
  'tool-background',
  'bili-share',
  'self-health',
  'proactive-body-request',
]

const FALLBACK_TRACES_KEEP = 256

interface ReplyFallbackOptions {
  ctx: Context
  channel: QqChannelSeam | undefined
  timeline?: ((kind: string, chatKey: string, detail?: Record<string, unknown>) => void) | undefined
  retryPrivate?: ((event: { chatKey: string; traceId: string; text: string; original: string }) => void) | undefined
  retryGroup?: ((event: { chatKey: string; traceId: string; text: string; original: string }) => void) | undefined
  privateFallbackText?: string | undefined
  /** 当前消息是不是必须回应 */
  requireReply?: ((chatKey: string) => boolean) | undefined
  roundOf(chatKey: string): RoundFacts | undefined
  inputOf(chatKey: string): string
  settle(chatKey: string): void
}

/**
 * 安装发送兜底与一次重排
 * @param options - 通道、轮次查找与结算入口
 */
export function installReplyFallback(options: ReplyFallbackOptions): void {
  const replyReasons = new Set(REPLY_WAKE_REASONS)
  const fallbackTraces = new Set<string>()
  const retriedPrivate = new Set<string>()
  const retriedGroup = new Set<string>()
  const awaitsReply = (chatKey: string, round: RoundFacts | undefined): round is RoundFacts =>
    round !== undefined
    && options.channel !== undefined
    && round.awake
    && round.reason !== null
    && replyReasons.has(round.reason)
    && !round.attempted
    && !round.finalSent
    && round.blocked === null
    && (!round.held || options.requireReply?.(chatKey) === true)
    && round.closeNote === null
  const sendFallback = async (chatKey: string, round: RoundFacts, text: string): Promise<void> => {
    const seam = options.channel
    const traceId = round.traceIds.at(-1) ?? ''
    if (seam === undefined || round.attempted) return
    if (traceId !== '') {
      if (fallbackTraces.has(traceId)) return
      fallbackTraces.add(traceId)
      if (fallbackTraces.size > FALLBACK_TRACES_KEEP) {
        const oldest = fallbackTraces.values().next().value
        if (oldest !== undefined) fallbackTraces.delete(oldest)
      }
    }
    round.attempted = true
    const sent = await seam.send(text, chatKey, true)
    if (sent.ok) {
      round.said = round.said === '' ? text : `${round.said}\n${text}`
      round.finalSent = true
      round.blocked = null
      options.timeline?.('reply_fallback_sent', chatKey, {
        ...traceId === '' ? {} : { traceId },
        ...round.reason === null ? {} : { reason: round.reason },
      })
      return
    }
    round.blocked = {
      code: sent.code ?? 'outbound.blocked',
      retryAt: sent.retryAt ?? null,
      ...sent.hint === undefined ? {} : { hint: sent.hint },
    }
  }
  const retryOnce = (chatKey: string, round: RoundFacts, text: string): boolean => {
    const traceId = round.traceIds.at(-1)
    const privateChat = chatKey.startsWith('private:')
    const retry = privateChat ? options.retryPrivate : options.retryGroup
    const seen = privateChat ? retriedPrivate : retriedGroup
    if (traceId === undefined || retry === undefined || seen.has(traceId)) return false
    seen.add(traceId)
    options.timeline?.(privateChat ? 'private_reply_retry' : 'group_reply_retry', chatKey, { traceId })
    retry({ chatKey, traceId, original: options.inputOf(chatKey), text })
    return true
  }
  const finishReply = async (chatKey: string): Promise<void> => {
    const round = options.roundOf(chatKey)
    const body = round === undefined ? '' : finalTextOf(round.draft)
    const original = options.inputOf(chatKey)
    if (awaitsReply(chatKey, round)) {
      const traceId = round.traceIds.at(-1)
      const trace = traceId === undefined ? {} : { traceId }
      const bare = hasWords(body) && isBareReply(body)
      if (hasWords(body) && !bare) {
        await sendFallback(chatKey, round, body)
      } else if (hasWords(round.draft)) {
        round.blocked = bare
          ? { code: 'bundle.reply_bare', retryAt: null, hint: '这一轮只写了空应声，没有说出具体的话' }
          : { code: 'bundle.reply_inner_only', retryAt: null, hint: '模型只写了内心旁白；正文应当再写一句真正发给对方的话' }
        options.timeline?.(bare ? 'reply_bare' : 'reply_inner_only', chatKey, trace)
        const asked = retryOnce(chatKey, round, bare
          ? `上一轮只写了“${body.slice(-500)}”这种空应声，而且没有调用发送工具。现在写一句具体反应，并调用 qq_send_message；mind 里留下 impulse、counter、choice 和这一轮的 affect。对方刚说：${original.slice(-300)}`
          : `上一轮你的回答只有括号旁白，没有真正发给对方。现在只写一句要发出去的正文，想法放进 mind，不要再写括号，也不要拒绝回话。对方刚说：${original.slice(-300)}`)
        if (!asked) {
          if (bare) await sendFallback(chatKey, round, body)
          else if (chatKey.startsWith('private:') && options.privateFallbackText !== undefined) {
            const fixed = finalTextOf(options.privateFallbackText)
            if (fixed !== '') await sendFallback(chatKey, round, fixed)
          }
        }
      } else {
        round.blocked = { code: 'bundle.reply_missing', retryAt: null, hint: '这一轮没有留下要发出去的话' }
        options.timeline?.('reply_missing', chatKey, trace)
        retryOnce(
          chatKey,
          round,
          `上一轮没有写出要发给对方的话。现在写一句真正发出去的话，并调用 qq_send_message；mind 里留下 impulse、counter、choice 和这一轮的 affect。对方刚说：${original.slice(-300)}`,
        )
      }
    }
    if (round !== undefined) round.outcome = 'completed'
    options.settle(chatKey)
  }
  options.ctx.on('agent/turn-stopping', ({ agent }) => finishReply(agent.id))
  // 图片深看等程序化跟进回合可能只发 turn/end，不经 turn-stopping；
  // 同一轮由 attempted/finalSent 或结算后的空 round 保证只处理一次。
  options.ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end' || event.data.reason.kind === 'error') return
    void finishReply(String(session.id))
  })
}

/** 处理一轮结束需要的能力 */
export interface RoundFinishOptions {
  continuity: QqContinuitySeam | undefined
  deepAfterTurn(chatKey: string, traceIds: readonly string[]): Promise<string | undefined>
  isStopped(chatKey: string): boolean
  wake(
    chatKey: string,
    text: string,
    reason: string,
    media?: readonly ContentBlock[],
    traceIds?: readonly string[],
    recordedText?: string,
  ): boolean
  warn(message: string, error: unknown): void
}

/** 把这一轮真实来往压成下次能接住的话头 */
export function conversationSummaryOf(input: string, said: string): string {
  const theySaid = finalTextOf(input).slice(-160)
  const iSaid = finalTextOf(said).slice(-100)
  return [
    theySaid === '' ? '' : `对方：${theySaid}`,
    iSaid === '' ? '' : `我：${iSaid}`,
  ].filter(part => part !== '').join('；')
}

/** 建一轮说完后的处理 */
export function createRoundFinishHandler(options: RoundFinishOptions): (event: RoundFinishedEvent) => void {
  return (event) => {
    if (options.continuity !== undefined
      && event.input !== ''
      && event.reason !== 'image-deep') {
      try {
        const summary = event.closeNote?.summary ?? conversationSummaryOf(event.input, event.said)
        options.continuity.close({
          chatKey: event.chatKey,
          summary: summary.slice(0, 240),
          nextOpening: event.closeNote?.nextOpening ?? event.mind?.next ?? '',
          ...event.closeNote?.throughSeq === undefined ? {} : { throughSeq: event.closeNote.throughSeq },
          ...event.mind?.choice === undefined || event.mind.choice === ''
            ? event.mind?.inner === undefined || event.mind.inner === '' ? {} : { thought: event.mind.inner }
            : { thought: event.mind.choice },
          origin: event.closeNote === undefined ? 'turn' : 'explicit',
        })
      } catch (error) {
        options.warn('后续话没记下来：%s', error)
      }
    }
    void options.deepAfterTurn(event.chatKey, event.traceIds).then((text) => {
      if (text !== undefined && !options.isStopped(event.chatKey)) {
        const material: ExternalMaterial = {
          source: '图片深看',
          title: '首轮回复后的画面事实',
          status: text.includes('没完成') ? 'failed' : 'ok',
          text,
          ...text.includes('没完成') ? { reason: '视觉模型没有完成部分图片的检查' } : {},
        }
        options.wake(event.chatKey, renderExternalMaterial(material), 'image-deep', [], event.traceIds, '')
      }
    })
  }
}
