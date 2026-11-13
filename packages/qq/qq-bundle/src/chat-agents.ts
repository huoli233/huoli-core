// 每个群聊或私聊占一条 DSH 会话，同一个键只开一次

import type { ImageAttachmentRef } from '@huoli/huoli-attachment'
import type { Context } from '@huoli/cordis'
import type { Agent, AgentHandle, ModelSelection } from '@huoli/huoli-agent'
import { brandString } from '@huoli/huoli-brand'
import { createUserMessage, type ContentBlock, type ContextFormed, type MessageSource } from '@huoli/huoli-llm'
import type { SessionId } from '@huoli/huoli-session'
import type { ImageRuntime, ImageCapabilityLlmPort } from './image-runtime.ts'
import { routeImagesForModel } from './image-runtime.ts'
import type { RoundRuntime } from './rounds.ts'
import type { WorkQueue } from './runtime.ts'

declare module '@huoli/huoli-llm' {
  interface MessageSourceMap {
    'qq-recall': { kind: 'qq-recall' } & ContextFormed
  }
}

/** 会话创建与查找 */
export interface ChatAgentRuntime {
  /** 找到或开一条聊天会话 */
  agentFor(chatKey: string): Promise<Agent | undefined>
  /** 这组聊天会话是否已经收掉 */
  isClosed(): boolean
  /** 收掉这次运行开过的会话 */
  close(): void
  /** 取消所有正在跑的聊天轮次 */
  cancelAll(reason: string): void
  /** 取消一个聊天正在跑的轮次 */
  cancel(chatKey: string, reason: string): boolean
}

/** 建会话时要用的诊断出口 */
export interface ChatAgentOptions {
  /** 记一条不带正文的诊断 */
  noteWake(kind: string, chatKey: string, detail?: Record<string, unknown>): void
  /** 新会话第一次拿到时挂上这个聊天自己的工具与提示边界 */
  prepareAgent?(agent: Agent, chatKey: string): void
}

/** 把一条消息送进对应聊天的 DSH 会话 */
export interface ChatWakeOptions {
  agents: ChatAgentRuntime
  queue: WorkQueue
  rounds: RoundRuntime
  images: ImageRuntime
  llm: ImageCapabilityLlmPort | undefined
  /** 主模型看不了图时当场补看 */
  describe?: (image: ImageAttachmentRef, focus: string) => Promise<string>
  /** 单图主视觉模型失败时使用的备用视觉模型 */
  describeComplex?: (image: ImageAttachmentRef, focus: string) => Promise<string>
  /** 多张图片由同一个视觉请求按顺序理解 */
  describeSequence?: (images: readonly ImageAttachmentRef[], focus: string) => Promise<string>
  /** 多图主视觉模型失败时，仍用一次请求整组重试 */
  describeSequenceFallback?: (images: readonly ImageAttachmentRef[], focus: string) => Promise<string>
  visionProvider?: string
  visionModel?: string
  visionHighModel?: string
  /** 每轮最多处理的图片数量 */
  maxImages?: number
  /** 每轮最多处理的图片总字节数 */
  maxImageBytes?: number
  /** 配置了独立视觉模型时，优先由它识图 */
  preferConfiguredVision?: boolean
  hasViewer: boolean
  deepAfterReply: boolean
  isStopped(chatKey: string): string | undefined
  blockedBudget(chatKey: string): { ratio: number; metric: string } | undefined
  noteWake(kind: string, chatKey: string, detail?: Record<string, unknown>): void
  /** 在 followup 前绑定本次入站发送者，并返回结束回合时清理的函数 */
  bindSenders?(agent: Agent, chatKey: string, senderIds: readonly string[]): () => void
}

