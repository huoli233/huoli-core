// 断线重连之后补读一小段最近消息：中间空着的那段别人说的话，不能当她听过

import { hasWords, type IncomingMessage } from './events.ts'
import { groupHistoryMessage, privateHistoryMessage } from './private-poll.ts'
import type { AskReply } from './ws.ts'

/** 断线补读的默认值 */
export const CATCHUP_DEFAULTS = {
  /** 连上之后要不要补读 */
  enabled: true,
  /** 一次最多补几条 */
  maxMessages: 20,
  /** 只补多久以内的消息 */
  windowMs: 10 * 60_000,
  /** 失败之后隔多久再试 */
  retryMs: 1_000,
  /** 最多再试几次 */
  maxRetries: 2,
  /** 时间戳最多认到多远的将来，超出的按服务端时钟错乱丢掉 */
  futureSlackMs: 60_000,
  /** 每个会话记住多少个见过的编号，用来去重 */
  seenIdMax: 100,
} as const

/** 补读留下的事实，不带消息正文 */
export interface CatchupEvent {
  kind: 'missed' | 'error'
  at: number
  chatKey: string
  count?: number
  messageId?: string
  code?: string
}

/** 补读要用的出口 */
export interface CatchupOptions {
  /** 名单里配着的会话，写 group:编号 或 private:编号 */
  chats: () => readonly string[]
  ask: (action: string, params: Record<string, unknown>) => Promise<AskReply>
  sentIds: () => ReadonlySet<string>
  emit: (message: IncomingMessage) => void
  selfId: string
  /** 连上之后要不要补读 */
  enabled?: boolean
  /** 一次最多补几条 */
  maxMessages?: number
  /** 只补多久以内的消息 */
  windowMs?: number
  /** 失败之后隔多久再试 */
  retryMs?: number
  /** 最多再试几次 */
  maxRetries?: number
  now?: () => number
  log?: (message: string) => void
  report?: (event: CatchupEvent) => void
}

/** 补读器 */
export interface Catchup {
  /** 连上之后补一轮；失败只记一行，不外抛 */
  run(): Promise<void>
  /** 实时到达的一条先记进已见，补读时不再当成错过的 */
  seen(message: IncomingMessage): void
  /** 这个会话已经处理到哪个时刻 */
  watermarkOf(chatKey: string): number
}

/** 一个会话的已见记录 */
interface Seen {
  /** 已经处理到哪个时刻，毫秒 */
  lastAt: number
  /** 见过的消息编号 */
  ids: Set<string>
  /** 编号的先后，超过上限先忘掉最早的那几条 */
  order: string[]
}

/** 等一会儿，但别让定时器拖着进程不退 */
function pauseMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

/**
 * 建一个断线补读器
 * @param options - 名单、出口与阈值
 * @returns 补读器
 */
