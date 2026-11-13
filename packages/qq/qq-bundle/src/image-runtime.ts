// 图片运行层：存哈希、估兴趣、先快速看，必要时等首轮回复后深入看

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import type { ContentBlock } from '@huoli/huoli-llm'
import type { IncomingMessage } from '@huoli/huoli-qq-channel'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import type { ImageAttachmentRef } from '@huoli/huoli-attachment'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import type { AssetCategory } from './asset-store.ts'
import { createImageArchive, imageKindLabel, type ImageArchive, type ImageKind, type ImageRecord } from './image-archive.ts'
import type { PreparedImage } from './incoming-media.ts'
import { isImageContentBlock, registerImageTools, selectVisionImages, visionBatchByteLimit, visionBatchLimit, type ImageViewer } from './image-tools.ts'
import type { Config } from './types.ts'
import { createVisionDescriber, createVisionSequenceDescriber, visionModelCandidates, type VisionLlmPort } from './vision.ts'
import { registerSelfImageTool, selfImageOptions } from './self-image.ts'
import type { MediaBudget } from './media-budget.ts'

/** 图片运行层参数 */
export interface ImageRuntimeOptions {
  archive: ImageArchive
  viewer: ImageViewer | undefined
  sequenceViewer?: (images: readonly ImageAttachmentRef[], options?: { focus?: string }) => Promise<string>
  maxImages?: number
  quickWeightFrom: number
  deepWeightFrom: number
  ignorePhrases?: readonly string[]
  deepAfterReply: boolean
  recentPromptMax: number
  halfLifeHours: number
  note?: (kind: string, chatKey: string, detail?: Record<string, unknown>) => void
  mediaBudget?: MediaBudget
}
interface DeepPlan {
  traceId: string
  imageId: string
  image: PreparedImage['image']
  question: string
  kind: ImageKind
}
type ImageDecisionStatus = 'ignored' | 'sticker' | 'cached' | 'quick' | 'deep'
/** 当前聊天模型的图片输入能力 */
export interface ImageCapabilityLlmPort extends VisionLlmPort {
  resolveModelInfo(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<{ inputModalities?: readonly string[] }>
}
/** 只读取当前模型选择的一部分能力 */
export interface ImageModelPort {
  current?: () => { provider: string; model: string } | undefined
}

/** 把附件分给主模型时要知道的当前条件 */
export interface ImageRoutingOptions {
  attachments: readonly ContentBlock[]
  model: ImageModelPort | undefined
  llm: ImageCapabilityLlmPort | undefined
  /** 主模型看不了图时，用视觉模型当场看一张；传的是已存档的图片引用 */
  describe?: (image: ImageAttachmentRef, focus: string) => Promise<string>
  /** 多图按顺序进入视觉模型时使用的高能力路由 */
  describeComplex?: (image: ImageAttachmentRef, focus: string) => Promise<string>
  /** 多图在同一次视觉请求中按顺序理解 */
  describeSequence?: (images: readonly ImageAttachmentRef[], focus: string) => Promise<string>
  /** 多图主视觉模型失败时，用备用视觉模型整组重试 */
  describeSequenceFallback?: (images: readonly ImageAttachmentRef[], focus: string) => Promise<string>
  visionProvider?: string
  visionModel?: string
  visionHighModel?: string
  /** 配置有独立视觉模型时，不因聊天模型能力元数据而绕过它 */
  preferConfiguredVision?: boolean
  /** 每轮最多交给聊天或视觉模型的图片数量 */
  maxImages?: number
  /** 每轮最多交给聊天或视觉模型的图片总字节数 */
  maxBytes?: number
  hasViewer: boolean
  deepAfterReply: boolean
}

/** 主模型这一轮实际收什么附件 */
export interface ImageRoutingResult {
  attachments: readonly ContentBlock[]
  notice: string
  route: 'none' | 'chat' | 'vision' | 'vision-fallback' | 'unavailable'
  provider?: string
  model?: string
}

/** 图片运行层接口 */
export interface ImageRuntime {
  /** 保存图片并决定是否放进当前模型消息 */
  process(images: readonly PreparedImage[], message: IncomingMessage): Promise<ImageProcessingResult>
  /** 首轮回复后取一次深度检查，没有计划就是空 */
  deepAfterTurn(chatKey: string, traceIds: readonly string[]): Promise<string | undefined>
  /** 清掉没有进入对应模型回合的图片计划 */
  discard(traceIds: readonly string[]): void
  /** 卸载或急停时清空所有待看图片 */
  clear(): void
  /** 生成提示词里的旧图列表 */
  prompt(chatKey: string, now: number): string
  /** 明确回看旧图时提起兴趣，并留下可观察事实 */
  recall(chatKey: string, imageId: string, at: number): void
}

/** 图片随当前消息交给主模型的结果 */
export interface ImageProcessingResult {
  notes: readonly string[]
  attachImages: boolean
  /** 本轮不交给聊天模型的图片附件编号 */
  excludedImageIds?: readonly string[]
}

/** 整个图片能力装配后的出口 */
export interface ImageSupport {
  runtime: ImageRuntime
  archive: ImageArchive
  viewer: ImageViewer | undefined
  complexViewer: ImageViewer | undefined
  sequenceViewer: ((images: readonly ImageAttachmentRef[], options?: { focus?: string }) => Promise<string>) | undefined
  sequenceFallbackViewer: ((images: readonly ImageAttachmentRef[], options?: { focus?: string }) => Promise<string>) | undefined
}

function hasConcreteMediaContext(text: string): boolean {
  const body = text
    .replace(/\[[^\]\n]{1,24}\]/gu, ' ')
    .replace(/https?:\/\/\S+/gu, ' ')
    .trim()
  return /[\p{L}\p{N}]/u.test(body)
}

