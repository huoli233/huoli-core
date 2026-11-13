// 图片只看一次会丢，这里按内容哈希保存，按权重和时效决定先看还是后看

import fs from 'node:fs'
import path from 'node:path'
import type { ImageAttachmentRef } from '@huoli/huoli-attachment'

/** 图片的初步类型，只作判断线索 */
export type ImageKind = 'sticker' | 'screenshot' | 'photo' | 'unknown'

/** 给模型看的图片类型名称 */
export function imageKindLabel(kind: ImageKind | undefined): string {
  if (kind === 'sticker') return '表情包或贴纸'
  if (kind === 'screenshot') return '截图或界面'
  if (kind === 'photo') return '照片'
  return '类型不确定'
}

/** 一张遇到的图片 */
export interface ImageRecord {
  /** 图片内容的哈希 */
  imageId: string
  /** 哪个聊天 */
  chatKey: string
  /** 哪条消息 */
  messageId: string
  /** 谁发的 */
  senderId: string
  /** 谁发的，显示名 */
  senderName: string
  /** 第一次看到的时间 */
  firstSeenAt: number
  /** 最近一次看到的时间 */
  lastSeenAt: number
  /** 看到过几次 */
  seenCount: number
  /** 基础兴趣权重 */
  weight: number
  /** 消息和画面形态给出的初步类型 */
  kind?: ImageKind
  /** 附件引用 */
  image: ImageAttachmentRef
  /** 快速看过的说明 */
  quickSummary?: string
  /** 深入看过的说明 */
  deepSummary?: string
  /** 最近一次查看时间 */
  lastViewedAt?: number
  /** 模型确认过的语义标签 */
  semanticTags?: string[]
  /** 这张图最适合带出的情绪 */
  emotion?: string
  /** 情绪强度，零到一 */
  emotionIntensity?: number
  /** 什么场景适合用 */
  useWhen?: string
  /** 最近一次标注时间 */
  annotatedAt?: number
  /** 之前决定暂时不看或跳过的次数 */
  skipCount?: number
  /** 最近一次明确跳过或暂时不看的时间 */
  skippedAt?: number
  /** 最近一次因旧图回看而提起的兴趣 */
  recallAt?: number
}

/** 收一张图片时记下的事实 */
export interface ImageRecordInput {
  chatKey: string
  messageId: string
  senderId: string
  senderName: string
  at: number
  image: ImageAttachmentRef
  weight: number
  kind?: ImageKind
}

interface StoredImages {
  version: 1
  items: ImageRecord[]
}

/** 图片档接口 */
export interface ImageArchive {
  /** 记一张图，重复内容只增加权重和次数 */
  record(input: ImageRecordInput): ImageRecord
  /** 按聊天找一张 */
  get(chatKey: string, imageId: string): ImageRecord | undefined
  /** 按当前权重和时效列出最近的图片 */
  recent(chatKey: string, now: number, limit: number): Array<ImageRecord & { score: number }>
  /** 记一次快速说明 */
  setQuick(imageId: string, chatKey: string, text: string, at: number): void
  /** 记一次深入说明 */
  setDeep(imageId: string, chatKey: string, text: string, at: number): void
  /** 加一点兴趣或查看权重 */
  boost(chatKey: string, imageId: string, amount: number): void
  /** 给图片补语义标签、情绪和使用场景 */
  annotate(chatKey: string, imageId: string, input: {
    tags: readonly string[]
    emotion?: string
    intensity?: number
    useWhen?: string
  }, at: number): void
  /** 记一次暂时不看或跳过 */
  skip(chatKey: string, imageId: string, at: number): void
  /** 记一次旧图回看 */
  recall(chatKey: string, imageId: string, at: number): void
  /** 落盘 */
  flush(): void
}

/** 建图片档的参数 */
export interface ImageArchiveOptions {
  /** 文件放哪 */
  file: string
  /** 最多留几张 */
  maxItems: number
  /** 权重随时间减半的小时数 */
  halfLifeHours: number
}

const HOUR_MS = 3_600_000

function read(file: string): StoredImages {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (value === null || typeof value !== 'object') return { version: 1, items: [] }
    const row = value as { version?: unknown; items?: unknown }
    if (row.version !== 1 || !Array.isArray(row.items)) return { version: 1, items: [] }
    return { version: 1, items: row.items.filter((item): item is ImageRecord => item !== null && typeof item === 'object') }
  } catch {
    return { version: 1, items: [] }
  }
}

function write(file: string, state: StoredImages): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * 建一个图片档
 * @param options 文件、数量与权重半衰
 * @returns 图片档接口
 */
