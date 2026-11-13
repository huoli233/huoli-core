// 跟 QQ 那一头说话用的东西：收到的消息、要发的消息

import { cardFactOf } from './card.ts'

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
  /** 这条消息里可以下载或读取的内容 */
  attachments: readonly IncomingAttachment[]
  /** 消息段中真实的文字，不含附件占位符 */
  bodyText?: string
  /** 排查时串起一条消息各阶段的编号 */
  traceId: string
  /** 自己发出来的只作事实标记，拦不拦由装配层决定 */
  readonly selfSent: boolean
  /** 从历史补回来的消息；普通实时消息没有这一项 */
  readonly history?: 'private' | 'group'
}

/** QQ 消息段里的附件事实 */
export interface IncomingAttachment {
  /** 附件种类 */
  kind: 'image' | 'video' | 'record' | 'file'
  /** 可直接下载的地址，没有就是空串 */
  url: string
  /** 原始文件名，没有就是空串 */
  name: string
  /** 平台给的媒体类型，没有就是空串 */
  mediaType: string
  /** QQ 消息段带有表情包标识 */
  sticker?: boolean
}

/** 被戳了一下 */
export interface IncomingPoke {
  chatKey: string
  userId: string
  at: number
}

/** 群里或私聊里一条消息被撤回 */
export interface IncomingRecall {
  chatKey: string
  /** 原消息是谁发的 */
  senderId: string
  /** 实际执行撤回的人 */
  operatorId: string
  messageId: string
  at: number
  /** 被收回的是机器人自己发的消息 */
  selfMessage: boolean
  /** 机器人自己执行的撤回 */
  bySelf: boolean
}

/** 群里对机器人自己的禁言状态 */
export interface GroupMuteNotice {
  chatKey: string
  muted: boolean
  at: number
  /** 解除时刻；解除通知或永久禁言无法确定时是 0 */
  until: number
  operatorId: string
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
  /** 下次可以再试的时刻 */
  retryAt?: number
  /** 请求已经发出但没收到明确回执时标成 unknown，调用方不得自动重放 */
  outcome?: 'unknown'
}

