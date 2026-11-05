// 跟 QQ 那一头说话用的东西：收到的消息、要发的消息

/** 收到的一条消息 */
export interface IncomingMessage {
  chatKey: string
  senderId: string
  senderName: string
  text: string
  at: number
  atMe: boolean
  isPoke: boolean
  replyToBot: boolean
  messageId: string
  /** 自己发出来的只作事实标记，拦不拦由装配层决定 */
  readonly selfSent: boolean
}

/** 被戳了一下 */
export interface IncomingPoke {
  chatKey: string
  userId: string
  at: number
}

/** 要发的东西 */
export interface Outgoing {
  chatKey: string
  text: string
}

/** 消息段，data 里的值由通信那头给 */
export interface MessageSegment {
  type: string
  data?: Record<string, unknown>
}

/** 发出去的结果 */
export interface SentResult {
  ok: boolean
  messageId?: string
  code?: string
  reason?: string
  hint?: string
}

/** 发送这一路发生的事，只给排查用，不带原文 */
export interface OutboundEvent {
  kind: 'attempt' | 'sent' | 'blocked'
  at: number
  chatKey: string
  count: number
  code?: string
  retryAt?: number
}

/** 连接状态 */
export interface ChannelStatus {
  connected: boolean
  url: string
  reconnectCount: number
  lastError: string
}

/**
 * 原始事件里的值转成文本，只认字符串和数字
 * @param value - 原始事件里的字段值
 * @returns 转好的文本，其它类型给空串
 */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

/**
 * 一个群或私聊的键
 * @param kind - 哪一类
 * @param id - 编号
 * @returns 拼好的话
 */
export function chatKeyOf(kind: 'group' | 'private', id: string | number): string {
  return `${kind}:${String(id)}`
}

/**
 * 从一坨 OneBot 消息段里挤出文字，引用编号留占位好让模型看见在回谁
 * @param segments - 消息段
 * @returns 拼好的话
 */
export function textOf(segments: unknown): string {
  if (typeof segments === 'string') return segments
  if (!Array.isArray(segments)) return ''
  const parts: string[] = []
  for (const segment of segments) {
    if (segment === null || typeof segment !== 'object') continue
    const item = segment as { type?: unknown; data?: Record<string, unknown> }
    const kind = asText(item.type)
    if (kind === 'text') parts.push(asText(item.data?.text))
    else if (kind === 'at') {
      const qq = asText(item.data?.qq)
      parts.push(qq === 'all' ? '@全体成员' : `@${asText(item.data?.name ?? qq)}`)
    } else if (kind === 'image') parts.push('[图片]')
    else if (kind === 'face') parts.push('[表情]')
    else if (kind === 'reply') {
      const id = asText(item.data?.id)
      if (id !== '') parts.push(`[回复:${id}]`)
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/**
 * 这句话里有没有真正的字，只由图片表情占位拼出来的算没有
 * @param text - 翻好的话
 * @returns 有没有正文
 */
export function hasWords(text: string): boolean {
  return text.replace(/\[[^\]]*\]/gu, '').trim() !== ''
}

/**
 * 这条消息有没有点到自己
 * @param segments - 消息段
 * @param selfId - 自己的号
 * @returns 是或不是
 */
export function mentionsSelf(segments: unknown, selfId: string): boolean {
  if (!Array.isArray(segments) || selfId === '') return false
  for (const segment of segments) {
    if (segment === null || typeof segment !== 'object') continue
    const item = segment as { type?: unknown; data?: Record<string, unknown> }
    if (asText(item.type) !== 'at') continue
    if (asText(item.data?.qq) === selfId) return true
  }
  return false
}

/**
 * 读出消息段里引用的编号，没有引用段就给空表
 * @param segments - 消息段
 * @returns 被引用消息的编号
 */
export function replyIds(segments: unknown): string[] {
  if (!Array.isArray(segments)) return []
  const ids: string[] = []
  for (const segment of segments) {
    if (segment === null || typeof segment !== 'object') continue
    const item = segment as { type?: unknown; data?: Record<string, unknown> }
    if (asText(item.type) !== 'reply') continue
    const id = asText(item.data?.id)
    if (id !== '') ids.push(id)
  }
  return ids
}

/**
 * 这条消息有没有在回复自己，引用编号落进自己发过的表里才算
 * @param segments - 消息段
 * @param selfId - 自己的号
 * @param sentIds - 自己发出去过的消息编号
 * @returns 是或不是
 */
export function repliesToSelf(segments: unknown, selfId: string, sentIds: ReadonlySet<string> = new Set()): boolean {
  if (selfId === '') return false
  for (const id of replyIds(segments)) {
    if (sentIds.has(id)) return true
  }
  return false
}

/**
 * 把收到的原始事件翻成一条消息，自发只打标不丢
 * @param raw - 原始事件
 * @param selfId - 自己的号
 * @param now - 现在的时间
 * @param sentIds - 自己发出去过的消息编号，用来按引用编号认出在回自己
 * @returns 处理结果
 */
export function toIncoming(
  raw: Record<string, unknown>,
  selfId: string,
  now: number,
  sentIds: ReadonlySet<string> = new Set(),
): IncomingMessage | null {
  const postType = asText(raw.post_type)
  if (postType !== 'message' && postType !== 'message_sent') return null
  const type = asText(raw.message_type)
  const kind: 'group' | 'private' = type === 'group' ? 'group' : 'private'
  const chatId = kind === 'group' ? raw.group_id : raw.user_id
  if (chatId === undefined || chatId === null) return null
  const sender = raw.sender !== null && typeof raw.sender === 'object' ? raw.sender as Record<string, unknown> : {}
  const userId = asText(raw.user_id ?? sender.user_id)
  const segments = raw.message
  return {
    chatKey: chatKeyOf(kind, asText(chatId)),
    senderId: userId,
    senderName: asText(sender.card ?? sender.nickname ?? userId),
    text: textOf(segments),
    at: Number(raw.time) > 0 ? Number(raw.time) * 1000 : now,
    atMe: mentionsSelf(segments, selfId) || (kind === 'private' && userId === selfId),
    isPoke: false,
    replyToBot: repliesToSelf(segments, selfId, sentIds),
    messageId: asText(raw.message_id),
    selfSent: postType === 'message_sent' || (selfId !== '' && userId === selfId),
  }
}

/**
 * 把"戳一戳"翻成一条入站
 * @param raw - 原始事件
 * @param now - 现在的时间
 * @returns 处理结果
 */
export function toPoke(raw: Record<string, unknown>, now: number): IncomingPoke | null {
  if (asText(raw.post_type) !== 'notice') return null
  if (asText(raw.notice_type) !== 'notify') return null
  if (asText(raw.sub_type) !== 'poke') return null
  const target = asText(raw.target_id)
  const group = raw.group_id
  const chatKey = group !== undefined && group !== null ? chatKeyOf('group', asText(group)) : chatKeyOf('private', asText(raw.user_id))
  return { chatKey, userId: target, at: now }
}
