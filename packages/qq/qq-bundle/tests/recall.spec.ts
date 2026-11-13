import type { QqMessage } from '@huoli/huoli-qq-attention'
import type { IncomingRecall } from '@huoli/huoli-qq-channel'
import { describe, expect, it } from 'vitest'
import { recallNoticeText } from '../src/recall.ts'

const recall: IncomingRecall = {
  chatKey: 'group:123',
  senderId: '555',
  operatorId: '555',
  messageId: '901',
  at: 1,
  selfMessage: false,
  bySelf: false,
}

describe('撤回现场', () => {
  it('关联到原话时说明是谁撤回，并禁止复述', () => {
    const original: QqMessage = {
      seq: 1,
      chatKey: 'group:123',
      messageId: '901',
      senderId: '555',
      senderName: '阿澈',
      text: '刚才那句不算',
      at: 1,
    }

    const text = recallNoticeText(recall, original)

    expect(text).toContain('阿澈')
    expect(text).toContain('刚才那句不算')
    expect(text).toContain('不要复述')
  })

  it('管理员撤回机器人消息时直接说清', () => {
    const text = recallNoticeText({
      ...recall,
      senderId: '999',
      operatorId: '777',
      selfMessage: true,
    }, undefined)

    expect(text).toContain('用户 999 撤回了你刚发的一条消息')
    expect(text).toContain('收件箱里已经没有那条原文')
  })
})