/** 建一个由同一聊天队列处理的唤醒入口 */
export function createChatWakeHandler(options: ChatWakeOptions): (
  chatKey: string,
  text: string,
  reason: string,
  media?: readonly ContentBlock[],
  traceIds?: readonly string[],
  recordedText?: string,
  source?: MessageSource,
  senderIds?: readonly string[],
) => boolean {
  return (
    chatKey,
    text,
    reason,
    media = [],
    traceIds = [],
    recordedText = text,
    source = { kind: 'user' },
    senderIds = [],
  ) => {
    if (options.agents.isClosed()) {
      options.noteWake('followup_skipped', chatKey, { reason: 'agents_closed' })
      return false
    }
    const stopped = options.isStopped(chatKey)
    if (stopped !== undefined) {
      options.noteWake('emergency_stop_skipped', chatKey, { reason: stopped })
      return false
    }
    const budget = options.blockedBudget(chatKey)
    if (budget !== undefined) {
      options.noteWake('budget_stop', chatKey, budget)
      return false
    }
    options.noteWake('followup_request', chatKey, { traceIds })
    const queued = options.queue.enqueue({
      key: chatKey,
      traceId: traceIds.at(-1) ?? '',
      async run() {
        const agent = await options.agents.agentFor(chatKey)
        if (agent === undefined || options.agents.isClosed()) {
          options.rounds.dropWake(chatKey, reason)
          options.images.discard(traceIds)
          options.noteWake('followup_skipped', chatKey, options.agents.isClosed() ? { reason: 'agents_closed' } : {})
          return
        }
        const releaseSenderBinding = options.bindSenders?.(agent, chatKey, senderIds)
        try {
          const imageCount = media.filter(item => item.type === 'image').length
          const imageRouteStartedAt = Date.now()
          if (imageCount > 0) options.noteWake('image_route_started', chatKey, { traceIds, imageCount })
          let routed: Awaited<ReturnType<typeof routeImagesForModel>>
          try {
            routed = await routeImagesForModel({
              attachments: media,
              model: agent.model,
              llm: options.llm,
              hasViewer: options.hasViewer,
              deepAfterReply: options.deepAfterReply,
              ...options.preferConfiguredVision === undefined ? {} : { preferConfiguredVision: options.preferConfiguredVision },
              ...options.maxImages === undefined ? {} : { maxImages: options.maxImages },
              ...options.maxImageBytes === undefined ? {} : { maxBytes: options.maxImageBytes },
              ...options.visionProvider === undefined ? {} : { visionProvider: options.visionProvider },
              ...options.visionModel === undefined ? {} : { visionModel: options.visionModel },
              ...options.visionHighModel === undefined ? {} : { visionHighModel: options.visionHighModel },
              ...options.describe === undefined ? {} : { describe: options.describe },
              ...options.describeComplex === undefined ? {} : { describeComplex: options.describeComplex },
              ...options.describeSequence === undefined ? {} : { describeSequence: options.describeSequence },
              ...options.describeSequenceFallback === undefined ? {} : { describeSequenceFallback: options.describeSequenceFallback },
            })
          } catch (error) {
            if (imageCount > 0) options.noteWake('image_route_finished', chatKey, {
              traceIds,
              imageCount,
              durationMs: Math.max(0, Date.now() - imageRouteStartedAt),
              outcome: 'failed',
            })
            throw error
          }
          if (imageCount > 0) options.noteWake('image_route_finished', chatKey, {
            traceIds,
            imageCount,
            routedImageCount: routed.attachments.filter(item => item.type === 'image').length,
            route: routed.route,
            ...routed.provider === undefined ? {} : { provider: routed.provider },
            ...routed.model === undefined ? {} : { model: routed.model },
            durationMs: Math.max(0, Date.now() - imageRouteStartedAt),
            outcome: 'ready',
          })
          if (options.agents.isClosed()) {
            options.rounds.dropWake(chatKey, reason)
            options.images.discard(traceIds)
            options.noteWake('followup_skipped', chatKey, { reason: 'agents_closed' })
            return
          }
          agent.followup(createUserMessage({
            content: [{ type: 'text', text: `${text}${routed.notice}` }, ...routed.attachments],
            source,
          }))
          options.noteWake('followup_queued', chatKey)
          await agent.whenIdle()
          options.noteWake('turn_idle', chatKey)
        } finally {
          releaseSenderBinding?.()
        }
      },
    })
    if (queued === 'started' || queued === 'queued') {
      options.rounds.addWake(chatKey, reason, traceIds)
      options.rounds.noteInput(chatKey, recordedText)
    } else {
      options.noteWake('followup_skipped', chatKey, { reason: queued === 'full' ? 'queue_full' : 'queue_closed' })
    }
    return queued === 'started' || queued === 'queued'
  }
}

/**
 * 建聊天会话管理器
 * @param ctx 运行环境
 * @param options 诊断出口
 * @returns 会话查找与关闭接口
 */
