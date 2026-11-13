// QQ 附件入站：有上限地下载，图片和文件存进项目图片目录，其它文件也留一份原样

import { Buffer } from 'node:buffer'
import path from 'node:path'
import type {
  FileAttachmentRef, ImageAttachmentRef, ImageMediaType, SaveFileAttachment, SaveImageAttachment,
} from '@huoli/huoli-attachment'
import type { ContentBlock } from '@huoli/huoli-llm'
import type { IncomingAttachment } from '@huoli/huoli-qq-channel'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { createAssetStore, type AssetCategory, type AssetStore } from './asset-store.ts'
import {
  assetFactText, createAssetClassifier, fallbackClassification,
  type AssetClassification, type AssetClassifier,
} from './asset-classify.ts'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import type { Config } from './types.ts'
import type { VisionLlmPort } from './vision.ts'
import type { VoiceTranscriptOutcome } from './asr.ts'
import type { VideoAnalysis } from './video-vision.ts'
import { ensurePublicUrl } from './weblinks.ts'

/** 存进项目图片目录之后的事实 */
export interface ArchivedMedia {
  /** 相对项目图片目录的路径 */
  relative: string
  /** 完整路径 */
  file: string
  /** 归到哪一类 */
  category: AssetCategory
  /** 形态名 */
  kind: string
  /** 一句内容说明 */
  caption: string
  /** 情绪 */
  emotion: string
  /** 主题或角色 */
  topic: string
  /** 场景与情绪词 */
  tags: readonly string[]
  /** 判读来源 */
  source: 'model' | 'fallback' | 'protocol'
  /** 同时收进表情包库时的编号 */
  stickerId?: string
}

/** 交给归档入口的一份素材 */
export interface IncomingArchiveInput {
  /** 内容字节 */
  data: Uint8Array
  /** 平台给的文件名 */
  name: string
  /** 内容类型 */
  mediaType: string
  /** 扩展名，带点 */
  extension: string
  /** 图片引用，只有图片才有 */
  image?: ImageAttachmentRef
  /** QQ 消息段明确标记为表情包 */
  sticker?: boolean
  /** 消息里这句话，帮助判读 */
  hint: string
  /** 哪个聊天 */
  chatKey: string
  /** 哪条消息 */
  messageId: string
  /** 谁发的 */
  senderId: string
  /** 谁发的，显示名 */
  senderName: string
  /** 什么时候收到的 */
  at: number
}

/** 归档入口 */
export interface IncomingArchivePort {
  /**
   * 判读并保存一份素材
   * @param input 素材字节与来源事实
   * @returns 落盘后的事实
   */
  save(input: IncomingArchiveInput): Promise<ArchivedMedia>
}

/** 造归档入口要的东西 */
export interface IncomingArchiveOptions {
  /** 素材目录 */
  store: AssetStore
  /** 视觉模型判读，没接上就按扩展名粗分 */
  classifier?: AssetClassifier
  /** 判读用的提供方与模型 */
  classify: { provider: string; model: string; maxTokens: number; maxChars: number; timeoutMs: number }
}

function toArchived(asset: ReturnType<AssetStore['save']>, classification: AssetClassification): ArchivedMedia {
  return {
    relative: asset.relative.split(path.sep).join('/'),
    file: asset.file,
    category: asset.category,
    kind: classification.kind,
    caption: asset.caption,
    emotion: asset.emotion ?? '',
    topic: asset.topic,
    tags: asset.tags,
    source: classification.source,
    ...asset.stickerId === undefined ? {} : { stickerId: asset.stickerId },
  }
}

/**
 * 建一个入站归档入口：按配置让模型判类，否则按扩展名粗分，再存进项目图片目录
 * @param options 素材目录、判读器与模型预算
 * @returns 归档入口
 */
export function createIncomingArchive(options: IncomingArchiveOptions): IncomingArchivePort {
  return {
    async save(input) {
      const fallback = fallbackClassification({ fileName: input.name, mediaType: input.mediaType })
      const classification = input.sticker === true
        ? {
          ...fallback,
          category: 'sticker' as const,
          kind: '表情包',
          caption: 'QQ 消息段标记的表情包',
          tags: ['表情包'],
          keep: true,
          favorite: false,
          source: 'protocol' as const,
        }
        : input.image === undefined || options.classifier === undefined
          ? fallback
          : await options.classifier(input.image, {
            ...options.classify,
            fileName: input.name,
            mediaType: input.mediaType,
            ...input.hint.trim() === '' ? {} : { hint: input.hint },
          })
      // 模型给的一层子目录就是主题那层目录
      const topic = classification.subDir.trim() || classification.topic?.trim() || ''
      const asset = options.store.save({
        data: input.data,
        facts: { ...classification, topic },
        mediaType: input.mediaType,
        extension: input.extension,
        chatKey: input.chatKey,
        messageId: input.messageId,
        senderId: input.senderId,
        senderName: input.senderName,
        at: input.at,
      })
      return toArchived(asset, classification)
    },
  }
}