/** 发送这一路发生的事，只给排查用，不带原文 */
export interface OutboundEvent {
  kind: 'attempt' | 'sent' | 'blocked'
  at: number
  chatKey: string
  count: number
  /** 第一条成功发送的时间；分段消息的 `at` 是整次发送结算时间。 */
  firstSentAt?: number
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
 * 建一条消息的追踪编号
 * @param chatKey - 哪个会话
 * @param messageId - 平台消息编号
 * @param at - 消息时刻
 * @returns 可稳定查询的编号
 */
export function traceIdOf(chatKey: string, messageId: string, at: number): string {
  return `${chatKey}#${messageId === '' ? `at-${at}` : `msg-${messageId}`}`
}

/**
 * 文件消息里真正给人看的名字；地址、data URL 和平台内部编号不冒充文件名
 * @param data - QQ 文件段的 data
 * @returns 清理过的文件名，没有就是空串
 */
function fileNameOf(data: Record<string, unknown> | undefined): string {
  const named = asText(data?.name ?? data?.file_name ?? data?.fileName).trim()
  const raw = named !== '' ? named : asText(data?.file).trim()
  if (/^(?:https?:\/\/|base64:\/\/|data:)/iu.test(raw) || /^[0-9a-f]{24,}$/iu.test(raw)) return ''
  return raw
    .replace(/[\[\]\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160)
}

/**
 * 从一坨 OneBot 消息段里挤出文字，引用编号留个位置好让模型看见在回谁
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
    else if (kind === 'mface') parts.push('[表情]')
    else if (kind === 'forward') {
      const id = asText(item.data?.id)
      parts.push(id === '' ? '[转发的聊天记录]' : `[转发的聊天记录:${id}]`)
    }
    else if (kind === 'file') {
      const name = fileNameOf(item.data)
      parts.push(name === '' ? '[文件]' : `[文件:${name}]`)
    }
    else if (kind === 'record') parts.push('[语音]')
    else if (kind === 'video') parts.push('[视频]')
    else if (kind === 'json' || kind === 'xml') {
      const fact = cardFactOf(item.data)
      parts.push(fact === undefined ? '[卡片]' : `\n${fact}\n`)
    }
    else if (kind === 'reply') {
      const id = asText(item.data?.id)
      if (id !== '') parts.push(`[回复:${id}]`)
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/** 这几个位置本身就说明有东西可看，不能当成纯表情丢掉 */
const CONTENT_MARKS: readonly string[] = ['转发的聊天记录', '[文件]', '[图片]', '[视频]', '[语音]', '[卡片]']

/**
 * 这句话里有没有值得回应的内容，只有图片表情凑出来的算没有
 * @param text - 翻好的话
 * @returns 有没有正文
 */
export function hasWords(text: string): boolean {
  // 转发记录与文件里装着别人的话和东西，丢掉就等于她看不见群里发生过什么
  if (CONTENT_MARKS.some(mark => text.includes(mark))) return true
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

function attachmentKindOf(type: string): IncomingAttachment['kind'] | undefined {
  if (type === 'image' || type === 'mface') return 'image'
  if (type === 'video' || type === 'record' || type === 'file') return type
  return undefined
}

function bodyTextOf(segments: unknown): string {
  if (typeof segments === 'string') return segments.trim()
  if (!Array.isArray(segments)) return ''
  return segments.flatMap((segment) => {
    if (segment === null || typeof segment !== 'object') return []
    const item = segment as { type?: unknown; data?: Record<string, unknown> }
    return asText(item.type) === 'text' ? [asText(item.data?.text)] : []
  }).join('').trim()
}

/**
 * 从消息段里找出可下载的附件
 * @param segments 原始消息段
 * @returns 按消息顺序排好的附件
 */
export function attachmentsOf(segments: unknown): IncomingAttachment[] {
  if (!Array.isArray(segments)) return []
  return segments.flatMap((segment) => {
    if (segment === null || typeof segment !== 'object') return []
    const item = segment as { type?: unknown; data?: Record<string, unknown> }
    const type = asText(item.type)
    const kind = attachmentKindOf(type)
    if (kind === undefined) return []
    const direct = asText(item.data?.url)
    const file = asText(item.data?.file)
    const url = direct !== '' ? direct : /^https?:\/\//u.test(file) || file.startsWith('base64://') || file.startsWith('data:')
      ? file
      : ''
    if (type === 'mface' && url === '') return []
    const sticker = type === 'mface'
      || item.data?.is_sticker === true
      || asText(item.data?.emoji_id) !== ''
      || asText(item.data?.emoji_package_id) !== ''
    return [{
      kind,
      url,
      name: asText(item.data?.name ?? item.data?.file_name ?? item.data?.file),
      mediaType: asText(item.data?.mime_type ?? item.data?.content_type ?? item.data?.file_mime),
      ...(sticker ? { sticker: true } : {}),
    }]
  })
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
  if (type !== 'group' && type !== 'private') return null
  const kind: 'group' | 'private' = type === 'group' ? 'group' : 'private'
  const chatId = kind === 'group' ? raw.group_id : raw.user_id
  if (chatId === undefined || chatId === null) return null
  const sender = raw.sender !== null && typeof raw.sender === 'object' ? raw.sender as Record<string, unknown> : {}
  const userId = asText(raw.user_id ?? sender.user_id)
  const segments = raw.message
  const bodyText = bodyTextOf(segments)
  const chatKey = chatKeyOf(kind, asText(chatId))
  const messageId = asText(raw.message_id)
  return {
    chatKey,
    senderId: userId,
    senderName: asText(sender.card ?? sender.nickname ?? userId),
    text: textOf(segments),
    at: Number(raw.time) > 0 ? Number(raw.time) * 1000 : now,
    atMe: mentionsSelf(segments, selfId) || (kind === 'private' && userId === selfId),
    isPoke: false,
    replyToBot: repliesToSelf(segments, selfId, sentIds),
    messageId,
    attachments: attachmentsOf(segments),
    ...(bodyText === '' ? {} : { bodyText }),
    traceId: traceIdOf(chatKey, messageId, Number(raw.time) > 0 ? Number(raw.time) * 1000 : now),
    selfSent: postType === 'message_sent' || (selfId !== '' && userId === selfId),
  }
}

/**
 * 是不是戳一戳通知；关键词只用于辨认固定协议写法
 * @param raw - 原始事件
 * @returns 只认两种固定写法
 */
export function isPokeNotice(raw: Record<string, unknown>): boolean {
  if (asText(raw.post_type) !== 'notice') return false
  const noticeType = asText(raw.notice_type)
  return noticeType === 'poke' || (noticeType === 'notify' && asText(raw.sub_type) === 'poke')
}

/**
 * 把戳一戳翻成一条入站；填了自己的号时，两个编号里有一个是自己才收下
 * @param raw - 原始事件
 * @param now - 现在的时间
 * @param selfId - 机器人自己的号，不填就不核对被戳的人
 * @returns 处理结果
 */
export function toPoke(raw: Record<string, unknown>, now: number, selfId = ''): IncomingPoke | null {
  if (!isPokeNotice(raw)) return null
  const target = asText(raw.target_id)
  const user = asText(raw.user_id)
  if (selfId !== '' && target !== selfId && user !== selfId) return null
  const peer = selfId !== '' && user === selfId && target !== '' ? target : user
  const group = raw.group_id
  const chatKey = group !== undefined && group !== null ? chatKeyOf('group', asText(group)) : chatKeyOf('private', peer)
  return { chatKey, userId: peer, at: now }
}

/**
 * 把群聊或私聊撤回通知翻成一条结构化事实
 * @param raw - 原始事件
 * @param selfId - 机器人自己的号
 * @param now - 现在的时间
 * @returns 不是撤回通知时返回空
 */
export function toRecall(
  raw: Record<string, unknown>,
  selfId: string,
  now: number,
): IncomingRecall | null {
  if (asText(raw.post_type) !== 'notice') return null
  const noticeType = asText(raw.notice_type)
  const groupId = asText(raw.group_id)
  const kind = noticeType === 'group_recall' && groupId !== ''
    ? 'group'
    : noticeType === 'friend_recall'
      ? 'private'
      : undefined
  if (kind === undefined) return null
  const senderId = asText(raw.user_id)
  const friendId = kind === 'private' ? senderId : groupId
  if (friendId === '') return null
  const operatorId = asText(raw.operator_id) || senderId
  return {
    chatKey: chatKeyOf(kind, friendId),
    senderId,
    operatorId,
    messageId: asText(raw.message_id),
    at: now,
    selfMessage: selfId !== '' && senderId === selfId,
    bySelf: selfId !== '' && operatorId === selfId,
  }
}

/**
 * 把群禁言通知翻成机器人自己的发送状态
 * @param raw - 原始事件
 * @param selfId - 机器人自己的号
 * @param now - 现在的时间
 * @returns 只认机器人自己被禁言或解除时返回通知
 */
export function toGroupMute(
  raw: Record<string, unknown>,
  selfId: string,
  now: number,
): GroupMuteNotice | null {
  if (asText(raw.post_type) !== 'notice') return null
  if (asText(raw.notice_type) !== 'group_ban') return null
  const subType = asText(raw.sub_type)
  if (subType !== 'ban' && subType !== 'lift_ban') return null
  if (selfId === '' || asText(raw.user_id) !== selfId) return null
  const groupId = asText(raw.group_id)
  if (groupId === '') return null
  const duration = Number(raw.duration)
  const durationMs = Number.isFinite(duration) && duration > 0 ? Math.floor(duration * 1000) : 0
  return {
    chatKey: chatKeyOf('group', groupId),
    muted: subType === 'ban',
    at: now,
    until: subType === 'ban' ? (durationMs === 0 ? 0 : now + durationMs) : now,
    operatorId: asText(raw.operator_id),
  }
}
