// 合并转发：把几段正文装成一条带节点的消息，动作名与参数都在这里定

import { reduceChatPunctuation } from './chat-style.ts'
import type { MessageSegment } from './events.ts'

/** 一条合并转发里的节点：要么引用已有消息，要么给名字和正文/图片段 */
export interface ForwardNode {
  /** 引用群里已有的一条消息，填它的消息编号 */
  messageId?: string
  /** 显示在转发卡片里的名字 */
  name: string
  /** 这一段正文，或一组已经装好的消息段（高亮片段里的图片） */
  content: string | readonly MessageSegment[]
}

/** 一次合并转发请求：动作名与它要带的参数 */
export interface ForwardCall {
  /** 发出去的动作名 */
  action: string
  /** 随动作一起带的参数 */
  params: Record<string, unknown>
}

// 卡片里只留文字，markdown 链接取标签、裸地址整段去掉
const MARKDOWN_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/gu
const BARE_URL = /https?:\/\/\S+/gu
// 地址去掉后留下的空档并回一个
const SPACE_RUN = /[ \t]{2,}/gu

/**
 * 合并转发一段正文的收口：与单条发送同一套规矩，另外不让链接进卡片
 * @param text - 模型写的那一段正文
 * @returns 去掉书面标点与网址的正文
 */
export function forwardTextOf(text: string): string {
  const withoutLinks = text
    .replace(MARKDOWN_LINK, (_whole, label: string) => label.trim())
    .replace(BARE_URL, '')
    .replace(SPACE_RUN, ' ')
  return reduceChatPunctuation(withoutLinks)
}

/**
 * 把几段正文装成一次合并转发请求，群与私聊各走各的动作
 * @param nodes - 要发的节点，正文先按单条发送收口，收口后为空的丢掉
 * @param chatKey - 会话键，决定发给群还是发给个人
 * @param selfId - 机器人自己的号，节点里当发言者
 * @returns 动作名与参数；一段都不剩时给 undefined
 */
export function forwardCallOf(
  nodes: readonly ForwardNode[],
  chatKey: string,
  selfId: string,
): ForwardCall | undefined {
  // 引用节点保持原样；自己写的文字节点过收口，图片段原样带走
  const contentOf = (content: ForwardNode['content']): string | readonly MessageSegment[] =>
    typeof content === 'string' ? forwardTextOf(content) : content
  const hasContent = (content: ForwardNode['content']): boolean =>
    typeof content === 'string' ? forwardTextOf(content) !== '' : content.length > 0
  const kept = nodes
    .filter(node => (node.messageId ?? '') !== '' || hasContent(node.content))
    .map(node => (node.messageId ?? '') !== ''
      ? { messageId: node.messageId, name: node.name, content: '' }
      : { name: node.name, content: contentOf(node.content) })
  if (kept.length === 0) return undefined
  const messages = kept.map(node => ({
    type: 'node',
    data: node.messageId !== undefined
      ? { id: node.messageId }
      : { name: node.name, uin: Number(selfId) || 0, content: node.content },
  }))
  if (chatKey.startsWith('group:')) {
    return { action: 'send_group_forward_msg', params: { group_id: Number(chatKey.slice('group:'.length)), messages } }
  }
  return { action: 'send_private_forward_msg', params: { user_id: Number(chatKey.slice('private:'.length)), messages } }
}
