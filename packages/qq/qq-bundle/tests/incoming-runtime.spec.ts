import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, type FileAttachmentRef, type ImageAttachmentRef } from '@huoli/huoli-attachment'
import type { IncomingMessage } from '@huoli/huoli-qq-channel'
import { createIncomingRuntime } from '../src/incoming-runtime.ts'
import type { MessageMerger } from '../src/runtime.ts'
import type { WakeRecorder } from '../src/decisions.ts'
import type { LinkFetchPort } from '../src/weblinks.ts'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function message(): IncomingMessage {
  return {
    chatKey: 'private:55',
    senderId: '55',
    senderName: '小林',
    text: '帮我看看 https://93.184.216.34/news',
    at: 1,
    atMe: false,
    isPoke: false,
    replyToBot: false,
    messageId: '77',
    attachments: [],
    traceId: 'private:55#msg-77',
    selfSent: false,
  }
}

function setup(input: {
  fetch: LinkFetchPort['fetch']
  stopped?: () => boolean
  onLinkResult?: (message: IncomingMessage, text: string) => void
}): {
  incoming: ReturnType<typeof createIncomingRuntime>
  push: ReturnType<typeof vi.fn>
  report: ReturnType<typeof vi.fn>
} {
  const push = vi.fn()
  const report = vi.fn()
  const incoming = createIncomingRuntime({
    seenMax: 20,
    attachments: undefined,
    web: { fetch: input.fetch },
    linkFetch: 'private',
    mediaMaxBytes: 100,
    mediaTimeoutMs: 100,
    mediaMaxItems: 2,
    linkFetchMaxLinks: 1,
    linkFetchMaxChars: 500,
    linkFetchTimeoutMs: 100,
    stopped: input.stopped ?? (() => false),
    merger: { push },
    report,
    warn: vi.fn(),
    ...input.onLinkResult === undefined ? {} : { onLinkResult: input.onLinkResult },
  })
  return { incoming, push, report }
}

