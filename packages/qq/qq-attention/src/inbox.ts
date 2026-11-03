/**
 * Per-session message inbox for one chat. The channel bridge pushes inbound
 * messages; the attention tools read, wait, and advance the watermark.
 *
 * @module @huoli/huoli-qq-attention
 */

/** One inbound message as stored in the inbox. */
export interface QqMessage {
  /** Monotonic sequence inside one chat, starting at 1. */
  readonly seq: number
  /** Chat this message belongs to. */
  readonly chatKey: string
  /** Platform sender id. */
  readonly senderId: string
  /** Display name, when the channel reports one. */
  readonly senderName?: string
  /** Message text. */
  readonly text: string
  /** Arrival time in milliseconds. */
  readonly at: number
}

/** Fields the channel bridge supplies when pushing one message. */
export interface InboxPush {
  /** Platform sender id. */
  senderId: string
  /** Display name, when available. */
  senderName?: string
  /** Message text. */
  text: string
  /** Arrival time; defaults to now. */
  at?: number
}

/** Read result carrying the watermark the model should echo back. */
export interface InboxRead {
  readonly messages: readonly QqMessage[]
  /** Sequence of the newest message in this chat, zero when empty. */
  readonly nextSeq: number
  /** Whether the limit cut the result short. */
  readonly partial: boolean
}

/** Wait result; a timeout is an ordinary outcome, not an error. */
export interface InboxWait {
  readonly messages: readonly QqMessage[]
  /** True when the chat stayed quiet long enough to count as finished. */
  readonly quietReached: boolean
  /** True when the total wait expired before any message arrived. */
  readonly timedOut: boolean
}

/** Inbox seam consumed by the attention tools and fed by the channel bridge. */
export interface QqInbox {
  /** Append one message and wake every waiter of that chat. */
  push(chatKey: string, message: InboxPush): QqMessage
  /** Read messages above the watermark. */
  read(chatKey: string, afterSeq: number, limit: number): InboxRead
  /** Wait for messages, settling on a quiet period or the total timeout. */
  wait(chatKey: string, options: { timeoutMs: number; quietMs: number; signal?: AbortSignal }): Promise<InboxWait>
  /** Number of stored messages in one chat. */
  count(chatKey: string): number
}

interface Waiter {
  readonly afterSeq: number
  readonly quietMs: number
  readonly totalTimer: ReturnType<typeof setTimeout>
  quietTimer: ReturnType<typeof setTimeout> | undefined
  readonly collected: QqMessage[]
  readonly finish: (result: InboxWait) => void
}

/** Create an inbox holding messages in memory. */
export function createInbox(now: () => number = () => Date.now()): QqInbox {
  const chats = new Map<string, QqMessage[]>()
  const waiters = new Map<string, Set<Waiter>>()

  const listOf = (chatKey: string): QqMessage[] => {
    const existing = chats.get(chatKey)
    if (existing !== undefined) return existing
    const created: QqMessage[] = []
    chats.set(chatKey, created)
    return created
  }

  const settle = (waiter: Waiter, result: InboxWait): void => {
    clearTimeout(waiter.totalTimer)
    if (waiter.quietTimer !== undefined) clearTimeout(waiter.quietTimer)
    waiter.finish(result)
  }

  const notify = (chatKey: string, message: QqMessage): void => {
    const set = waiters.get(chatKey)
    if (set === undefined) return
    for (const waiter of [...set]) {
      if (message.seq <= waiter.afterSeq) continue
      waiter.collected.push(message)
      if (waiter.quietMs > 0) {
        if (waiter.quietTimer !== undefined) clearTimeout(waiter.quietTimer)
        waiter.quietTimer = setTimeout(() => settle(waiter, { messages: [...waiter.collected], quietReached: true, timedOut: false }), waiter.quietMs)
        continue
      }
      settle(waiter, { messages: [...waiter.collected], quietReached: false, timedOut: false })
    }
  }

  return {
    push(chatKey, message) {
      const list = listOf(chatKey)
      const item: QqMessage = {
        seq: list.length + 1,
        chatKey,
        senderId: message.senderId,
        ...message.senderName !== undefined ? { senderName: message.senderName } : {},
        text: message.text,
        at: message.at ?? now(),
      }
      list.push(item)
      notify(chatKey, item)
      return item
    },
    read(chatKey, afterSeq, limit) {
      const list = listOf(chatKey)
      const selected = list.filter(message => message.seq > afterSeq).slice(0, limit)
      return {
        messages: selected,
        nextSeq: list.length,
        partial: list.filter(message => message.seq > afterSeq).length > selected.length,
      }
    },
    wait(chatKey, options) {
      const list = listOf(chatKey)
      const afterSeq = list.length
      return new Promise<InboxWait>((resolve) => {
        const set = waiters.get(chatKey) ?? new Set<Waiter>()
        waiters.set(chatKey, set)
        const waiter: Waiter = {
          afterSeq,
          quietMs: options.quietMs,
          totalTimer: setTimeout(() => settle(waiter, { messages: [...waiter.collected], quietReached: false, timedOut: true }), options.timeoutMs),
          quietTimer: undefined,
          collected: [],
          finish: (result) => { set.delete(waiter); resolve(result) },
        }
        set.add(waiter)
        options.signal?.addEventListener('abort', () => settle(waiter, { messages: [...waiter.collected], quietReached: false, timedOut: true }), { once: true })
      })
    },
    count(chatKey) {
      return listOf(chatKey).length
    },
  }
}
