// 收到的图片和文件放进项目里的图片目录，按内容分类分目录，并按档位清理

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** 素材类别，每一类有自己的中文目录 */
export type AssetCategory =
  | 'sticker' | 'meme' | 'screenshot' | 'photo' | 'illustration'
  | 'selfie' | 'document' | 'video' | 'audio' | 'other'

/** 每类对应的目录名 */
export const ASSET_CATEGORY_DIRS: Readonly<Record<AssetCategory, string>> = {
  sticker: '表情包',
  meme: '梗图',
  screenshot: '截图',
  photo: '实拍',
  illustration: '插画',
  selfie: '自拍',
  document: '文档',
  video: '视频',
  audio: '音频',
  other: '其它',
}

/** 没有主题或角色时用的子目录 */
export const ASSET_FALLBACK_TOPIC = '未分类'

/** 四档：刚到的缓存、正常、收藏、冷归档 */
export type AssetTier = 'cache' | 'normal' | 'favorite' | 'archive'

/** 判读给出的落盘事实 */
export interface AssetFacts {
  /** 归到哪一类 */
  category: AssetCategory
  /** 形态名，例如表情包、梗图 */
  kind?: string
  /** 主题或角色，用作子目录 */
  topic?: string
  /** 出自哪个作品 */
  ip?: string
  /** 哪个角色 */
  character?: string
  /** 这张画带的情绪 */
  emotion?: string
  /** 情绪强度，零到一 */
  intensity?: number
  /** 一句内容说明 */
  caption?: string
  /** 场景与情绪词 */
  tags?: readonly string[]
  /** 值不值得留着，假就先进缓存档 */
  keep?: boolean
  /** 是不是要收进收藏档 */
  favorite?: boolean
}

/** 目录里的一条素材 */
export interface StoredAsset {
  /** 内容短哈希，找图和文件名都用它 */
  id: string
  /** 归到哪一类 */
  category: AssetCategory
  /** 现在在哪一档 */
  tier: AssetTier
  /** 完整路径 */
  file: string
  /** 相对图片目录的路径 */
  relative: string
  /** 多少字节 */
  bytes: number
  /** 内容类型 */
  mediaType: string
  /** 主题或角色那层目录名 */
  topic: string
  /** 一句内容说明 */
  caption: string
  /** 场景与情绪词 */
  tags: string[]
  /** 出自哪个作品 */
  ip?: string
  /** 哪个角色 */
  character?: string
  /** 这张画带的情绪 */
  emotion?: string
  /** 情绪强度，零到一 */
  intensity?: number
  /** 第一次存下来的时间 */
  createdAt: number
  /** 最近一次拿到这份内容的时间 */
  lastSeenAt: number
  /** 拿到过几次 */
  hits: number
  /** 收藏档的权重倍数，其它档是一 */
  baseWeight: number
  /** 哪个聊天 */
  chatKey?: string
  /** 哪条消息 */
  messageId?: string
  /** 谁发的 */
  senderId?: string
  /** 谁发的，显示名 */
  senderName?: string
  /** 同时收进表情包库时的编号 */
  stickerId?: string
}