/** 图片或视频帧的基础兴趣值；所有自动媒体入口共用。 */
export function mediaWeightOf(message: IncomingMessage, kind: ImageKind): number {
  let weight = message.chatKey.startsWith('private:') ? 15 : 5
  if (message.atMe) weight += 30
  if (message.replyToBot) weight += 30
  if (hasConcreteMediaContext(message.text)) weight += 20
  if (message.attachments.some(attachment => attachment.kind === 'video')) weight += 15
  if (kind === 'screenshot') weight += 10
  if (kind === 'sticker') weight += 5
  return Math.min(100, weight)
}

function imageInterestOf(record: ImageRecord, now: number, halfLifeHours: number): number {
  const ageHours = Math.max(0, now - record.lastSeenAt) / 3_600_000
  const freshness = Math.pow(0.5, ageHours / Math.max(0.01, halfLifeHours))
  const skipped = record.skippedAt !== undefined && Math.max(0, now - record.skippedAt) < 30 * 60_000
  const viewed = record.lastViewedAt !== undefined && Math.max(0, now - record.lastViewedAt) < 60 * 60_000
  const recalled = record.recallAt !== undefined && Math.max(0, now - record.recallAt) < 2 * 3_600_000
  const repeated = Math.min(0.5, (record.seenCount - 1) * 0.1)
  return Math.min(100, Math.max(0,
    record.weight * freshness * (skipped ? 0.5 : 1) * (viewed ? 0.75 : 1) * (1 - repeated) + (recalled ? 15 : 0),
  ))
}

function explicitlyIgnored(text: string, phrases: readonly string[]): boolean {
  const normalized = text.trim()
  return normalized !== '' && phrases.some(phrase => phrase.trim() !== '' && normalized.includes(phrase.trim()))
}

function imageStatusOf(interest: number, quickFrom: number, deepFrom: number): ImageDecisionStatus {
  if (interest >= deepFrom) return 'deep'
  if (interest >= quickFrom) return 'quick'
  return 'cached'
}

function imageKindOf(image: PreparedImage): ImageKind {
  return image.attachment.sticker === true ? 'sticker' : 'photo'
}