/** 装配好的项目图片目录 */
export interface MediaArchiveSupport {
  /** 入站归档入口 */
  port: IncomingArchivePort
  /** 素材目录 */
  store: AssetStore
  /** 多久清理一次，毫秒 */
  sweepIntervalMs: number
  /** 按档位清理一次 */
  sweep(now: number): void
}

/**
 * 按配置装配项目图片目录：判类器、素材目录与入站归档入口
 * @param config 组合包配置
 * @param llm 模型服务，没有时按扩展名粗分
 * @returns 归档入口、素材目录与清理间隔
 */
export function createMediaArchive(config: Config, llm: VisionLlmPort | undefined): MediaArchiveSupport {
  const home = resolveHuoliHome(config.home)
  const store = createAssetStore({
    root: config.mediaRoot ?? path.join(home, BUNDLE_DEFAULTS.mediaRoot),
    indexFile: config.mediaIndexFile ?? path.join(home, BUNDLE_DEFAULTS.mediaIndexFile),
    stickerFile: config.stickerFile ?? config.mediaStickerFile ?? path.join(home, BUNDLE_DEFAULTS.mediaStickerFile),
    maxItems: Math.max(1, config.mediaIndexMax ?? BUNDLE_DEFAULTS.mediaIndexMax),
    halfLifeHours: Math.max(0.01, config.mediaHalfLifeHours ?? BUNDLE_DEFAULTS.mediaHalfLifeHours),
    favoriteWeight: Math.max(1, config.mediaFavoriteWeight ?? BUNDLE_DEFAULTS.mediaFavoriteWeight),
    archiveBelowWeight: Math.max(0, config.mediaArchiveBelowWeight ?? BUNDLE_DEFAULTS.mediaArchiveBelowWeight),
    cacheMaxAgeHours: Math.max(0, config.mediaCacheMaxAgeHours ?? BUNDLE_DEFAULTS.mediaCacheMaxAgeHours),
    cacheMaxItems: Math.max(0, config.mediaCacheMaxItems ?? BUNDLE_DEFAULTS.mediaCacheMaxItems),
  })
  const classify = {
    provider: config.visionProvider ?? BUNDLE_DEFAULTS.visionProvider,
    model: config.visionModel ?? BUNDLE_DEFAULTS.visionModel,
    maxTokens: Math.max(1, config.mediaClassifyMaxTokens ?? BUNDLE_DEFAULTS.mediaClassifyMaxTokens),
    maxChars: Math.max(1, config.mediaClassifyMaxChars ?? BUNDLE_DEFAULTS.mediaClassifyMaxChars),
    timeoutMs: Math.max(1, config.mediaClassifyTimeoutMs ?? BUNDLE_DEFAULTS.mediaClassifyTimeoutMs),
  }
  const classifier = (config.mediaClassify ?? BUNDLE_DEFAULTS.mediaClassify)
    ? createAssetClassifier(llm, classify)
    : undefined
  return {
    port: createIncomingArchive({ store, ...classifier === undefined ? {} : { classifier }, classify }),
    store,
    sweepIntervalMs: Math.max(0, config.mediaSweepIntervalMs ?? BUNDLE_DEFAULTS.mediaSweepIntervalMs),
    sweep(now) {
      store.sweep(now)
    },
  }
}

/** 下载与保存后的结果 */
export interface PreparedIncomingMedia {
  /** 可以直接交给模型的附件块 */
  content: readonly ContentBlock[]
  /** 给模型看的下载结果，不含内部临时地址 */
  notes: readonly string[]
  /** 成功保存几项 */
  saved: number
  /** 失败几项 */
  failed: number
  /** 成功保存的图片 */
  images: readonly PreparedImage[]
}

