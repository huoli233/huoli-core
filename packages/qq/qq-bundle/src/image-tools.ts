// 图片记忆工具：先列出旧图，再按这张图自己的问题重看

import type { Context } from '@huoli/cordis'
import type { ImageAttachmentRef } from '@huoli/huoli-attachment'
import type { ContentBlock } from '@huoli/huoli-llm'
import { defineTool } from '@huoli/huoli-tools'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import type { ImageArchive, ImageKind } from './image-archive.ts'
import { imageKindLabel } from './image-archive.ts'
import type { MediaBudget } from './media-budget.ts'

const MAX_VISION_BATCH_IMAGES = 16
const MAX_VISION_BATCH_BYTES = 64 * 1024 * 1024

export type ImageContentBlock = Extract<ContentBlock, { type: 'image' }>

/**
 * 判断附件是不是图片
 * @param item - 模型附件
 * @returns 图片附件时返回真
 */
export function isImageContentBlock(item: ContentBlock): item is ImageContentBlock {
  return item.type === 'image'
}

/**
 * 解析一批最多几张图片
 * @param value - 配置值
 * @returns 一到硬上限之间的整数
 */
export function visionBatchLimit(value: number | undefined): number {
  const requested = value ?? BUNDLE_DEFAULTS.visionBatchMaxImages
  return Number.isFinite(requested)
    ? Math.min(MAX_VISION_BATCH_IMAGES, Math.max(1, Math.floor(requested)))
    : BUNDLE_DEFAULTS.visionBatchMaxImages
}

/**
 * 解析一批图片的字节预算
 * @param value - 配置值
 * @returns 一到硬上限之间的整数
 */
export function visionBatchByteLimit(value: number | undefined): number {
  const requested = value ?? BUNDLE_DEFAULTS.visionBatchMaxBytes
  return Number.isFinite(requested)
    ? Math.min(MAX_VISION_BATCH_BYTES, Math.max(1, Math.floor(requested)))
    : BUNDLE_DEFAULTS.visionBatchMaxBytes
}

/**
 * 按接收顺序选入预算内的图片
 * @param attachments - 当前消息附件
 * @param maxImages - 最多几张
 * @param maxBytes - 总字节上限
 * @returns 选中的图片、字节和未选数量
 */
export function selectVisionImages(
  attachments: readonly ContentBlock[],
  maxImages: number,
  maxBytes: number,
): { images: ImageContentBlock[]; bytes: number; omitted: number } {
  const allImages = attachments.filter(isImageContentBlock)
  const images: ImageContentBlock[] = []
  let bytes = 0
  for (const item of allImages) {
    if (images.length >= maxImages || !Number.isSafeInteger(item.attachment.bytes) || item.attachment.bytes <= 0
      || item.attachment.bytes > maxBytes - bytes) break
    images.push(item)
    bytes += item.attachment.bytes
  }
  return { images, bytes, omitted: allImages.length - images.length }
}

/** 重看图片的能力 */
export type ImageViewer = (
  image: ImageAttachmentRef,
  options: { focus?: string; deep?: boolean; kind?: ImageKind },
) => Promise<string>

/** 图片工具要用到的东西 */
export interface ImageToolDeps {
  /** 图片档 */
  archive: ImageArchive
  /** 视觉模型，没接上时工具会明确拒绝 */
  viewer: ImageViewer | undefined
  /** 最多列几张 */
  listMax: number
  /** 回看旧图时提起兴趣 */
  recall?: (chatKey: string, imageId: string, at: number) => void
  /** 主动回看也消耗同一份媒体预算 */
  mediaBudget?: Pick<MediaBudget, 'consume'>
}

function chatKeyOf(exec: { agent?: { id: string } }): string {
  const id = exec.agent?.id
  if (id === undefined || id === '') throw new Error('image.no_chat: 这次调用没有会话｜下一步: 从带会话的入口调用')
  return id
}

function refuse(code: string, reason: string, hint: string): never {
  throw new Error(`${code}: ${reason}｜下一步: ${hint}`)
}

/**
 * 挂上图片记忆工具
 * @param ctx 运行环境
 * @param deps 图片档与视觉模型
 * @returns 撤掉两个工具的函数
 */
