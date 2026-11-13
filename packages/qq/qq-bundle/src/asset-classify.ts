// 让视觉模型把一份素材判成类别和内容事实，模型不可用时按扩展名粗分

import { createSystemMessage, createUserMessage } from '@huoli/huoli-llm'
import type { ImageAttachmentRef } from '@huoli/huoli-attachment'
import {
  ASSET_CATEGORY_DIRS,
  isAssetCategory,
  type AssetCategory,
  type AssetFacts,
} from './asset-store.ts'
import type { VisionLlmPort } from './vision.ts'

/** 一份素材的判读结果 */
export interface AssetClassification extends AssetFacts {
  /** 归到哪一类 */
  category: AssetCategory
  /** 形态名，例如表情包、梗图、截图 */
  kind: string
  /** 建议的子目录，只有一层 */
  subDir: string
  /** 判读来源：模型还是按扩展名兜底 */
  source: 'model' | 'fallback' | 'protocol'
}

/** 判读一次的参数 */
export interface AssetClassifyOptions {
  /** 用哪个提供方 */
  provider: string
  /** 用哪个模型 */
  model: string
  /** 最多生成多少 token */
  maxTokens: number
  /** 最多留多少字 */
  maxChars: number
  /** 最多等多久 */
  timeoutMs: number
  /** 平台给的文件名，兜底时看扩展名 */
  fileName: string
  /** 声明的内容类型 */
  mediaType: string
  /** 消息里这句话，帮助判断这张图要做什么 */
  hint?: string
}

/** 判读器 */
export type AssetClassifier = (
  image: ImageAttachmentRef,
  options: AssetClassifyOptions,
) => Promise<AssetClassification>

/** 建判读器要的模型预算 */
export interface AssetClassifierConfig {
  /** 用哪个提供方，空表示关闭 */
  provider: string
  /** 用哪个模型，空表示关闭 */
  model: string
  /** 最多生成多少 token */
  maxTokens: number
  /** 最多留多少字 */
  maxChars: number
  /** 最多等多久 */
  timeoutMs: number
}

const CLASSIFY_INSTRUCTION = [
  '[SYSTEM_LOAD] QQ_MEDIA_CLASSIFY',
  'TASK: classify_one_media_file_for_a_local_archive_and_later_reuse',
  'OUTPUT: exactly_one_json_object; no_prose; no_code_fence; no_text_outside_it',
  'FIELDS: category|tags|caption|ip|character|kind|emotion|intensity|topic|subDir|keep|favorite',
  'category_one_of: sticker|meme|screenshot|photo|illustration|selfie|document|video|audio|other',
  'sticker: 聊天里用来带情绪的表情包贴纸',
  'meme: 带梗、带文字玩笑或反差的网络图',
  'screenshot: 界面、聊天记录、报错、网页或表格的截图',
  'photo: 实拍照片',
  'illustration: 绘画、二次元插画、漫画页',
  'selfie: 自拍或人物自照',
  'document: 文档、票据、表单类图片',
  'video: 视频',
  'audio: 语音或音频',
  'other: 看不清或不属于上面任何一类',
  'caption: 中文，二十四字以内，只写看得见的内容',
  'tags: 三到六个中文词，写场景与情绪',
  'ip: 只写能认出来的作品名，认不出就空字符串',
  'character: 只写能认出来的角色名，认不出就空字符串',
  'kind: 中文形态名，例如表情包、梗图、截图、实拍照、插画',
  'emotion: 这张图带的情绪，没有就空字符串',
  'intensity: 零到一的小数，表示情绪强弱',
  'topic: 中文短词，用来建子目录，例如猫、群聊截图、风景',
  'subDir: 一层目录名，不带斜线和点号',
  'keep: 值得以后再看或再用就是 true',
  'favorite: 能反复当表情用的就是 true',
  'RULE: only_use_visible_content; never_invent_identity_franchise_or_relationship',
].join('\n')

