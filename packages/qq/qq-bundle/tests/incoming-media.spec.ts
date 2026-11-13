import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AttachmentId, type FileAttachmentRef, type ImageAttachmentRef } from '@huoli/huoli-attachment'
import { readStickerLibrary, createAssetStore } from '../src/asset-store.ts'
import { createIncomingArchive, createMediaArchive, prepareIncomingMedia, type IncomingArchiveInput, type IncomingArchivePort, type MediaAttachmentPort } from '../src/incoming-media.ts'
import type { StreamChunk } from '@huoli/huoli-llm'
import type { VisionLlmPort } from '../src/vision.ts'

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  mediaType: 'image/png',
  bytes: 4,
  width: 1,
  height: 1,
}

const FILE_REF: FileAttachmentRef = {
  attachmentId: AttachmentId('sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  bytes: 4,
  name: '说明.pdf',
}

const dirs: string[] = []

function mediaRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-incoming-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function port(): MediaAttachmentPort & { savedImages: number; savedFiles: number } {
  const state = {
    savedImages: 0,
    savedFiles: 0,
    saveImage: vi.fn(async () => {
      state.savedImages += 1
      return IMAGE_REF
    }),
    saveFile: vi.fn(async () => {
      state.savedFiles += 1
      return FILE_REF
    }),
    imageHostPath: () => 'C:/temp/image.png',
    fileHostPath: () => 'C:/temp/file.pdf',
  }
  return state
}

describe('入站附件', () => {
  it('图片存成附件块，文件原样保存', async () => {
    const store = port()
    const result = await prepareIncomingMedia([
      { kind: 'image', url: 'data:image/png;base64,iVBORw==', name: 'a.png', mediaType: 'image/png' },
      { kind: 'file', url: 'base64://SGVsbG8=', name: '说明.pdf', mediaType: 'application/pdf' },
    ], {
      attachments: store,
      maxBytes: 100,
      timeoutMs: 1_000,
      maxItems: 4,
    })

    expect(result.saved).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.content).toHaveLength(2)
    expect(result.content[0]).toEqual({ type: 'image', attachment: IMAGE_REF })
    expect(result.content[1]).toEqual({ type: 'file', attachment: FILE_REF })
    // 本机路径不进模型可见文本，只留附件编号
    expect(result.notes.join('\n')).toContain('图片已保存，编号')
    expect(result.notes.join('\n')).toContain('文件已保存，编号')
    expect(result.notes.join('\n')).not.toContain('E:\\')
    expect(result.notes.join('\n')).not.toContain('image.png')
    expect(result.notes.join('\n')).not.toContain('file.pdf')
    expect(result.images).toHaveLength(1)
  })

  it('没有附件仓时留下明确失败，不抛到收消息路径', async () => {
    const result = await prepareIncomingMedia([
      { kind: 'image', url: 'base64://iVBORw==', name: 'a.png', mediaType: 'image/png' },
    ], { attachments: undefined, maxBytes: 100, timeoutMs: 1_000, maxItems: 4 })

    expect(result.saved).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.notes[0]).toContain('media.no_store')
  })

  it('语音语言与情绪分开呈现', async () => {
    const result = await prepareIncomingMedia([
      { kind: 'record', url: 'base64://AQID', name: 'voice.wav', mediaType: 'audio/wav' },
    ], {
      attachments: port(),
      maxBytes: 100,
      timeoutMs: 1_000,
      maxItems: 4,
      asr: async () => ({ ok: true, text: '我有点累', emotion: 'SAD', language: 'zh' }),
    })

    expect(result.notes.join('\n')).toContain('语气/声音：SAD')
    expect(result.notes.join('\n')).toContain('语言：zh')
    expect(result.notes.join('\n')).not.toContain('语气/声音：SAD / zh')
  })

  it('视频保留原附件并把时间标记关键帧交给图片链路', async () => {
    const store = port()
    const result = await prepareIncomingMedia([
      { kind: 'video', url: 'base64://AQID', name: 'walk.mp4', mediaType: 'video/mp4' },
    ], {
      attachments: store,
      maxBytes: 100,
      timeoutMs: 1_000,
      maxItems: 4,
      analyzeVideo: async () => ({
        frames: [
          { data: new Uint8Array([4]), timestampMs: 0 },
          { data: new Uint8Array([5]), timestampMs: 8_000 },
        ],
        transcript: { ok: true, text: '前面有台阶', language: 'zh' },
      }),
    })

    expect(result.saved).toBe(1)
    expect(store.savedFiles).toBe(1)
    expect(store.savedImages).toBe(2)
    expect(result.content.map(block => block.type)).toEqual(['file', 'image', 'image'])
    expect(result.images.map(image => image.timestampMs)).toEqual([0, 8_000])
    expect(result.notes.join('\n')).toContain('VIDEO_FRAMES')
    expect(result.notes.join('\n')).toContain('8.0 秒')
    expect(result.notes.join('\n')).toContain('前面有台阶')
  })

  it('视频分析失败时仍保留视频文件并说明降级', async () => {
    const store = port()
    const result = await prepareIncomingMedia([
      { kind: 'video', url: 'base64://AQID', name: 'walk.mp4', mediaType: 'video/mp4' },
    ], {
      attachments: store,
      maxBytes: 100,
      timeoutMs: 1_000,
      maxItems: 4,
      analyzeVideo: async () => { throw new Error('ffmpeg unavailable') },
    })

    expect(result.saved).toBe(1)
    expect(store.savedFiles).toBe(1)
    expect(result.content.map(block => block.type)).toEqual(['file'])
    expect(result.notes.join('\n')).toContain('视频分析失败：ffmpeg unavailable；原视频已保留')
  })

  it('未启用 ASR 时说明视频音轨未分析，画面仍可用', async () => {
    const result = await prepareIncomingMedia([
      { kind: 'video', url: 'base64://AQID', name: 'walk.mp4', mediaType: 'video/mp4' },
    ], {
      attachments: port(),
      maxBytes: 100,
      timeoutMs: 1_000,
      maxItems: 4,
      analyzeVideo: async () => ({
        frames: [{ data: new Uint8Array([4]), timestampMs: 0 }],
      }),
    })

    expect(result.notes.join('\n')).toContain('视频音轨没能转写（语音识别未启用）')
    expect(result.images).toHaveLength(1)
    expect(result.content.map(block => block.type)).toEqual(['file', 'image'])
  })

  it('超过单项上限就拒绝', async () => {
    const result = await prepareIncomingMedia([
      { kind: 'file', url: 'base64://MTIzNDU2', name: 'a.bin', mediaType: '' },
    ], { attachments: port(), maxBytes: 3, timeoutMs: 1_000, maxItems: 4 })

    expect(result.saved).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.notes[0]).toContain('media.too_large')
  })

  it('公网下载前拒绝本机和内网地址', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await prepareIncomingMedia([
      { kind: 'file', url: 'https://127.0.0.1/private.txt', name: 'a.txt', mediaType: 'text/plain' },
    ], { attachments: port(), maxBytes: 100, timeoutMs: 1_000, maxItems: 4 })

    expect(result.saved).toBe(0)
    expect(result.notes[0]).toContain('link.private_address')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('重定向跳进内网时在下一跳前停止', async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private.txt' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const store = port()

    const result = await prepareIncomingMedia([
      { kind: 'file', url: 'https://93.184.216.34/start', name: 'a.txt', mediaType: 'text/plain' },
    ], { attachments: store, maxBytes: 100, timeoutMs: 1_000, maxItems: 4 })

    expect(result.saved).toBe(0)
    expect(result.notes[0]).toContain('link.private_address')
    expect(store.savedFiles).toBe(0)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('图片存进项目图片目录，并把分类事实写进给模型看的说明', async () => {
    const root = mediaRoot()
    const seen: IncomingArchiveInput[] = []
    const archive: IncomingArchivePort = {
      save(input) {
        seen.push(input)
        return Promise.resolve({
          relative: '表情包/猫/猫猫捂脸_ab12cd34ef56.png',
          file: path.join(root, 'media', '表情包', '猫', '猫猫捂脸_ab12cd34ef56.png'),
          category: 'sticker',
          kind: '表情包',
          caption: '猫猫捂脸',
          emotion: '尴尬',
          topic: '猫',
          tags: ['猫', '尴尬'],
          source: 'model',
        })
      },
    }

    const result = await prepareIncomingMedia([
      { kind: 'image', url: 'base64://iVBORw==', name: 'a.png', mediaType: 'image/png' },
    ], {
      attachments: port(),
      archive,
      hint: '这个表情什么意思',
      chatKey: 'group:1',
      messageId: 'm1',
      senderId: 'u1',
      senderName: '甲',
      at: 5_000,
      maxBytes: 100,
      timeoutMs: 1_000,
      maxItems: 4,
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.image).toBe(IMAGE_REF)
    expect(seen[0]?.hint).toBe('这个表情什么意思')
    expect(seen[0]?.extension).toBe('.png')
    expect(seen[0]?.chatKey).toBe('group:1')
    expect(result.notes.join('\n')).toContain('表情包/猫/')
    expect(result.notes.join('\n')).toContain('内容：猫猫捂脸')
    expect(result.notes.join('\n')).toContain('模型判类')
    expect(result.images[0]?.asset?.category).toBe('sticker')
  })

  it('归档失败也不影响这一项本来保存成功', async () => {
    const archive: IncomingArchivePort = {
      save() {
        return Promise.reject(new Error('media.leak'))
      },
    }

    const result = await prepareIncomingMedia([
      { kind: 'image', url: 'base64://iVBORw==', name: 'a.png', mediaType: 'image/png' },
    ], { attachments: port(), archive, maxBytes: 100, timeoutMs: 1_000, maxItems: 4 })

    expect(result.saved).toBe(1)
    expect(result.notes.join('\n')).toContain('media.leak')
    expect(result.notes.join('\n')).toContain('图片已保存')
    expect(result.images[0]?.asset).toBeUndefined()
  })

  it('视觉模型不可用时仍然分目录落盘，表情包照常入库', async () => {
    const root = mediaRoot()
    const store = createAssetStore({
      root: path.join(root, 'media'),
      indexFile: path.join(root, 'media.json'),
      stickerFile: path.join(root, 'stickers.json'),
      maxItems: 50,
      halfLifeHours: 336,
      favoriteWeight: 2.2,
      archiveBelowWeight: 0.25,
      cacheMaxAgeHours: 72,
      cacheMaxItems: 50,
    })
    const archive = createIncomingArchive({
      store,
      classify: { provider: '', model: '', maxTokens: 10, maxChars: 10, timeoutMs: 10 },
    })

    const result = await prepareIncomingMedia([
      { kind: 'image', url: 'base64://R0lGODlh', name: 'a.png', mediaType: 'image/png', sticker: true },
      { kind: 'file', url: 'base64://SGVsbG8=', name: '说明.pdf', mediaType: 'application/pdf' },
    ], { attachments: port(), archive, maxBytes: 100, timeoutMs: 1_000, maxItems: 4 })

    expect(result.saved).toBe(2)
    const notes = result.notes.join('\n')
    expect(notes).toContain('按扩展名粗分')
    expect(notes).toContain('表情包/')
    expect(notes).toContain('文档/')
    const stickerFile = path.join(root, 'stickers.json')
    const library = readStickerLibrary(stickerFile)
    expect(library).toHaveLength(1)
    expect(fs.existsSync(library[0]?.file ?? '')).toBe(true)
  })

  it('归档判类默认关闭，可由配置显式开启', async () => {
    const root = mediaRoot()
    let calls = 0
    const llm: VisionLlmPort = {
      async *stream() {
        calls += 1
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }
    const support = createMediaArchive({
      visionProvider: 'relay',
      visionModel: 'vision',
      mediaRoot: path.join(root, 'media'),
      mediaIndexFile: path.join(root, 'media.json'),
      mediaStickerFile: path.join(root, 'stickers.json'),
    }, llm)
    const input: IncomingArchiveInput = {
      data: new Uint8Array([1]),
      name: 'a.png',
      mediaType: 'image/png',
      extension: '.png',
      image: IMAGE_REF,
      hint: '',
      chatKey: 'group:1',
      messageId: '1',
      senderId: 'u1',
      senderName: '甲',
      at: 1,
    }

    await expect(support.port.save(input)).resolves.toMatchObject({ source: 'fallback' })
    expect(calls).toBe(0)

    const enabled = createMediaArchive({
      visionProvider: 'relay',
      visionModel: 'vision',
      mediaRoot: path.join(root, 'enabled'),
      mediaIndexFile: path.join(root, 'enabled.json'),
      mediaStickerFile: path.join(root, 'enabled-stickers.json'),
      mediaClassify: true,
    }, llm)
    await enabled.port.save(input)
    expect(calls).toBe(1)

    const markedSticker = await enabled.port.save({
      ...input,
      data: new Uint8Array([2]),
      sticker: true,
    })
    expect(markedSticker.source).toBe('protocol')
    expect(markedSticker.category).toBe('sticker')
    expect(calls).toBe(1)
  })
})
