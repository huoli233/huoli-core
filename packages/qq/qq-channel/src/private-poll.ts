// 有些 OneBot 后端收不到好友私聊事件，但历史接口仍能读到消息；这里补一条只读轮询兜底

import type { AskReply } from './ws.ts'
import { asText, attachmentsOf, chatKeyOf, hasWords, mentionsSelf, repliesToSelf, textOf, traceIdOf, type IncomingMessage } from './events.ts'

/** 好友私聊轮询的默认值 */
export const PRIVATE_POLL_DEFAULTS = {
  /** 一轮最多回看多少条历史 */
  count: 20,
  /** 两个好友之间至少隔多久再轮询 */
  minIntervalMs: 1_000,
} as const

/** 群历史补收的默认值 */
export const GROUP_HISTORY_DEFAULTS = {
  /** 一轮最多回看多少条 */
  count: 30,
  /** 只补最近多久以内的消息 */
  maxAgeMs: 30 * 60_000,
  /** 两次轮询至少隔多久 */
  minIntervalMs: 1_000,
} as const

/** 轮询需要的出口 */
export interface PrivatePollOptions {
  peers: readonly string[]
  intervalMs: number
  count?: number
  status: () => { connected: boolean }
  ask: (action: string, params: Record<string, unknown>) => Promise<AskReply>
  sentIds: () => ReadonlySet<string>
  emit: (message: IncomingMessage) => void
  selfId: string
  /** 首次建立基线时，从这个时刻之后的消息直接补交；用于修复后找回漏掉的消息 */
  replaySince?: number
  log?: (message: string) => void
  report?: (event: PrivatePollEvent) => void
}

/** 轮询留下的诊断事实，不带消息正文 */
export interface PrivatePollEvent {
  kind: 'baseline' | 'new' | 'replay' | 'error'
  at: number
  peer: string
  count?: number
  messageId?: string
  code?: string
}

/** 一条好友的历史游标，只留最近见过的编号 */
interface Cursor {
  primed: boolean
  lastAt: number
  ids: Set<string>
  order: string[]
}

/** 可以手动触发一轮，也可以按时轮询 */
export interface PrivatePoller {
  pollOnce(): Promise<void>
  start(): void
  stop(): void
}

/** 群历史补收留下的诊断事实，不带消息正文 */
export interface GroupHistoryEvent {
  kind: 'baseline' | 'history' | 'error'
  at: number
  group: string
  count?: number
  messageId?: string
  code?: string
}

/** 群历史补收的参数 */
export interface GroupHistoryOptions {
  groups: readonly string[]
  intervalMs: number
  count?: number
  maxAgeMs?: number
  status: () => { connected: boolean }
  ask: (action: string, params: Record<string, unknown>) => Promise<AskReply>
  sentIds: () => ReadonlySet<string>
  emit: (message: IncomingMessage) => void
  selfId: string
  /** 首次轮询是否把近期消息交给入站；默认只建立基线 */
  replayInitial?: boolean
  now?: () => number
  log?: (message: string) => void
  report?: (event: GroupHistoryEvent) => void
}

/** 群历史补收器 */
export interface GroupHistoryPoller {
  pollOnce(): Promise<void>
  start(): void
  stop(): void
}

const HISTORY_LIMIT = 100

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function historyOf(reply: AskReply): Record<string, unknown>[] {
  if (!reply.ok || !Array.isArray(reply.data.messages)) return []
  return reply.data.messages.flatMap((item) => {
    const record = recordOf(item)
    return record === undefined ? [] : [record]
  })
}

function seenKeyOf(message: IncomingMessage): string {
  if (message.messageId !== '') return `id:${message.messageId}`
  return `at:${message.at}:${message.senderId}:${message.text}`
}

function historyMessageOf(
  item: Record<string, unknown>,
  chatKey: string,
  selfId: string,
  sentIds: ReadonlySet<string> = new Set(),
  directed = false,
): IncomingMessage | null {
  const sender = recordOf(item.sender)
  const senderId = asText(item.sender_id ?? item.user_id ?? sender?.user_id)
  const seconds = Number(item.time)
  if (senderId === '' || !Number.isFinite(seconds) || seconds <= 0) return null
  const segments = item.message
  const text = textOf(segments === undefined ? item.raw_message : segments)
  const messageId = asText(item.message_id ?? item.message_seq)
  const at = seconds * 1000
  return {
    chatKey,
    senderId,
    senderName: asText(item.sender_name ?? sender?.card ?? sender?.nickname) || senderId,
    text,
    at,
    atMe: directed || mentionsSelf(segments, selfId),
    isPoke: false,
    replyToBot: repliesToSelf(segments, selfId, sentIds),
    messageId,
    attachments: attachmentsOf(segments),
    traceId: traceIdOf(chatKey, messageId, at),
    selfSent: selfId !== '' && senderId === selfId,
    history: chatKey.startsWith('group:') ? 'group' : 'private',
  }
}

