// 读回来的东西怎么整理：那头给的是原始消息段，这里只挑我们要给模型看的几项

import type { AskReply, WsChannel } from './ws.ts'

/** 读一次最多给几条，别让她一口气把整群翻完 */
export const READ_DEFAULTS = {
  maxMessages: 30,
  maxMembers: 200,
}

/** 群里的一条消息，只留看得懂的几项 */
export type ReadMessageLine = {
  /** 消息编号，拿出来才能接着看那一条 */
  messageId: string
  /** 谁说的，编号 */
  senderId: string
  /** 谁说的，名字 */
  senderName: string
  /** 什么时候说的，毫秒 */
  at: number
  /** 说了什么，图片之类的只留个记号 */
  text: string
}

/** 群里的一个人 */
export type ReadMemberLine = {
  /** 编号 */
  userId: string
  /** 名字，没改群名片就是昵称 */
  name: string
  /** 在群里的身份 */
  role: string
}

/** 读失败时给的东西 */
export type ReadFailure = { ok: false; code: string; reason: string; hint: string }

/** 翻记录的结果 */
export type HistoryOutcome = { ok: true; items: ReadMessageLine[] } | ReadFailure

/** 列成员的结果 */
export type MembersOutcome = { ok: true; members: ReadMemberLine[] } | ReadFailure

/** 看一条的结果 */
export type MessageOutcome = { ok: true; message: ReadMessageLine } | ReadFailure

/** 把一问回来的失败转成读这边的失败 */
function failed(reply: Extract<AskReply, { ok: false }>): ReadFailure {
  return { ok: false, code: reply.code, reason: reply.reason, hint: reply.hint }
}

/**
 * 消息正文可能是整段文字，也可能是一串段；图片语音只留个记号
 * @param message 那头给的正文
 * @returns 拼好的一句话，认不出来是空串
 */
export function textOf(message: unknown): string {
  if (typeof message === 'string') return message
  if (!Array.isArray(message)) return ''
  const parts: string[] = []
  for (const segment of message) {
    if (segment === null || typeof segment !== 'object') continue
    const row = segment as { type?: unknown; data?: unknown }
    if (row.type === 'text') {
      const data = row.data as { text?: unknown } | null
      if (typeof data?.text === 'string') parts.push(data.text)
      continue
    }
    // 别把图片里的一长串地址塞进上下文，只说这里有个什么东西
    if (typeof row.type === 'string' && row.type !== '') parts.push(`[${row.type}]`)
  }
  return parts.join('')
}

/** 只认数字与字符串，别的一律空串，免得把整个对象拼进正文 */
function asId(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** 把那头回的一条原始消息整理成一行 */
function lineOf(raw: unknown): ReadMessageLine | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const row = raw as Record<string, unknown>
  const id = row.message_id
  if (typeof id !== 'string' && typeof id !== 'number') return undefined
  const sender = row.sender as Record<string, unknown> | undefined
  const seconds = typeof row.time === 'number' ? row.time : 0
  return {
    messageId: String(id),
    senderId: asId(row.user_id ?? sender?.user_id),
    senderName: asId(sender?.card ?? sender?.nickname ?? row.nickname),
    at: Math.max(0, seconds) * 1000,
    text: textOf(row.message),
  }
}

/** 群里第几号；不是群就给 undefined */
function groupIdOf(chatKey: string): number | undefined {
  if (!chatKey.startsWith('group:')) return undefined
  const id = Number(chatKey.slice('group:'.length))
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

/**
 * 翻这个群最近说过的话
 * @param channel 连接那一路
 * @param chatKey 会话键，只认群
 * @param count 最多要几条
 * @returns 从旧到新的几条，或带码与提示的失败
 */
export async function readHistory(channel: WsChannel, chatKey: string, count: number): Promise<HistoryOutcome> {
  const groupId = groupIdOf(chatKey)
  if (groupId === undefined) return { ok: false, code: 'channel.read_private', reason: '私聊不翻记录', hint: '只翻群里的记录' }
  const limit = Math.max(1, Math.min(READ_DEFAULTS.maxMessages, Math.floor(count)))
  const reply = await channel.ask('get_group_msg_history', { group_id: groupId, count: limit, message_seq: 0 })
  if (!reply.ok) return failed(reply)
  const raw = reply.data.messages
  const items = Array.isArray(raw) ? raw.map(lineOf).filter((line): line is ReadMessageLine => line !== undefined) : []
  return { ok: true, items: items.slice(-limit) }
}

/**
 * 看这个群里都有谁
 * @param channel 连接那一路
 * @param chatKey 会话键，只认群
 * @param limit 最多列几个
 * @returns 群里的人，或带码与提示的失败
 */
export async function readMembers(channel: WsChannel, chatKey: string, limit: number): Promise<MembersOutcome> {
  const groupId = groupIdOf(chatKey)
  if (groupId === undefined) return { ok: false, code: 'channel.read_private', reason: '私聊不列成员', hint: '只列群里的成员' }
  const cap = Math.max(1, Math.min(READ_DEFAULTS.maxMembers, Math.floor(limit)))
  const reply = await channel.ask('get_group_member_list', { group_id: groupId })
  if (!reply.ok) return failed(reply)
  // 这一路回来的可能是数组，也可能包在 data 里
  const list = Array.isArray(reply.data) ? reply.data : Array.isArray(reply.data.members) ? reply.data.members : []
  const members: ReadMemberLine[] = []
  for (const raw of list.slice(0, cap)) {
    if (raw === null || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    members.push({
      userId: asId(row.user_id),
      name: asId(row.card ?? row.nickname),
      role: asId(row.role),
    })
  }
  return { ok: true, members }
}

/**
 * 按编号看具体那一条
 * @param channel 连接那一路
 * @param messageId 消息编号
 * @returns 那一条，或带码与提示的失败
 */
export async function readMessage(channel: WsChannel, messageId: string): Promise<MessageOutcome> {
  const id = Number(messageId)
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, code: 'channel.read_bad_id', reason: '这个编号不对', hint: '从消息列表里拿编号，别自己编一个' }
  const reply = await channel.ask('get_msg', { message_id: id })
  if (!reply.ok) return failed(reply)
  const line = lineOf(reply.data)
  if (line === undefined) return { ok: false, code: 'channel.read_empty', reason: '没读到那一条', hint: '换个编号再看' }
  return { ok: true, message: line }
}
