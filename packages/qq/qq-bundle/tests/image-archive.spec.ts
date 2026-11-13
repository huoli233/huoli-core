import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AttachmentId, type ImageAttachmentRef } from '@huoli/huoli-attachment'
import type { IncomingMessage } from '@huoli/huoli-qq-channel'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageArchive } from '../src/image-archive.ts'
import { createImageRuntime, routeImagesForModel } from '../src/image-runtime.ts'
import type { PreparedImage } from '../src/incoming-media.ts'

const dirs: string[] = []

function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-images-'))
  dirs.push(dir)
  return path.join(dir, 'images.json')
}

function image(char = 'd', bytes = 10): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${char.repeat(64)}`),
    mediaType: 'image/png',
    bytes,
    width: 10,
    height: 10,
  }
}

function prepared(char = 'd'): PreparedImage {
  return {
    image: image(char),
    attachment: { kind: 'image', url: 'https://a.test/a.png', name: 'a.png', mediaType: 'image/png' },
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('图片档', () => {
  it('同一哈希重复出现只加次数和权重', () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const first = archive.record({
      chatKey: 'group:1', messageId: '1', senderId: 'u1', senderName: '甲', at: 1_000, image: image(), weight: 20,
    })
    const again = archive.record({
      chatKey: 'group:1', messageId: '2', senderId: 'u2', senderName: '乙', at: 2_000, image: image(), weight: 20,
    })

    expect(again.imageId).toBe(first.imageId)
    expect(again.seenCount).toBe(2)
    expect(again.weight).toBeGreaterThan(first.weight)
  })

  it('越新的图片分数越高，说明能读写', () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 1 })
    archive.record({
      chatKey: 'group:1', messageId: '1', senderId: 'u1', senderName: '甲', at: 0, image: image(), weight: 50,
    })
    archive.setQuick(String(image().attachmentId), 'group:1', '一张测试图', 100)
    const recent = archive.recent('group:1', 3_600_000, 5)

    expect(recent[0]?.score).toBeLessThan(50)
    expect(recent[0]?.quickSummary).toBe('一张测试图')
  })

  it('语义标签、情绪和适用场景能保存并进入旧图提示', () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const record = archive.record({
      chatKey: 'group:1', messageId: '1', senderId: 'u1', senderName: '甲', at: 1_000, image: image(), weight: 50, kind: 'sticker',
    })
    archive.annotate('group:1', record.imageId, {
      tags: ['扶额', '无奈'],
      emotion: '无奈',
      intensity: 0.8,
      useWhen: '接一句没办法的时候',
    }, 2_000)
    const runtime = createImageRuntime({
      archive,
      viewer: undefined,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: false,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })

    const prompt = runtime.prompt('group:1', 2_000)

    expect(prompt).toContain('TAGS: 扶额,无奈')
    expect(prompt).toContain('EMOTION: 无奈 80%')
    expect(prompt).toContain('USE_FOR: 接一句没办法的时候')
  })

  it('暂时不看会降低兴趣，回看旧图会重新提起兴趣', () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const record = archive.record({
      chatKey: 'group:1', messageId: '1', senderId: 'u1', senderName: '甲', at: 1_000, image: image('d'), weight: 70,
    })
    const before = archive.recent('group:1', 1_000, 1)[0]?.score ?? 0

    archive.skip('group:1', record.imageId, 1_100)
    const skipped = archive.recent('group:1', 1_100, 1)[0]?.score ?? 0
    expect(skipped).toBeLessThan(before)

    archive.recall('group:1', record.imageId, 2_000)
    const recalled = archive.recent('group:1', 2_000, 1)[0]?.score ?? 0
    expect(recalled).toBeGreaterThan(skipped)
  })
})

describe('图片先看还是后看', () => {
  it('群视频按状态缓存，被点名后才快速看并标出时间', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const runtime = createImageRuntime({
      archive,
      viewer: vi.fn(async () => '走廊和台阶'),
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: false,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })
    const frame: PreparedImage = {
      ...prepared('e'),
      attachment: { kind: 'image', url: '', name: 'walk-frame-0008.jpg', mediaType: 'image/jpeg' },
      timestampMs: 8_000,
    }
    const base: IncomingMessage = {
      chatKey: 'group:1',
      senderId: 'u1',
      senderName: '甲',
      text: '[视频]',
      at: 10_000,
      atMe: false,
      isPoke: false,
      replyToBot: false,
      messageId: 'video-1',
      attachments: [{ kind: 'video', url: '', name: 'walk.mp4', mediaType: 'video/mp4' }],
      traceId: 'trace-video-1',
      selfSent: false,
    }
    const ambient = await runtime.process([frame], base)

    expect(ambient.notes.join('\n')).toContain('视频画面 00:00:08')
    expect(ambient.notes.join('\n')).toContain('已缓存')
    expect(ambient.excludedImageIds).toEqual([String(frame.image.attachmentId)])

    const called = await runtime.process([frame], {
      ...base,
      atMe: true,
      messageId: 'video-2',
      traceId: 'trace-video-2',
    })
    expect(called.notes.join('\n')).toContain('状态：快速看')
    expect(called.notes.join('\n')).not.toContain('已缓存')
    expect(called.excludedImageIds).toEqual([])
  })

  it('普通私聊图片先缓存，带具体看图文字时才快速看', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const note = vi.fn()
    const runtime = createImageRuntime({
      archive,
      viewer: vi.fn(async () => '报错窗口'),
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: false,
      recentPromptMax: 5,
      halfLifeHours: 24,
      note,
    })
    const base = {
      chatKey: 'private:1', senderId: 'u1', senderName: '甲', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, attachments: [],
      traceId: 'private:1#msg-1', selfSent: false,
    }
    const ambient = await runtime.process([prepared('plain')], {
      ...base,
      text: '[图片]',
      messageId: '1',
    })
    expect(ambient.excludedImageIds).toEqual([String(image('plain').attachmentId)])
    expect(note).toHaveBeenCalledWith('image_status', 'private:1', expect.objectContaining({ status: 'cached' }))

    const called = await runtime.process([prepared('question')], {
      ...base,
      text: '看看这个报错',
      messageId: '2',
      traceId: 'private:1#msg-2',
    })
    expect(called.excludedImageIds).toEqual([])
    expect(called.notes.join('\n')).toContain('状态：快速看')
    expect(note).toHaveBeenCalledWith('image_status', 'private:1', expect.objectContaining({ status: 'quick' }))
  })

  it('群聊无指向的低兴趣图片只归档，不进入模型请求', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const viewer = vi.fn(async () => '不应调用')
    const runtime = createImageRuntime({
      archive,
      viewer,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: false,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })

    const result = await runtime.process([prepared()], {
      chatKey: 'group:1', senderId: 'u1', senderName: '甲', text: '[图片]', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: '1', attachments: [], traceId: 'group:1#msg-1', selfSent: false,
    })

    expect(viewer).not.toHaveBeenCalled()
    expect(result.attachImages).toBe(true)
    expect(result.excludedImageIds).toEqual([String(image().attachmentId)])
    expect(result.notes[0]).toContain('已缓存')
    expect(result.notes[0]).toContain(String(image().attachmentId))
  })

  it('一组图片按各自兴趣过滤，保留已关注图片', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    archive.record({
      chatKey: 'group:1', messageId: 'before', senderId: 'u1', senderName: '甲',
      at: 900, image: image('d'), weight: 100,
    })
    const runtime = createImageRuntime({
      archive,
      viewer: undefined,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: false,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })

    const result = await runtime.process([prepared('d'), prepared('e')], {
      chatKey: 'group:1', senderId: 'u1', senderName: '甲', text: '', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: '1', attachments: [], traceId: 'group:1#msg-1', selfSent: false,
    })

    expect(result.excludedImageIds).toEqual([String(image('e').attachmentId)])
  })

  it('私聊明确发来的图片先交主模型，首轮后再深看', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const viewer = vi.fn(async (_image: ImageAttachmentRef, options: { deep?: boolean }) =>
      options.deep === true ? '深看结果' : '先看结果')
    const runtime = createImageRuntime({
      archive,
      viewer,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: true,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })

    const result = await runtime.process([prepared()], {
      chatKey: 'private:1', senderId: 'u1', senderName: '甲', text: '看看这张照片', at: 1_000,
      atMe: true, isPoke: false, replyToBot: false, messageId: '1', attachments: [], traceId: 'private:1#msg-1', selfSent: false,
    })
    expect(viewer).not.toHaveBeenCalled()
    expect(result.attachImages).toBe(true)
    const deep = await runtime.deepAfterTurn('private:1', ['private:1#msg-1'])

    expect(deep).toContain('IMAGE_DEEP_RESULT')
    expect(deep).toContain('深看结果')
    expect(viewer).toHaveBeenCalledTimes(1)
  })

  it('同一轮多张图片合并为一次首轮后的深看请求', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const viewer = vi.fn(async (ref: ImageAttachmentRef) => `已看 ${String(ref.attachmentId)}`)
    const sequenceViewer = vi.fn(async (refs: readonly ImageAttachmentRef[], options?: { focus?: string }) => {
      void options
      return `整组共 ${refs.length} 张`
    })
    const runtime = createImageRuntime({
      archive,
      viewer,
      sequenceViewer,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: true,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })

    const result = await runtime.process([prepared('d'), prepared('e')], {
      chatKey: 'private:1', senderId: 'u1', senderName: '甲', text: '看看这两张', at: 1_000,
      atMe: true, isPoke: false, replyToBot: false, messageId: '2', attachments: [], traceId: 'private:1#msg-2', selfSent: false,
    })
    const deep = await runtime.deepAfterTurn('private:1', ['private:1#msg-2'])

    expect(result.attachImages).toBe(true)
    expect(viewer).not.toHaveBeenCalled()
    expect(sequenceViewer).toHaveBeenCalledTimes(1)
    expect(sequenceViewer.mock.calls[0]?.[0]).toEqual([image('d'), image('e')])
    expect(sequenceViewer.mock.calls[0]?.[1]?.focus).toContain('第 1 张')
    expect(deep).toContain('dddddddddddddddd')
    expect(deep).toContain('eeeeeeeeeeeeeeee')
    expect(deep).toContain('整组共 2 张')
  })

  it('明确说别看的图片只存档，不直接看也不排深看', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const viewer = vi.fn(async () => '不应调用')
    const runtime = createImageRuntime({
      archive,
      viewer,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: true,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })

    const result = await runtime.process([prepared()], {
      chatKey: 'private:1', senderId: 'u1', senderName: '甲', text: '这张别看', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: '1', attachments: [], traceId: 'private:1#msg-1', selfSent: false,
    })

    expect(result.attachImages).toBe(false)
    expect(result.notes[0]).toContain('先不看')
    await expect(runtime.deepAfterTurn('private:1', ['private:1#msg-1'])).resolves.toBeUndefined()
    expect(viewer).not.toHaveBeenCalled()
  })

  it('图片跳过短语由运行配置提供', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const viewer = vi.fn(async () => '不应调用')
    const runtime = createImageRuntime({
      archive,
      viewer,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      ignorePhrases: ['先别识别这张'],
      deepAfterReply: true,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })

    const result = await runtime.process([prepared()], {
      chatKey: 'private:1', senderId: 'u1', senderName: '甲', text: '先别识别这张图', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: 'custom-ignore', attachments: [],
      traceId: 'private:1#custom-ignore', selfSent: false,
    })

    expect(result.attachImages).toBe(false)
    expect(result.notes[0]).toContain('先不看')
    expect(viewer).not.toHaveBeenCalled()
  })

  it('同一聊天的深看计划只由对应消息的回合消费', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const viewer = vi.fn(async (ref: ImageAttachmentRef) => `已看 ${String(ref.attachmentId)}`)
    const runtime = createImageRuntime({
      archive,
      viewer,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: true,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })
    const base = {
      chatKey: 'private:1', senderId: 'u1', senderName: '甲', text: '看看这张照片', at: 1_000,
      atMe: true, isPoke: false, replyToBot: false, attachments: [], selfSent: false,
    } as const

    await runtime.process([prepared('d')], { ...base, messageId: '1', traceId: 'private:1#msg-1' })
    await runtime.process([prepared('e')], { ...base, messageId: '2', traceId: 'private:1#msg-2' })

    const first = await runtime.deepAfterTurn('private:1', ['private:1#msg-1'])
    expect(first).toContain('dddddddddddddddd')
    expect(first).not.toContain('eeeeeeeeeeeeeeee')
    expect(viewer).toHaveBeenCalledTimes(1)

    const second = await runtime.deepAfterTurn('private:1', ['private:1#msg-2'])
    expect(second).toContain('eeeeeeeeeeeeeeee')
    expect(viewer).toHaveBeenCalledTimes(2)
  })

  it('队列拒收后丢弃的图片计划不会再调用视觉模型', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const viewer = vi.fn(async () => '不应调用')
    const runtime = createImageRuntime({
      archive,
      viewer,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: true,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })

    await runtime.process([prepared()], {
      chatKey: 'private:1', senderId: 'u1', senderName: '甲', text: '看看这张照片', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: '1', attachments: [], traceId: 'private:1#msg-1', selfSent: false,
    })
    runtime.discard(['private:1#msg-1'])

    await expect(runtime.deepAfterTurn('private:1', ['private:1#msg-1'])).resolves.toBeUndefined()
    expect(viewer).not.toHaveBeenCalled()
  })

  it('按结构化表情标记和已有判类记录图片类型', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const runtime = createImageRuntime({
      archive,
      viewer: undefined,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: false,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })
    const sticker: PreparedImage = {
      image: image('f'),
      attachment: { kind: 'image', url: 'https://a.test/f.png', name: 'face.png', mediaType: 'image/png', sticker: true },
    }
    const screenshot: PreparedImage = {
      image: { ...image('a'), width: 1920, height: 1080 },
      attachment: { kind: 'image', url: 'https://a.test/a.png', name: 'screen-shot.png', mediaType: 'image/png' },
      asset: {
        relative: '截图/应用/error.png',
        file: 'E:/media/截图/应用/error.png',
        category: 'screenshot',
        kind: '截图',
        caption: '报错界面',
        emotion: '',
        topic: '应用',
        tags: [],
        source: 'model',
      },
    }

    const result = await runtime.process([sticker, screenshot], {
      chatKey: 'group:1', senderId: 'u1', senderName: '甲', text: '', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: '3', attachments: [], traceId: 'group:1#msg-3', selfSent: false,
    })

    expect(result.notes.join('\n')).toContain('表情包或贴纸')
    expect(result.notes.join('\n')).toContain('截图或界面')
    expect(archive.recent('group:1', 1_000, 5).map(item => item.kind)).toEqual(
      expect.arrayContaining(['sticker', 'screenshot']),
    )
  })

  it('群聊普通正文不会自动把低兴趣图片交给模型', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const runtime = createImageRuntime({
      archive,
      viewer: undefined,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: false,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })

    const result = await runtime.process([prepared('c')], {
      chatKey: 'group:1', senderId: 'u1', senderName: '甲', text: '顺便说一句', bodyText: '顺便说一句', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: '5', attachments: [], traceId: 'group:1#msg-5', selfSent: false,
    })

    expect(result.excludedImageIds).toContain(String(image('c').attachmentId))
    expect(result.notes.join('\n')).toContain('本轮不交给模型')
  })

  it('私聊里的结构化表情包也默认不进入视觉请求', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const runtime = createImageRuntime({
      archive,
      viewer: vi.fn(async () => '不应被调用'),
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: true,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })
    const sticker: PreparedImage = {
      image: image('e'),
      attachment: { kind: 'image', url: 'https://a.test/e.png', name: 'face.png', mediaType: 'image/png', sticker: true },
    }

    const result = await runtime.process([sticker], {
      chatKey: 'private:1', senderId: 'u1', senderName: '甲', text: '这张是什么', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: '6', attachments: [], traceId: 'private:1#msg-6', selfSent: false,
    })

    expect(result.attachImages).toBe(false)
    expect(result.excludedImageIds).toContain(String(sticker.image.attachmentId))
    expect(result.notes.join('\n')).toContain('qq_image_view')
    await expect(runtime.deepAfterTurn('private:1', ['private:1#msg-6'])).resolves.toBeUndefined()
  })

  it('同一条消息的多张图给连续序列提示，不按单张孤立看', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const runtime = createImageRuntime({
      archive,
      viewer: undefined,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: false,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })

    const result = await runtime.process([prepared('d'), prepared('e')], {
      chatKey: 'group:1', senderId: 'u1', senderName: '甲', text: '', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: '3', attachments: [], traceId: 'group:1#msg-3', selfSent: false,
    })

    expect(result.notes.join('\n')).toContain('[DATA] IMAGE_SEQUENCE')
    expect(result.notes.join('\n')).toContain('COUNT: 2')
  })

  it('一整批都是表情包又没人叫看时，不把图塞给模型', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const runtime = createImageRuntime({
      archive,
      viewer: undefined,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: false,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })
    const sticker = (name: string): PreparedImage => ({
      image: image(name.slice(0, 1)),
      attachment: { kind: 'image', url: `https://a.test/${name}.png`, name: `${name}.png`, mediaType: 'image/png', sticker: true },
    })

    const result = await runtime.process([sticker('sticker1'), sticker('sticker2')], {
      chatKey: 'group:1', senderId: 'u1', senderName: '甲', text: '', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: '4', attachments: [], traceId: 'group:1#msg-4', selfSent: false,
    })

    expect(result.attachImages).toBe(false)
    expect(result.notes.join('\n')).toContain('表情包')
  })

  it('不按宽高比或文件名猜成截图', async () => {
    const archive = createImageArchive({ file: tempFile(), maxItems: 20, halfLifeHours: 24 })
    const runtime = createImageRuntime({
      archive,
      viewer: undefined,
      quickWeightFrom: 35,
      deepWeightFrom: 60,
      deepAfterReply: false,
      recentPromptMax: 5,
      halfLifeHours: 24,
    })
    const tall: PreparedImage = {
      image: { ...image('b'), width: 1080, height: 2400 },
      attachment: { kind: 'image', url: 'https://a.test/b.png', name: 'screen-shot.png', mediaType: 'image/png' },
    }

    await runtime.process([tall], {
      chatKey: 'group:1', senderId: 'u1', senderName: '甲', text: '', at: 1_000,
      atMe: false, isPoke: false, replyToBot: false, messageId: '4', attachments: [], traceId: 'group:1#msg-4', selfSent: false,
    })

    expect(archive.recent('group:1', 1_000, 5)[0]?.kind).toBe('photo')
  })

  it('模型选择口不可用且没有视觉兜底时，明确说明图片不可见', async () => {
    const routed = await routeImagesForModel({
      attachments: [
        { type: 'text', text: '[图片]' },
        { type: 'image', attachment: image() },
        { type: 'text', text: '正文' },
      ],
      model: undefined,
      llm: undefined,
      hasViewer: false,
      deepAfterReply: true,
    })

    expect(routed.attachments.some(item => item.type === 'image')).toBe(false)
    expect(routed.attachments.some(item => item.type === 'text' && item.text === '正文')).toBe(true)
    expect(routed.notice).toContain('当前聊天模型不能直接看图')
    expect(routed.notice).toContain('别猜画面')
  })

  it('主模型不支持图片时，使用配置的视觉模型把画面事实送进同一轮', async () => {
    const attachment = image()
    const describe = vi.fn(async () => '截图里显示连接超时')
    const routed = await routeImagesForModel({
      attachments: [
        { type: 'text', text: '[图片]' },
        { type: 'image', attachment },
        { type: 'text', text: '这个报错怎么处理' },
      ],
      model: { current: () => ({ provider: 'test', model: 'text-only' }) },
      llm: {
        async resolveModelInfo() {
          return { inputModalities: ['text'] }
        },
        async *stream() {},
      },
      describe,
      hasViewer: true,
      deepAfterReply: true,
    })

    expect(describe).toHaveBeenCalledWith(attachment, '按画面实际内容说明，不猜身份与画外内容')
    expect(routed.attachments.some(item => item.type === 'image')).toBe(false)
    expect(routed.notice).toContain('视觉模型看到的实际内容：截图里显示连接超时')
    expect(routed.notice).toContain('要不要接话、怎么接话由你判断')
  })

  it('多图回退用高能力模型一次理解整组有序图片', async () => {
    const first = image('first')
    const second = image('second')
    const regular = vi.fn(async () => '普通识图')
    const complex = vi.fn(async (_image: ImageAttachmentRef) => '多图分析')
    const sequence = vi.fn(async (images: readonly ImageAttachmentRef[]) => `整组 ${images.length} 张`)
    const routed = await routeImagesForModel({
      attachments: [
        { type: 'image', attachment: first },
        { type: 'image', attachment: second },
      ],
      model: { current: () => ({ provider: 'test', model: 'text-only' }) },
      llm: {
        async resolveModelInfo() { return { inputModalities: ['text'] } },
        async *stream() {},
      },
      describe: regular,
      describeComplex: complex,
      describeSequence: sequence,
      hasViewer: true,
      deepAfterReply: true,
    })

    expect(regular).not.toHaveBeenCalled()
    expect(complex).not.toHaveBeenCalled()
    expect(sequence).toHaveBeenCalledTimes(1)
    expect(sequence).toHaveBeenCalledWith([first, second], '按接收顺序逐张说明可见内容，再总结图片之间能确认的连续关系；不猜身份与画外内容')
    expect(routed.notice).toContain('[DATA] IMAGE_SEQUENCE')
    expect(routed.notice).toContain('整组 2 张')
  })

  it('图片数量超限时只送入前几张并说明其余图片未分析', async () => {
    const first = image('a')
    const second = image('b')
    const third = image('c')
    const sequence = vi.fn(async (images: readonly ImageAttachmentRef[]) => `分析 ${images.length} 张`)
    const routed = await routeImagesForModel({
      attachments: [
        { type: 'text', text: '先看这组' },
        { type: 'image', attachment: first },
        { type: 'image', attachment: second },
        { type: 'image', attachment: third },
      ],
      model: { current: () => ({ provider: 'test', model: 'text-only' }) },
      llm: {
        async resolveModelInfo() { return { inputModalities: ['text'] } },
        async *stream() {},
      },
      describe: vi.fn(async () => '单图'),
      describeSequence: sequence,
      hasViewer: true,
      deepAfterReply: false,
      maxImages: 2,
    })

    expect(sequence).toHaveBeenCalledTimes(1)
    expect(sequence).toHaveBeenCalledWith([first, second], expect.any(String))
    expect(routed.notice).toContain('另有 1 张未分析')
    expect(routed.attachments).toEqual([{ type: 'text', text: '先看这组' }])
  })

  it('主模型直看时保留原附件顺序并限制图片数量', async () => {
    const first = image('a')
    const second = image('b')
    const third = image('c')
    const routed = await routeImagesForModel({
      attachments: [
        { type: 'text', text: '开头' },
        { type: 'image', attachment: first },
        { type: 'text', text: '中间' },
        { type: 'image', attachment: second },
        { type: 'image', attachment: third },
      ],
      model: { current: () => ({ provider: 'test', model: 'vision' }) },
      llm: {
        async resolveModelInfo() { return { inputModalities: ['text', 'image'] } },
        async *stream() {},
      },
      hasViewer: false,
      deepAfterReply: false,
      maxImages: 2,
    })

    expect(routed.attachments).toEqual([
      { type: 'text', text: '开头' },
      { type: 'image', attachment: first },
      { type: 'text', text: '中间' },
      { type: 'image', attachment: second },
    ])
    expect(routed.notice).toContain('另有 1 张未分析')
  })

  it('当前模型声明能收图时保留图片并跳过视觉补看提示', async () => {
    const attachment = image()
    const routed = await routeImagesForModel({
      attachments: [{ type: 'image', attachment }],
      model: { current: () => ({ provider: 'test', model: 'vision' }) },
      llm: {
        async resolveModelInfo() {
          return { inputModalities: ['text', 'image'] }
        },
        async *stream() {},
      },
      hasViewer: true,
      deepAfterReply: true,
    })

    expect(routed.attachments).toEqual([{ type: 'image', attachment }])
    expect(routed.notice).toBe('')
  })

  it('profile 固定视觉路由时，即使聊天模型支持图片也使用配置的视觉模型', async () => {
    const attachment = image('configured-vision')
    const describe = vi.fn(async () => 'Gemini 观察到一张猫的照片')
    const resolveModelInfo = vi.fn(async () => ({ inputModalities: ['text', 'image'] }))
    const routed = await routeImagesForModel({
      attachments: [{ type: 'image', attachment }],
      model: { current: () => ({ provider: 'relay-103', model: 'deepseek-v4.1-flash' }) },
      llm: { resolveModelInfo, async *stream() {} },
      describe,
      hasViewer: true,
      deepAfterReply: false,
      preferConfiguredVision: true,
    })

    expect(resolveModelInfo).not.toHaveBeenCalled()
    expect(describe).toHaveBeenCalledWith(attachment, '按画面实际内容说明，不猜身份与画外内容')
    expect(routed.attachments).toEqual([])
    expect(routed.notice).toContain('Gemini 观察到一张猫的照片')
  })

  it('视觉路由开启但未配置视觉模型时仍允许兼容模型直接看图', async () => {
    const attachment = image('native-vision')
    const routed = await routeImagesForModel({
      attachments: [{ type: 'image', attachment }],
      model: { current: () => ({ provider: 'relay-103', model: 'vision-chat' }) },
      llm: {
        async resolveModelInfo() { return { inputModalities: ['text', 'image'] } },
        async *stream() {},
      },
      hasViewer: false,
      deepAfterReply: false,
      preferConfiguredVision: true,
    })

    expect(routed.attachments).toEqual([{ type: 'image', attachment }])
  })

  it('单图主视觉模型失败时改用高能力模型并记录实际路由', async () => {
    const attachment = image('single-fallback')
    const describe = vi.fn(async () => { throw new Error('primary unavailable') })
    const describeComplex = vi.fn(async () => '备用视觉模型识别到一张截图')
    const routed = await routeImagesForModel({
      attachments: [{ type: 'image', attachment }],
      model: { current: () => ({ provider: 'relay-103', model: 'deepseek-v4.1-flash' }) },
      llm: { async resolveModelInfo() { return { inputModalities: ['text', 'image'] } }, async *stream() {} },
      describe,
      describeComplex,
      visionProvider: 'relay-103',
      visionModel: 'gemini-3.8-flash',
      visionHighModel: 'gemini-3.8-flash-high',
      hasViewer: true,
      deepAfterReply: false,
      preferConfiguredVision: true,
    })

    expect(describe).toHaveBeenCalledOnce()
    expect(describeComplex).toHaveBeenCalledOnce()
    expect(routed.route).toBe('vision-fallback')
    expect(routed.provider).toBe('relay-103')
    expect(routed.model).toBe('gemini-3.8-flash-high')
    expect(routed.notice).toContain('备用视觉模型识别到一张截图')
  })

  it('多图主模型失败后用一次低延迟视觉请求保留整组顺序', async () => {
    const first = image('sequence-first')
    const second = image('sequence-second')
    const primary = vi.fn(async () => { throw new Error('high model unavailable') })
    const fallback = vi.fn(async (images: readonly ImageAttachmentRef[]) => `按顺序读取 ${images.length} 张`)
    const routed = await routeImagesForModel({
      attachments: [
        { type: 'image', attachment: first },
        { type: 'image', attachment: second },
      ],
      model: { current: () => ({ provider: 'relay-103', model: 'deepseek-v4.1-flash' }) },
      llm: { async resolveModelInfo() { return { inputModalities: ['text'] } }, async *stream() {} },
      describe: vi.fn(async () => 'single'),
      describeSequence: primary,
      describeSequenceFallback: fallback,
      visionProvider: 'relay-103',
      visionModel: 'gemini-3.8-flash',
      visionHighModel: 'gemini-3.8-flash-high',
      hasViewer: true,
      deepAfterReply: false,
      preferConfiguredVision: true,
    })

    expect(primary).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledWith([first, second], expect.any(String))
    expect(routed.route).toBe('vision-fallback')
    expect(routed.model).toBe('gemini-3.8-flash')
    expect(routed.notice).toContain('按顺序读取 2 张')
  })

  it('视觉模型都失败时只有明确支持图片的聊天模型能接收原图', async () => {
    const attachment = image('chat-fallback')
    const routed = await routeImagesForModel({
      attachments: [{ type: 'image', attachment }],
      model: { current: () => ({ provider: 'relay-103', model: 'deepseek-v4.1-flash' }) },
      llm: { async resolveModelInfo() { return { inputModalities: ['text', 'image'] } }, async *stream() {} },
      describe: vi.fn(async () => { throw new Error('vision unavailable') }),
      describeComplex: vi.fn(async () => { throw new Error('high vision unavailable') }),
      visionProvider: 'relay-103',
      visionModel: 'gemini-3.8-flash',
      visionHighModel: 'gemini-3.8-flash-high',
      hasViewer: true,
      deepAfterReply: false,
      preferConfiguredVision: true,
    })

    expect(routed.route).toBe('chat')
    expect(routed.provider).toBe('relay-103')
    expect(routed.model).toBe('deepseek-v4.1-flash')
    expect(routed.attachments).toEqual([{ type: 'image', attachment }])
    expect(routed.notice).toContain('改由聊天模型直接看图')
  })

  it('多图主备视觉模型都只收到顺序前缀中的预算内图片', async () => {
    const first = image('budget-first', 10)
    const second = image('budget-second', 10)
    const third = image('budget-third', 1)
    const primary = vi.fn(async () => { throw new Error('high model unavailable') })
    const fallback = vi.fn(async (images: readonly ImageAttachmentRef[]) => `按顺序读取 ${images.length} 张`)
    const routed = await routeImagesForModel({
      attachments: [
        { type: 'image', attachment: first },
        { type: 'image', attachment: second },
        { type: 'image', attachment: third },
      ],
      model: { current: () => ({ provider: 'relay-103', model: 'deepseek-v4.1-flash' }) },
      llm: { async resolveModelInfo() { return { inputModalities: ['text'] } }, async *stream() {} },
      describe: vi.fn(async () => 'single'),
      describeSequence: primary,
      describeSequenceFallback: fallback,
      visionProvider: 'relay-103',
      visionModel: 'gemini-3.8-flash',
      visionHighModel: 'gemini-3.8-flash-high',
      hasViewer: true,
      deepAfterReply: false,
      preferConfiguredVision: true,
      maxBytes: 20,
    })

    expect(primary).toHaveBeenCalledWith([first, second], expect.any(String))
    expect(fallback).toHaveBeenCalledWith([first, second], expect.any(String))
    expect(routed.route).toBe('vision-fallback')
    expect(routed.notice).toContain('另有 1 张未分析')
    expect(routed.notice).toContain('20 字节')
  })

  it('聊天模型直看图片时遵守同一字节预算并保留消息顺序', async () => {
    const first = image('chat-budget-first', 12)
    const second = image('chat-budget-second', 9)
    const routed = await routeImagesForModel({
      attachments: [
        { type: 'text', text: '开头' },
        { type: 'image', attachment: first },
        { type: 'text', text: '后续' },
        { type: 'image', attachment: second },
      ],
      model: { current: () => ({ provider: 'test', model: 'vision' }) },
      llm: {
        async resolveModelInfo() { return { inputModalities: ['text', 'image'] } },
        async *stream() {},
      },
      hasViewer: false,
      deepAfterReply: false,
      maxBytes: 20,
    })

    expect(routed.route).toBe('chat')
    expect(routed.attachments).toEqual([
      { type: 'text', text: '开头' },
      { type: 'image', attachment: first },
      { type: 'text', text: '后续' },
    ])
    expect(routed.notice).toContain('另有 1 张未分析')
  })

  it('首张图片超过字节预算时不向任何模型发送图片', async () => {
    const oversized = image('oversized', 21)
    const describe = vi.fn(async () => '不应触发')
    const resolveModelInfo = vi.fn(async () => ({ inputModalities: ['text', 'image'] }))
    const routed = await routeImagesForModel({
      attachments: [{ type: 'image', attachment: oversized }],
      model: { current: () => ({ provider: 'test', model: 'vision' }) },
      llm: { resolveModelInfo, async *stream() {} },
      describe,
      hasViewer: true,
      deepAfterReply: false,
      maxBytes: 20,
    })

    expect(routed.route).toBe('unavailable')
    expect(routed.attachments).toEqual([])
    expect(routed.notice).toContain('图片仍已保存')
    expect(describe).not.toHaveBeenCalled()
    expect(resolveModelInfo).not.toHaveBeenCalled()
  })
})