/**
 * 把历史接口的一条好友消息翻成普通入站；缺发送者或时间的条目不猜
 * @param item - 历史接口返回的一条
 * @param peer - 这段私聊的好友编号
 * @param selfId - 机器人自己的编号
 * @param sentIds - 自己发过、可用于识别引用回复的编号
 * @returns 翻好的消息，认不出时为空
 */
export function privateHistoryMessage(
  item: Record<string, unknown>,
  peer: string,
  selfId: string,
  sentIds: ReadonlySet<string> = new Set(),
): IncomingMessage | null {
  if (peer === '') return null
  return historyMessageOf(item, chatKeyOf('private', peer), selfId, sentIds, true)
}

/**
 * 把历史接口的一条群消息翻成普通入站
 * @param item - 历史接口返回的一条
 * @param group - 群编号
 * @param selfId - 机器人自己的编号
 * @param sentIds - 自己发过、可用于识别引用回复的编号
 * @returns 翻好的消息，认不出时为空
 */
export function groupHistoryMessage(
  item: Record<string, unknown>,
  group: string,
  selfId: string,
  sentIds: ReadonlySet<string> = new Set(),
): IncomingMessage | null {
  if (group === '') return null
  return historyMessageOf(item, chatKeyOf('group', group), selfId, sentIds)
}

function remember(cursor: Cursor, key: string): void {
  if (key === '' || cursor.ids.has(key)) return
  cursor.ids.add(key)
  cursor.order.push(key)
  if (cursor.order.length <= HISTORY_LIMIT) return
  const oldest = cursor.order.shift()
  if (oldest !== undefined) cursor.ids.delete(oldest)
}

/**
 * 建一个好友私聊轮询器；第一次只建基线，之后才把新消息交出去
 * @param options - 好友、间隔与入站出口
 * @returns 轮询器
 */