/** 存一份素材要给的东西 */
export interface SaveAssetInput {
  /** 内容字节 */
  data: Uint8Array
  /** 判读结果 */
  facts: AssetFacts
  /** 内容类型 */
  mediaType: string
  /** 扩展名，带点 */
  extension: string
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

/** 一次清理的结果 */
export interface AssetSweepResult {
  /** 删掉几份缓存 */
  removedCache: number
  /** 几份降到冷归档档 */
  archived: number
  /** 因总量上限删掉几份冷档 */
  removedArchive: number
  /** 清理后各档几条 */
  counts: Readonly<Record<AssetTier, number>>
}

/** 素材目录 */
export interface AssetStore {
  /** 图片目录的根 */
  readonly root: string
  /** 存一份，同内容只加次数不重复写文件 */
  save(input: SaveAssetInput): StoredAsset
  /** 按编号找一份 */
  get(id: string): StoredAsset | undefined
  /** 加一点权重，缓存档顺便升成正常档 */
  boost(id: string, amount: number, at: number): void
  /** 按权重和时效列出最近的几份 */
  list(now: number, limit: number): Array<StoredAsset & { weight: number }>
  /** 按档位清理并落盘 */
  sweep(now: number): AssetSweepResult
  /** 只把索引落盘 */
  flush(): void
}

/** 建素材目录的参数 */
export interface AssetStoreOptions {
  /** 图片目录的根 */
  root: string
  /** 索引文件 */
  indexFile: string
  /** 表情包库文件，要与通道读的那一份是同一个文件 */
  stickerFile: string
  /** 索引最多留几条 */
  maxItems: number
  /** 权重减半要多少小时 */
  halfLifeHours: number
  /** 收藏档的权重倍数 */
  favoriteWeight: number
  /** 权重低于这条线就降到冷归档档 */
  archiveBelowWeight: number
  /** 缓存档最多留多久 */
  cacheMaxAgeHours: number
  /** 缓存档最多留几条 */
  cacheMaxItems: number
}

/** 表情包库里的一条，字段与通道读的那份表一致 */
export interface StickerRecord {
  /** 编号，发的时候用它 */
  id: string
  /** 一句什么时候用得上 */
  tag: string
  /** 场景词 */
  tags: string[]
  /** 适合带出的情绪 */
  emotions: string[]
  /** 情绪强度，零到一，没标就是空 */
  intensity: number | null
  /** 一句使用说明 */
  usage: string
  /** 图在项目里的位置 */
  file: string
}

interface StoredIndex {
  version: 1
  items: StoredAsset[]
}

const HOUR_MS = 3_600_000
const INDEX_VERSION = 1
const SEGMENT_MAX = 20
const ID_HEX = 12

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu
const ILLEGAL_CHARS = /[\u0000-\u001f<>:"/\\|?*]/gu

/**
 * 类别是否认识
 * @param value 待查的名字
 * @returns 认识就是真
 */
export function isAssetCategory(value: string): value is AssetCategory {
  return Object.hasOwn(ASSET_CATEGORY_DIRS, value)
}

/**
 * 把一段名字清理成能当目录或文件名用的样子
 * @param raw 原始名字，可能带分隔符或控制字符
 * @param fallback 清理后为空时用它
 * @param maxLength 最多留几个字
 * @returns 可用的名字片段
 */
export function safeSegment(raw: string, fallback: string, maxLength = SEGMENT_MAX): string {
  const stripped = raw.replace(ILLEGAL_CHARS, '').replace(/\s+/gu, ' ').trim()
  const trimmed = stripped.replace(/^[.\s]+/u, '').replace(/[.\s]+$/u, '')
  const cut = Array.from(trimmed).slice(0, Math.max(1, Math.floor(maxLength))).join('')
  if (cut === '' || RESERVED.test(cut)) return fallback
  return cut
}

/**
 * 在图片目录里拼一条路径，绝对路径和跳出根的分段直接拒绝
 * @param root 图片目录的根
 * @param segments 相对分段，可带子目录
 * @returns 根内的完整路径
 */
export function resolveMediaPath(root: string, ...segments: readonly string[]): string {
  const usable = segments.filter(segment => segment !== '')
  if (usable.length === 0) throw new Error('media.unsafe_path: 没有给路径')
  const base = path.resolve(root)
  for (const segment of usable) {
    if (path.isAbsolute(segment) || /^[a-zA-Z]:/u.test(segment)) throw new Error(`media.unsafe_path: ${segment}`)
    const parts = segment.split(/[\\/]+/u)
    if (parts.some(part => part === '..' || part === '.' || part === '')) {
      throw new Error(`media.unsafe_path: ${segment}`)
    }
  }
  const target = path.resolve(base, ...usable)
  const relative = path.relative(base, target)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`media.unsafe_path: ${target}`)
  }
  return target
}

/**
 * 路径是不是在根里面
 * @param root 根
 * @param target 待查路径
 * @returns 在里面就是真
 */