const CATEGORY_ORDER: readonly AssetCategory[] = [
  'sticker', 'meme', 'screenshot', 'photo', 'illustration',
  'selfie', 'document', 'video', 'audio', 'other',
]

const MEDIA_TYPE_CATEGORIES: Readonly<Record<string, AssetCategory>> = {
  'image/gif': 'other',
  'image/jpeg': 'photo',
  'image/png': 'other',
  'image/webp': 'other',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'audio/amr': 'audio',
  'audio/mpeg': 'audio',
  'audio/ogg': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/zip': 'document',
  'text/plain': 'document',
}

const EXTENSION_CATEGORIES: Readonly<Record<string, AssetCategory>> = {
  gif: 'other',
  apng: 'other',
  jpg: 'photo',
  jpeg: 'photo',
  heic: 'photo',
  bmp: 'photo',
  png: 'other',
  webp: 'other',
  svg: 'other',
  mp4: 'video',
  mov: 'video',
  mkv: 'video',
  webm: 'video',
  avi: 'video',
  mp3: 'audio',
  amr: 'audio',
  silk: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  txt: 'document',
  md: 'document',
  csv: 'document',
  zip: 'document',
  rar: 'document',
  '7z': 'document',
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

function categoryOfExtension(fileName: string, mediaType: string): AssetCategory {
  const byExtension = EXTENSION_CATEGORIES[extensionOf(fileName)]
  if (byExtension !== undefined) return byExtension
  return MEDIA_TYPE_CATEGORIES[mediaType.toLowerCase()] ?? 'other'
}

/**
 * 按扩展名和声明类型粗分
 * @param input 文件名与内容类型
 * @returns 标了兜底的判读结果
 */
export function fallbackClassification(input: { fileName: string; mediaType: string }): AssetClassification {
  const category = categoryOfExtension(input.fileName, input.mediaType)
  const kind = ASSET_CATEGORY_DIRS[category]
  return {
    category,
    kind,
    subDir: '',
    topic: '',
    caption: `按扩展名认成${kind}`,
    tags: [kind],
    keep: true,
    favorite: false,
    source: 'fallback',
  }
}

/**
 * 判读来源给模型看的一句话
 * @param source 判读来源
 * @returns 中文说明
 */
export function classificationSourceLabel(source: 'model' | 'fallback' | 'protocol'): string {
  if (source === 'model') return '模型判类'
  if (source === 'protocol') return 'QQ 消息段标记'
  return '按扩展名粗分'
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function textField(row: Record<string, unknown>, key: string, maxChars: number): string {
  const value = row[key]
  return typeof value === 'string' ? value.trim().slice(0, maxChars) : ''
}

function listField(row: Record<string, unknown>, key: string, maxItems: number): string[] {
  const value = row[key]
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, 12))
    .filter(item => item !== '')
    .slice(0, maxItems)
}

function categoryOfRow(row: Record<string, unknown>): AssetCategory | undefined {
  const raw = textField(row, 'category', 24).toLowerCase()
  if (isAssetCategory(raw)) return raw
  const kind = textField(row, 'kind', 12)
  for (const key of CATEGORY_ORDER) {
    if (kind.includes(ASSET_CATEGORY_DIRS[key])) return key
  }
  return undefined
}

function floatField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const scaled = value > 1 ? value / 100 : value
  return Math.min(1, Math.max(0, scaled))
}

/**
 * 把模型输出的一段文字读成判读结果
 * @param text 模型输出
 * @param input 文件名与内容类型，类别读不出来时兜底
 * @returns 判读结果，读不出类别时是兜底结果
 */