export function createChatAgents(ctx: Context, options: ChatAgentOptions): ChatAgentRuntime {
  const sessions = new Map<string, AgentHandle>()
  const opening = new Map<string, Promise<Agent | undefined>>()
  const known = new Map<string, Agent>()
  const prepared = new WeakSet<Agent>()
  let closed = false

  const disposeHandle = (handle: AgentHandle, chatKey: string): void => {
    void Promise.resolve().then(() => handle.dispose()).catch((error: unknown) => {
      options.noteWake('agent_dispose_failed', chatKey, { error: String(error) })
      ctx.logger('qq-bundle').warn('这个聊天的会话没收干净：%s', String(error))
    })
  }

  // 恢复老会话时会沿用会话里存的模型，把这一轮的默认模型对齐过去，换模型才真的生效
  const alignModel = (agent: Agent, chatKey: string): void => {
    const defaults = ctx.get('agentDefaultModel') as { currentSelection(): ModelSelection } | undefined
    const wanted = defaults?.currentSelection()
    if (wanted === undefined) return
    try {
      const current = agent.model.current()
      if (current !== undefined && current.provider === wanted.provider && current.model === wanted.model) return
      agent.model.select({
        provider: wanted.provider,
        model: wanted.model,
        ...wanted.reasoningEffort === undefined ? {} : { reasoningEffort: wanted.reasoningEffort },
      })
      options.noteWake('agent_model_aligned', chatKey, { from: current?.model ?? '', to: wanted.model })
    } catch (error) {
      options.noteWake('agent_model_align_failed', chatKey, { error: String(error) })
    }
  }

  const prepare = (agent: Agent, chatKey: string): boolean => {
    if (prepared.has(agent) || options.prepareAgent === undefined) return true
    try {
      options.prepareAgent(agent, chatKey)
      prepared.add(agent)
      return true
    } catch (error) {
      options.noteWake('agent_prepare_failed', chatKey, { error: String(error) })
      ctx.logger('qq-bundle').warn('这条聊天的工具边界没挂上：%s', String(error))
      return false
    }
  }

  const agentFor = async (chatKey: string): Promise<Agent | undefined> => {
    if (closed) {
      options.noteWake('agent_closed', chatKey)
      return undefined
    }
    const agentSink = ctx.get('agents')
    const sessionId = brandString<SessionId>(chatKey)
    const kept = sessions.get(chatKey)
    if (kept !== undefined) {
      known.set(chatKey, kept.agent)
      alignModel(kept.agent, chatKey)
      options.noteWake('agent_reused', chatKey)
      return kept.agent
    }
    const live = agentSink?.get(sessionId)
    if (live !== undefined) {
      known.set(chatKey, live)
      alignModel(live, chatKey)
      options.noteWake('agent_live', chatKey)
      return prepare(live, chatKey) ? live : undefined
    }
    const pending = opening.get(chatKey)
    if (pending !== undefined) {
      options.noteWake('agent_pending', chatKey)
      return pending
    }
    if (agentSink === undefined) {
      options.noteWake('agent_service_missing', chatKey)
      return undefined
    }
    options.noteWake('agent_create_start', chatKey)
    const defaults = ctx.get('agentDefaultModel') as { currentSelection(): ModelSelection } | undefined
    const selection = defaults?.currentSelection()
    const agentOptions = selection === undefined
      ? undefined
      : {
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
      }
    const open = agentSink.create({
      sessionId,
      ...agentOptions === undefined ? {} : { agentOptions },
    }).catch(async (error: unknown) => {
      if (!(error instanceof Error) || error.name !== 'SessionAlreadyExistsError') throw error
      if (closed) throw error
      options.noteWake('agent_resume_start', chatKey)
      return agentSink.resume({
        resumeSessionId: sessionId,
        ...agentOptions === undefined ? {} : { agentOptions },
      })
    })
    const creating = open
      .then((handle: AgentHandle) => {
        if (closed) {
          options.noteWake('agent_create_discarded', chatKey)
          disposeHandle(handle, chatKey)
          return undefined
        }
        sessions.set(chatKey, handle)
        known.set(chatKey, handle.agent)
        alignModel(handle.agent, chatKey)
        if (!prepare(handle.agent, chatKey)) {
          sessions.delete(chatKey)
          known.delete(chatKey)
          disposeHandle(handle, chatKey)
          return undefined
        }
        options.noteWake('agent_create_ready', chatKey)
        return handle.agent
      })
      .catch((error: unknown) => {
        if (closed) {
          options.noteWake('agent_create_discarded', chatKey)
          return undefined
        }
        options.noteWake('agent_create_failed', chatKey, { error: String(error) })
        ctx.logger('qq-bundle').warn('这个群的会话没开起来：%s', String(error))
        return undefined
      })
      .finally(() => {
        opening.delete(chatKey)
      })
    opening.set(chatKey, creating)
    return creating
  }

  return {
    agentFor,
    isClosed: () => closed,
    close() {
      if (closed) return
      closed = true
      for (const [chatKey, handle] of sessions) disposeHandle(handle, chatKey)
      sessions.clear()
      known.clear()
      opening.clear()
    },
    cancelAll(reason) {
      for (const agent of known.values()) agent.cancel({ kind: 'hook', reason })
    },
    cancel(chatKey, reason) {
      const agent = known.get(chatKey)
      if (agent === undefined) return false
      agent.cancel({ kind: 'hook', reason })
      options.noteWake('agent_cancelled', chatKey, { reason })
      return true
    },
  }
}