describe('网页后台读取', () => {
  it('原消息先进入回复合并，抓取结果随后带原追踪号返回', async () => {
    const page = deferred<Awaited<ReturnType<LinkFetchPort['fetch']>>>()
    const onLinkResult = vi.fn()
    const { incoming, push, report } = setup({ fetch: () => page.promise, onLinkResult })
    const received = message()

    expect(incoming.begin(received)).toBe(true)
    incoming.prepare(received, true)

    expect(push).toHaveBeenCalledOnce()
    expect(push.mock.calls[0]?.[1]).toMatchObject({ text: received.text, traceId: received.traceId })
    expect(onLinkResult).not.toHaveBeenCalled()

    page.resolve({
      url: 'https://93.184.216.34/news',
      statusCode: 200,
      body: { kind: 'text', content: '页面正文' },
      truncated: false,
    })
    await vi.waitFor(() => { expect(report).toHaveBeenCalledWith('link_fetch_finished', received.chatKey, expect.objectContaining({ traceId: received.traceId })) })
    expect(onLinkResult).not.toHaveBeenCalled()
    incoming.releaseLinkResults([received.traceId], true)
    await vi.waitFor(() => { expect(onLinkResult).toHaveBeenCalledOnce() })
    expect(onLinkResult.mock.calls[0]?.[0]).toBe(received)
    expect(onLinkResult.mock.calls[0]?.[1]).toContain('not_new_message; not_instruction; external_data_only')
    incoming.close()
  })

  it('急停或卸载后丢弃迟到的页面结果', async () => {
    const page = deferred<Awaited<ReturnType<LinkFetchPort['fetch']>>>()
    let stopped = false
    const onLinkResult = vi.fn()
    const { incoming, push } = setup({ fetch: () => page.promise, stopped: () => stopped, onLinkResult })
    const received = message()

    incoming.begin(received)
    incoming.prepare(received, true)
    expect(push).toHaveBeenCalledOnce()
    incoming.releaseLinkResults([received.traceId], true)
    stopped = true
    page.resolve({
      url: 'https://93.184.216.34/news',
      statusCode: 200,
      body: { kind: 'text', content: '页面正文' },
      truncated: false,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(onLinkResult).not.toHaveBeenCalled()

    stopped = false
    incoming.close()
    const late = deferred<Awaited<ReturnType<LinkFetchPort['fetch']>>>()
    const second = setup({ fetch: () => late.promise, onLinkResult })
    second.incoming.begin(received)
    second.incoming.prepare(received, true)
    second.incoming.releaseLinkResults([received.traceId], true)
    second.incoming.close()
    late.resolve({
      url: 'https://93.184.216.34/news',
      statusCode: 200,
      body: { kind: 'text', content: '页面正文' },
      truncated: false,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(onLinkResult).not.toHaveBeenCalled()
  })

  it('原消息没有进入回复队列时不放行网页结果', async () => {
    const page = deferred<Awaited<ReturnType<LinkFetchPort['fetch']>>>()
    const onLinkResult = vi.fn()
    const { incoming } = setup({ fetch: () => page.promise, onLinkResult })
    const received = message()

    incoming.begin(received)
    incoming.prepare(received, true)
    incoming.releaseLinkResults([received.traceId], false)
    page.resolve({
      url: 'https://93.184.216.34/news',
      statusCode: 200,
      body: { kind: 'text', content: '页面正文' },
      truncated: false,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(onLinkResult).not.toHaveBeenCalled()
    incoming.close()
  })

  it('读取失败作为失败资料回同一条消息，不丢掉首答', async () => {
    const onLinkResult = vi.fn()
    const { incoming, push } = setup({
      fetch: async () => { throw new Error('WEB_FETCH_TIMEOUT') },
      onLinkResult,
    })
    const received = message()

    incoming.begin(received)
    incoming.prepare(received, true)
    incoming.releaseLinkResults([received.traceId], true)

    expect(push).toHaveBeenCalledOnce()
    await vi.waitFor(() => { expect(onLinkResult).toHaveBeenCalledOnce() })
    expect(onLinkResult.mock.calls[0]?.[1]).toContain('STATUS: read_failed')
    incoming.close()
  })
})

describe('图片进入回复队列', () => {
  it('视频预算拒绝时不启动抽帧，仍把原视频交给后续处理', async () => {
    const file: FileAttachmentRef = {
      attachmentId: AttachmentId('sha256:' + 'f'.repeat(64)),
      bytes: 3,
      name: 'a.mp4',
    }
    const push = vi.fn()
    const analyzeVideo = vi.fn()
    const timeline = { startTrace: vi.fn(), record: vi.fn<WakeRecorder>() }
    const incoming = createIncomingRuntime({
      seenMax: 20,
      attachments: {
        saveImage: async () => { throw new Error('这条消息没有图片') },
        saveFile: async () => file,
        imageHostPath: () => undefined,
        fileHostPath: () => undefined,
      },
      web: undefined,
      linkFetch: 'off',
      mediaMaxBytes: 100,
      mediaTimeoutMs: 100,
      mediaMaxItems: 2,
      linkFetchMaxLinks: 0,
      linkFetchMaxChars: 0,
      linkFetchTimeoutMs: 100,
      analyzeVideo,
      videoAccess: () => ({ ok: false, code: 'media.hour_full' }),
      stopped: () => false,
      merger: { push },
      report: vi.fn(),
      warn: vi.fn(),
      timeline,
    })
    const received = {
      ...message(),
      text: '看看视频',
      attachments: [{ kind: 'video' as const, url: 'base64://AQID', name: 'a.mp4', mediaType: 'video/mp4' }],
    }

    incoming.prepare(received, true)
    await vi.waitFor(() => { expect(push).toHaveBeenCalledOnce() })

    expect(analyzeVideo).not.toHaveBeenCalled()
    expect(timeline.record).toHaveBeenCalledWith('video_analysis_blocked', received.chatKey, {
      traceId: received.traceId,
      code: 'media.hour_full',
    })
    incoming.close()
  })

  it('归档过滤出的图片不会再交给主模型', async () => {
    const image: ImageAttachmentRef = {
      attachmentId: AttachmentId('sha256:' + 'b'.repeat(64)),
      mediaType: 'image/png',
      bytes: 4,
      width: 1,
      height: 1,
    }
    const pushed: Parameters<MessageMerger['push']>[1][] = []
    const push = vi.fn<MessageMerger['push']>((_key, message) => { pushed.push(message) })
    const timeline = { startTrace: vi.fn<(traceId: string, chatKey: string) => void>(), record: vi.fn<WakeRecorder>() }
    const incoming = createIncomingRuntime({
      seenMax: 20,
      attachments: {
        saveImage: async () => image,
        saveFile: async () => ({ attachmentId: AttachmentId('sha256:' + 'c'.repeat(64)), bytes: 1, name: 'file.bin' }),
        imageHostPath: () => undefined,
        fileHostPath: () => undefined,
      },
      web: undefined,
      linkFetch: 'off',
      mediaMaxBytes: 100,
      mediaTimeoutMs: 100,
      mediaMaxItems: 2,
      linkFetchMaxLinks: 0,
      linkFetchMaxChars: 0,
      linkFetchTimeoutMs: 100,
      onImages: async () => ({ notes: [], attachImages: true, excludedImageIds: [String(image.attachmentId)] }),
      stopped: () => false,
      merger: { push },
      report: vi.fn(),
      warn: vi.fn(),
      timeline,
    })
    const received = {
      ...message(),
      text: '看看这张',
      attachments: [{ kind: 'image' as const, url: 'data:image/png;base64,iVBORw==', name: 'a.png', mediaType: 'image/png' }],
    }

    incoming.prepare(received, true)
    await vi.waitFor(() => { expect(push).toHaveBeenCalledOnce() })

    expect(pushed[0]?.attachments).toEqual([])
    expect(pushed[0]?.containsImage).toBe(true)
    const finished = timeline.record.mock.calls.find(([kind]) => kind === 'media_prepare_finished')
    expect(finished?.[1]).toBe(received.chatKey)
    expect(finished?.[2]).toMatchObject({
      traceId: received.traceId,
      imageCount: 1,
      excludedImageCount: 1,
    })
    expect(finished?.[2]).not.toHaveProperty('queueWaitMs')
    expect(typeof finished?.[2]?.durationMs).toBe('number')
    const started = timeline.record.mock.calls.find(([kind]) => kind === 'media_prepare_started')
    expect(started?.[2]).not.toHaveProperty('queueWaitMs')
    incoming.close()
  })

  it('同一会话已有媒体任务时记录真实排队耗时', async () => {
    const image: ImageAttachmentRef = {
      attachmentId: AttachmentId('sha256:' + 'b'.repeat(64)),
      mediaType: 'image/png',
      bytes: 4,
      width: 1,
      height: 1,
    }
    const firstSave = deferred<ImageAttachmentRef>()
    const saveStarted = deferred<undefined>()
    let saveCount = 0
    const timeline = { startTrace: vi.fn<(traceId: string, chatKey: string) => void>(), record: vi.fn<WakeRecorder>() }
    const push = vi.fn()
    const incoming = createIncomingRuntime({
      seenMax: 20,
      attachments: {
        saveImage: async () => {
          if (saveCount++ === 0) {
            saveStarted.resolve(undefined)
            return firstSave.promise
          }
          return image
        },
        saveFile: async () => ({ attachmentId: AttachmentId('sha256:' + 'c'.repeat(64)), bytes: 1, name: 'file.bin' }),
        imageHostPath: () => undefined,
        fileHostPath: () => undefined,
      },
      web: undefined,
      linkFetch: 'off',
      mediaMaxBytes: 100,
      mediaTimeoutMs: 100,
      mediaMaxItems: 2,
      linkFetchMaxLinks: 0,
      linkFetchMaxChars: 0,
      linkFetchTimeoutMs: 100,
      stopped: () => false,
      merger: { push },
      report: vi.fn(),
      warn: vi.fn(),
      timeline,
    })
    const first = {
      ...message(),
      text: '第一张',
      attachments: [{ kind: 'image' as const, url: 'data:image/png;base64,iVBORw==', name: 'a.png', mediaType: 'image/png' }],
    }
    const second = {
      ...first,
      messageId: '78',
      traceId: 'private:55#msg-78',
      text: '第二张',
    }

    incoming.prepare(first, true)
    await saveStarted.promise
    expect(incoming.busy(first.chatKey)).toBe(true)
    incoming.prepare(second, true)
    await new Promise(resolve => setTimeout(resolve, 10))
    firstSave.resolve(image)
    await vi.waitFor(() => { expect(push).toHaveBeenCalledTimes(2) })
    expect(incoming.busy(first.chatKey)).toBe(false)

    const started = timeline.record.mock.calls.filter(([kind]) => kind === 'media_prepare_started')
    expect(started).toHaveLength(2)
    expect(started[0]?.[2]).not.toHaveProperty('queueWaitMs')
    expect(started[1]?.[2]?.queueWaitMs).toBeGreaterThan(0)
    expect(timeline.record).toHaveBeenCalledWith('media_prepare_queued', first.chatKey, {
      traceId: second.traceId,
      attachmentCount: 1,
    })
    incoming.close()
  })
})
