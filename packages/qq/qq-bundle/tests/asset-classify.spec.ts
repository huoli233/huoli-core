import { AttachmentId, type ImageAttachmentRef } from '@huoli/huoli-attachment'
import type { StreamChunk } from '@huoli/huoli-llm'
import { describe, expect, it } from 'vitest'
import {
  assetFactText,
  classifyAsset,
  classificationSourceLabel,
  createAssetClassifier,
  fallbackClassification,
  parseClassification,
  type AssetClassifier,
} from '../src/asset-classify.ts'
import type { VisionLlmPort } from '../src/vision.ts'

const IMAGE: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'),
  mediaType: 'image/png',
  bytes: 10,
  width: 10,
  height: 10,
}

const OPTIONS = {
  provider: 'relay',
  model: 'vision',
  maxTokens: 200,
  maxChars: 2_000,
  timeoutMs: 1_000,
  fileName: 'a.gif',
  mediaType: 'image/gif',
}

describe('素材判类', () => {
  it('读得懂模型给的 JSON，并带上内容事实', () => {
    const result = parseClassification(
      '{"category":"sticker","kind":"表情包","caption":"猫猫扶额","tags":["猫","无语"],"ip":"","character":"猫猫","emotion":"无奈","intensity":0.8,"topic":"猫","subDir":"猫","keep":true,"favorite":true}',
      { fileName: 'a.gif', mediaType: 'image/gif' },
    )

    expect(result.source).toBe('model')
    expect(result.category).toBe('sticker')
    expect(result.kind).toBe('表情包')
    expect(result.caption).toBe('猫猫扶额')
    expect(result.tags).toEqual(['猫', '无语'])
    expect(result.character).toBe('猫猫')
    expect(result.emotion).toBe('无奈')
    expect(result.intensity).toBeCloseTo(0.8)
    expect(result.subDir).toBe('猫')
    expect(result.favorite).toBe(true)
    expect(result.ip).toBeUndefined()
  })

  it('只给中文形态名也能认出类别', () => {
    const result = parseClassification('{"kind":"截图","caption":"群聊"}', {
      fileName: 'shot.png',
      mediaType: 'image/png',
    })

    expect(result.category).toBe('screenshot')
    expect(result.source).toBe('model')
  })

  it('模型输出不是 JSON 时按扩展名兜底并标明来源', () => {
    const result = parseClassification('这不是 JSON', { fileName: 'b.pdf', mediaType: 'application/pdf' })

    expect(result.source).toBe('fallback')
    expect(result.category).toBe('document')
    expect(classificationSourceLabel(result.source)).toBe('按扩展名粗分')
    expect(classificationSourceLabel('protocol')).toBe('QQ 消息段标记')
  })

  it('按扩展名和声明类型粗分到对应类别', () => {
    expect(fallbackClassification({ fileName: 'a.gif', mediaType: '' }).category).toBe('other')
    expect(fallbackClassification({ fileName: 'a.apng', mediaType: '' }).category).toBe('other')
    expect(fallbackClassification({ fileName: '', mediaType: 'image/gif' }).category).toBe('other')
    expect(fallbackClassification({ fileName: 'a.jpg', mediaType: '' }).category).toBe('photo')
    expect(fallbackClassification({ fileName: 'a.mp4', mediaType: '' }).category).toBe('video')
    expect(fallbackClassification({ fileName: 'a.amr', mediaType: '' }).category).toBe('audio')
    expect(fallbackClassification({ fileName: 'a.docx', mediaType: '' }).category).toBe('document')
    expect(fallbackClassification({ fileName: 'a.apk', mediaType: '' }).category).toBe('other')
    expect(fallbackClassification({ fileName: 'noext', mediaType: 'video/quicktime' }).category).toBe('video')
    expect(fallbackClassification({ fileName: 'a.gif', mediaType: '' }).keep).toBe(true)
  })

  it('模型可用时用模型判类', async () => {
    const llm: VisionLlmPort = {
      async *stream() {
        yield {
          type: 'text-delta',
          index: 0,
          text: '{"category":"meme","kind":"梗图","caption":"熊猫头流泪","topic":"熊猫头","subDir":"熊猫头"}',
        } satisfies StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }

    const result = await classifyAsset(llm, IMAGE, OPTIONS)

    expect(result.source).toBe('model')
    expect(result.category).toBe('meme')
    expect(result.subDir).toBe('熊猫头')
  })

  it('模型不可用或抛错时退回兜底', async () => {
    const broken: VisionLlmPort = {
      async *stream() {
        throw new Error('upstream down')
      },
    }

    await expect(classifyAsset(broken, IMAGE, OPTIONS)).resolves.toMatchObject({
      source: 'fallback',
      category: 'other',
    })

    const silent: VisionLlmPort = {
      async *stream() {
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }
    await expect(classifyAsset(silent, IMAGE, OPTIONS)).resolves.toMatchObject({ source: 'fallback' })
  })

  it('没有配置视觉模型时不建判类器', () => {
    expect(createAssetClassifier(undefined, { provider: 'relay', model: 'v', maxTokens: 10, maxChars: 10, timeoutMs: 10 }))
      .toBeUndefined()
    const classifier: AssetClassifier | undefined = createAssetClassifier(
      { async *stream() { yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk } },
      { provider: '', model: 'v', maxTokens: 10, maxChars: 10, timeoutMs: 10 },
    )
    expect(classifier).toBeUndefined()
  })

  it('落盘事实拼成一句模型可读的话', () => {
    const text = assetFactText({
      relative: '表情包/猫/猫猫扶额_ab12cd34ef56.gif',
      kind: '表情包',
      caption: '猫猫扶额',
      emotion: '无奈',
      source: 'model',
    })

    expect(text).toContain('表情包/猫/')
    expect(text).toContain('内容：猫猫扶额')
    expect(text).toContain('情绪：无奈')
    expect(text).toContain('模型判类')
  })
})
