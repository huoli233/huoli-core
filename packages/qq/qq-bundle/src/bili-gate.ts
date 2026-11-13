// 把站内插件想转达的话送回主人私聊，并把群里的来路如实报给它

import type { Context } from '@huoli/cordis'
import type { QqChannelSeam } from '@huoli/huoli-qq-channel'
import type { QqAttentionSeam, QqMessage } from '@huoli/huoli-qq-attention'

/** 门卫要用的东西 */
export interface BiliGateOptions {
  /** QQ 发送接缝 */
  channel: QqChannelSeam | undefined
  /** 注意力收件箱，用来回答谁在什么时候说过什么 */
  attention: QqAttentionSeam | undefined
  /** 主人的 QQ 号 */
  creatorQq: string
  /** 机器人的 QQ 号，用来排除自己发的 */
  selfId: string
  /** 要不要挂这个门卫 */
  enabled: boolean
  /** 转达正文最多多少字，超了截一句最要紧的 */
  maxChars: number
  /** 一次最多翻多少条最近消息 */
  maxMessages: number
  /** 当前体力与视频识别余量；站内自己逛会用这个决定要不要出发 */
  capacity?: () => {
    energy: number
    sleepState: string
    videoHourRemaining: number
    videoDayRemaining: number
    videoMinEnergy: number
  }
  /** 记日志 */
  warn: (message: string) => void
}

/** 转达用的服务形状 */
interface GateService {
  hello(): Promise<Record<string, unknown>>
  context(input: Record<string, unknown>): Promise<{ trusted: boolean; label: string }>
  ownerMessages(input: Record<string, unknown>): Promise<{ messages: unknown[] }>
  recentMessages(input: Record<string, unknown>): Promise<{ chat: Record<string, unknown>; messages: unknown[] }>
  capacity(): Promise<Record<string, unknown>>
  notify(input: Record<string, unknown>): Promise<{ ok: boolean }>
}

/** 站内插件转达过来的东西里，取能说出口的那部分 */
function notifyText(input: Record<string, unknown>, maxChars: number): string {
  const raw = typeof input.text === 'string' ? input.text.trim() : ''
  if (raw === '') return ''
  const items = Array.isArray(input.items) ? input.items : []
  const first = items[0]
  if (first !== null && typeof first === 'object') {
    const row = first as Record<string, unknown>
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    const why = typeof row.why === 'string' ? row.why.trim() : ''
    if (title !== '' && why !== '') {
      const short = `刚刷到个想跟你说一下 ${title} ${why}`
      return short.slice(0, maxChars)
    }
  }
  // 收件箱、评论报告和待同意草稿都是多行事实：保留前几行，别只取头一行把编号和草稿丢掉
  const lines = raw.split('\n').map(line => line.trim()).filter(line => line !== '')
  return (lines.length > 0 ? lines.join('\n') : raw).slice(0, maxChars)
}

/** 一句话里能拿去认视频的链接或编号 */
function linksOf(text: string): string[] {
  const urls = text.match(/https?:\/\/\S+/giu) ?? []
  const bvIds = text.match(/BV.{10}/giu) ?? []
  const found = [...urls, ...bvIds]
  return [...new Set(found.map(item => item.replace(/[.,;:]$/u, '')))].slice(0, 4)
}

/** 会话键翻成协议里的群或私聊 */
function chatOf(sessionId: string): Record<string, unknown> {
  const privateId = sessionId.startsWith('private:') ? sessionId.slice('private:'.length) : ''
  const groupId = sessionId.startsWith('group:') ? sessionId.slice('group:'.length) : ''
  return privateId !== '' ? { type: 'private', id: privateId } : { type: 'group', id: groupId }
}

/** 收件箱里的一条真人发言，翻成协议里的一行 */
function messageRow(message: QqMessage, ownerId: string): Record<string, unknown> {
  const isOwner = message.senderId === ownerId
  return {
    id: String(message.messageId ?? message.seq),
    at: message.at,
    sender: {
      id: message.senderId,
      name: message.senderName ?? '',
      isOwner,
      ...isOwner ? { trusted: true } : {},
    },
    text: message.text,
    links: linksOf(message.text),
    replyTo: message.replyToBot === true ? 'self' : '',
    atSelf: message.atMe === true || message.replyToBot === true,
  }
}

/**
 * 挂上站内插件要用的门卫服务
 * @param ctx - 运行环境
 * @param options - 发送接缝、收件箱、主人号与开关
 */
export function registerBiliGate(ctx: Context, options: BiliGateOptions): void {
  if (!options.enabled || options.channel === undefined || options.creatorQq === '') return
  const ownerChat = `private:${options.creatorQq}`
  const recentOf = (chatKey: string): QqMessage[] => {
    if (options.attention === undefined) return []
    try {
      return options.attention.inbox.recent(chatKey, options.maxMessages).filter(item => item.isRecall !== true)
    } catch (error) {
      options.warn(`翻最近消息没成：${String(error)}`)
      return []
    }
  }
  const service: GateService = {
    async hello() {
      return { protocol: 2, actions: ['hello', 'context', 'ownerMessages', 'recentMessages', 'capacity', 'notify'], name: 'qq-chat' }
    },
    async context(input) {
      // 群聊一律不算主人本人，写操作全关时也不靠这个放行
      const sessionId = String(input.sessionId ?? '')
      return sessionId === ownerChat
        ? { trusted: true, label: '主人私聊' }
        : { trusted: false, label: 'QQ 群或别人的会话' }
    },
    async ownerMessages(input) {
      const since = Number(input.since ?? 0)
      const messages = recentOf(ownerChat)
        .filter(item => item.senderId === options.creatorQq && item.at > since)
        .map(item => ({ at: item.at, text: item.text }))
      return { messages }
    },
    async recentMessages(input) {
      const sessionId = String(input.sessionId ?? '')
      const since = Number(input.since ?? 0)
      // 只要带链接、@ 她或引用她的，普通闲聊不用往外报
      const messages = recentOf(sessionId)
        .filter(item => item.senderId !== options.selfId && item.at > since)
        .filter(item => linksOf(item.text).length > 0 || item.atMe === true || item.replyToBot === true)
        .map(item => messageRow(item, options.creatorQq))
      return { chat: chatOf(sessionId), messages }
    },
    async capacity() {
      return options.capacity?.() ?? {
        energy: 0,
        sleepState: 'unknown',
        videoHourRemaining: 0,
        videoDayRemaining: 0,
        videoMinEnergy: 1,
      }
    },
    async notify(input) {
      const text = notifyText(input, options.maxChars)
      if (text === '') return { ok: false }
      try {
        const result = await options.channel?.send(text, ownerChat)
        return { ok: result?.ok === true }
      } catch (error) {
        options.warn(`站内转达没发出去：${String(error)}`)
        return { ok: false }
      }
    },
  }
  // 服务名要先登记才能挂值，provide 本身就是可卸载的 effect
  ctx.provide('biliEyesGate', service)
}
