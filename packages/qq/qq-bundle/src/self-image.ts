// 自画像比对：参考图 + 当前图交给视觉模型，只输出可解释的身份等级

import fs from 'node:fs'
import path from 'node:path'
import type { Context } from '@huoli/cordis'
import type { ImageAttachmentRef } from '@huoli/huoli-attachment'
import { createSystemMessage, createUserMessage, type StreamChunk } from '@huoli/huoli-llm'
import { defineTool } from '@huoli/huoli-tools'
import type { JsonValue } from '@huoli/huoli-util-values'
import type { ImageArchive } from './image-archive.ts'
import type { Config } from './types.ts'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import { ensurePublicUrl } from './weblinks.ts'

/** 自我识别需要的最小附件保存能力 */
interface ReferenceWriter {
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<ImageAttachmentRef>
}

/** 自我识别的参数 */
export interface SelfImageOptions {
  archive: ImageArchive
  llm: {
    stream(options: {
      provider: string
      model: string
      messages: unknown[]
      maxTokens: number
      signal?: AbortSignal
    }): AsyncIterable<StreamChunk>
  } | undefined
  provider: string
  model: string
  selfId: string
  attachments: ReferenceWriter | undefined
  referenceImages: readonly string[]
  referenceDescription: string
  maxBytes: number
  maxReferences: number
  timeoutMs: number
  maxTokens: number
}

/** 一次自我识别结果 */
export interface SelfImageVerdict extends Record<string, JsonValue> {
  ok: true
  imageId: string
  level: 'exact' | 'likely' | 'possible' | 'not-self' | 'unknown'
  confidence: number
  isSelf: string
  behavior: string
  clothing: string
  scene: string
  people: string
  actions: string
  matchedFeatures: string[]
  differences: string[]
  note: string
  referenceCount: number
}

const SELF_SYSTEM = [
  '[SYSTEM_LOAD] QQ_SELF_IMAGE_IDENTIFY',
  'TASK: compare_reference_images_with_target_image; decide_if_same_character',
  'PERSPECTIVE: first_person_self_check; compare_as_self_not_art_critic',
  'REFERENCE_SCOPE: avatar|configured_persona_images',
  'OUTPUT: compact_JSON_only',
  'FIELDS: is_self=yes|likely|possible|no|unknown; confidence=0..1; matched_features[]; differences[]; clothing; scene; people; actions; note',
  'MATCH_ITEMS: hair_color|hair_shape|eye_color|signature_body_part|tail|fin|ear|accessory|clothing_palette|silhouette',
  'STYLE_RULE: different_art_style|Q_version|cosplay|outfit_change|meme_edit does_not_mean_not_self',
  'TEXT_RULE: transcribe_only_visible_text; do_not_infer_identity_from_text_alone',
  'SELF_RULE: no_reference_or_unclear_feature -> is_self=unknown',
  'SAFETY: no_identity_or_age_guess|no_relationship_guess|no_offscreen_content',
].join('\n')

