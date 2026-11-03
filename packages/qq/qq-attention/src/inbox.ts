/**
 * In-memory inbox for one chat. The channel bridge pushes inbound messages;
 * the attention tools read above a watermark and wait for the chat to settle.
 *
 * Messages themselves live in the session log; this buffer only serves the
 * live window the tools look at.
 *
 * @module @huoli/huoli-qq-attention
 */

/** One inbound message held in the live buffer. */
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

/** Read result; the watermark is the last returned message, not the buffer size. */
export interface InboxRead {
  readonly messages: readonly QqMessage[]
  /** Sequence of the last message returned, or the input watermark when nothing matched. */
  readonly readThroughSeq: number
  /** Whether more messages wait above the returned window. */
  readonly partial: boolean
  /** Highest sequence currently stored in this chat. */
  readonly latestSeq: number
}

/** Wait result; a timeout and a cancellation are different outcomes. */
export interface InboxWait {
  readonly messages: readonly QqMessage[]
  /** The chat stayed quiet long enough to count as finished. */
  readonly quietReached: boolean
  /** The total wait expired. */
  readonly timedOut: boolean
  /** The caller aborted the wait. */
  readonly cancelled: boolean
}

/** Live inbox seam. */
export interface QqInbox {
  /** Append one message and wake every waiter of that chat. */
  push(chatKey: string, message: InboxPush): QqMessage
  /** Read messages strictly above the watermark, up to the limit. */
  read(chatKey: string, afterSeq: number, limit: number): InboxRead
  /** Wait for messages that arrive after this call, settling on quiet or timeout. */
  wait(chatKey: string, options: { timeoutMs: number; quietMs: number; signal?: AbortSignal }): Promise<InboxWait>
  /** Highest sequence stored for a chat, zero when empty. */
  latestSeq(chatKey: string): number
  /** Newest messages of a chat, oldest first. */
  recent(chatKey: string, limit: number): readonly QqMessage[]
}

interface Waiter {
  readonly afterSeq: number
  readonly quietMs: number
  readonly collected: QqMessage[]
  readonly settle: (result: InboxWait) => void
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

  const notify = (chatKey: string, message: QqMessage): void => {
    const set = waiters.get(chatKey)
    if (set === undefined) return
    for (const waiter of [...set]) {
      if (message.seq <= waiter.afterSeq) continue
      waiter.collected.push(message)
      waiter.settle({
        messages: [...waiter.collected],
        quietReached: false,
        timedOut: false,
        cancelled: false,
      })
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
      const above = list.filter(message => message.seq > afterSeq)
      const selected = above.slice(0, limit)
      const last = selected[selected.length - 1]
      return {
        messages: selected,
        readThroughSeq: last !== undefined ? last.seq : afterSeq,
        partial: above.length > selected.length,
        latestSeq: list.length,
      }
    },
    wait(chatKey, options) {
      const list = listOf(chatKey)
      // The starting cursor is the newest message at call time, so anything that
      // arrives later is collected and nothing before this call can be missed.
      const startSeq = list.length
      return new Promise<InboxWait>((resolve) => {
        const set = waiters.get(chatKey) ?? new Set<Waiter>()
        waiters.set(chatKey, set)
        const collected: QqMessage[] = []
        let settled = false
        let quietTimer: ReturnType<typeof setTimeout> | undefined

        const cleanup = (): void => {
          clearTimeout(totalTimer)
          if (quietTimer !== undefined) clearTimeout(quietTimer)
          set.delete(waiter)
          options.signal?.removeEventListener('abort', onAbort)
          if (set.size === 0) waiters.delete(chatKey)
        }

        const finish = (result: InboxWait): void => {
          if (settled) return
          settled = true
          cleanup()
          resolve(result)
        }

        const onAbort = (): void => {
          finish({ messages: [...collected], quietReached: false, timedOut: false, cancelled: true })
        }

        const totalTimer = setTimeout(() => {
          finish({ messages: [...collected], quietReached: false, timedOut: true, cancelled: false })
        }, Math.max(1, options.timeoutMs))

        const waiter: Waiter = {
          afterSeq: startSeq,
          quietMs: options.quietMs,
          collected,
          settle: (result) => {
            if (settled) return
            if (options.quietMs > 0) {
              if (quietTimer !== undefined) clearTimeout(quietTimer)
              quietTimer = setTimeout(() => {
                finish({ messages: [...collected], quietReached: true, timedOut: false, cancelled: false })
              }, options.quietMs)
              return
            }
            finish(result)
          },
        }
        set.add(waiter)

        if (options.signal?.aborted === true) {
          onAbort()
          return
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })

        if (options.quietMs > 0) {
          quietTimer = setTimeout(() => {
            finish({ messages: [...collected], quietReached: true, timedOut: false, cancelled: false })
          }, options.quietMs)
        }
      })
    },
    latestSeq(chatKey) {
      return listOf(chatKey).length
    },
    recent(chatKey, limit) {
      const list = listOf(chatKey)
      const size = Math.max(0, Math.min(limit, list.length))
      return list.slice(list.length - size)
    },
  }
}