export function createCatchup(options: CatchupOptions): Catchup {
  const enabled = options.enabled ?? CATCHUP_DEFAULTS.enabled
  const maxMessages = Math.max(1, Math.floor(options.maxMessages ?? CATCHUP_DEFAULTS.maxMessages))
  const windowMs = Math.max(0, Math.floor(options.windowMs ?? CATCHUP_DEFAULTS.windowMs))
  const retryMs = Math.max(0, Math.floor(options.retryMs ?? CATCHUP_DEFAULTS.retryMs))
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? CATCHUP_DEFAULTS.maxRetries))
  const now = options.now ?? Date.now
  // 进程起来那一刻算基线：启动之前的旧消息归历史补收管，这里只补这次进程里断掉的那一段
  const openedAt = now()
  const seen = new Map<string, Seen>()
  const failures = new Map<string, string>()
  let running = false
  let queued = false

  const seenOf = (chatKey: string): Seen => {
    const kept = seen.get(chatKey)
    if (kept !== undefined) return kept
    const created: Seen = { lastAt: openedAt, ids: new Set(), order: [] }
    seen.set(chatKey, created)
    return created
  }

  const rememberId = (cursor: Seen, messageId: string): void => {
    if (messageId === '' || cursor.ids.has(messageId)) return
    cursor.ids.add(messageId)
    cursor.order.push(messageId)
    if (cursor.order.length <= CATCHUP_DEFAULTS.seenIdMax) return
    const oldest = cursor.order.shift()
    if (oldest !== undefined) cursor.ids.delete(oldest)
  }

  // 未来的时间戳不往水位上顶，否则一条错乱的消息会让后面全都算「太旧」
  const advance = (cursor: Seen, at: number): void => {
    cursor.lastAt = Math.max(cursor.lastAt, Math.min(at, now()))
  }

  const seenMessage = (message: IncomingMessage): void => {
    const cursor = seenOf(message.chatKey)
    rememberId(cursor, message.messageId)
    advance(cursor, message.at)
  }

  const requestOf = (chatKey: string): { action: string; params: Record<string, unknown> } | undefined => {
    const at = chatKey.indexOf(':')
    if (at <= 0) return undefined
    const kind = chatKey.slice(0, at)
    const id = Number(chatKey.slice(at + 1))
    if (!Number.isSafeInteger(id) || id <= 0) return undefined
    if (kind === 'group') {
      return { action: 'get_group_msg_history', params: { group_id: id, count: maxMessages, message_seq: 0 } }
    }
    if (kind === 'private') return { action: 'get_friend_msg_history', params: { user_id: id, count: maxMessages } }
    return undefined
  }

  const rowsOf = (reply: AskReply, chatKey: string): Array<{ message: IncomingMessage; index: number }> => {
    if (!reply.ok || !Array.isArray(reply.data.messages)) return []
    const rows = reply.data.messages.flatMap((item) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
      return [item as Record<string, unknown>]
    })
    const id = chatKey.slice(chatKey.indexOf(':') + 1)
    const sentIds = options.sentIds()
    const group = chatKey.startsWith('group:')
    return rows.flatMap((row, index) => {
      const message = group
        ? groupHistoryMessage(row, id, options.selfId, sentIds)
        : privateHistoryMessage(row, id, options.selfId, sentIds)
      return message === null ? [] : [{ message, index }]
    })
  }

  // 读一次历史，失败按配置再试几次；断开或试完都只记一行，绝不往外抛
  const fetchHistory = async (chatKey: string): Promise<AskReply | undefined> => {
    const request = requestOf(chatKey)
    if (request === undefined) return undefined
    let lastCode = ''
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let reply: AskReply
      try {
        reply = await options.ask(request.action, request.params)
      } catch (error) {
        reply = { ok: false, code: 'catchup.ask_failed', reason: String(error), hint: '下一次连上再补' }
      }
      if (reply.ok) {
        failures.delete(chatKey)
        return reply
      }
      lastCode = reply.code
      // 已经断开就别再试，等下一次连上再来
      if (reply.code === 'channel.offline') return undefined
      if (attempt < maxRetries && retryMs > 0) await pauseMs(retryMs)
    }
    if (failures.get(chatKey) !== lastCode) {
      failures.set(chatKey, lastCode)
      options.log?.(`断线补读失败：${chatKey} ${lastCode}`)
      options.report?.({ kind: 'error', at: now(), chatKey, code: lastCode })
    }
    return undefined
  }

  const catchUpChat = async (chatKey: string): Promise<void> => {
    // 水位必须在读历史之前取：读的这段时间来的实时消息会把水位顶到「现在」，
    // 取晚了就会把真正错过的那些当成太旧
    const before = seenOf(chatKey).lastAt
    const at = now()
    const floor = at - windowMs
    const ceiling = at + CATCHUP_DEFAULTS.futureSlackMs
    const reply = await fetchHistory(chatKey)
    if (reply === undefined) return
    const rows = rowsOf(reply, chatKey)
      .sort((left, right) => left.message.at - right.message.at || left.index - right.index)
    let delivered = 0
    for (const { message } of rows) {
      const cursor = seenOf(chatKey)
      // 同一个编号不重复；编号认不出时靠下面那条时刻水位兜住
      if (message.messageId !== '' && cursor.ids.has(message.messageId)) continue
      if (message.at > ceiling) continue
      if (message.at < floor) continue
      rememberId(cursor, message.messageId)
      advance(cursor, message.at)
      // 自己发过的旧消息只进已见，不当成要补的未读
      if (message.selfSent) continue
      if (message.at <= before) continue
      if (!hasWords(message.text)) continue
      if (delivered >= maxMessages) break
      delivered += 1
      options.report?.({ kind: 'missed', at, chatKey, messageId: message.messageId })
      options.emit(message)
    }
    if (delivered > 0) options.log?.(`断线补读：${chatKey} 补回 ${delivered} 条`)
  }

  const runOnce = async (): Promise<void> => {
    if (!enabled) return
    // 上一轮还没读完就又连上：记一笔，这一轮读完再补一次，别把这段空洞漏掉
    if (running) {
      queued = true
      return
    }
    running = true
    try {
      // 名单里的会话都要看一遍：断线时没说过话的群，恰恰是空洞藏得最深的地方
      const targets = [...new Set([...options.chats(), ...seen.keys()])].filter(key => key !== '')
      for (const chatKey of targets) {
        try {
          await catchUpChat(chatKey)
        } catch (error) {
          options.log?.(`断线补读异常：${chatKey} ${String(error)}`)
        }
      }
    } finally {
      running = false
      if (queued) {
        queued = false
        void runOnce()
      }
    }
  }

  return {
    run: runOnce,
    seen(message) {
      seenMessage(message)
    },
    watermarkOf(chatKey) {
      return seen.get(chatKey)?.lastAt ?? openedAt
    },
  }
}