function mediaTypeOf(value: string): string {
  const lower = value.split('?')[0]?.split('#')[0]?.toLowerCase() ?? ''
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

async function boundedBytes(url: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`self_image.http_${response.status}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > maxBytes) throw new Error('self_image.too_large')
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength > maxBytes) throw new Error('self_image.too_large')
  return data
}

async function loadReference(
  source: string,
  writer: ReferenceWriter | undefined,
  maxBytes: number,
  signal: AbortSignal,
): Promise<ImageAttachmentRef | undefined> {
  if (writer === undefined || source.trim() === '') return undefined
  try {
    const local = source.startsWith('http://') || source.startsWith('https://')
      ? undefined
      : path.resolve(source)
    let data: Uint8Array
    if (local !== undefined) {
      const stat = fs.statSync(local)
      if (!stat.isFile() || stat.size > maxBytes) return undefined
      data = fs.readFileSync(local)
    } else {
      await ensurePublicUrl(source)
      data = await boundedBytes(source, maxBytes, signal)
    }
    return await writer.saveImage({
      data,
      mediaType: mediaTypeOf(local ?? source),
      name: path.basename(local ?? new URL(source).pathname),
    })
  } catch {
    return undefined
  }
}

function parseVerdict(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap(item => typeof item === 'string' && item.trim() !== '' ? [item.trim().slice(0, 100)] : []).slice(0, 12)
    : []
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 300) : ''
}

/**
 * 加载参考图并做一次自我识别
 * @param options - 图片档、视觉模型、头像与参考图
 * @param chatKey - 当前聊天
 * @param imageId - 待判断图片哈希
 * @param clue - 聊天里的身份线索
 * @returns 五档结论
 */
export async function identifySelf(
  options: SelfImageOptions,
  chatKey: string,
  imageId: string,
  clue = '',
): Promise<SelfImageVerdict> {
  const target = options.archive.get(chatKey, imageId)
  if (target === undefined) throw new Error('self_image.not_found')
  if (options.attachments === undefined) throw new Error('self_image.attachments_unavailable')
  const sources = [
    ...options.selfId === '' ? [] : [`https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(options.selfId)}&s=640`],
    ...options.referenceImages,
  ].filter((item, index, all) => item.trim() !== '' && all.indexOf(item) === index)
  const signal = AbortSignal.timeout(options.timeoutMs)
  const references: ImageAttachmentRef[] = []
  for (const source of sources.slice(0, Math.max(1, options.maxReferences))) {
    const ref = await loadReference(source, options.attachments, options.maxBytes, signal)
    if (ref !== undefined) references.push(ref)
  }
  if (references.length === 0) throw new Error('self_image.no_reference')
  if (references.some(item => item.attachmentId === target.image.attachmentId)) {
    return {
      ok: true, imageId, level: 'exact', confidence: 1, isSelf: 'yes',
      behavior: 'claim_naturally',
      clothing: '', scene: '', people: '', actions: '',
      matchedFeatures: ['hash_equal'], differences: [], note: 'target_matches_reference_hash',
      referenceCount: references.length,
    }
  }
  if (options.llm === undefined || options.provider === '' || options.model === '') throw new Error('self_image.vision_unavailable')
  const system = createSystemMessage(`${SELF_SYSTEM}\nREFERENCE_FEATURES: ${options.referenceDescription || 'none; compare images directly'}`)
  const user = createUserMessage({
    content: [
      { type: 'text', text: `REFERENCE_IMAGES: ${references.length}\nTEXT_CLUE: ${clue.trim().slice(0, 300) || 'none'}\nTARGET_IMAGE: follows_references` },
      ...references.map(ref => ({ type: 'image' as const, attachment: ref })),
      { type: 'image' as const, attachment: target.image },
    ],
    source: { kind: 'user' },
  })
  let text = ''
  for await (const chunk of options.llm.stream({
    provider: options.provider,
    model: options.model,
    messages: [system, user],
    maxTokens: options.maxTokens,
    signal,
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  const parsed = parseVerdict(text)
  if (parsed === undefined) throw new Error('self_image.invalid_json')
  const raw = textOf(parsed.is_self).toLowerCase()
  const isSelf = ['yes', 'likely', 'possible', 'no', 'unknown'].includes(raw) ? raw : 'unknown'
  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0
  const level = isSelf === 'no'
    ? 'not-self'
    : isSelf === 'yes'
      ? confidence >= 0.6 ? 'likely' : 'possible'
      : isSelf === 'likely' ? 'likely'
        : isSelf === 'possible' ? 'possible' : 'unknown'
  return {
    ok: true,
    imageId,
    level,
    confidence,
    isSelf,
    behavior: level === 'likely' ? 'claim_with_uncertainty' : level === 'possible' ? 'do_not_claim' : level === 'not-self' ? 'ordinary_image' : 'say_uncertain',
    clothing: textOf(parsed.clothing),
    scene: textOf(parsed.scene),
    people: textOf(parsed.people),
    actions: textOf(parsed.actions),
    matchedFeatures: stringsOf(parsed.matched_features),
    differences: stringsOf(parsed.differences),
    note: textOf(parsed.note),
    referenceCount: references.length,
  }
}

/**
 * 挂上自画像识别工具
 * @param ctx 运行环境
 * @param options 自我识别依赖
 * @returns 撤下函数
 */
export function registerSelfImageTool(ctx: Context, options: SelfImageOptions): () => void {
  return ctx.tools.register(defineTool({
    name: 'qq_identify_self',
    description: '判断这个聊天里的一张图是不是机器人自己。先用参考形象图和当前头像逐项比对发色、发型、瞳色、尾巴/鳍/耳鳍、发饰、服装主配色与轮廓；画风不同、Q版、换装或不完整二创不直接否定。没有参考图或看不清时说不确定，不猜。',
    parameters: {
      image_id: { type: 'string', description: '从 qq_image_list 拿到的图片哈希。' },
      text_clue: { type: 'string', description: '聊天里和这张图有关的原话线索，例如“这不就是你”。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const imageId = typeof args.image_id === 'string' ? args.image_id.trim() : ''
      if (imageId === '') throw new Error('self_image.no_id: 没给图片哈希; NEXT: 先用 qq_image_list 找一张')
      const chatKey = String(exec.agent?.id ?? '')
      if (chatKey === '') throw new Error('self_image.no_chat: 这次调用没有会话; NEXT: 从当前聊天调用')
      const clue = typeof args.text_clue === 'string' ? args.text_clue : ''
      return identifySelf(options, chatKey, imageId, clue)
    },
  }))
}

/** 从组合包配置取自我识别参数 */
export function selfImageOptions(
  config: Config,
  archive: ImageArchive,
  llm: SelfImageOptions['llm'],
  attachments: ReferenceWriter | undefined,
  selfId: string,
  provider: string,
  model: string,
): SelfImageOptions {
  return {
    archive,
    llm,
    provider,
    model,
    selfId,
    attachments,
    referenceImages: config.selfReferenceImages ?? BUNDLE_DEFAULTS.selfReferenceImages,
    referenceDescription: config.selfReferenceDescription ?? BUNDLE_DEFAULTS.selfReferenceDescription,
    maxBytes: Math.max(1, config.selfImageMaxBytes ?? BUNDLE_DEFAULTS.selfImageMaxBytes),
    maxReferences: Math.max(1, Math.min(8, config.selfImageMaxReferences ?? BUNDLE_DEFAULTS.selfImageMaxReferences)),
    timeoutMs: Math.max(5_000, config.visionTimeoutMs ?? BUNDLE_DEFAULTS.visionTimeoutMs),
    maxTokens: Math.max(400, config.visionMaxTokens ?? BUNDLE_DEFAULTS.visionMaxTokens),
  }
}
