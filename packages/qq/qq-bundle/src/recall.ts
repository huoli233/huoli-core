// 把撤回通知写成模型能看懂的现场事实，不替它决定要不要回应

import type { ContentBlock, MessageSource } from '@huoli/huoli-llm'
import type { QqMessage, QqAttentionSeam } from '@huoli/huoli-qq-attention'
import type { IncomingRecall, QqChannelSeam } from '@huoli/huoli-qq-channel'
import type { QqSubjectSeam } from '@huoli/huoli-qq-subject'

/**
 * 写成一条撤回通知
 * @param recall - 谁撤回了哪一条
 * @param original - 收件箱里还留着的原话
 * @returns 只陈述事实与判断注意事项的一段话
 */
export function recallNoticeText(recall: IncomingRecall, original: QqMessage | undefined): string {
  const who = recall.senderId === '' ? '有人' : original?.senderName ?? `用户 ${recall.senderId}`
  const action = recall.selfMessage
    ? recall.operatorId === recall.senderId
      ? '你刚发的一条消息已经撤回'
      : `${who} 撤回了你刚发的一条消息`
    : recall.operatorId !== '' && recall.operatorId !== recall.senderId
      ? `${who} 的一条消息被 ${recall.operatorId} 撤回`
      : `${who} 撤回了一条刚发的消息`
  const originalText = original?.text.trim() ?? ''
  const context = originalText === ''
    ? '收件箱里已经没有那条原文。'
    : `被收回的原话是：${originalText}\n这句只用来判断这次撤回，不要复述。`
  return `[撤回通知]\n${action}。\n${context}`
}

/** 撤回要接回同一轮 DSH 现场所需的出口 */
export interface RecallHandlerDeps {
  channel: Pick<QqChannelSeam, 'onRecall'>
  attention: QqAttentionSeam | undefined
  subject: QqSubjectSeam | undefined
  mode(): 'probability' | 'heartflow' | 'autonomous'
  sleeping(chatKey?: string): boolean
  flush(chatKey: string): void
  noteWake(kind: string, chatKey: string, detail?: Record<string, unknown>): void
  wake(
    chatKey: string,
    text: string,
    reason: string,
    media: readonly ContentBlock[],
    traceIds: readonly string[],
    recordedText: string,
    source: MessageSource,
  ): boolean
}

/**
 * 把结构化撤回接进注意力、休息与 DSH 唤醒
 * @param deps - 现场、模式、休息和唤醒出口
 * @returns 撤下监听
 */
export function registerRecallHandler(deps: RecallHandlerDeps): () => void {
  const seen = new Set<string>()
  return deps.channel.onRecall((recall) => {
    if (recall.bySelf) return
    const recallKey = `${recall.chatKey}#${recall.messageId}#${recall.operatorId}`
    if (seen.has(recallKey)) return
    seen.add(recallKey)
    if (seen.size > 256) {
      const oldest = seen.values().next().value
      if (oldest !== undefined) seen.delete(oldest)
    }
    deps.flush(recall.chatKey)
    const original = recall.messageId === ''
      ? undefined
      : [...(deps.attention?.inbox.recent(recall.chatKey, 40) ?? [])]
        .reverse()
        .find(message => message.messageId === recall.messageId)
    const text = recallNoticeText(recall, original)
    deps.attention?.inbox.push(recall.chatKey, {
      messageId: recall.messageId,
      isRecall: true,
      senderId: recall.senderId,
      ...original?.senderName === undefined ? {} : { senderName: original.senderName },
      text,
      at: recall.at,
      ...original?.atMe === undefined ? {} : { atMe: original.atMe },
      ...original?.replyToBot === undefined ? {} : { replyToBot: original.replyToBot },
    })
    deps.noteWake('recall_received', recall.chatKey, {
      selfMessage: recall.selfMessage,
      hasOriginal: original !== undefined,
    })
    if (deps.sleeping(recall.chatKey)) {
      deps.noteWake('rest_skipped', recall.chatKey, { reason: 'sleeping' })
      return
    }
    deps.subject?.store.setActive(recall.chatKey)
    if (deps.mode() === 'probability'
      && !recall.selfMessage
      && original?.atMe !== true
      && original?.replyToBot !== true) return
    const wakeDecision = deps.attention?.shouldWake(recall.chatKey, {
      chatKey: recall.chatKey,
      senderId: recall.senderId,
      text,
      at: recall.at,
      atMe: original?.atMe === true,
      replyToBot: original?.replyToBot === true,
    }, undefined, recall.at, { ambientAll: deps.mode() === 'autonomous' })
    if (wakeDecision?.allow === false) {
      deps.noteWake('wake_skipped', recall.chatKey, { reason: wakeDecision.reason })
      return
    }
    deps.wake(
      recall.chatKey,
      text,
      'recall',
      [],
      [`${recall.chatKey}#recall-${recall.messageId}-${recall.at}`],
      text,
      {
        kind: 'qq-recall',
        form: 'notice',
        summary: recall.selfMessage ? '你的一条消息被撤回' : '一条消息被撤回',
      },
    )
  })
}
