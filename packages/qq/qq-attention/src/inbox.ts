// 实时收件箱：通道桥接往这里推，工具从这里读与等

/** 缓冲里的一条消息 */
export interface QqMessage {
  seq: number
  chatKey: string
  senderId: string
  senderName?: string
  text: string
  at: number
}

/** 通道推消息时给的字段 */
export interface InboxPush {
  senderId: string
  senderName?: string
  text: string
  at?: number
}

/** 读的结果，水位是这次读到的最后一条 */
export interface InboxRead {
  messages: readonly QqMessage[]
  readThroughSeq: number
  partial: boolean
  latestSeq: number
}

/** 等的结果，超时与取消分开 */
export interface InboxWait {
  messages: readonly QqMessage[]
  quietReached: boolean
  timedOut: boolean
  cancelled: boolean
}

/** 收件箱接口 */
export interface QqInbox {
  push(chatKey: string, message: InboxPush): QqMessage
  read(chatKey: string, afterSeq: number, limit: number): InboxRead
  wait(chatKey: string, options: { timeoutMs: number; quietMs: number; signal?: AbortSignal }): Promise<InboxWait>
  latestSeq(chatKey: string): number
  recent(chatKey: string, limit: number): readonly QqMessage[]
}

// 一个等待者
interface Waiter {
  afterSeq: number
  quietMs: number
  collected: QqMessage[]
  settle: (result: InboxWait) => void
}

/**
 * 建一个内存收件箱
 * @param now - 现在的时间
 * @returns 处理结果
 */
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
      // 起点取调用那一刻的最新序号，之后到达的才算这次等到的
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
