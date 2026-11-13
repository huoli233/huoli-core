import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ImageAttachmentRef } from '@huoli/huoli-attachment'
import type { StreamChunk } from '@huoli/huoli-llm'
import type { ImageArchive, ImageRecord } from '../src/image-archive.ts'
import { identifySelf, type SelfImageOptions } from '../src/self-image.ts'

const roots: string[] = []
const targetRef = { attachmentId: 'target', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } as ImageAttachmentRef

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function referenceFile(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-self-image-'))
  roots.push(root)
  const file = path.join(root, 'self.png')
  fs.writeFileSync(file, Uint8Array.of(1))
  return file
}

function options(overrides: Partial<SelfImageOptions> = {}): SelfImageOptions {
  const record = {
    imageId: 'target', chatKey: 'group:1', image: targetRef,
  } as ImageRecord
  const archive = { get: () => record } as unknown as ImageArchive
  return {
    archive,
    llm: undefined,
    provider: '',
    model: '',
    selfId: '',
    attachments: {
      saveImage: () => Promise.resolve({
        attachmentId: 'reference', mediaType: 'image/png', bytes: 1, width: 1, height: 1,
      } as ImageAttachmentRef),
    },
    referenceImages: [referenceFile()],
    referenceDescription: 'white whale tail; blue hair',
    maxBytes: 1_000,
    maxReferences: 3,
    timeoutMs: 5_000,
    maxTokens: 800,
    ...overrides,
  }
}

describe('自画像识别', () => {
  it('目标与参考图哈希相同时直接判 exact，不调模型', async () => {
    const exactRef = { ...targetRef }
    const verdict = await identifySelf(options({
      attachments: { saveImage: () => Promise.resolve(exactRef) },
    }), 'group:1', 'target')

    expect(verdict).toMatchObject({ level: 'exact', confidence: 1, matchedFeatures: ['hash_equal'] })
  })

  it('视觉模型给出外观不一致时判成 possible，并保留衣着和差异', async () => {
    const llm: SelfImageOptions['llm'] = {
      async *stream() {
        yield {
          type: 'text-delta', index: 0,
          text: '{"is_self":"likely","confidence":0.72,"matched_features":["blue_hair","whale_tail"],"differences":["different_outfit"],"clothing":"white_dress","scene":"room","people":"one","actions":"standing","note":"same_character_different_style"}',
        } satisfies StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }
    const verdict = await identifySelf(options({ llm, provider: 'relay', model: 'vision' }), 'group:1', 'target')

    expect(verdict).toMatchObject({
      level: 'likely',
      isSelf: 'likely',
      clothing: 'white_dress',
      scene: 'room',
      differences: ['different_outfit'],
    })
  })

  it('没有可用参考图时明确拒绝，不猜自己', async () => {
    await expect(identifySelf(options({ referenceImages: [] }), 'group:1', 'target'))
      .rejects.toThrow('self_image.no_reference')
  })
})
