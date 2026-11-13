import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, type ImageAttachmentRef } from '@huoli/huoli-attachment'
import type { ContentBlock } from '@huoli/huoli-llm'
import type { IncomingMessage } from '@huoli/huoli-qq-channel'
import { historyObserveOnly } from '../src/incoming-runtime.ts'
import { createMessageMerger, createWorkQueue, shouldAutonomousNudge } from '../src/runtime.ts'

function deferred(): { promise: Promise<void>; done: () => void } {
  let done: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    done = resolve
  })
  return { promise, done }
}

describe('会话排队', () => {
  it('立即启动不记成排队，真实等待只带实际等待时长', async () => {
    vi.useFakeTimers()
    try {
      const events: { kind: string; waitMs?: number }[] = []
      const queue = createWorkQueue({ slots: 1, perKeyMax: 2, onEvent: event => events.push(event) })
      const first = deferred()
      expect(queue.enqueue({ key: 'private:1', async run() { await first.promise } })).toBe('started')
      expect(events.map(event => event.kind)).toEqual(['started'])
      expect(queue.enqueue({ key: 'private:1', async run() {} })).toBe('queued')
      vi.advanceTimersByTime(125)
      first.done()
      await vi.waitFor(() => { expect(events.some(event => event.kind === 'finished')).toBe(true) })
      await vi.waitFor(() => { expect(events.some(event => event.kind === 'started' && (event.waitMs ?? 0) >= 125)).toBe(true) })
    } finally {
      vi.useRealTimers()
    }
  })

  it('同一个聊天按顺序走，前一项结束就接着下一项', async () => {
    const queue = createWorkQueue({ slots: 2, perKeyMax: 4 })
    const first = deferred()
    const order: string[] = []
    queue.enqueue({ key: 'private:1', async run() { order.push('第一项开始'); await first.promise; order.push('第一项结束') } })
    queue.enqueue({ key: 'private:1', async run() { order.push('第二项开始') } })

    await Promise.resolve()
    expect(order).toEqual(['第一项开始'])
    first.done()
    await vi.waitFor(() => {
      expect(order).toEqual(['第一项开始', '第一项结束', '第二项开始'])
    })
  })

  it('不同聊天可以同时跑，空出执行位就启动下一个聊天', async () => {
    const queue = createWorkQueue({ slots: 2, perKeyMax: 4 })
    const first = deferred()
    const started: string[] = []
    queue.enqueue({ key: 'group:1', async run() { started.push('一群'); await first.promise } })
    queue.enqueue({ key: 'group:2', async run() { started.push('二群') } })
    queue.enqueue({ key: 'group:3', async run() { started.push('三群') } })

    await Promise.resolve()
    expect(started).toEqual(['一群', '二群'])
    first.done()
    await vi.waitFor(() => {
      expect(started).toContain('三群')
    })
  })

  it('一个聊天的等待项有上限，满了明确拒绝', () => {
    const queue = createWorkQueue({ slots: 1, perKeyMax: 1 })
    const held = deferred()
    queue.enqueue({ key: 'group:1', async run() { await held.promise } })
    expect(queue.enqueue({ key: 'group:1', async run() {} })).toBe('queued')
    expect(queue.enqueue({ key: 'group:1', async run() {} })).toBe('full')
    expect(queue.waiting()).toBe(1)
    held.done()
  })

  it('关掉之后不再接新项', () => {
    const queue = createWorkQueue({ slots: 1, perKeyMax: 2 })
    queue.close()
    expect(queue.enqueue({ key: 'group:1', async run() {} })).toBe('closed')
  })
})