export function createPrivatePoller(options: PrivatePollOptions): PrivatePoller {
  const peers = [...new Set(options.peers.map(peer => peer.trim()).filter(peer => peer !== ''))]
  const intervalMs = Math.max(PRIVATE_POLL_DEFAULTS.minIntervalMs, Math.floor(options.intervalMs))
  const count = Math.max(1, Math.floor(options.count ?? PRIVATE_POLL_DEFAULTS.count))
  const cursors = new Map<string, Cursor>()
  const failures = new Map<string, string>()
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  const cursorOf = (peer: string): Cursor => {
    const kept = cursors.get(peer)
    if (kept !== undefined) return kept
    const created: Cursor = { primed: false, lastAt: 0, ids: new Set(), order: [] }
    cursors.set(peer, created)
    return created
  }

  const pollPeer = async (peer: string): Promise<void> => {
    const numeric = Number(peer)
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return
    const reply = await options.ask('get_friend_msg_history', { user_id: numeric, count })
    if (!reply.ok) {
      if (reply.code !== 'channel.offline' && failures.get(peer) !== reply.code) {
        failures.set(peer, reply.code)
        options.log?.(`好友私聊轮询失败：${peer} ${reply.code}`)
        options.report?.({ kind: 'error', at: Date.now(), peer, code: reply.code })
      }
      return
    }
    failures.delete(peer)

    const cursor = cursorOf(peer)
    const sentIds = options.sentIds()
    const rows = historyOf(reply).flatMap((item, index) => {
      const message = privateHistoryMessage(item, peer, options.selfId, sentIds)
      return message === null ? [] : [{ message, index }]
    })
    if (!cursor.primed) {
      for (const { message } of rows) {
        remember(cursor, seenKeyOf(message))
        cursor.lastAt = Math.max(cursor.lastAt, message.at)
      }
      cursor.primed = true
      options.log?.(`好友私聊轮询已建立基线：${peer} ${rows.length} 条`)
      options.report?.({ kind: 'baseline', at: Date.now(), peer, count: rows.length })
      const replaySince = options.replaySince
      if (replaySince !== undefined) {
        const replay = rows
          .filter(({ message }) => !message.selfSent && message.at >= replaySince && hasWords(message.text))
          .sort((left, right) => left.message.at - right.message.at || left.index - right.index)
        for (const { message } of replay) {
          options.report?.({ kind: 'replay', at: Date.now(), peer, messageId: message.messageId })
          options.emit(message)
        }
      }
      return
    }

    const fresh = rows
      .filter(({ message }) => !message.selfSent && message.messageId !== '')
      .filter(({ message }) => message.at >= cursor.lastAt && !cursor.ids.has(seenKeyOf(message)))
      .sort((left, right) => left.message.at - right.message.at || left.index - right.index)
    for (const { message } of fresh) {
      remember(cursor, seenKeyOf(message))
      cursor.lastAt = Math.max(cursor.lastAt, message.at)
      if (hasWords(message.text)) {
        options.log?.(`好友私聊轮询发现新消息：${message.chatKey} ${message.messageId}`)
        options.report?.({ kind: 'new', at: Date.now(), peer, messageId: message.messageId })
        options.emit(message)
      }
    }
  }

  const pollOnce = async (): Promise<void> => {
    if (running || peers.length === 0 || !options.status().connected) return
    running = true
    try {
      for (const peer of peers) await pollPeer(peer)
    } finally {
      running = false
    }
  }

  return {
    pollOnce,
    start() {
      if (timer !== undefined) return
      const run = (): void => {
        void pollOnce().catch((error: unknown) => {
          options.log?.(`好友私聊轮询异常：${String(error)}`)
        })
      }
      run()
      timer = setInterval(run, intervalMs)
      timer.unref()
    },
    stop() {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
  }
}

/**
 * 建群历史补收器；第一次补回近期消息，之后只补新出现的消息
 * @param options - 群名单、间隔、年龄上限与入站出口
 * @returns 群历史补收器
 */
export function createGroupHistoryPoller(options: GroupHistoryOptions): GroupHistoryPoller {
  const groups = [...new Set(options.groups.map(group => group.trim()).filter(group => group !== ''))]
  const intervalMs = Math.max(GROUP_HISTORY_DEFAULTS.minIntervalMs, Math.floor(options.intervalMs))
  const count = Math.max(1, Math.min(HISTORY_LIMIT, Math.floor(options.count ?? GROUP_HISTORY_DEFAULTS.count)))
  const maxAgeMs = Math.max(0, Math.floor(options.maxAgeMs ?? GROUP_HISTORY_DEFAULTS.maxAgeMs))
  const now = options.now ?? Date.now
  const cursors = new Map<string, Cursor>()
  const failures = new Map<string, string>()
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  const cursorOf = (group: string): Cursor => {
    const kept = cursors.get(group)
    if (kept !== undefined) return kept
    const created: Cursor = { primed: false, lastAt: 0, ids: new Set(), order: [] }
    cursors.set(group, created)
    return created
  }

  const pollGroup = async (group: string): Promise<void> => {
    const numeric = Number(group)
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return
    const reply = await options.ask('get_group_msg_history', { group_id: numeric, count, message_seq: 0 })
    if (!reply.ok) {
      if (reply.code !== 'channel.offline' && failures.get(group) !== reply.code) {
        failures.set(group, reply.code)
        options.log?.(`群历史补收失败：${group} ${reply.code}`)
        options.report?.({ kind: 'error', at: now(), group, code: reply.code })
      }
      return
    }
    failures.delete(group)
    const sentIds = options.sentIds()
    const cutoff = now() - maxAgeMs
    const rows = historyOf(reply).flatMap((item, index) => {
      const message = groupHistoryMessage(item, group, options.selfId, sentIds)
      return message === null ? [] : [{ message, index }]
    }).filter(({ message }) =>
      !message.selfSent
      && hasWords(message.text)
      && message.at >= cutoff)
      .sort((left, right) => left.message.at - right.message.at || left.index - right.index)

    const cursor = cursorOf(group)
    if (!cursor.primed && options.replayInitial !== true) {
      for (const { message } of rows) remember(cursor, seenKeyOf(message))
      cursor.lastAt = rows.reduce((latest, { message }) => Math.max(latest, message.at), cursor.lastAt)
      cursor.primed = true
      options.report?.({ kind: 'baseline', at: now(), group, count: rows.length })
      options.log?.(`群历史补收已建立基线：${group} ${rows.length} 条，未回放旧消息`)
      return
    }
    const fresh = rows.filter(({ message }) => {
      const key = seenKeyOf(message)
      if (cursor.ids.has(key)) return false
      return !cursor.primed || message.at >= cursor.lastAt
    })
    for (const { message } of fresh) {
      remember(cursor, seenKeyOf(message))
      cursor.lastAt = Math.max(cursor.lastAt, message.at)
      options.report?.({ kind: 'history', at: now(), group, messageId: message.messageId })
      options.emit(message)
    }
    if (!cursor.primed) {
      cursor.primed = true
      options.log?.(`群历史补收已建立基线：${group} ${fresh.length} 条`)
    }
  }

  const pollOnce = async (): Promise<void> => {
    if (running || groups.length === 0 || !options.status().connected) return
    running = true
    try {
      for (const group of groups) await pollGroup(group)
    } finally {
      running = false
    }
  }

  return {
    pollOnce,
    start() {
      if (timer !== undefined) return
      const run = (): void => {
        void pollOnce().catch((error: unknown) => {
          options.log?.(`群历史补收异常：${String(error)}`)
        })
      }
      run()
      timer = setInterval(run, intervalMs)
      timer.unref()
    },
    stop() {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    },
  }
}