/** 保存后的图片和它的原始平台事实 */
export interface PreparedImage {
  /** 附件仓里的图片 */
  image: ImageAttachmentRef
  /** 平台原始附件 */
  attachment: IncomingAttachment
  /** 存进项目图片目录后的事实，没接归档时为空 */
  asset?: ArchivedMedia
  /** 视频抽帧时对应的画面时刻 */
  timestampMs?: number
}

/** 入站附件处理的参数 */
export interface MediaAttachmentPort {
  /** 保存图片 */
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>
  /** 原样保存文件 */
  saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef>
  /** 找出图片的本地路径 */
  imageHostPath(ref: ImageAttachmentRef): string | undefined
  /** 找出文件的本地路径 */
  fileHostPath(ref: FileAttachmentRef): string | undefined
}

/** 入站附件处理的参数 */
export interface IncomingMediaOptions {
  /** 附件仓，没接上时只返回失败事实 */
  attachments: MediaAttachmentPort | undefined
  /** 项目图片目录，没接上时只留附件仓那一份 */
  archive?: IncomingArchivePort
  /** 消息里这句话，帮助判读 */
  hint?: string
  /** 这条消息的聊天键 */
  chatKey?: string
  /** 这条消息的编号 */
  messageId?: string
  /** 谁发的 */
  senderId?: string
  /** 谁发的，显示名 */
  senderName?: string
  /** 什么时候收到的 */
  at?: number
  /** 单项最大字节 */
  maxBytes: number
  /** 一项最多等多久 */
  timeoutMs: number
  /** 一条消息最多处理几项 */
  maxItems: number
  /** 语音转写；没接上就只存文件 */
  asr?: (data: Uint8Array, mediaType: string) => Promise<VoiceTranscriptOutcome>
  /** 视频本机抽帧与音轨识别 */
  analyzeVideo?: (data: Uint8Array, mediaType: string) => Promise<VideoAnalysis>
}

const IMAGE_TYPES: Readonly<Record<string, ImageMediaType>> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
}

const MEDIA_REDIRECT_MAX = 4

function imageTypeOf(value: string): ImageMediaType | undefined {
  const mediaType = value.split(';')[0]?.trim().toLowerCase() ?? ''
  const known = IMAGE_TYPES[mediaType]
  if (known !== undefined) return known
  let pathname = value
  try {
    pathname = new URL(value).pathname
  } catch {
    pathname = value
  }
  const extension = path.extname(pathname).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  return undefined
}

function bytesOfBase64(value: string): Uint8Array {
  const body = value.slice(value.indexOf(',') + 1)
  return Buffer.from(body, 'base64')
}

function bytesOfDataUrl(value: string): { data: Uint8Array; mediaType: string } {
  const comma = value.indexOf(',')
  if (comma < 0) throw new Error('media.bad_base64')
  const header = value.slice(0, comma)
  return { data: bytesOfBase64(value), mediaType: header.slice(5, Math.max(5, header.indexOf(';'))) }
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > maxBytes) throw new Error('media.too_large')
  if (response.body === null) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body.getReader()
  while (true) {
    const part = await reader.read()
    if (part.done) break
    total += part.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('media.too_large')
    }
    chunks.push(part.value)
  }
  const data = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return data
}