export function registerImageTools(ctx: Context, deps: ImageToolDeps): () => void {
  const offList = ctx.tools.register(defineTool({
    name: 'qq_image_list',
    description: '列出这个聊天见过的图片。只在要回看旧图、或对方问起以前那张图时用；不是每张新图都要列。每张有内容哈希、权重、时间、快速说明和深入说明。想看哪张，把哈希交给 qq_image_view；不要凭旧摘要假装看过细节。',
    parameters: {
      limit: { type: 'number', description: '最多列几张，不填给十张。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const asked = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 10
      const items = deps.archive.recent(chatKey, Date.now(), Math.min(deps.listMax, Math.max(1, Math.floor(asked))))
        .map(item => ({
          imageId: item.imageId,
          messageId: item.messageId,
          senderName: item.senderName,
          firstSeenAt: item.firstSeenAt,
          lastSeenAt: item.lastSeenAt,
          seenCount: item.seenCount,
          weight: item.weight,
          kind: item.kind ?? 'unknown',
          kindLabel: imageKindLabel(item.kind),
          score: item.score,
          quickSummary: item.quickSummary ?? '',
          deepSummary: item.deepSummary ?? '',
          semanticTags: item.semanticTags ?? [],
          emotion: item.emotion ?? '',
          emotionIntensity: item.emotionIntensity ?? null,
          useWhen: item.useWhen ?? '',
        }))
      return Promise.resolve({ count: items.length, items })
    },
  }))

  const offView = ctx.tools.register(defineTool({
    name: 'qq_image_view',
    description: '重新打开这个聊天里的一张旧图片。只在要确认图里的具体信息时用；表情包、贴纸、梗图不要为了识别而调用，先按聊天情绪接。要说明你现在想看什么；需要仔细检查时把 deep 设成 true。结果只描述实际可见内容，不猜人物身份。',
    parameters: {
      image_id: { type: 'string', description: '图片内容哈希，从 qq_image_list 拿。' },
      question: { type: 'string', description: '这次想确认什么，例如数人数、读文字、看动作或看背景。' },
      deep: { type: 'boolean', description: '是否做更细的二轮检查，不填为快速看。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const imageId = typeof args.image_id === 'string' ? args.image_id.trim() : ''
      if (imageId === '') refuse('image.no_id', '没给图片哈希', '先用 qq_image_list 找一张')
      const record = deps.archive.get(chatKey, imageId)
      if (record === undefined) refuse('image.not_found', '这个聊天里没有这张图', '先用 qq_image_list 看看有哪些')
      if (deps.viewer === undefined) refuse('image.vision_unavailable', '视觉模型没接上', '等视觉能力装配好再看')
      if (deps.mediaBudget !== undefined) {
        const decision = deps.mediaBudget.consume({
          kind: 'image',
          at: Date.now(),
          group: chatKey.startsWith('group:'),
          key: `${chatKey}:view:${imageId}:${Date.now()}`,
        })
        if (!decision.ok) {
          refuse(decision.code ?? 'media.blocked', decision.reason ?? '当前媒体预算不足', '先歇一会儿，或者按已有摘要聊')
        }
      }
      deps.recall?.(chatKey, imageId, Date.now())
      const question = typeof args.question === 'string' && args.question.trim() !== ''
        ? args.question.trim()
        : '按画面实际内容谨慎说明'
      const deep = args.deep === true
      const text = await deps.viewer(record.image, {
        focus: question,
        deep,
        ...record.kind === undefined ? {} : { kind: record.kind },
      })
      if (deep) deps.archive.setDeep(imageId, chatKey, text, Date.now())
      else deps.archive.setQuick(imageId, chatKey, text, Date.now())
      deps.archive.boost(chatKey, imageId, deep ? 8 : 4)
      return { imageId, deep, text }
    },
  }))
  const offAnnotate = ctx.tools.register(defineTool({
    name: 'qq_image_annotate',
    description: '给一张已经真正看过的图片保存语义标签、情绪、强度和使用场景。表情包和梗图尤其适合；只看清内容时也可以不标情绪。',
    parameters: {
      image_id: { type: 'string', description: '图片内容哈希。' },
      tags: { type: 'array', description: '最多十二个语义标签。' },
      emotion: { type: 'string', description: '这张图最适合带出的情绪。' },
      intensity: { type: 'number', description: '情绪强度，零到一。' },
      use_when: { type: 'string', description: '什么场景适合用。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const imageId = typeof args.image_id === 'string' ? args.image_id.trim() : ''
      if (imageId === '') refuse('image.no_id', '没给图片哈希', '先用 qq_image_list 找一张')
      const record = deps.archive.get(chatKey, imageId)
      if (record === undefined) refuse('image.not_found', '这个聊天里没有这张图', '先用 qq_image_list 看看有哪些')
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((tag): tag is string => typeof tag === 'string')
        : []
      deps.archive.annotate(chatKey, imageId, {
        tags,
        ...typeof args.emotion === 'string' ? { emotion: args.emotion } : {},
        ...typeof args.intensity === 'number' ? { intensity: args.intensity } : {},
        ...typeof args.use_when === 'string' ? { useWhen: args.use_when } : {},
      }, Date.now())
      return Promise.resolve({ ok: true, imageId, tags: tags.slice(0, 12) })
    },
  }))
  return () => {
    offList()
    offView()
    offAnnotate()
  }
}
