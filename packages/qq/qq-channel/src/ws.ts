// 跟 QQ 那头连着：收消息、发消息、断了自动重连

import { asText, type ChannelStatus, type MessageSegment, type SentResult } from './events.ts'

/** 连上去要的地址与身份 */
export interface WsOptions {
  url: string
  selfId: string
  accessToken?: string
  reconnectMs?: number
  now?: () => number
}

/** 连接的回调 */
export interface WsHandlers {
  onMessage: (raw: Record<string, unknown>) => void
  onStatus: (status: ChannelStatus) => void
  log: (message: string) => void
}

/** 一条连接 */
export interface WsChannel {
  start(): void
  stop(): void
  send(message: string | readonly MessageSegment[], chatKey: string): Promise<SentResult>
  react(messageId: string, emoji: string): Promise<SentResult>
  status(): ChannelStatus
  /** 这一条连接发出去过的消息编号，用来按引用编号认出在回自己 */
  sentIds(): ReadonlySet<string>
}

// 一段等回话的超时
const CALL_TIMEOUT_MS = 15_000

/**
 * 建一条连接
 * @param options - 选项
 * @param handlers - 收到消息时做什么
 * @returns 处理结果
 */
export function createWsChannel(options: WsOptions, handlers: WsHandlers): WsChannel {
  const reconnectMs = Math.max(1000, options.reconnectMs ?? 5000)
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let seq = 0
  let status: ChannelStatus = { connected: false, url: options.url, reconnectCount: 0, lastError: '' }
  const sentIds = new Set<string>()
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

  // 每个连接自己读一次关闭标记，避免被外层的提前返回窄化掉
  const isStopped = (): boolean => stopped

  const call = (action: string, params: Record<string, unknown>): Promise<SentResult> => {
    const active = socket
    if (active === undefined || active.readyState !== 1) {
      handlers.log(`发不出去：连接不在时收到 ${action}`)
      return Promise.resolve({ ok: false, code: 'channel.offline', reason: '还没连上', hint: '等连上再发，或者先不发作罢' })
    }
    seq += 1
    const echo = `qq-${seq}`
    return new Promise<SentResult>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(echo)
        handlers.log(`发不出去：${action} 等回话超时`)
        resolve({ ok: false, code: 'channel.timeout', reason: '等回话超时', hint: '等一下再发，别原样重发同一句' })
      }, CALL_TIMEOUT_MS)
      pending.set(echo, { settle: resolve, timer })
      active.send(JSON.stringify({ action, params, echo }))
    })
  }

  const connect = (): void => {
    if (isStopped()) return
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
        } catch (_parseFailure) {
          // 坏帧没有事件可翻，跳过它让下一帧继续收
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
            // 对方主动拒收时这一条是唯一线索，别让它只剩一个返回码
            if (retcode !== 0) handlers.log(`发不出去：对方回 ${retcode} ${asText(raw.wording ?? raw.message ?? '')}`)
            const id = typeof data.message_id === 'number' || typeof data.message_id === 'string' ? String(data.message_id) : ''
            if (retcode === 0 && id !== '') sentIds.add(id)
            waiting.settle(retcode === 0
              ? { ok: true, ...id !== '' ? { messageId: id } : {} }
              : { ok: false, code: `channel.${retcode}`, reason: asText(raw.wording ?? raw.message ?? '发送失败'), hint: '照对方给的码换个做法，别原样重发' })
          }
          return
        }
        handlers.onMessage(raw)
      })
      ws.addEventListener('close', () => {
        settleAll({ ok: false, code: 'channel.closed', reason: '连接断了', hint: '等自动重连上再发' })
        publish({ connected: false, reconnectCount: status.reconnectCount + 1 })
        if (stopped) return
        timer = setTimeout(connect, reconnectMs)
      })
      ws.addEventListener('error', () => {
        publish({ lastError: '连接出错' })
      })
    } catch (error) {
      publish({ connected: false, lastError: error instanceof Error ? error.message : asText(error) })
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
      settleAll({ ok: false, code: 'channel.stopped', reason: '已经关掉', hint: '重新起一条连接再发' })
      socket?.close()
      socket = undefined
      sentIds.clear()
      publish({ connected: false })
    },
    send(message: string | readonly MessageSegment[], chatKey: string) {
      if (chatKey.startsWith('group:')) {
        return call('send_group_msg', { group_id: Number(chatKey.slice('group:'.length)), message })
      }
      return call('send_private_msg', { user_id: Number(chatKey.slice('private:'.length)), message })
    },
    react(messageId, emoji) {
      if (messageId === '') return Promise.resolve({ ok: false, code: 'channel.no_target', reason: '没有要回应的那条消息', hint: '从消息列表里拿编号' })
      return call('set_msg_emoji_like', { message_id: Number(messageId), emoji_id: emoji })
    },
    status() {
      return { ...status, url: options.url }
    },
    sentIds() {
      return sentIds
    },
  }
}
