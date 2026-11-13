// 入站运行层：去重、附件保存、链接读取和多句合并

import type { IncomingMessage } from '@huoli/huoli-qq-channel'
import type { TimelineRuntime } from './decisions.ts'
import {
  prepareIncomingMedia, type IncomingArchivePort, type MediaAttachmentPort, type PreparedImage,
} from './incoming-media.ts'
import type { VoiceTranscriptOutcome } from './asr.ts'
import type { VideoAnalysis } from './video-vision.ts'
import type { ImageProcessingResult } from './image-runtime.ts'
import type { MessageMerger } from './runtime.ts'
import { fetchLinkContext, linksIn, type LinkFetchPort } from './weblinks.ts'

/** 入站运行层要用到的参数 */
export interface IncomingRuntimeOptions {
  /** 同一会话最长保留多少条去重键 */
  seenMax: number
  /** 附件仓 */
  attachments: MediaAttachmentPort | undefined
  /** 项目图片目录，没接上就只留附件仓那一份 */
  archive?: IncomingArchivePort | undefined
  /** 网页读取服务 */
  web: LinkFetchPort | undefined
  /** 自动读取链接的范围 */
  linkFetch: 'off' | 'private' | 'all'
  /** 附件与链接预算 */
  mediaMaxBytes: number
  mediaTimeoutMs: number
  mediaMaxItems: number
  /** 语音转写；没接上就只存文件 */
  asr?: (data: Uint8Array, mediaType: string) => Promise<VoiceTranscriptOutcome>
  /** 视频本机抽帧与音轨识别 */
  analyzeVideo?: (data: Uint8Array, mediaType: string, message: IncomingMessage) => Promise<VideoAnalysis>
  /** 视频抽帧前先问体力、群聊限制与小时额度 */
  videoAccess?: (message: IncomingMessage) => { ok: boolean; code?: string; reason?: string }
  linkFetchMaxLinks: number
  linkFetchMaxChars: number
  linkFetchTimeoutMs: number
  /** 图片保存后决定马上看、缓存还是以后看 */
  onImages?: (images: readonly PreparedImage[], message: IncomingMessage) => Promise<ImageProcessingResult>
  /** 网页读完后交回原聊天的排队入口 */
  onLinkResult?: (message: IncomingMessage, text: string) => void
  /** 当前是否已经急停 */
  stopped(): boolean
  /** 多句合并出口 */
  merger: Pick<MessageMerger, 'push'>
  /** 写一条不带正文的诊断 */
  report(kind: string, chatKey: string, detail?: Record<string, unknown>): void
  /** 统一诊断时间线 */
  timeline?: Pick<TimelineRuntime, 'startTrace' | 'record'>
  /** 附件或链接管线异常 */
  warn(message: string): void
}

/** 入站运行层 */
export interface IncomingRuntime {
  /** 开始处理一条入站；自身消息和重复消息返回假 */
  begin(message: IncomingMessage): boolean
  /** 这条消息是不是第一次看到 */
  firstTime(message: IncomingMessage): boolean
  /** 排队处理附件与链接，再交给多句合并 */
  prepare(message: IncomingMessage, immediate: boolean): void
  /** 这个聊天是否还有附件正在准备 */
  busy(chatKey: string): boolean
  /** 原消息进入回复队列后，放行对应的网页结果 */
  releaseLinkResults(traceIds: readonly string[], accepted: boolean): void
  /** 停止接收并丢弃尚未完成的入站结果 */
  close(): void
}

/**
 * 群历史是否只更新现场而不进入模型
 * @param message - 收到的消息
 * @param wake - 配置是否允许历史唤醒
 * @returns 只观察时返回真
 */
export function historyObserveOnly(message: IncomingMessage, wake: boolean): boolean {
  return message.history === 'group' && !wake
}

/**
 * 群聊里把消息编号带进上下文，模型想引用回复时不用再翻历史
 * @param message - 收到的消息
 * @returns 带编号的字段，私聊或没编号时为空
 */
function quoteIdOf(message: IncomingMessage): { messageId?: string } {
  if (!message.chatKey.startsWith('group:')) return {}
  return message.messageId === '' ? {} : { messageId: message.messageId }
}

/**
 * 建入站运行层
 * @param options 去重、附件、网页与合并出口
 * @returns 入站处理接口
 */