const CATEGORY_KINDS: Readonly<Record<AssetCategory, ImageKind>> = {
  sticker: 'sticker',
  meme: 'sticker',
  screenshot: 'screenshot',
  document: 'screenshot',
  photo: 'photo',
  selfie: 'photo',
  illustration: 'photo',
  video: 'unknown',
  audio: 'unknown',
  other: 'unknown',
}

function classifiedKindOf(image: PreparedImage): ImageKind | undefined {
  const category = image.asset?.category
  return category === undefined ? undefined : CATEGORY_KINDS[category]
}

function annotateWithClassification(archive: ImageArchive, chatKey: string, record: ImageRecord, image: PreparedImage, at: number): void {
  if (image.asset === undefined) return
  if (image.asset.tags.length === 0 && image.asset.emotion === '') return
  archive.annotate(chatKey, record.imageId, {
    tags: image.asset.tags,
    ...image.asset.emotion === '' ? {} : { emotion: image.asset.emotion },
  }, at)
}

/**
 * 先走配置的视觉模型；失败时尝试备用视觉模型，再按能力元数据回退到聊天模型。
 * @param options 附件、模型选择和视觉路由
 * @returns 本轮附件、观察说明和实际使用的模型路由
 */
export async function routeImagesForModel(options: ImageRoutingOptions): Promise<ImageRoutingResult> {
  const allImages = options.attachments.filter(isImageContentBlock)
  const maxImages = visionBatchLimit(options.maxImages)
  const maxBytes = visionBatchByteLimit(options.maxBytes)
  const selection = selectVisionImages(options.attachments, maxImages, maxBytes)
  const images = selection.images
  const selectedImages = new Set(images)
  const limitedNotice = selection.omitted > 0
    ? `\n图片仍已保存；本轮只向模型提供接收顺序前缀中的 ${images.length} 张（${selection.bytes} 字节），另有 ${selection.omitted} 张未分析。单轮上限为 ${maxImages} 张、${maxBytes} 字节；需要时请分批发送。`
    : ''
  const useConfiguredVision = options.preferConfiguredVision === true && options.describe !== undefined
  const highVisionModel = options.visionHighModel || options.visionModel
  if (allImages.length === 0) return { attachments: options.attachments, notice: '', route: 'none' }
  const rest = options.attachments.filter(item => item.type !== 'image')
  let modelInfoChecked = false
  let chatCanSeeImages = false
  let chatSelection: { provider: string; model: string } | undefined
  const chatImageCapability = async (): Promise<boolean> => {
    if (modelInfoChecked) return chatCanSeeImages
    modelInfoChecked = true
    try {
      chatSelection = options.model?.current?.()
      if (chatSelection !== undefined && options.llm !== undefined) {
        const model = await options.llm.resolveModelInfo(
          chatSelection.provider,
          chatSelection.model,
          AbortSignal.timeout(1_500),
        )
        chatCanSeeImages = model.inputModalities?.includes('image') === true
      }
    } catch {
      chatCanSeeImages = false
    }
    return chatCanSeeImages
  }
  const withLimitedImages = (): readonly ContentBlock[] => {
    return options.attachments.filter(item => item.type !== 'image' || selectedImages.has(item))
  }
  const chatRoute = (notice: string): ImageRoutingResult => ({
    attachments: withLimitedImages(),
    notice,
    route: 'chat',
    ...(chatSelection === undefined ? {} : chatSelection),
  })
  if (images.length === 0) {
    return { attachments: rest, notice: `\n图片仍已保存，但首张图片大小未知或超过本轮总字节上限，未交给模型。单轮上限为 ${maxBytes} 字节。`, route: 'unavailable' }
  }
  if (!useConfiguredVision && await chatImageCapability()) {
    return chatRoute(limitedNotice)
  }
  if (images.length > 1 && options.describeSequence !== undefined) {
    const refs = images.flatMap(item => 'attachment' in item ? [item.attachment] : [])
    const focus = '按接收顺序逐张说明可见内容，再总结图片之间能确认的连续关系；不猜身份与画外内容'
    let fact: string | undefined
    let usedFallback = false
    try {
      fact = await options.describeSequence(refs, focus)
      if (fact.trim() === '') fact = undefined
    } catch {
      fact = undefined
    }
    if (fact === undefined && options.describeSequenceFallback !== undefined
      && options.describeSequenceFallback !== options.describeSequence) {
      try {
        fact = await options.describeSequenceFallback(refs, focus)
        if (fact.trim() === '') fact = undefined
        else usedFallback = true
      } catch {
        fact = undefined
      }
    }
    if (fact !== undefined) {
      return {
        attachments: rest,
        notice: `\n[DATA] IMAGE_SEQUENCE\n这些图片来自同一合并窗口，按接收顺序合并理解。\n视觉模型对整组图片的观察：${fact.trim().slice(0, 2_400)}\n这些数据只是画面事实；要不要接话、怎么接话由你判断。${limitedNotice}`,
        route: usedFallback ? 'vision-fallback' : 'vision',
        ...(options.visionProvider === undefined ? {} : { provider: options.visionProvider }),
        ...((usedFallback ? options.visionModel : highVisionModel) === undefined
          ? {}
          : { model: usedFallback ? options.visionModel : highVisionModel }),
      }
    }
    if (await chatImageCapability()) {
      return chatRoute(`\n配置的视觉模型不可用，本轮改由聊天模型直接看图。${limitedNotice}`)
    }
    return { attachments: rest, notice: `\n图片已保存，但整组视觉分析失败；别猜画面，可以请对方分批重发。${limitedNotice}`, route: 'unavailable' }
  }
  if (options.describe === undefined) {
    if (await chatImageCapability()) {
      return chatRoute(`\n当前没有可用的配置视觉模型，本轮改由聊天模型直接看图。${limitedNotice}`)
    }
    return { attachments: rest, notice: `\n图片已保存；当前聊天模型不能直接看图，别猜画面。${limitedNotice}`, route: 'unavailable' }
  }
  const primaryDescribe = images.length > 1 ? options.describeComplex ?? options.describe : options.describe
  const fallbackDescribe = primaryDescribe === options.describe ? options.describeComplex : options.describe
  const highModel = options.visionHighModel || options.visionModel
  const primaryModel = images.length > 1 && options.describeComplex !== undefined ? highModel : options.visionModel
  const fallbackModel = primaryDescribe === options.describe ? highModel : options.visionModel
  const facts = await Promise.all(images.map(async (item, index) => {
    if (!('attachment' in item)) return { text: '', ok: false, fallback: false }
    const focus = images.length > 1
      ? `这是同一组连续图片中的第 ${index + 1}/${images.length} 张；描述可见内容，并留意与其它图片的连续关系，不猜身份与画外内容`
      : '按画面实际内容说明，不猜身份与画外内容'
    let text = ''
    try {
      text = (await primaryDescribe(item.attachment, focus)).trim()
    } catch {
      text = ''
    }
    let fallback = false
    if (text === '' && fallbackDescribe !== undefined && fallbackDescribe !== primaryDescribe) {
      try {
        text = (await fallbackDescribe(item.attachment, focus)).trim()
        fallback = text !== ''
      } catch {
        text = ''
      }
    }
    return { text, ok: text !== '', fallback }
  }))
  const usedFallback = facts.some(fact => fact.fallback)
  const readableFacts = facts.flatMap((fact, index) => fact.ok
    ? [`[DATA] 收到的第 ${index + 1} 张图片，视觉模型看到的实际内容：${fact.text.slice(0, 1200)}`]
    : [`[DATA] 收到的第 ${index + 1} 张图片，视觉模型本轮未能读取画面，别猜画面。`])
  if (!facts.some(fact => fact.ok)) {
    if (await chatImageCapability()) {
      return chatRoute(`\n配置的视觉模型不可用，本轮改由聊天模型直接看图。${limitedNotice}`)
    }
    return { attachments: rest, notice: '\n图片已保存但视觉模型没接上，别猜画面。' + limitedNotice, route: 'unavailable' }
  }
  return {
    attachments: rest,
    notice: `\n${facts.length > 1 ? '[DATA] IMAGE_SEQUENCE\n这些图片来自同一合并窗口，按接收顺序合并理解为一个连续场景。\n' : ''}${readableFacts.join('\n')}\n这些数据只是画面事实；要不要接话、怎么接话由你判断。${limitedNotice}`,
    route: usedFallback ? 'vision-fallback' : 'vision',
    ...(options.visionProvider === undefined ? {} : { provider: options.visionProvider }),
    ...((usedFallback ? fallbackModel : primaryModel) === undefined
      ? {}
      : { model: usedFallback ? fallbackModel : primaryModel }),
  }
}