export function parseClassification(
  text: string,
  input: { fileName: string; mediaType: string },
): AssetClassification {
  const row = parseJsonObject(text)
  const category = row === undefined ? undefined : categoryOfRow(row)
  if (row === undefined || category === undefined) return fallbackClassification(input)
  const ip = textField(row, 'ip', 20)
  const character = textField(row, 'character', 20)
  const emotion = textField(row, 'emotion', 12)
  const intensity = floatField(row, 'intensity')
  return {
    category,
    kind: textField(row, 'kind', 12) || ASSET_CATEGORY_DIRS[category],
    subDir: textField(row, 'subDir', 12),
    topic: textField(row, 'topic', 12),
    caption: textField(row, 'caption', 24),
    tags: listField(row, 'tags', 6),
    ...ip === '' ? {} : { ip },
    ...character === '' ? {} : { character },
    ...emotion === '' ? {} : { emotion },
    ...intensity === undefined ? {} : { intensity },
    keep: row.keep !== false,
    favorite: row.favorite === true,
    source: 'model',
  }
}

/**
 * 让视觉模型判读一张图片
 * @param llm 模型服务
 * @param image 已经保存的图片
 * @param options 模型、预算和文件事实
 * @returns 判读结果，模型输出读不出来时按扩展名兜底
 */
export async function classifyAsset(
  llm: VisionLlmPort,
  image: ImageAttachmentRef,
  options: AssetClassifyOptions,
): Promise<AssetClassification> {
  const fallback = (): AssetClassification => fallbackClassification({
    fileName: options.fileName,
    mediaType: options.mediaType,
  })
  const system = createSystemMessage(CLASSIFY_INSTRUCTION)
  const message = createUserMessage({
    content: [
      {
        type: 'text',
        text: `FILE_NAME: ${options.fileName || 'unknown'}\nMEDIA_TYPE: ${options.mediaType || 'unknown'}\nCHAT_LINE: ${options.hint?.trim() || 'none'}`,
      },
      { type: 'image', attachment: image },
    ],
    source: { kind: 'user' },
  })
  let text = ''
  try {
    for await (const chunk of llm.stream({
      provider: options.provider,
      model: options.model,
      messages: [system, message],
      maxTokens: options.maxTokens,
      signal: AbortSignal.timeout(options.timeoutMs),
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
    }
  } catch {
    return fallback()
  }
  const kept = text.trim().slice(0, Math.max(1, options.maxChars))
  if (kept === '') return fallback()
  return parseClassification(kept, { fileName: options.fileName, mediaType: options.mediaType })
}

/**
 * 按配置建一个判读器
 * @param llm 模型服务
 * @param config 提供方、模型与预算
 * @returns 判读器，没有视觉模型时为空
 */
export function createAssetClassifier(
  llm: VisionLlmPort | undefined,
  config: AssetClassifierConfig,
): AssetClassifier | undefined {
  if (llm === undefined || config.provider === '' || config.model === '') return undefined
  const fixed = {
    provider: config.provider,
    model: config.model,
    maxTokens: Math.max(1, config.maxTokens),
    maxChars: Math.max(1, config.maxChars),
    timeoutMs: Math.max(1, config.timeoutMs),
  }
  return (image, options) => classifyAsset(llm, image, { ...fixed, ...options })
}

/** 一段模型可读的素材事实 */
export interface AssetFactLine {
  /** 落在项目图片目录里的相对路径 */
  relative: string
  /** 归到哪一类 */
  kind: string
  /** 一句内容说明 */
  caption: string
  /** 情绪 */
  emotion: string
  /** 判读来源 */
  source: 'model' | 'fallback' | 'protocol'
}

/**
 * 把落盘事实拼成一句给模型看的话
 * @param line 落盘事实
 * @returns 中文一行
 */
export function assetFactText(line: AssetFactLine): string {
  const parts = [line.kind, line.caption === '' ? '' : `内容：${line.caption}`, line.emotion === '' ? '' : `情绪：${line.emotion}`]
    .filter(part => part !== '')
  return `${line.relative}｜${parts.join('｜')}｜${classificationSourceLabel(line.source)}`
}