export function createIncomingRuntime(options: IncomingRuntimeOptions): IncomingRuntime {
  const seen: string[] = []
  const seenKeys = new Set<string>()
  const incomingWork = new Map<string, Promise<void>>()
  const linkResults = new Map<string, { message: IncomingMessage; accepted?: boolean; text?: string }>()
  const runtime = { active: true }
  const isActive = (): boolean => runtime.active

  const deliverLinkResult = (traceId: string): void => {
    const result = linkResults.get(traceId)
    if (result?.accepted !== true || result.text === undefined) return
    linkResults.delete(traceId)
    options.onLinkResult?.(result.message, result.text)
  }

  const firstTime = (message: IncomingMessage): boolean => {
    if (message.messageId === '') return true
    const key = `${message.chatKey}:${message.messageId}`
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
    seen.push(key)
    if (seen.length > options.seenMax) {
      const oldest = seen.shift()
      if (oldest !== undefined) seenKeys.delete(oldest)
    }
    return true
  }

  const begin = (message: IncomingMessage): boolean => {
    if (!runtime.active) return false
    options.timeline?.startTrace(message.traceId, message.chatKey)
    options.timeline?.record('inbound_received', message.chatKey, {
      messageId: message.messageId,
      history: message.history,
    })
    if (message.selfSent) {
      options.timeline?.record('self_message_skipped', message.chatKey)
      return false
    }
    if (!firstTime(message)) {
      options.timeline?.record('duplicate_skipped', message.chatKey)
      return false
    }
    return true
  }

  const prepare = (message: IncomingMessage, immediate: boolean): void => {
    if (!runtime.active) return
    const containsImage = message.attachments.some(attachment => attachment.kind === 'image')
    const fetchLinks = options.linkFetch === 'all'
      || (options.linkFetch === 'private' && message.chatKey.startsWith('private:'))
    const hasLinks = fetchLinks && linksIn(message.text, 1).length > 0
    if (hasLinks && options.web !== undefined && options.onLinkResult !== undefined) {
      linkResults.set(message.traceId, { message })
      void (async () => {
        let text: string
        try {
          text = await fetchLinkContext(message.text, options.web, {
            maxLinks: options.linkFetchMaxLinks,
            maxChars: options.linkFetchMaxChars,
            timeoutMs: options.linkFetchTimeoutMs,
          })
        } catch (error) {
          options.report('link_fetch_failed', message.chatKey, { traceId: message.traceId })
          options.warn(`链接后台读取失败：${String(error)}`)
          text = '[DATA] LINK_FAILED\nSTATUS: background_read_failed'
        }
        if (!runtime.active || options.stopped() || text === '') {
          linkResults.delete(message.traceId)
          return
        }
        options.report('link_fetch_finished', message.chatKey, { traceId: message.traceId, chars: text.length })
        const result = linkResults.get(message.traceId)
        if (result !== undefined) {
          result.text = text
          deliverLinkResult(message.traceId)
        }
      })().catch((error: unknown) => {
        options.report('link_result_failed', message.chatKey, { traceId: message.traceId })
        options.warn(`链接结果没有排回原会话：${String(error)}`)
      })
    }
    if (message.attachments.length === 0) {
      options.merger.push(
        message.chatKey,
        {
          senderName: message.senderName,
          senderId: message.senderId,
          text: message.text,
          at: message.at,
          traceId: message.traceId,
          ...quoteIdOf(message),
        },
        immediate,
      )
      return
    }
    const queuedAt = Date.now()
    const wasQueued = incomingWork.has(message.chatKey)
    const previous = incomingWork.get(message.chatKey) ?? Promise.resolve()
    if (wasQueued) {
      options.timeline?.record('media_prepare_queued', message.chatKey, {
        traceId: message.traceId,
        attachmentCount: message.attachments.length,
      })
    }
    let startedAt: number | undefined
    const next = previous.then(async () => {
      if (!isActive() || options.stopped()) return
      startedAt = Date.now()
      const queueWaitMs = Math.max(0, startedAt - queuedAt)
      options.timeline?.record('media_prepare_started', message.chatKey, {
        traceId: message.traceId,
        ...(wasQueued ? { queueWaitMs } : {}),
        attachmentCount: message.attachments.length,
      })
      const videoCheck = message.attachments.some(attachment => attachment.kind === 'video')
        ? options.videoAccess?.(message)
        : undefined
      if (videoCheck?.ok === false) {
        options.timeline?.record('video_analysis_blocked', message.chatKey, {
          traceId: message.traceId,
          ...videoCheck.code === undefined ? {} : { code: videoCheck.code },
        })
      }
      const prepared = await prepareIncomingMedia(message.attachments, {
        attachments: options.attachments,
        ...options.archive === undefined ? {} : { archive: options.archive },
        hint: message.text,
        chatKey: message.chatKey,
        messageId: message.messageId,
        senderId: message.senderId,
        senderName: message.senderName,
        at: message.at,
        maxBytes: options.mediaMaxBytes,
        timeoutMs: options.mediaTimeoutMs,
        maxItems: options.mediaMaxItems,
        ...options.asr === undefined ? {} : { asr: options.asr },
        ...options.analyzeVideo === undefined || videoCheck?.ok === false ? {} : {
          analyzeVideo: (data, mediaType) => options.analyzeVideo?.(data, mediaType, message) ?? Promise.resolve({
            frames: [],
            frameFailure: '视频分析入口不可用',
          }),
        },
      })
      if (!isActive() || options.stopped()) return
      const imageResult = options.onImages === undefined || prepared.images.length === 0
        ? { notes: [], attachImages: true, excludedImageIds: [] }
        : await options.onImages(prepared.images, message)
      if (!isActive() || options.stopped()) return
      const excludedImageIds = new Set(imageResult.excludedImageIds ?? [])
      options.timeline?.record('media_prepare_finished', message.chatKey, {
        traceId: message.traceId,
        ...(wasQueued ? { queueWaitMs } : {}),
        durationMs: Math.max(0, Date.now() - startedAt),
        saved: prepared.saved,
        failed: prepared.failed,
        imageCount: prepared.images.length,
        excludedImageCount: excludedImageIds.size,
      })
      const text = [message.text, ...prepared.notes, ...imageResult.notes].filter(part => part.trim() !== '').join('\n')
      if (prepared.saved > 0) options.report('media_saved', message.chatKey, { saved: prepared.saved, failed: prepared.failed })
      else if (prepared.failed > 0) options.report('media_failed', message.chatKey, { failed: prepared.failed })
      options.merger.push(
        message.chatKey,
        {
          senderName: message.senderName,
          senderId: message.senderId,
          text,
          at: message.at,
          traceId: message.traceId,
          ...quoteIdOf(message),
          ...(containsImage ? { containsImage: true } : {}),
          attachments: prepared.content.filter(item => item.type !== 'image'
            || (imageResult.attachImages && !excludedImageIds.has(String(item.attachment.attachmentId)))),
        },
        immediate,
      )
    }).catch((error: unknown) => {
      if (!runtime.active) return
      options.timeline?.record('media_prepare_failed', message.chatKey, {
        traceId: message.traceId,
        ...(wasQueued ? { queueWaitMs: Math.max(0, (startedAt ?? Date.now()) - queuedAt) } : {}),
        durationMs: Math.max(0, Date.now() - (startedAt ?? queuedAt)),
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      options.report('media_failed', message.chatKey, { error: String(error) })
      options.warn(`附件或链接处理失败：${String(error)}`)
      options.merger.push(
        message.chatKey,
        {
          senderName: message.senderName,
          text: `${message.text}\n附件或链接处理失败`,
          at: message.at,
          traceId: message.traceId,
          ...quoteIdOf(message),
          ...(containsImage ? { containsImage: true } : {}),
        },
        true,
      )
    }).finally(() => {
      if (incomingWork.get(message.chatKey) === next) incomingWork.delete(message.chatKey)
    })
    incomingWork.set(message.chatKey, next)
  }

  return {
    begin,
    firstTime,
    prepare,
    busy(chatKey) {
      return incomingWork.has(chatKey)
    },
    releaseLinkResults(traceIds, accepted) {
      for (const traceId of traceIds) {
        const result = linkResults.get(traceId)
        if (result === undefined) continue
        if (!accepted) linkResults.delete(traceId)
        else {
          result.accepted = true
          deliverLinkResult(traceId)
        }
      }
    },
    close() {
      runtime.active = false
      incomingWork.clear()
      linkResults.clear()
    },
  }
}