/**
 * 建图片运行层
 * @param options 图片档、视觉模型与权重线
 * @returns 图片运行接口
 */
export function createImageRuntime(options: ImageRuntimeOptions): ImageRuntime {
  const deep = new Map<string, DeepPlan[]>()
  const maxImages = visionBatchLimit(options.maxImages)

  return {
    process(images, message) {
      const notes: string[] = []
      const excludedImageIds: string[] = []
      const ignored = explicitlyIgnored(message.text, options.ignorePhrases ?? BUNDLE_DEFAULTS.imageIgnorePhrases)
      const addressed = !ignored && (message.atMe || message.replyToBot)
      const fromVideo = message.attachments.some(attachment => attachment.kind === 'video')
      const kinds = images.map(prepared => classifiedKindOf(prepared) ?? imageKindOf(prepared))
      const allStickers = images.length > 0 && kinds.every(kind => kind === 'sticker')
      const nonStickerCount = kinds.filter(kind => kind !== 'sticker').length
      if (nonStickerCount > 1) {
        notes.push([
          '[DATA] IMAGE_SEQUENCE',
          `COUNT: ${nonStickerCount}`,
          'ORDER: message_order',
          'RULE: 这些是同一条消息里连着发的，按顺序当成一个连续场景看；先合起来理解发生了什么，不要一张一张孤立描述。',
        ].join('\n'))
      }
      for (const [index, prepared] of images.entries()) {
        const kind = kinds[index] ?? 'unknown'
        const record = options.archive.record({
          chatKey: message.chatKey,
          messageId: message.messageId,
          senderId: message.senderId,
          senderName: message.senderName,
          at: message.at,
          image: prepared.image,
          weight: mediaWeightOf(message, kind),
          kind,
        })
        annotateWithClassification(options.archive, message.chatKey, record, prepared, message.at)
        const videoTime = prepared.timestampMs === undefined
          ? ''
          : ` ${new Date(prepared.timestampMs).toISOString().slice(11, 19)}`
        const position = prepared.timestampMs !== undefined
          ? `视频画面${videoTime}`
          : images.length === 1 ? `图片（${imageKindLabel(kind)}）` : `第 ${index + 1} 张图片（${imageKindLabel(kind)}）`
        if (ignored) {
          options.archive.skip(message.chatKey, record.imageId, message.at)
          options.note?.('image_skipped', message.chatKey, { imageId: record.imageId, reason: 'explicit' })
          options.note?.('image_status', message.chatKey, {
            imageId: record.imageId, status: 'ignored', interest: 0, kind, addressed,
          })
          notes.push(`${position}已存档，按你的意思先不看，哈希 ${record.imageId}`)
          continue
        }
        // 表情包默认只作为聊天素材；需要看画面时由模型按需调用回看工具。
        if (kind === 'sticker') {
          options.archive.skip(message.chatKey, record.imageId, message.at)
          options.note?.('image_sticker_skipped', message.chatKey, { imageId: record.imageId })
          options.note?.('image_status', message.chatKey, {
            imageId: record.imageId, status: 'sticker', interest: 0, kind, addressed,
          })
          excludedImageIds.push(String(prepared.image.attachmentId))
          notes.push(`${position}已归档，默认不做视觉识别；需要看画面时可调 qq_image_view，哈希 ${record.imageId}`)
          continue
        }
        const interest = imageInterestOf(record, message.at, options.halfLifeHours)
        const effectiveInterest = addressed ? Math.max(interest, options.quickWeightFrom) : interest
        let status = imageStatusOf(effectiveInterest, options.quickWeightFrom, options.deepWeightFrom)
        if (status !== 'cached' && options.mediaBudget !== undefined) {
          const budget = options.mediaBudget.consume({
            kind: fromVideo ? 'video' : 'image',
            at: message.at,
            group: message.chatKey.startsWith('group:'),
            key: fromVideo ? message.traceId : `${message.traceId}:${record.imageId}`,
          })
          options.note?.('media_budget_check', message.chatKey, {
            imageId: record.imageId,
            kind: fromVideo ? 'video' : 'image',
            ok: budget.ok,
            ...budget.code === undefined ? {} : { code: budget.code },
            energy: budget.energy,
            hourUsed: budget.hourUsed,
            hourMax: budget.hourMax,
            dayUsed: budget.dayUsed,
            dayMax: budget.dayMax,
          })
          if (!budget.ok) {
            status = 'cached'
            options.note?.('media_budget_blocked', message.chatKey, {
              imageId: record.imageId,
              code: budget.code,
              kind: fromVideo ? 'video' : 'image',
              energy: budget.energy,
              hourUsed: budget.hourUsed,
              hourMax: budget.hourMax,
              dayUsed: budget.dayUsed,
              dayMax: budget.dayMax,
            })
          }
        }
        options.note?.('image_status', message.chatKey, {
          imageId: record.imageId, status, interest: effectiveInterest, kind, addressed,
        })
        if (status === 'cached') {
          options.archive.skip(message.chatKey, record.imageId, message.at)
          options.note?.('image_cached', message.chatKey, { imageId: record.imageId, interest: effectiveInterest })
          excludedImageIds.push(String(prepared.image.attachmentId))
          notes.push(`${position}已缓存，本轮不交给模型；需要回看时调 qq_image_view，哈希 ${record.imageId}`)
          continue
        }
        if (options.viewer === undefined) {
          notes.push(`${position}已存档，哈希 ${record.imageId}，当前没有可用的视觉模型`)
          continue
        }
        notes.push(`${position}已存档，状态：${status === 'deep' ? '深入看' : '快速看'}，哈希 ${record.imageId}`)
        if (options.deepAfterReply && status === 'deep') {
          options.note?.('image_deep_planned', message.chatKey, { imageId: record.imageId, interest: effectiveInterest, addressed })
          const plans = deep.get(message.chatKey) ?? []
          plans.push({
            traceId: message.traceId,
            imageId: record.imageId,
            image: prepared.image,
            question: message.text.trim() || '仔细检查人物数量、文字、动作和不确定处',
            kind,
          })
          deep.set(message.chatKey, plans)
        }
      }
      // 一整批都是表情包、又没人叫你看时，不把图塞给模型，只留情绪事实
      return Promise.resolve({
        notes,
        attachImages: !ignored && !allStickers,
        excludedImageIds,
      })
    },
    async deepAfterTurn(chatKey, traceIds) {
      const current = deep.get(chatKey)
      if (current === undefined || options.viewer === undefined) return undefined
      // 兜底链发出的轮次可能没带 traceId；这时按会话把待看图片全补看，别让计划一直挂着
      const accepted = new Set(traceIds)
      const plans = traceIds.length === 0 ? current : current.filter(plan => accepted.has(plan.traceId))
      const remaining = traceIds.length === 0 ? [] : current.filter(plan => !accepted.has(plan.traceId))
      if (remaining.length === 0) deep.delete(chatKey)
      else deep.set(chatKey, remaining)
      if (plans.length === 0) return undefined
      const results: string[] = []
      const selected = plans.slice(0, maxImages)
      const omitted = plans.length - selected.length
      if (selected.length > 1 && options.sequenceViewer !== undefined) {
        try {
          const report = await options.sequenceViewer(selected.map(plan => plan.image), {
            focus: selected.map((plan, index) => `第 ${index + 1} 张：${plan.question}`).join('\n'),
          })
          for (const [index, plan] of selected.entries()) {
            const summary = `[DATA] IMAGE_SEQUENCE_DEEP_RESULT\nIMAGE_ID: ${plan.imageId}\nPOSITION: ${index + 1}/${selected.length}\nGROUP_REPORT:\n${report}`
            options.archive.setDeep(plan.imageId, chatKey, summary, Date.now())
            results.push(summary)
          }
        } catch (error) {
          const failure = String(error instanceof Error ? error.message : error)
          for (const plan of selected) {
            results.push(`[DATA] IMAGE_DEEP_FAILED\nIMAGE_ID: ${plan.imageId}\nERROR: ${failure}`)
          }
        }
        if (omitted > 0) results.push(`[DATA] IMAGE_DEEP_LIMIT\nCOUNT: ${omitted}\n这些图片仍已保存，但未进入本轮深看。`)
        return results.join('\n')
      }
      for (const plan of selected) {
        try {
          const text = await options.viewer(plan.image, { focus: plan.question, deep: true, kind: plan.kind })
          options.archive.setDeep(plan.imageId, chatKey, text, Date.now())
          results.push(`[DATA] IMAGE_DEEP_RESULT\nIMAGE_ID: ${plan.imageId}\nBODY:\n${text}`)
        } catch (error) {
          results.push(`[DATA] IMAGE_DEEP_FAILED\nIMAGE_ID: ${plan.imageId}\nERROR: ${String(error instanceof Error ? error.message : error)}`)
        }
      }
      if (omitted > 0) results.push(`[DATA] IMAGE_DEEP_LIMIT\nCOUNT: ${omitted}\n这些图片仍已保存，但未进入本轮深看。`)
      return results.join('\n')
    },
    discard(traceIds) {
      const rejected = new Set(traceIds)
      for (const [chatKey, plans] of deep) {
        const kept = plans.filter(plan => !rejected.has(plan.traceId))
        if (kept.length === 0) deep.delete(chatKey)
        else if (kept.length !== plans.length) deep.set(chatKey, kept)
      }
    },
    clear() {
      deep.clear()
    },
    recall(chatKey, imageId, at) {
      options.archive.recall(chatKey, imageId, at)
      options.note?.('image_recalled', chatKey, { imageId })
    },
    prompt(chatKey, now) {
      const items = options.archive.recent(chatKey, now, options.recentPromptMax)
      if (items.length === 0) return ''
      return [
        '[DATA] SEEN_IMAGES',
        ...items.map((item) => {
          const summary = item.deepSummary ?? item.quickSummary ?? 'summary_missing'
          const semantics = [
            item.semanticTags?.length ? `TAGS: ${item.semanticTags.join(',')}` : '',
            item.emotion ? `EMOTION: ${item.emotion}${item.emotionIntensity === undefined ? '' : ` ${Math.round(item.emotionIntensity * 100)}%`}` : '',
            item.useWhen ? `USE_FOR: ${item.useWhen}` : '',
          ].filter(part => part !== '').join('｜')
          return `- ${item.imageId}｜${imageKindLabel(item.kind)}｜SCORE: ${item.score.toFixed(1)}｜${item.senderName}｜${semantics}${semantics === '' ? '' : '｜'}${summary.slice(0, 120)}`
        }),
        'RULE: only_open_when_needed; stickers_are_emotion_not_photo; no_invented_details',
      ].join('\n')
    },
  }
}

