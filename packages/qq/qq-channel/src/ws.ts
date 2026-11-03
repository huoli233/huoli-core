// 跟 QQ 那头连着：收消息、发消息、断了自动重连

import type { ChannelStatus, SentResult } from './events.ts'

// 连上去要的地址与身份
export interface WsOptions {
  url: string
  selfId: string
  accessToken?: string
  reconnectMs?: number
  now?: () => number
}

// 连接的回调
export interface WsHandlers {
  onMessage: (raw: Record<string, unknown>) => void
  onStatus: (status: ChannelStatus) => void
  log: (message: string) => void
}

// 一条连接
export interface WsChannel {
  start(): void
  stop(): void
  send(text: string, chatKey: string): Promise<SentResult>
  react(messageId: string, emoji: string): Promise<SentResult>
  status(): ChannelStatus
}

// 一段等回话的超时
const CALL_TIMEOUT_MS = 15_000

// 建一条连接
export function createWsChannel(options: WsOptions, handlers: WsHandlers): WsChannel {
  const reconnectMs = Math.max(1000, options.reconnectMs ?? 5000)
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let seq = 0
  let status: ChannelStatus = { connected: false, url: options.url, reconnectCount: 0, lastError: '' }
  const pending = new Map<string, { settle: (value: SentResult) => void; timer: ReturnType<typeof setTimeout> }>()

  const publish = (next: Partial<ChannelStatus>): void => {
    status = { ...status, ...next }
    handlers.onStatus(status)
  }

  const settleAll = (result: SentResult): void => {
    for (const [echo, waiting] of pending) {
      clearTimeout(waiting.timer)
      waiting.settle(result)
      pending.delete(echo)
    }
  }

  const call = (action: string, params: Record<string, unknown>): Promise<SentResult> => {
    if (socket === undefined || socket.readyState !== 1) {
      return Promise.resolve({ ok: false, code: 'channel.offline', reason: '还没连上' })
    }
    seq += 1
    const echo = `qq-${seq}`
    return new Promise<SentResult>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(echo)
        resolve({ ok: false, code: 'channel.timeout', reason: '等回话超时' })
      }, CALL_TIMEOUT_MS)
      pending.set(echo, { settle: resolve, timer })
      socket!.send(JSON.stringify({ action, params, echo }))
    })
  }

  const connect = (): void => {
    if (stopped) return
    try {
      const headers: Record<string, string> = {}
      if (options.accessToken !== undefined && options.accessToken !== '') {
        headers.Authorization = `Bearer ${options.accessToken}`
      }
      const ws = new WebSocket(options.url, { headers } as never)
      socket = ws
      ws.addEventListener('open', () => {
        publish({ connected: true, lastError: '' })
        handlers.log(`已经连上 ${options.url}`)
      })
      ws.addEventListener('message', (event) => {
        const text = typeof event.data === 'string' ? event.data : ''
        if (text === '') return
        let raw: Record<string, unknown>
        try {
          raw = JSON.parse(text) as Record<string, unknown>
        } catch {
          return
        }
        // 有 echo 的是自己发出去的调用等回来的结果
        const echo = typeof raw.echo === 'string' ? raw.echo : ''
        if (echo !== '') {
          const waiting = pending.get(echo)
          if (waiting !== undefined) {
            clearTimeout(waiting.timer)
            pending.delete(echo)
            const data = raw.data !== null && typeof raw.data === 'object' ? raw.data as Record<string, unknown> : {}
            const retcode = Number(raw.retcode ?? 0)
            waiting.settle(retcode === 0
              ? { ok: true, ...typeof data.message_id === 'number' || typeof data.message_id === 'string'
                ? { messageId: String(data.message_id) } : {} }
              : { ok: false, code: `channel.${retcode}`, reason: String(raw.wording ?? raw.message ?? '发送失败') })
          }
          return
        }
        handlers.onMessage(raw)
      })
      ws.addEventListener('close', () => {
        settleAll({ ok: false, code: 'channel.closed', reason: '连接断了' })
        publish({ connected: false, reconnectCount: status.reconnectCount + 1 })
        if (stopped) return
        timer = setTimeout(connect, reconnectMs)
      })
      ws.addEventListener('error', () => {
        publish({ lastError: '连接出错' })
      })
    } catch (error) {
      publish({ connected: false, lastError: String((error as Error)?.message ?? error) })
      if (!stopped) timer = setTimeout(connect, reconnectMs)
    }
  }

  return {
    start() {
      stopped = false
      connect()
    },
    stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      settleAll({ ok: false, code: 'channel.stopped', reason: '已经关掉' })
      socket?.close()
      socket = undefined
      publish({ connected: false })
    },
    send(text, chatKey) {
      if (chatKey.startsWith('group:')) {
        return call('send_group_msg', { group_id: Number(chatKey.slice('group:'.length)), message: text })
      }
      return call('send_private_msg', { user_id: Number(chatKey.slice('private:'.length)), message: text })
    },
    react(messageId, emoji) {
      if (messageId === '') return Promise.resolve({ ok: false, code: 'channel.no_target', reason: '没有要回应的那条消息' })
      return call('set_msg_emoji_like', { message_id: Number(messageId), emoji_id: emoji })
    },
    status() {
      return { ...status, url: options.url }
    },
  }
}