export function isInsideMediaRoot(root: string, target: string): boolean {
  const base = path.resolve(root)
  const relative = path.relative(base, path.resolve(target))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * 一条素材现在的权重
 * @param asset 素材
 * @param now 当前时刻
 * @param halfLifeHours 权重减半要多少小时
 * @returns 衰减后的权重
 */
export function assetWeight(
  asset: Pick<StoredAsset, 'baseWeight' | 'lastSeenAt'>,
  now: number,
  halfLifeHours: number,
): number {
  const ageHours = Math.max(0, now - asset.lastSeenAt) / HOUR_MS
  return asset.baseWeight * Math.pow(0.5, ageHours / Math.max(0.01, halfLifeHours))
}

function shortHash(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex').slice(0, ID_HEX)
}

function readIndex(file: string): StoredIndex {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (value === null || typeof value !== 'object') return { version: INDEX_VERSION, items: [] }
    const row = value as { version?: unknown; items?: unknown }
    if (row.version !== INDEX_VERSION || !Array.isArray(row.items)) return { version: INDEX_VERSION, items: [] }
    const items = row.items.filter((item): item is StoredAsset => item !== null
      && typeof item === 'object'
      && typeof (item as { id?: unknown }).id === 'string'
      && typeof (item as { file?: unknown }).file === 'string')
    return { version: INDEX_VERSION, items }
  } catch {
    return { version: INDEX_VERSION, items: [] }
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

function readJsonArray(file: string): unknown[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function asStickerRecord(raw: unknown): StickerRecord | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.file !== 'string') return undefined
  if (row.id === '' || row.file === '') return undefined
  return {
    id: row.id,
    tag: typeof row.tag === 'string' ? row.tag : '',
    tags: Array.isArray(row.tags) ? row.tags.filter((item): item is string => typeof item === 'string') : [],
    emotions: Array.isArray(row.emotions) ? row.emotions.filter((item): item is string => typeof item === 'string') : [],
    intensity: typeof row.intensity === 'number' && Number.isFinite(row.intensity) ? row.intensity : null,
    usage: typeof row.usage === 'string' ? row.usage : '',
    file: row.file,
  }
}

/**
 * 读表情包库
 * @param file 库文件
 * @returns 里面的几张，读不动时是空表
 */
export function readStickerLibrary(file: string): StickerRecord[] {
  return readJsonArray(file).map(asStickerRecord).filter((row): row is StickerRecord => row !== undefined)
}

/**
 * 往表情包库里放一张，同编号或同一文件只更新
 * @param file 库文件
 * @param record 要放进去的那一张
 */
export function upsertSticker(file: string, record: StickerRecord): void {
  const kept = readStickerLibrary(file)
    .filter(row => row.id !== record.id && row.file !== record.file)
  writeJson(file, [record, ...kept])
}

/**
 * 从表情包库里去掉一个编号
 * @param file 库文件
 * @param id 编号
 */
export function removeSticker(file: string, id: string): void {
  const kept = readStickerLibrary(file).filter(row => row.id !== id)
  writeJson(file, kept)
}

function categoryDirOf(category: AssetCategory): string {
  return ASSET_CATEGORY_DIRS[category]
}

function nameSourceOf(facts: AssetFacts, categoryDir: string): string {
  const candidates = [facts.character, facts.ip, facts.emotion, facts.caption]
  for (const candidate of candidates) {
    const value = candidate?.trim() ?? ''
    if (value !== '') return value
  }
  return categoryDir
}

function topicOf(facts: AssetFacts): string {
  const raw = facts.topic?.trim() ?? ''
  return safeSegment(raw, ASSET_FALLBACK_TOPIC)
}

function uniqueTags(tags: readonly string[] | undefined, extra: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of [...tags ?? [], ...extra]) {
    const value = tag.trim().slice(0, 12)
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out.slice(0, 8)
}

/**
 * 建一个素材目录
 * @param options 目录、索引、表情包库与四档阈值
 * @returns 素材目录接口
 */
export function createAssetStore(options: AssetStoreOptions): AssetStore {
  const root = path.resolve(options.root)
  const maxItems = Math.max(1, Math.floor(options.maxItems))
  const halfLifeHours = Math.max(0.01, options.halfLifeHours)
  const favoriteWeight = Math.max(1, options.favoriteWeight)
  const archiveBelowWeight = Math.max(0, options.archiveBelowWeight)
  const cacheMaxAgeHours = Math.max(0, options.cacheMaxAgeHours)
  const cacheMaxItems = Math.max(0, Math.floor(options.cacheMaxItems))
  let state: StoredIndex | undefined

  const load = (): StoredIndex => {
    state ??= readIndex(options.indexFile)
    return state
  }

  const flush = (): void => {
    if (state === undefined) return
    writeJson(options.indexFile, state)
  }

  const dropFile = (asset: StoredAsset): void => {
    if (!isInsideMediaRoot(root, asset.file)) return
    try {
      fs.rmSync(asset.file, { force: true })
    } catch {
      // 文件删不掉时索引照常更新，下次清理再看
    }
    if (asset.stickerId !== undefined) removeSticker(options.stickerFile, asset.stickerId)
  }

  const copy = (asset: StoredAsset): StoredAsset => ({ ...asset, tags: [...asset.tags] })

  return {
    root,

    save(input) {
      const index = load()
      const id = shortHash(input.data)
      const seenAt = input.at
      const found = index.items.find(item => item.id === id)
      if (found !== undefined) {
        found.lastSeenAt = seenAt
        found.hits += 1
        if (found.tier === 'cache') found.tier = 'normal'
        flush()
        return copy(found)
      }
      const categoryDir = categoryDirOf(input.facts.category)
      const topic = topicOf(input.facts)
      const nameSource = safeSegment(nameSourceOf(input.facts, categoryDir), categoryDir, 16)
      const extension = input.extension.startsWith('.') ? input.extension : `.${input.extension}`
      const relativeDir = path.join(categoryDir, topic)
      const file = resolveMediaPath(root, relativeDir, `${nameSource}_${id}${extension}`)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, input.data, { mode: 0o600 })
      const favorite = input.facts.favorite === true
      const tier: AssetTier = favorite ? 'favorite' : input.facts.keep === false ? 'cache' : 'normal'
      const sticker = input.facts.category === 'sticker' || input.facts.kind?.includes(categoryDirOf('sticker')) === true
      const asset: StoredAsset = {
        id,
        category: input.facts.category,
        tier,
        file,
        relative: path.join(relativeDir, path.basename(file)),
        bytes: input.data.byteLength,
        mediaType: input.mediaType,
        topic,
        caption: (input.facts.caption ?? '').trim().slice(0, 60),
        tags: uniqueTags(input.facts.tags, [categoryDir, topic]),
        createdAt: seenAt,
        lastSeenAt: seenAt,
        hits: 1,
        baseWeight: favorite ? favoriteWeight : 1,
        chatKey: input.chatKey,
        messageId: input.messageId,
        senderId: input.senderId,
        senderName: input.senderName,
        ...input.facts.ip === undefined || input.facts.ip.trim() === '' ? {} : { ip: input.facts.ip.trim().slice(0, 20) },
        ...input.facts.character === undefined || input.facts.character.trim() === '' ? {} : { character: input.facts.character.trim().slice(0, 20) },
        ...input.facts.emotion === undefined || input.facts.emotion.trim() === '' ? {} : { emotion: input.facts.emotion.trim().slice(0, 12) },
        ...input.facts.intensity === undefined ? {} : { intensity: Math.min(1, Math.max(0, input.facts.intensity)) },
      }
      if (sticker) {
        asset.stickerId = id
        upsertSticker(options.stickerFile, {
          id,
          tag: (asset.caption || asset.topic || categoryDir).slice(0, 16),
          tags: asset.tags,
          emotions: asset.emotion === undefined ? [] : [asset.emotion],
          intensity: asset.intensity ?? null,
          usage: asset.caption,
          file: asset.file,
        })
      }
      index.items.push(asset)
      flush()
      return copy(asset)
    },

    get(id) {
      const found = load().items.find(item => item.id === id)
      return found === undefined ? undefined : copy(found)
    },

    boost(id, amount, at) {
      const found = load().items.find(item => item.id === id)
      if (found === undefined) return
      found.baseWeight = Math.min(10, Math.max(0.01, found.baseWeight + amount))
      found.lastSeenAt = Math.max(found.lastSeenAt, at)
      found.hits += 1
      if (found.tier === 'cache') found.tier = 'normal'
      flush()
    },

    list(now, limit) {
      return load().items
        .map(item => ({ ...copy(item), weight: assetWeight(item, now, halfLifeHours) }))
        .sort((left, right) => right.weight - left.weight || right.lastSeenAt - left.lastSeenAt)
        .slice(0, Math.max(0, Math.floor(limit)))
    },

    sweep(now) {
      const index = load()
      const removed = new Set<string>()
      const counts: Record<AssetTier, number> = { cache: 0, normal: 0, favorite: 0, archive: 0 }
      let removedCache = 0
      let archived = 0
      let removedArchive = 0
      const alive = (): StoredAsset[] => index.items.filter(item => !removed.has(item.id))
      // 缓存档过期就删
      for (const item of alive()) {
        if (item.tier !== 'cache') continue
        if (now - item.createdAt <= cacheMaxAgeHours * HOUR_MS) continue
        removed.add(item.id)
        removedCache += 1
      }
      // 缓存档超过条数上限先删最旧的
      const cache = alive().filter(item => item.tier === 'cache')
      if (cache.length > cacheMaxItems) {
        const oldest = [...cache].sort((left, right) => left.createdAt - right.createdAt)
        for (const item of oldest.slice(0, cache.length - cacheMaxItems)) {
          removed.add(item.id)
          removedCache += 1
        }
      }
      // 正常档权重掉到线下就进冷归档
      for (const item of alive()) {
        if (item.tier !== 'normal') continue
        if (assetWeight(item, now, halfLifeHours) >= archiveBelowWeight) continue
        item.tier = 'archive'
        archived += 1
      }
      // 总量上限只动冷归档，收藏档一直留着
      const over = alive().length - maxItems
      if (over > 0) {
        const cold = alive()
          .filter(item => item.tier === 'archive')
          .sort((left, right) => left.lastSeenAt - right.lastSeenAt)
        for (const item of cold.slice(0, over)) {
          removed.add(item.id)
          removedArchive += 1
        }
      }
      const kept = alive()
      for (const item of index.items) {
        if (removed.has(item.id)) dropFile(item)
      }
      index.items = kept
      for (const item of kept) counts[item.tier] += 1
      const changed = removed.size > 0 || archived > 0
      if (changed || kept.length > 0) flush()
      return { removedCache, archived, removedArchive, counts }
    },

    flush() {
      flush()
    },
  }
}