describe('短消息合并', () => {
  it('窗口内按顺序合成一条，窗口结束交给下一路', () => {
    vi.useFakeTimers()
    try {
      const flushed: string[] = []
      const merger = createMessageMerger({
        delayMs: () => 1_500,
        maxDelayMs: 4_000,
        maxChars: 8_000,
        onFlush: message => flushed.push(message.text),
      })
      merger.push('private:1', { senderName: '甲', text: '第一句', at: 1 })
      vi.advanceTimersByTime(500)
      merger.push('private:1', { senderName: '甲', text: '第二句', at: 2 })
      vi.advanceTimersByTime(1_499)
      expect(flushed).toEqual([])
      vi.advanceTimersByTime(1)
      expect(flushed).toEqual(['甲：第一句\n甲：第二句'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('点名、引用或字数超限时不再等', () => {
    const flushed: string[] = []
    const merger = createMessageMerger({
      delayMs: () => 1_500,
      maxDelayMs: 4_000,
      maxChars: 12,
      onFlush: message => flushed.push(message.text),
    })
    merger.push('group:1', { senderName: '甲', text: '@她', at: 1 }, true)
    merger.push('private:1', { senderName: '乙', text: '这一句已经很长了', at: 2 }, true)
    expect(flushed).toHaveLength(2)
  })

  it('带图片的点名消息等合并窗口收齐同一批图片', () => {
    vi.useFakeTimers()
    try {
      const ref: ImageAttachmentRef = {
        attachmentId: AttachmentId('sha256:' + 'a'.repeat(64)),
        mediaType: 'image/png',
        bytes: 1,
        width: 1,
        height: 1,
      }
      const image: ContentBlock = { type: 'image', attachment: ref }
      const flushed: { text: string; attachments: readonly ContentBlock[] }[] = []
      const merger = createMessageMerger({
        delayMs: () => 800,
        maxDelayMs: 4_000,
        maxChars: 8_000,
        onFlush: message => flushed.push(message),
      })

      merger.push('group:1', {
        senderName: '甲', text: '看一下', at: 1, attachments: [image], traceId: '1',
      }, true)
      vi.advanceTimersByTime(500)
      merger.push('group:1', {
        senderName: '甲', text: '还有这张', at: 2, attachments: [image], traceId: '2',
      }, true)

      expect(flushed).toEqual([])
      vi.advanceTimersByTime(800)
      expect(flushed).toHaveLength(1)
      expect(flushed[0]?.attachments).toEqual([image, image])
      expect(flushed[0]?.text).toContain('看一下')
      expect(flushed[0]?.text).toContain('还有这张')
    } finally {
      vi.useRealTimers()
    }
  })

  it('表情包被过滤后仍按含图消息等待并合并', () => {
    vi.useFakeTimers()
    try {
      const flushed: { text: string; attachments: readonly ContentBlock[] }[] = []
      const merger = createMessageMerger({
        delayMs: () => 800,
        maxDelayMs: 4_000,
        maxChars: 8_000,
        onFlush: message => flushed.push(message),
      })

      merger.push('group:1', {
        senderName: '甲', text: '这个表情呢', at: 1, containsImage: true, attachments: [],
      }, true)
      vi.advanceTimersByTime(300)
      merger.push('group:1', {
        senderName: '甲', text: '还有这个', at: 2, containsImage: true, attachments: [],
      }, true)

      expect(flushed).toEqual([])
      vi.advanceTimersByTime(800)
      expect(flushed).toHaveLength(1)
      expect(flushed[0]?.attachments).toEqual([])
      expect(flushed[0]?.text).toContain('这个表情呢')
      expect(flushed[0]?.text).toContain('还有这个')
    } finally {
      vi.useRealTimers()
    }
  })

  it('关掉时立刻交出去', () => {
    const flushed: string[] = []
    const merger = createMessageMerger({
      delayMs: () => 0,
      maxDelayMs: 0,
      maxChars: 100,
      onFlush: message => flushed.push(message.text),
    })
    merger.push('group:1', { senderName: '甲', text: '马上处理', at: 1 })
    expect(flushed).toEqual(['甲：马上处理'])
  })
})

describe('群历史唤醒', () => {
  const message: IncomingMessage = {
    chatKey: 'group:1',
    senderId: '2',
    senderName: '甲',
    text: '刚说过的话',
    at: 1,
    atMe: false,
    isPoke: false,
    replyToBot: false,
    messageId: '3',
    attachments: [],
    traceId: 'group:1#msg-3',
    selfSent: false,
    history: 'group',
  }

  it('默认只更新现场，不进入模型', () => {
    expect(historyObserveOnly(message, false)).toBe(true)
  })

  it('打开之后才允许历史进入正常判断', () => {
    expect(historyObserveOnly(message, true)).toBe(false)
    expect(historyObserveOnly({ ...message, history: 'private' }, false)).toBe(false)
  })
})

describe('自主时刻', () => {
  const base = {
    mode: 'autonomous' as const,
    chatKey: 'group:1',
    humanActive: false,
    busy: false,
    asleep: false,
    hasCandidate: false,
    waitingForReason: true,
  }

  it('完整自主模式只有攒到具体候选项才叫模型；空场面不巡场', () => {
    expect(shouldAutonomousNudge(base)).toBe(false)
    expect(shouldAutonomousNudge({ ...base, hasCandidate: true, waitingForReason: false })).toBe(true)
    expect(shouldAutonomousNudge({ ...base, chatKey: 'private:1', hasCandidate: true })).toBe(true)
  })

  it('只拦物理不可行；正在聊、休息、非自主模式都交给模型', () => {
    expect(shouldAutonomousNudge({ ...base, humanActive: true, hasCandidate: true })).toBe(true)
    expect(shouldAutonomousNudge({ ...base, busy: true })).toBe(false)
    expect(shouldAutonomousNudge({ ...base, asleep: true })).toBe(false)
    expect(shouldAutonomousNudge({ ...base, attentionSleeping: true })).toBe(false)
    expect(shouldAutonomousNudge({ ...base, resting: true, hasCandidate: true })).toBe(true)
    expect(shouldAutonomousNudge({ ...base, chatKey: 'other:1' })).toBe(false)
    expect(shouldAutonomousNudge({ ...base, selfTalkStreak: 2 })).toBe(false)
    expect(shouldAutonomousNudge({ ...base, selfTalkStreak: 2, hasCandidate: true })).toBe(true)
  })
})