export function createImageArchive(options: ImageArchiveOptions): ImageArchive {
  const maxItems = Math.max(1, Math.floor(options.maxItems))
  const halfLifeHours = Math.max(0.01, options.halfLifeHours)
  const state = read(options.file)

  const save = (): void => {
    state.items = state.items
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .slice(0, maxItems)
    write(options.file, state)
  }

  return {
    record(input) {
      const imageId = String(input.image.attachmentId)
      const found = state.items.find(item => item.chatKey === input.chatKey && item.imageId === imageId)
      if (found !== undefined) {
        found.lastSeenAt = input.at
        found.seenCount += 1
        found.weight = Math.min(100, found.weight + Math.max(1, Math.round(input.weight / 2)))
        if ((found.kind === undefined || found.kind === 'unknown') && input.kind !== undefined) found.kind = input.kind
        found.senderId = input.senderId
        found.senderName = input.senderName
        save()
        return { ...found }
      }
      const item: ImageRecord = {
        imageId,
        chatKey: input.chatKey,
        messageId: input.messageId,
        senderId: input.senderId,
        senderName: input.senderName,
        firstSeenAt: input.at,
        lastSeenAt: input.at,
        seenCount: 1,
        weight: Math.max(0, Math.min(100, input.weight)),
        image: input.image,
        ...input.kind === undefined ? {} : { kind: input.kind },
      }
      state.items.push(item)
      save()
      return { ...item }
    },
    get(chatKey, imageId) {
      return state.items.find(item => item.chatKey === chatKey && item.imageId === imageId)
    },
    recent(chatKey, now, limit) {
      return state.items
        .filter(item => item.chatKey === chatKey)
        .map((item) => {
          const ageHours = Math.max(0, now - item.lastSeenAt) / HOUR_MS
          const freshness = Math.pow(0.5, ageHours / halfLifeHours)
          const skippedRecently = item.skippedAt !== undefined
            && Math.max(0, now - item.skippedAt) < 30 * 60_000
          const repeated = Math.min(0.5, (item.seenCount - 1) * 0.1)
          const viewed = item.lastViewedAt !== undefined && Math.max(0, now - item.lastViewedAt) < 60 * 60_000
          const recalled = item.recallAt !== undefined && Math.max(0, now - item.recallAt) < 2 * HOUR_MS
          const interest = item.weight * freshness
            * (skippedRecently ? 0.5 : 1)
            * (viewed ? 0.75 : 1)
            * (1 - repeated)
            + (recalled ? 15 : 0)
          return { ...item, score: Math.min(100, Math.max(0, interest)) }
        })
        .sort((left, right) => right.score - left.score || right.lastSeenAt - left.lastSeenAt)
        .slice(0, Math.max(0, limit))
    },
    setQuick(imageId, chatKey, text, at) {
      const item = state.items.find(row => row.chatKey === chatKey && row.imageId === imageId)
      if (item === undefined) return
      item.quickSummary = text
      item.lastViewedAt = at
      save()
    },
    setDeep(imageId, chatKey, text, at) {
      const item = state.items.find(row => row.chatKey === chatKey && row.imageId === imageId)
      if (item === undefined) return
      item.deepSummary = text
      item.lastViewedAt = at
      save()
    },
    boost(chatKey, imageId, amount) {
      const item = state.items.find(row => row.chatKey === chatKey && row.imageId === imageId)
      if (item === undefined) return
      item.weight = Math.max(0, Math.min(100, item.weight + amount))
      save()
    },
    annotate(chatKey, imageId, input, at) {
      const item = state.items.find(row => row.chatKey === chatKey && row.imageId === imageId)
      if (item === undefined) return
      const tags = [...new Set(input.tags.map(tag => tag.trim()).filter(tag => tag !== ''))].slice(0, 12)
      item.semanticTags = tags
      if (input.emotion !== undefined && input.emotion.trim() !== '') item.emotion = input.emotion.trim()
      if (input.intensity !== undefined && Number.isFinite(input.intensity)) {
        item.emotionIntensity = Math.min(1, Math.max(0, input.intensity))
      }
      if (input.useWhen !== undefined && input.useWhen.trim() !== '') item.useWhen = input.useWhen.trim().slice(0, 120)
      item.annotatedAt = at
      save()
    },
    skip(chatKey, imageId, at) {
      const item = state.items.find(row => row.chatKey === chatKey && row.imageId === imageId)
      if (item === undefined) return
      item.skipCount = (item.skipCount ?? 0) + 1
      item.skippedAt = at
      item.weight = Math.max(0, item.weight - 8)
      save()
    },
    recall(chatKey, imageId, at) {
      const item = state.items.find(row => row.chatKey === chatKey && row.imageId === imageId)
      if (item === undefined) return
      item.recallAt = at
      item.lastSeenAt = Math.max(item.lastSeenAt, at)
      item.weight = Math.min(100, item.weight + 12)
      save()
    },
    flush() {
      save()
    },
  }
}
