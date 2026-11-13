import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assetWeight,
  createAssetStore,
  isInsideMediaRoot,
  readStickerLibrary,
  resolveMediaPath,
  safeSegment,
  upsertSticker,
  type AssetStore,
  type AssetStoreOptions,
  type StickerRecord,
} from '../src/asset-store.ts'

const dirs: string[] = []

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-media-'))
  dirs.push(dir)
  return dir
}

function storeOf(root: string, overrides: Partial<AssetStoreOptions> = {}): AssetStore {
  return createAssetStore({
    root: path.join(root, 'media'),
    indexFile: path.join(root, 'media.json'),
    stickerFile: path.join(root, 'stickers.json'),
    maxItems: 500,
    halfLifeHours: 336,
    favoriteWeight: 2.2,
    archiveBelowWeight: 0.25,
    cacheMaxAgeHours: 72,
    cacheMaxItems: 500,
    ...overrides,
  })
}

const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01])
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x02])

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('素材目录', () => {
  it('按类别和主题分目录，文件名带名字与短哈希', () => {
    const root = tempRoot()
    const store = storeOf(root)
    const asset = store.save({
      data: GIF_BYTES,
      facts: { category: 'sticker', kind: '表情包', topic: '猫', caption: '猫猫捂脸' },
      mediaType: 'image/gif',
      extension: '.gif',
      chatKey: 'group:1',
      messageId: 'm1',
      senderId: 'u1',
      senderName: '甲',
      at: 1_000,
    })

    expect(asset.relative).toBe(path.join('表情包', '猫', path.basename(asset.file)))
    expect(path.dirname(path.dirname(asset.file))).toBe(path.join(root, 'media', '表情包'))
    expect(path.basename(asset.file).endsWith('.gif')).toBe(true)
    expect(path.basename(asset.file)).toContain('猫猫捂脸')
    expect(path.basename(asset.file)).toContain(asset.id)
    expect(fs.readFileSync(asset.file)).toEqual(Buffer.from(GIF_BYTES))
    expect(store.get(asset.id)?.category).toBe('sticker')
  })

  it('同内容只存一份，再收到只加次数', () => {
    const root = tempRoot()
    const store = storeOf(root)
    const first = store.save({
      data: PNG_BYTES,
      facts: { category: 'photo', topic: '风景' },
      mediaType: 'image/png',
      extension: '.png',
      chatKey: 'group:1',
      messageId: 'm1',
      senderId: 'u1',
      senderName: '甲',
      at: 1_000,
    })
    const again = store.save({
      data: PNG_BYTES,
      facts: { category: 'photo', topic: '风景' },
      mediaType: 'image/png',
      extension: '.png',
      chatKey: 'group:2',
      messageId: 'm2',
      senderId: 'u2',
      senderName: '乙',
      at: 2_000,
    })

    expect(again.id).toBe(first.id)
    expect(again.hits).toBe(2)
    expect(again.lastSeenAt).toBe(2_000)
    const listed = fs.readdirSync(path.join(root, 'media', '实拍', '风景'))
    expect(listed).toHaveLength(1)
  })

  it('清理目录名里的分隔符和危险字符', () => {
    expect(safeSegment('猫/狗', '未分类')).toBe('猫狗')
    expect(safeSegment('..', '未分类')).toBe('未分类')
    expect(safeSegment('  ', '未分类')).toBe('未分类')
    expect(safeSegment('a'.repeat(40), '未分类', 6)).toBe('aaaaaa')
    expect(safeSegment('CON', '未分类')).toBe('未分类')
  })

  it('绝对路径和跳出根的分段直接拒绝', () => {
    const root = path.join(tempRoot(), 'media')
    expect(() => resolveMediaPath(root, '../外', 'a.gif')).toThrow('media.unsafe_path')
    expect(() => resolveMediaPath(root, '表情包', '../../a.gif')).toThrow('media.unsafe_path')
    expect(() => resolveMediaPath(root, 'C:\\另外一处\\a.gif')).toThrow('media.unsafe_path')
    expect(() => resolveMediaPath(root, '/etc/a.gif')).toThrow('media.unsafe_path')
    expect(resolveMediaPath(root, '表情包', '猫', 'a.gif')).toBe(path.join(root, '表情包', '猫', 'a.gif'))
  })

  it('模型给的子目录带越界分段时仍然落在图片目录里', () => {
    const root = tempRoot()
    const store = storeOf(root)
    const asset = store.save({
      data: GIF_BYTES,
      facts: { category: 'sticker', topic: '../../../跑出去' },
      mediaType: 'image/gif',
      extension: '.gif',
      chatKey: 'group:1',
      messageId: 'm1',
      senderId: 'u1',
      senderName: '甲',
      at: 1_000,
    })

    expect(isInsideMediaRoot(path.join(root, 'media'), asset.file)).toBe(true)
    expect(asset.relative.startsWith('表情包')).toBe(true)
  })

  it('表情包类的素材写进表情包库，字段与通道读的那份对齐', () => {
    const root = tempRoot()
    const store = storeOf(root)
    const asset = store.save({
      data: GIF_BYTES,
      facts: {
        category: 'sticker',
        kind: '表情包',
        topic: '猫',
        caption: '猫猫扶额，写着无语',
        emotion: '无语',
        intensity: 0.7,
        tags: ['猫', '无奈'],
        favorite: true,
      },
      mediaType: 'image/gif',
      extension: '.gif',
      chatKey: 'group:1',
      messageId: 'm1',
      senderId: 'u1',
      senderName: '甲',
      at: 1_000,
    })

    const library = readStickerLibrary(path.join(root, 'stickers.json')) as Array<StickerRecord & Record<string, unknown>>
    expect(library).toHaveLength(1)
    const row = library[0] as StickerRecord
    expect(row.id).toBe(asset.id)
    expect(row.file).toBe(asset.file)
    expect(row.tag).toBe('猫猫扶额，写着无语')
    expect(row.usage).toBe('猫猫扶额，写着无语')
    expect(row.tags).toContain('猫')
    expect(row.emotions).toEqual(['无语'])
    expect(row.intensity).toBeCloseTo(0.7)
    expect(fs.existsSync(row.file)).toBe(true)
    expect(asset.stickerId).toBe(asset.id)
  })

  it('同一个文件或编号只留一条表情包记录', () => {
    const root = tempRoot()
    const file = path.join(root, 'stickers.json')
    upsertSticker(file, { id: 'a', tag: '旧', tags: [], emotions: [], intensity: null, usage: '', file: '/x/a.gif' })
    upsertSticker(file, { id: 'b', tag: '新', tags: [], emotions: [], intensity: null, usage: '', file: '/x/b.gif' })
    upsertSticker(file, { id: 'b', tag: '改了', tags: [], emotions: [], intensity: null, usage: '', file: '/x/b.gif' })

    const library = readStickerLibrary(file)
    expect(library.map(row => row.id)).toEqual(['b', 'a'])
    expect(library[0]?.tag).toBe('改了')
  })

  it('缓存档过期就删，收藏档一直留着', () => {
    const root = tempRoot()
    const store = storeOf(root, { cacheMaxAgeHours: 3 })
    const day = 24 * 3_600_000
    const cached = store.save({
      data: PNG_BYTES,
      facts: { category: 'photo', topic: '随手', keep: false },
      mediaType: 'image/png',
      extension: '.png',
      chatKey: 'group:1',
      messageId: 'm1',
      senderId: 'u1',
      senderName: '甲',
      at: 0,
    })
    const kept = store.save({
      data: GIF_BYTES,
      facts: { category: 'sticker', topic: '猫', favorite: true },
      mediaType: 'image/gif',
      extension: '.gif',
      chatKey: 'group:1',
      messageId: 'm2',
      senderId: 'u1',
      senderName: '甲',
      at: 0,
    })

    const result = store.sweep(4 * day)

    expect(result.removedCache).toBe(1)
    expect(result.counts.cache).toBe(0)
    expect(result.counts.favorite).toBe(1)
    expect(fs.existsSync(cached.file)).toBe(false)
    expect(fs.existsSync(kept.file)).toBe(true)
    expect(store.get(kept.id)?.tier).toBe('favorite')
  })

  it('缓存档超过条数上限先删最旧的', () => {
    const root = tempRoot()
    const store = storeOf(root, { cacheMaxItems: 1, cacheMaxAgeHours: 72 })
    const first = store.save({
      data: new Uint8Array([1]),
      facts: { category: 'other', topic: '甲', keep: false },
      mediaType: 'image/png',
      extension: '.png',
      chatKey: 'group:1', messageId: 'm1', senderId: 'u1', senderName: '甲', at: 1_000,
    })
    store.save({
      data: new Uint8Array([2]),
      facts: { category: 'other', topic: '甲', keep: false },
      mediaType: 'image/png',
      extension: '.png',
      chatKey: 'group:1', messageId: 'm2', senderId: 'u1', senderName: '甲', at: 2_000,
    })

    const result = store.sweep(3_000)

    expect(result.removedCache).toBe(1)
    expect(fs.existsSync(first.file)).toBe(false)
    expect(store.get(first.id)).toBeUndefined()
  })

  it('正常档权重掉到线下就进冷归档，总量上限只删冷档', () => {
    const root = tempRoot()
    const store = storeOf(root, { maxItems: 1, halfLifeHours: 336 })
    const old = store.save({
      data: new Uint8Array([3]),
      facts: { category: 'photo', topic: '旧' },
      mediaType: 'image/jpeg',
      extension: '.jpg',
      chatKey: 'group:1', messageId: 'm1', senderId: 'u1', senderName: '甲', at: 0,
    })
    const recent = store.save({
      data: new Uint8Array([4]),
      facts: { category: 'sticker', topic: '猫', favorite: true },
      mediaType: 'image/gif',
      extension: '.gif',
      chatKey: 'group:1', messageId: 'm2', senderId: 'u1', senderName: '甲', at: 0,
    })

    const result = store.sweep(1_000 * 3_600_000)

    expect(result.archived).toBe(1)
    expect(result.removedArchive).toBe(1)
    expect(store.get(old.id)).toBeUndefined()
    expect(store.get(recent.id)?.tier).toBe('favorite')
    expect(fs.existsSync(recent.file)).toBe(true)
  })

  it('权重按半衰期衰减', () => {
    const asset = { baseWeight: 1, lastSeenAt: 0 }
    expect(assetWeight(asset, 0, 336)).toBeCloseTo(1)
    expect(assetWeight(asset, 336 * 3_600_000, 336)).toBeCloseTo(0.5)
    expect(assetWeight(asset, 336 * 3_600_000 * 2, 336)).toBeCloseTo(0.25)
    expect(assetWeight({ baseWeight: 2.2, lastSeenAt: 0 }, 0, 336)).toBeCloseTo(2.2)
  })
})
