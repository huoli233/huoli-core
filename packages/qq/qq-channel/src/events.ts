// 跟 QQ 那一头说话用的东西：收到的消息、要发的消息

// 收到的一条消息
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
}

// 被戳了一下
export interface IncomingPoke {
  chatKey: string
  userId: string
  at: number
}

// 要发的东西
export interface Outgoing {
  chatKey: string
  text: string
}

// 发出去的结果
export interface SentResult {
  ok: boolean
  messageId?: string
  code?: string
  reason?: string
}

// 连接状态
export interface ChannelStatus {
  connected: boolean
  url: string
  reconnectCount: number
  lastError: string
}

// 一个群或私聊的键
export function chatKeyOf(kind: 'group' | 'private', id: string | number): string {
  return `${kind}:${String(id)}`
}

// 从一坨 OneBot 消息段里挤出文字
export function textOf(segments: unknown): string {
  if (typeof segments === 'string') return segments
  if (!Array.isArray(segments)) return ''
  const parts: string[] = []
  for (const segment of segments) {
    if (segment === null || typeof segment !== 'object') continue
    const item = segment as { type?: unknown; data?: Record<string, unknown> }
    const kind = String(item.type ?? '')
    if (kind === 'text') parts.push(String(item.data?.text ?? ''))
    else if (kind === 'at') {
      const qq = String(item.data?.qq ?? '')
      parts.push(qq === 'all' ? '@全体成员' : `@${String(item.data?.name ?? qq)}`)
    } else if (kind === 'image') parts.push('[图片]')
    else if (kind === 'face') parts.push('[表情]')
    else if (kind === 'reply') continue
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

// 这条消息有没有点到自己
export function mentionsSelf(segments: unknown, selfId: string): boolean {
  if (!Array.isArray(segments) || selfId === '') return false
  for (const segment of segments) {
    if (segment === null || typeof segment !== 'object') continue
    const item = segment as { type?: unknown; data?: Record<string, unknown> }
    if (String(item.type ?? '') !== 'at') continue
    if (String(item.data?.qq ?? '') === selfId) return true
  }
  return false
}

// 这条消息有没有在回复自己
export function repliesToSelf(segments: unknown, selfId: string): boolean {
  if (!Array.isArray(segments) || selfId === '') return false
  for (const segment of segments) {
    if (segment === null || typeof segment !== 'object') continue
    const item = segment as { type?: unknown; data?: Record<string, unknown> }
    if (String(item.type ?? '') !== 'reply') continue
    const target = String(item.data?.user_id ?? item.data?.qq ?? '')
    if (target === selfId) return true
  }
  return false
}

// 把收到的原始事件翻成一条消息
export function toIncoming(raw: Record<string, unknown>, selfId: string, now: number): IncomingMessage | null {
  const postType = String(raw.post_type ?? '')
  if (postType !== 'message' && postType !== 'message_sent') return null
  const type = String(raw.message_type ?? '')
  const kind: 'group' | 'private' = type === 'group' ? 'group' : 'private'
  const chatId = kind === 'group' ? raw.group_id : raw.user_id
  if (chatId === undefined || chatId === null) return null
  const sender = raw.sender !== null && typeof raw.sender === 'object' ? raw.sender as Record<string, unknown> : {}
  const userId = String(raw.user_id ?? sender.user_id ?? '')
  const segments = raw.message
  return {
    chatKey: chatKeyOf(kind, String(chatId)),
    senderId: userId,
    senderName: String(sender.card ?? sender.nickname ?? userId),
    text: textOf(segments),
    at: Number(raw.time) > 0 ? Number(raw.time) * 1000 : now,
    atMe: mentionsSelf(segments, selfId) || (kind === 'private' && userId === selfId),
    isPoke: false,
    replyToBot: repliesToSelf(segments, selfId),
    messageId: String(raw.message_id ?? ''),
  }
}

// 把"戳一戳"翻成一条入站
export function toPoke(raw: Record<string, unknown>, now: number): IncomingPoke | null {
  if (String(raw.post_type ?? '') !== 'notice') return null
  if (String(raw.notice_type ?? '') !== 'notify') return null
  if (String(raw.sub_type ?? '') !== 'poke') return null
  const target = String(raw.target_id ?? '')
  const group = raw.group_id
  const chatKey = group !== undefined && group !== null ? chatKeyOf('group', String(group)) : chatKeyOf('private', String(raw.user_id ?? ''))
  return { chatKey, userId: target, at: now }
}
