import { AttachmentId, type ImageAttachmentRef } from '@huoli/huoli-attachment'
import type { StreamChunk } from '@huoli/huoli-llm'
import { describe, expect, it } from 'vitest'
import { createVisionDescriber, describeImage, describeImageSequence, type VisionLlmPort } from '../src/vision.ts'

const IMAGE: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'),
  mediaType: 'image/png',
  bytes: 10,
  width: 10,
  height: 10,
}

describe('视觉理解', () => {
  it('首选视觉模型成功后保持固定，不轮换到备用模型', async () => {
    const seen: string[] = []
    const llm: VisionLlmPort = {
      async *stream(options) {
        seen.push(options.model)
        yield { type: 'text-delta', index: 0, text: `由 ${options.model} 识别` } satisfies StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }
    const describe = createVisionDescriber(llm, {
      visionProvider: 'relay',
      visionModels: ['gpt-model', 'gemini-model'],
      visionAttemptTimeoutMs: 1_000,
    })
    expect(describe).toBeTypeOf('function')

    await expect(describe?.(IMAGE)).resolves.toBe('由 gpt-model 识别')
    await expect(describe?.(IMAGE)).resolves.toBe('由 gpt-model 识别')
    expect(seen).toEqual(['gpt-model', 'gpt-model'])
  })

  it('自动视觉候选失败时切换到下一个模型', async () => {
    const seen: string[] = []
    const llm: VisionLlmPort = {
      async *stream(options) {
        seen.push(options.model)
        if (options.model === 'gpt-model') {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM', message: '空流' } } } satisfies StreamChunk
        } else {
          yield { type: 'text-delta', index: 0, text: 'Gemini 读到了截图' } satisfies StreamChunk
          yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
        }
      },
    }
    const describe = createVisionDescriber(llm, {
      visionProvider: 'relay',
      visionModels: ['gpt-model', 'gemini-model'],
      visionAttemptTimeoutMs: 1_000,
    })

    await expect(describe?.(IMAGE)).resolves.toBe('Gemini 读到了截图')
    expect(seen).toEqual(['gpt-model', 'gemini-model'])
  })

  it('把图片交给指定视觉模型并取回短描述', async () => {
    const llm: VisionLlmPort = {
      async *stream() {
        yield { type: 'text-delta', index: 0, text: '一只白色小猫' } satisfies StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }

    await expect(describeImage(llm, IMAGE, {
      provider: 'relay', model: 'vision', maxTokens: 64, maxChars: 100, timeoutMs: 1_000,
    })).resolves.toBe('一只白色小猫')
  })

  it('视觉模型没有输出时给出明确失败', async () => {
    const llm: VisionLlmPort = {
      async *stream() {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM', message: '空流' } } } satisfies StreamChunk
      },
    }

    await expect(describeImage(llm, IMAGE, {
      provider: 'relay', model: 'vision', maxTokens: 64, maxChars: 100, timeoutMs: 1_000,
    })).rejects.toThrow('vision.error')
  })

  it('一组图片作为一次视觉请求按顺序携带', async () => {
    const second: ImageAttachmentRef = {
      ...IMAGE,
      attachmentId: AttachmentId('sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'),
    }
    let calls = 0
    let prompt = ''
    const llm: VisionLlmPort = {
      async *stream(options) {
        calls += 1
        prompt = JSON.stringify(options.messages)
        yield { type: 'text-delta', index: 0, text: '第一张是入口，第二张是结果页' } satisfies StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }

    await expect(describeImageSequence(llm, [IMAGE, second], {
      provider: 'relay', model: 'vision-high', maxTokens: 64, maxChars: 100, timeoutMs: 1_000,
    })).resolves.toBe('第一张是入口，第二张是结果页')

    expect(calls).toBe(1)
    expect(prompt).toContain('IMAGE 1/2')
    expect(prompt).toContain('IMAGE 2/2')
    expect(prompt.indexOf('IMAGE 1/2')).toBeLessThan(prompt.indexOf('IMAGE 2/2'))
    expect(prompt.indexOf('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'))
      .toBeLessThan(prompt.indexOf('dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'))
  })

  it('表情包用专门的语义观察提示，不套普通照片说明', async () => {
    let prompt = ''
    const llm: VisionLlmPort = {
      async *stream(options) {
        prompt = JSON.stringify(options.messages)
        yield { type: 'text-delta', index: 0, text: '一只猫扶额，适合无奈' } satisfies StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }

    await describeImage(llm, IMAGE, {
      provider: 'relay',
      model: 'vision',
      maxTokens: 64,
      maxChars: 100,
      timeoutMs: 1_000,
      kind: 'sticker',
      deep: true,
    })

    expect(prompt).toContain('QQ_IMAGE_STICKER')
    expect(prompt).toContain('SECTION_4_EMOTION')
    expect(prompt).toContain('dominant_emotion|secondary_emotion|intensity_0_100')
    expect(prompt).toContain('SECTION_5_USE')
    expect(prompt).toContain('appropriate_contexts|inappropriate_contexts')
  })

  it('截图按界面位置读取可见文字，不推断画面外状态', async () => {
    let prompt = ''
    const llm: VisionLlmPort = {
      async *stream(options) {
        prompt = JSON.stringify(options.messages)
        yield { type: 'text-delta', index: 0, text: '页面显示连接失败' } satisfies StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }

    await describeImage(llm, IMAGE, {
      provider: 'relay',
      model: 'vision',
      maxTokens: 64,
      maxChars: 100,
      timeoutMs: 1_000,
      kind: 'screenshot',
      deep: true,
    })

    expect(prompt).toContain('QQ_IMAGE_SCREENSHOT')
    expect(prompt).toContain('STEP_2: read_visible_title')
    expect(prompt).toContain('STEP_5: list_status_messages')
    expect(prompt).toContain('no_offscreen_inference')
  })

  it('通用深看遇到界面也会读取可见状态和报错', async () => {
    let prompt = ''
    const llm: VisionLlmPort = {
      async *stream(options) {
        prompt = JSON.stringify(options.messages)
        yield { type: 'text-delta', index: 0, text: '画面里有一个错误弹窗' } satisfies StreamChunk
        yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
      },
    }

    await describeImage(llm, IMAGE, {
      provider: 'relay',
      model: 'vision',
      maxTokens: 64,
      maxChars: 100,
      timeoutMs: 1_000,
      kind: 'photo',
      deep: true,
    })

    expect(prompt).toContain('QQ_IMAGE_DEEP')
    expect(prompt).toContain('SECTION_2_SUBJECTS')
    expect(prompt).toContain('SECTION_5_UI_OR_DOCUMENT')
    expect(prompt).toContain('SECTION_9_UNCERTAIN')
    expect(prompt).toContain('SELF_RECOGNITION: require_reference_match')
    expect(prompt).toContain('CHARACTER_ID:')
  })
})