async function fetchPublic(url: URL, signal: AbortSignal): Promise<Response> {
  let current = url
  for (let hop = 0; ; hop += 1) {
    const checked = await ensurePublicUrl(current.toString(), undefined, { allowAnyPort: true })
    const response = await fetch(checked, { signal, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (location === null || hop >= MEDIA_REDIRECT_MAX - 1) throw new Error('media.bad_redirect')
      current = new URL(location, checked)
      continue
    }
    const final = response.url === '' ? checked : new URL(response.url)
    await ensurePublicUrl(final.toString(), undefined, { allowAnyPort: true })
    return response
  }
}

async function download(attachment: IncomingAttachment, options: IncomingMediaOptions): Promise<{ data: Uint8Array; mediaType: string }> {
  if (attachment.url.startsWith('base64://')) {
    const data = bytesOfBase64(attachment.url)
    if (data.byteLength > options.maxBytes) throw new Error('media.too_large')
    return { data, mediaType: attachment.mediaType }
  }
  if (attachment.url.startsWith('data:')) {
    const decoded = bytesOfDataUrl(attachment.url)
    if (decoded.data.byteLength > options.maxBytes) throw new Error('media.too_large')
    return decoded
  }
  const url = await ensurePublicUrl(attachment.url, undefined, { allowAnyPort: true })
  const response = await fetchPublic(url, AbortSignal.timeout(options.timeoutMs))
  if (!response.ok) throw new Error(`media.http_${response.status}`)
  return {
    data: await readBounded(response, options.maxBytes),
    mediaType: attachment.mediaType || response.headers.get('content-type') || '',
  }
}

function fileNameOf(attachment: IncomingAttachment, fallback: string): string {
  const raw = attachment.name.trim()
  if (raw === '' || raw.startsWith('base64://') || raw.startsWith('data:')) return fallback
  try {
    return path.basename(new URL(raw).pathname)
  } catch {
    return path.basename(raw)
  }
}

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

function extensionOf(name: string, mediaType: string): string {
  const fromName = path.extname(name)
  if (fromName !== '') return fromName.toLowerCase()
  const known = IMAGE_EXTENSIONS[mediaType]
  if (known !== undefined) return known
  const slash = mediaType.indexOf('/')
  const subtype = slash < 0 ? '' : mediaType.slice(slash + 1).split(';')[0]?.trim() ?? ''
  const safe = subtype.replace(/[^a-z0-9]/gu, '').slice(0, 5)
  return `.${safe === '' ? 'bin' : safe}`
}

/** 一项存档失败也不影响这一项本身 */
async function archiveQuietly(
  archive: IncomingArchivePort,
  input: IncomingArchiveInput,
  notes: string[],
): Promise<ArchivedMedia | undefined> {
  try {
    return await archive.save(input)
  } catch (error) {
    notes.push(`这一项没存进项目图片目录：${String(error instanceof Error ? error.message : error)}`)
    return undefined
  }
}

function archiveNote(asset: ArchivedMedia): string {
  return `已存进项目图片目录 ${assetFactText({
    relative: asset.relative,
    kind: asset.kind,
    caption: asset.caption,
    emotion: asset.emotion,
    source: asset.source,
  })}`
}

/**
 * 下载并保存一条消息里的附件
 * @param media QQ 消息里的附件
 * @param options 附件仓、项目图片目录与预算
 * @returns 模型可用的附件块和文字诊断
 */
export async function prepareIncomingMedia(
  media: readonly IncomingAttachment[],
  options: IncomingMediaOptions,
): Promise<PreparedIncomingMedia> {
  const content: ContentBlock[] = []
  const notes: string[] = []
  const images: PreparedImage[] = []
  const at = options.at ?? Date.now()
  const archiveInput = (
    data: Uint8Array,
    name: string,
    mediaType: string,
    extra: { image?: ImageAttachmentRef; sticker?: boolean },
  ): IncomingArchiveInput => ({
    data,
    name,
    mediaType,
    extension: extensionOf(name, mediaType),
    hint: options.hint ?? '',
    chatKey: options.chatKey ?? '',
    messageId: options.messageId ?? '',
    senderId: options.senderId ?? '',
    senderName: options.senderName ?? '',
    at,
    ...extra.image === undefined ? {} : { image: extra.image },
    ...extra.sticker === undefined ? {} : { sticker: extra.sticker },
  })
  let saved = 0
  let failed = 0
  for (const [index, attachment] of media.slice(0, Math.max(0, options.maxItems)).entries()) {
    if (attachment.url === '') {
      failed += 1
      notes.push(`第 ${index + 1} 项${attachment.kind}没有可下载地址`)
      continue
    }
    try {
      if (options.attachments === undefined) throw new Error('media.no_store')
      const downloaded = await download(attachment, options)
      const name = fileNameOf(attachment, `${attachment.kind}-${index + 1}`)
      if (attachment.kind === 'image') {
        const mediaType = imageTypeOf(downloaded.mediaType || name)
        if (mediaType === undefined) throw new Error('media.unsupported_image')
        const ref: ImageAttachmentRef = await options.attachments.saveImage({
          data: downloaded.data,
          mediaType,
          name,
        })
        content.push({ type: 'image', attachment: ref })
        const asset = options.archive === undefined
          ? undefined
          : await archiveQuietly(options.archive, archiveInput(downloaded.data, name, mediaType, {
            image: ref,
            ...attachment.sticker === undefined ? {} : { sticker: attachment.sticker },
          }), notes)
        // 本机路径不进模型可见文本：只给编号，回看一律走 qq_image_list / qq_image_view
        notes.push(asset === undefined
          ? `图片已保存，编号 ${ref.attachmentId}`
          : archiveNote(asset))
        images.push({ image: ref, attachment, ...asset === undefined ? {} : { asset } })
      } else {
        const ref: FileAttachmentRef = await options.attachments.saveFile({ data: downloaded.data, name })
        content.push({ type: 'file', attachment: ref })
        const label = attachment.kind === 'record' ? '语音' : attachment.kind === 'video' ? '视频' : '文件'
        const asset = options.archive === undefined
          ? undefined
          : await archiveQuietly(options.archive, archiveInput(downloaded.data, name, downloaded.mediaType, {}), notes)
        // 文件名与本机路径都不进模型可见文本
        notes.push(asset === undefined
          ? `${label}已保存，编号 ${ref.attachmentId}`
          : `${label}${archiveNote(asset)}`)
        // 语音：转成文字再交给模型；失败就明说没转写，不猜内容
        if (attachment.kind === 'record') {
          const heard = options.asr === undefined
            ? undefined
            : await options.asr(downloaded.data, downloaded.mediaType)
          if (heard !== undefined && heard.ok) {
            const tone = [heard.emotion, heard.event].filter(part => part !== undefined && part !== '')
            notes.push([
              '[DATA] VOICE',
              `来自：${options.senderName ?? options.senderId ?? '对方'}`,
              `转写：${heard.text}`,
              ...tone.length === 0 ? [] : [`语气/声音：${tone.join(' / ')}`],
              ...heard.language === undefined ? [] : [`语言：${heard.language}`],
              '这是对方发来的真实语音；直接按内容接话，不要复述“我听完了你的语音”。',
            ].join('\n'))
          } else {
            notes.push(`这条语音没转写${heard === undefined ? '' : `（${heard.reason}）`}；不要猜内容`)
          }
        }
        if (attachment.kind === 'video') {
          if (options.analyzeVideo === undefined) {
            notes.push('视频画面识别没有启用；原视频已保留。')
          } else {
            try {
              const analysis = await options.analyzeVideo(downloaded.data, downloaded.mediaType)
              for (const frame of analysis.frames) {
                const frameName = `${name}-frame-${String(Math.round(frame.timestampMs / 1000)).padStart(4, '0')}.jpg`
                try {
                  const image = await options.attachments.saveImage({ data: frame.data, mediaType: 'image/jpeg', name: frameName })
                  content.push({ type: 'image', attachment: image })
                  images.push({
                    image,
                    attachment: { kind: 'image', url: '', name: frameName, mediaType: 'image/jpeg' },
                    timestampMs: frame.timestampMs,
                  })
                } catch (error) {
                  notes.push(`视频 ${Math.round(frame.timestampMs / 1000)} 秒画面没能保存：${String(error instanceof Error ? error.message : error)}`)
                }
              }
              if (images.some(image => image.timestampMs !== undefined)) {
                notes.push([
                  '[DATA] VIDEO_FRAMES',
                  `按时间顺序提取 ${images.filter(image => image.timestampMs !== undefined).length} 张关键画面：${images.filter(image => image.timestampMs !== undefined).map(frame => `${((frame.timestampMs ?? 0) / 1000).toFixed(1)} 秒`).join('、')}。`,
                ].join('\n'))
              }
              if (analysis.frameFailure !== undefined) notes.push(`视频画面识别失败：${analysis.frameFailure}；原视频已保留。`)
              if (analysis.transcript?.ok === true) {
                notes.push([
                  '[DATA] VIDEO_AUDIO',
                  `转写：${analysis.transcript.text}`,
                  ...analysis.transcript.language === undefined ? [] : [`语言：${analysis.transcript.language}`],
                  ...analysis.transcript.emotion === undefined && analysis.transcript.event === undefined
                    ? [] : [`声音线索：${[analysis.transcript.emotion, analysis.transcript.event].filter(Boolean).join(' / ')}`],
                ].join('\n'))
              } else {
                const reason = analysis.audioFailure
                  ?? (options.asr === undefined ? '语音识别未启用' : '没有返回转写')
                notes.push(`视频音轨没能转写（${reason}）；画面识别仍可继续。`)
              }
            } catch (error) {
              notes.push(`视频分析失败：${String(error instanceof Error ? error.message : error)}；原视频已保留。`)
            }
          }
        }
      }
      saved += 1
    } catch (error) {
      failed += 1
      notes.push(`第 ${index + 1} 项${attachment.kind}没保存：${String(error instanceof Error ? error.message : error)}`)
    }
  }
  if (media.length > options.maxItems) notes.push(`附件超过 ${options.maxItems} 项，后面的没有处理`)
  return { content, notes, saved, failed, images }
}