/**
 * 装图片档、提示词、工具与运行策略
 * @param ctx 运行环境
 * @param config 组合包配置
 * @param llm 模型服务
 * @param enabled 当前模式是否显示旧图记忆
 * @param note 写一条不带正文的诊断
 * @param selfId 机器人自己的编号
 * @returns 图片运行层
 */
export function installImageSupport(
  ctx: Context,
  config: Config,
  llm: VisionLlmPort | undefined,
  enabled?: () => boolean,
  note?: (kind: string, chatKey: string, detail?: Record<string, unknown>) => void,
  selfId = '',
  mediaBudget?: MediaBudget,
): ImageSupport {
  const regularModels = visionModelCandidates(config)
  const highModels = visionModelCandidates(config, true)
  const reportAttempt = note === undefined
    ? undefined
    : (fact: import('./vision.ts').VisionAttemptFact): void => {
      note('vision_model_attempt', '', { ...fact })
    }
  const viewer = createVisionDescriber(llm, config, regularModels, reportAttempt)
  const complexViewer = highModels.length === 0 ? viewer : createVisionDescriber(llm, config, highModels, reportAttempt)
  const sequenceViewer = highModels.length === 0
    ? createVisionSequenceDescriber(llm, config, undefined, reportAttempt)
    : createVisionSequenceDescriber(llm, config, highModels, reportAttempt)
  const sequenceFallbackViewer = regularModels.length === 0 || highModels.join('\n') === regularModels.join('\n')
    ? undefined
    : createVisionSequenceDescriber(llm, config, regularModels, reportAttempt)
  const archive = createImageArchive({
    file: config.imageArchiveFile ?? path.join(resolveHuoliHome(config.home), BUNDLE_DEFAULTS.imageArchiveFile),
    maxItems: Math.max(1, config.imageArchiveMax ?? BUNDLE_DEFAULTS.imageArchiveMax),
    halfLifeHours: Math.max(0.01, config.imageWeightHalfLifeHours ?? BUNDLE_DEFAULTS.imageWeightHalfLifeHours),
  })
  const runtime = createImageRuntime({
    archive,
    viewer,
    ...(sequenceViewer === undefined ? {} : { sequenceViewer }),
    maxImages: visionBatchLimit(config.visionBatchMaxImages),
    quickWeightFrom: Math.max(0, config.imageQuickWeightFrom ?? BUNDLE_DEFAULTS.imageQuickWeightFrom),
    deepWeightFrom: Math.max(0, config.imageDeepWeightFrom ?? BUNDLE_DEFAULTS.imageDeepWeightFrom),
    ignorePhrases: config.imageIgnorePhrases ?? BUNDLE_DEFAULTS.imageIgnorePhrases,
    deepAfterReply: config.imageDeepAfterReply ?? BUNDLE_DEFAULTS.imageDeepAfterReply,
    recentPromptMax: Math.max(0, config.imageRecentPromptMax ?? BUNDLE_DEFAULTS.imageRecentPromptMax),
    halfLifeHours: Math.max(0.01, config.imageWeightHalfLifeHours ?? BUNDLE_DEFAULTS.imageWeightHalfLifeHours),
    ...note === undefined ? {} : { note },
    ...mediaBudget === undefined ? {} : { mediaBudget },
  })
  ctx.systemPrompt.section({
    name: 'qq:image-memory',
    order: 345,
    text: context => enabled?.() === false ? '' : runtime.prompt(String(context.agent?.id ?? ''), Date.now()),
  })
  ctx.effect(() => registerImageTools(ctx, {
    archive,
    viewer,
    listMax: Math.max(1, BUNDLE_DEFAULTS.imageArchiveMax),
    recall: (chatKey, imageId, at) => {
      runtime.recall(chatKey, imageId, at)
    },
    ...mediaBudget === undefined ? {} : { mediaBudget },
  }))
  const attachments = ctx.get('attachments')
  ctx.effect(() => registerSelfImageTool(ctx, selfImageOptions(
    config,
    archive,
    llm,
    attachments,
    selfId,
    config.visionProvider ?? BUNDLE_DEFAULTS.visionProvider,
    config.visionModel ?? BUNDLE_DEFAULTS.visionModel,
  )))
  return { runtime, archive, viewer, complexViewer, sequenceViewer, sequenceFallbackViewer }
}
