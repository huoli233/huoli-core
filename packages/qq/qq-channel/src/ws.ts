// 跟 QQ 那头连着：收消息、发消息、断了自动重连

import fs from 'node:fs'
import path from 'node:path'
import { asText, type ChannelStatus, type MessageSegment, type SentResult } from './events.ts'
import { forwardCallOf, type ForwardNode } from './forward.ts'
import { createSelfInfo, SELF_INFO_DEFAULTS, type SelfInfo } from './self-info.ts'

/** 连上去要的地址与身份 */
export interface WsOptions {
  url: string
  selfId: string
  accessToken?: string
  reconnectMs?: number
  callTimeoutMs?: number
  /** 网关没读到身份时用的名字 */
  fallbackName?: string
  /** 连上后要不要问网关当前身份；默认关 */
  selfInfoEnabled?: boolean
  /** 问网关身份等回话多久 */
  selfInfoTimeoutMs?: number
  /** 重连后要不要再问一次 */
  selfInfoRefreshOnReconnect?: boolean
  /** 自发消息编号放哪，用来在重连后认出旧消息的引用 */
  sentLedgerFile?: string
  /** 最多保留多少条自发消息编号；默认 200，设为 0 不保留编号 */
  sendHistoryMax?: number
  /** 每个会话最多提供多少条近期发送记录；默认 20，设为 0 禁用近期记录与自助撤回 */
  recentSendMax?: number
  /** 自发消息编号保留多久，单位毫秒；默认 7 天，设为 0 不保留编号 */
  sentLedgerKeepMs?: number
  now?: () => number
}

/** 连接的被叫到时做的事 */
export interface WsHandlers {
  onMessage: (raw: Record<string, unknown>) => void
  onStatus: (status: ChannelStatus) => void
  log: (message: string) => void
}

/** 按聊天预留一条主动发送额度 */
export type ProactiveSendQuota =
  | { ok: false; code: string; reason: string; hint: string; retryAt?: number }
  | { ok: true; settle: (sent: boolean, at: number) => void }

/** 主动发送额度的读取与预留入口 */
export type ProactiveSendQuotaProvider = (chatKey: string) => ProactiveSendQuota | undefined

/** 一条连接 */
export interface WsChannel {
  start(): void
  stop(): void
  send(message: string | readonly MessageSegment[], chatKey: string): Promise<SentResult>
  /** 把几段正文合成一条合并转发发出去 */
  sendForward(nodes: readonly ForwardNode[], chatKey: string): Promise<SentResult>
  react(messageId: string, emoji: string): Promise<SentResult>
  /** 撤回当前会话里自己最近发出的一条 */
  unsend(messageId: string, chatKey: string): Promise<SentResult>
  /** 按已完成的群管理员校验删除一条群消息 */
  moderateDelete(messageId: string, chatKey: string): Promise<SentResult>
  status(): ChannelStatus
  /** 这一条连接发出去过的消息编号，用来按引用编号认出在回自己 */
  sentIds(): ReadonlySet<string>
  /** 当前会话最近发出去的几条 */
  recentSends(chatKey: string): readonly SentRecord[]
  /** 当前网关昵称、QQ 号、是否读到与读到的时刻 */
  selfInfo(): SelfInfo
  /** 只发起已登记的读取请求；send_poke 转到受急停保护的发送路 */
  ask(action: string, params: Record<string, unknown>): Promise<AskReply>
  /** 接上全局停发检查，返回原因时任何外发动作都拒绝 */
  useSendGuard(check: (() => string | undefined) | undefined): void
  /** 接上主动发送额度，在每次实际消息发送前预留 */
  useProactiveSendQuota(provide: ProactiveSendQuotaProvider | undefined): void
}

/** 自己发出去的一条，留着给撤回用 */
export interface SentRecord {
  /** 消息编号 */
  messageId: string
  /** 发到哪个会话 */
  chatKey: string
  /** 什么时候发的，毫秒 */
  at: number
}

function takeLast<T>(items: readonly T[], max: number): T[] {
  return max === 0 ? [] : items.slice(-max)
}

function retainedSentRecords(
  records: readonly SentRecord[],
  at: number,
  max: number,
  keepMs: number,
): SentRecord[] {
  if (max === 0 || keepMs === 0) return []
  const cutoff = at - keepMs
  return takeLast(records.filter(record => record.at >= cutoff && record.at <= at), max)
}

function readSentLedger(file: string | undefined, now: number, max: number, keepMs: number): SentRecord[] {
  if (file === undefined || file === '') return []
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    const records = parsed.flatMap((row) => {
      if (row === null || typeof row !== 'object') return []
      const item = row as Record<string, unknown>
      const messageId = typeof item.messageId === 'string' ? item.messageId : ''
      const chatKey = typeof item.chatKey === 'string' ? item.chatKey : ''
      const at = typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : 0
      return messageId !== '' && chatKey !== '' && at <= now && now - at <= keepMs
        ? [{ messageId, chatKey, at }]
        : []
    })
    return retainedSentRecords(records, now, max, keepMs)
  } catch {
    return []
  }
}

function writeSentLedger(
  file: string | undefined,
  records: readonly SentRecord[],
  at: number,
  max: number,
  keepMs: number,
): void {
  if (file === undefined || file === '') return
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(retainedSentRecords(records, at, max, keepMs))}\n`, { mode: 0o600 })
    fs.renameSync(temporary, file)
  } catch {
    // 编号记不下只影响跨重启识别，不阻断发送
  }
}

/** 问一次对方之后回来的东西：成了给数据，没成给码与提示 */
export type AskReply =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; reason: string; hint: string }

/** 一条回话，发送与读都先落成这个样子 */
type Reply =
  | { ok: true; data: Record<string, unknown>; messageId?: string }
  | { ok: false; data: Record<string, unknown>; code: string; reason: string; hint: string; outcome?: 'unknown' }

const READ_ACTIONS = new Set([
  'get_group_member_info',
  'get_group_info',
  'get_group_root_files',
  'get_group_files_by_folder',
  '_get_group_notice',
  'get_friend_msg_history',
  'get_group_msg_history',
  'get_group_member_list',
  'get_msg',
  'get_forward_msg',
  'get_mini_app_ark',
])

/** 连接这一层的默认值：等回话多久、断了隔多久重连、重连不许比这更快 */
export const WS_DEFAULTS = {
  /** 一段等回话的超时 */
  callTimeoutMs: 15_000,
  /** 断了之后隔多久重连 */
  reconnectMs: 5_000,
  /** 重连间隔的下限，配得再小也不快过它 */
  minReconnectMs: 1_000,
  /** 等回话超时的下限，配得再小也不短过它 */
  minCallTimeoutMs: 1_000,
  /** 最多保存的自发消息编号数；0 表示不保存 */
  sendHistoryMax: 200,
  /** 每个会话能查询与自助撤回的近期发送数；0 表示不提供近期记录 */
  recentSendMax: 20,
  /** 自发消息编号的保留时长，毫秒；0 表示不保存 */
  sentLedgerKeepMs: 7 * 24 * 3_600_000,
}

function resolveCount(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return resolved
}

function resolveDuration(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be finite and non-negative`)
  }
  return resolved
}

/**
 * 建一条连接
 * @param options - 选项
 * @param handlers - 收到消息时做什么
 * @returns 处理结果
 */
export function createWsChannel(options: WsOptions, handlers: WsHandlers): WsChannel {
  const reconnectMs = Math.max(WS_DEFAULTS.minReconnectMs, options.reconnectMs ?? WS_DEFAULTS.reconnectMs)
  const callTimeoutMs = Math.max(WS_DEFAULTS.minCallTimeoutMs, options.callTimeoutMs ?? WS_DEFAULTS.callTimeoutMs)
  const sendHistoryMax = resolveCount(options.sendHistoryMax, WS_DEFAULTS.sendHistoryMax, 'sendHistoryMax')
  const recentSendMax = resolveCount(options.recentSendMax, WS_DEFAULTS.recentSendMax, 'recentSendMax')
  const sentLedgerKeepMs = resolveDuration(options.sentLedgerKeepMs, WS_DEFAULTS.sentLedgerKeepMs, 'sentLedgerKeepMs')
  const selfEnabled = options.selfInfoEnabled ?? SELF_INFO_DEFAULTS.enabled
  const selfTimeoutMs = Math.max(SELF_INFO_DEFAULTS.minTimeoutMs, options.selfInfoTimeoutMs ?? SELF_INFO_DEFAULTS.timeoutMs)
  const selfRefresh = options.selfInfoRefreshOnReconnect ?? SELF_INFO_DEFAULTS.refreshOnReconnect
  const now = options.now ?? (() => Date.now())
  const selfInfo = createSelfInfo({ fallbackName: options.fallbackName ?? '', fallbackId: options.selfId, now })
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let seq = 0
  let selfOpens = 0
  let status: ChannelStatus = { connected: false, url: options.url, reconnectCount: 0, lastError: '' }
  const records = readSentLedger(options.sentLedgerFile, now(), sendHistoryMax, sentLedgerKeepMs)
  const sentIds = new Set(records.map(record => record.messageId))
  const pending = new Map<string, { settle: (reply: Reply) => void; timer: ReturnType<typeof setTimeout> }>()
  let sendGuard: (() => string | undefined) | undefined
  let proactiveSendQuota: ProactiveSendQuotaProvider | undefined

  const syncSentIds = (): void => {
    sentIds.clear()
    for (const record of records) sentIds.add(record.messageId)
  }

  const pruneRecords = (at: number, persist: boolean): void => {
    const kept = retainedSentRecords(records, at, sendHistoryMax, sentLedgerKeepMs)
    const changed = kept.length !== records.length || kept.some((record, index) => record !== records[index])
    if (!changed) return
    records.splice(0, records.length, ...kept)
    syncSentIds()
    if (persist) writeSentLedger(options.sentLedgerFile, records, at, sendHistoryMax, sentLedgerKeepMs)
  }

  const rememberSent = (messageId: string, chatKey: string, at: number): void => {
    if (messageId === '') return
    const next = retainedSentRecords([...records, { messageId, chatKey, at }], at, sendHistoryMax, sentLedgerKeepMs)
    records.splice(0, records.length, ...next)
    syncSentIds()
    writeSentLedger(options.sentLedgerFile, records, at, sendHistoryMax, sentLedgerKeepMs)
  }

  const publish = (next: Partial<ChannelStatus>): void => {
    status = { ...status, ...next }
    handlers.onStatus(status)
  }

  const settleAll = (reply: Reply): void => {
    for (const [echo, waiting] of pending) {
      clearTimeout(waiting.timer)
      waiting.settle(reply)
      pending.delete(echo)
    }
  }

  // 每个连接自己读一次关闭标记，避免被外层的提前返回窄化掉
  const isStopped = (): boolean => stopped

  const call = (action: string, params: Record<string, unknown>): Promise<SentResult> => {
    const stopped = sendGuard?.()
    if (stopped !== undefined) {
      return Promise.resolve({ ok: false, code: 'channel.emergency_stop', reason: stopped, hint: '先解除急停再发' })
    }
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
        resolve({ ok: false, code: 'channel.timeout', reason: '等回话超时', hint: '等一下再发，别原样重发同一句', outcome: 'unknown' })
      }, callTimeoutMs)
      pending.set(echo, {
        timer,
        settle: (reply) => {
          resolve(reply.ok
            ? { ok: true, ...reply.messageId === undefined ? {} : { messageId: reply.messageId } }
            : {
              ok: false,
              code: reply.code,
              reason: reply.reason,
              hint: reply.hint,
              ...reply.outcome === undefined ? {} : { outcome: reply.outcome },
            })
        },
      })
      try {
        active.send(JSON.stringify({ action, params, echo }))
      } catch (error) {
        clearTimeout(timer)
        pending.delete(echo)
        handlers.log(`发不出去：${action} 没写进连接：${String(error)}`)
        resolve({ ok: false, code: 'channel.send_failed', reason: '消息没写进连接', hint: '等连接恢复后再试' })
      }
    })
  }

  const sendWithQuota = (chatKey: string, send: () => Promise<SentResult>): Promise<SentResult> => {
    const quota = proactiveSendQuota?.(chatKey)
    if (quota?.ok === false) {
      return Promise.resolve({
        ok: false,
        code: quota.code,
        reason: quota.reason,
        hint: quota.hint,
        ...quota.retryAt === undefined ? {} : { retryAt: quota.retryAt },
      })
    }
    return send().then((result) => {
      if (quota?.ok === true) quota.settle(result.ok || result.outcome === 'unknown', now())
      return result
    }, (error: unknown) => {
      if (quota?.ok === true) quota.settle(false, now())
      throw error
    })
  }

  // 读类的调用要拿数据本身，不走上面那条只回成没成的路
  const ask = (action: string, params: Record<string, unknown>): Promise<AskReply> => {
    if (action === 'send_poke') {
      return call(action, params).then(result => result.ok
        ? { ok: true, data: {} }
        : { ok: false, code: result.code ?? 'channel.poke_failed', reason: result.reason ?? '戳一戳没发出去', hint: result.hint ?? '等一下再试' })
    }
    if (!READ_ACTIONS.has(action)) {
      return Promise.resolve({
        ok: false,
        code: 'channel.ask_outbound',
        reason: '这个动作不能走读取接口',
        hint: '只使用已提供的读取接口；发送动作走对应方法',
      })
    }
    const active = socket
    if (active === undefined || active.readyState !== 1) {
      return Promise.resolve({ ok: false, code: 'channel.offline', reason: '还没连上', hint: '等连上再问' })
    }
    seq += 1
    const echo = `qq-${seq}`
    return new Promise<AskReply>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(echo)
        handlers.log(`问不出来：${action} 等回话超时`)
        resolve({ ok: false, code: 'channel.timeout', reason: '等回话超时', hint: '等一下再问一次' })
      }, callTimeoutMs)
      pending.set(echo, {
        timer,
        settle: (reply) => {
          resolve(reply.ok
            ? { ok: true, data: reply.data }
            : { ok: false, code: reply.code, reason: reply.reason, hint: reply.hint })
        },
      })
      active.send(JSON.stringify({ action, params, echo }))
    })
  }

  // 身份读取用单独一条短连接，拿回就关，不往业务连接里多塞一帧
  const askSelf = (): Promise<AskReply> => {
    const echo = `qq-self-${seq += 1}`
    return new Promise<AskReply>((resolve, reject) => {
      let probe: WebSocket
      try {
        const headers: Record<string, string> = {}
        if (options.accessToken !== undefined && options.accessToken !== '') {
          headers.Authorization = `Bearer ${options.accessToken}`
        }
        probe = new WebSocket(options.url, { headers } as never)
      } catch (error) {
        reject(error)
        return
      }
      let settled = false
      // 超时计时器要在收尾之前备好，关掉时别误清外层重连那个
      const probeTimer = setTimeout(() => {
        finish({ ok: false, code: 'channel.timeout', reason: '等回话超时', hint: '等一下再问一次' })
      }, selfTimeoutMs)
      const finish = (reply: AskReply): void => {
        if (settled) return
        settled = true
        clearTimeout(probeTimer)
        probe.close()
        resolve(reply)
      }
      probe.addEventListener('open', () => {
        probe.send(JSON.stringify({ action: 'get_login_info', params: {}, echo }))
      })
      probe.addEventListener('message', (event) => {
        const text = typeof event.data === 'string' ? event.data : ''
        if (text === '') return
        let raw: Record<string, unknown>
        try {
          raw = JSON.parse(text) as Record<string, unknown>
        } catch (_parseFailure) {
          // 坏帧没有身份可翻，跳过它让下一帧继续收
          return
        }
        if (raw.echo !== echo) return
        const data = raw.data !== null && typeof raw.data === 'object' ? raw.data as Record<string, unknown> : {}
        finish(Number(raw.retcode ?? 0) === 0
          ? { ok: true, data }
          : { ok: false, code: `channel.${Number(raw.retcode ?? 0)}`, reason: asText(raw.wording ?? raw.message ?? '对方拒了'), hint: '照对方给的码换个做法' })
      })
      probe.addEventListener('error', () => {
        finish({ ok: false, code: 'self_info.connection', reason: '连接出错', hint: '等一下再问一次' })
      })
      probe.addEventListener('close', () => {
        finish({ ok: false, code: 'self_info.closed', reason: '连接断了', hint: '等一下再问一次' })
      })
    })
  }

  const refreshSelf = (): void => {
    if (!selfEnabled || selfOpens > 0 && !selfRefresh) return
    selfOpens += 1
    void askSelf().then((reply) => {
      if (!reply.ok) {
        selfInfo.fail(reply.code)
        handlers.log(`网关身份没读到：${reply.code} ${reply.reason}`)
        return
      }
      if (selfInfo.note(reply.data, now())) {
        handlers.log(`网关身份已读到：${selfInfo.read().nickname} ${selfInfo.read().qqId}`)
        return
      }
      selfInfo.fail('self_info.incomplete')
      handlers.log('网关身份没读到：回来的号或昵称是空的')
    }).catch((error: unknown) => {
      selfInfo.fail('self_info.failed')
      handlers.log(`网关身份没读到：${String(error)}`)
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
        refreshSelf()
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
            waiting.settle(retcode === 0
              ? { ok: true, data, ...id !== '' ? { messageId: id } : {} }
              : { ok: false, data, code: `channel.${retcode}`, reason: asText(raw.wording ?? raw.message ?? '对方拒了'), hint: '照对方给的码换个做法，别原样重来' })
          }
          return
        }
        handlers.onMessage(raw)
      })
      ws.addEventListener('close', () => {
        settleAll({ ok: false, data: {}, code: 'channel.closed', reason: '连接断了', hint: '等自动重连上再来', outcome: 'unknown' })
        publish({ connected: false, reconnectCount: status.reconnectCount + 1 })
        if (stopped) return
        timer = setTimeout(connect, reconnectMs)
      })
      ws.addEventListener('error', () => {
        publish({ lastError: '连接出错' })
      })
    } catch (error) {
      // 建连失败不往外抛：把原因记进状态，按重连间隔再试一次
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
      settleAll({ ok: false, data: {}, code: 'channel.stopped', reason: '已经关掉', hint: '重新起一条连接再来', outcome: 'unknown' })
      socket?.close()
      socket = undefined
      publish({ connected: false })
    },
    send(message, chatKey) {
      const sent = sendWithQuota(chatKey, () => chatKey.startsWith('group:')
        ? call('send_group_msg', { group_id: Number(chatKey.slice('group:'.length)), message })
        : call('send_private_msg', { user_id: Number(chatKey.slice('private:'.length)), message }))
      // 发出去成了就记一条，撤回时才有据可查
      return sent.then((result) => {
        if (result.ok && result.messageId !== undefined) {
          rememberSent(result.messageId, chatKey, now())
        }
        return result
      })
    },
    sendForward(nodes: readonly ForwardNode[], chatKey: string) {
      const request = forwardCallOf(nodes, chatKey, options.selfId)
      if (request === undefined) {
        return Promise.resolve({ ok: false, code: 'channel.empty_forward', reason: '没有能转发的段', hint: '至少给一段正文' })
      }
      return sendWithQuota(chatKey, () => call(request.action, request.params)).then((result) => {
        if (result.ok && result.messageId !== undefined) rememberSent(result.messageId, chatKey, now())
        return result
      })
    },
    react(messageId, emoji) {
      if (messageId === '') return Promise.resolve({ ok: false, code: 'channel.no_target', reason: '没有要回应的那条消息', hint: '从消息列表里拿编号' })
      return call('set_msg_emoji_like', { message_id: Number(messageId), emoji_id: emoji })
    },
    unsend(messageId, chatKey) {
      if (messageId === '') return Promise.resolve({ ok: false, code: 'unsend.no_id', reason: '没给要撤哪一条', hint: '从刚发出去的回执里拿编号' })
      pruneRecords(now(), true)
      const recent = takeLast(records.filter(record => record.chatKey === chatKey), recentSendMax)
      if (!recent.some(record => record.messageId === messageId)) {
        return Promise.resolve({ ok: false, code: 'unsend.not_mine', reason: '这条不是我刚发的', hint: '只撤自己刚发出去的那几条' })
      }
      const numericId = Number(messageId)
      if (!Number.isSafeInteger(numericId)) {
        return Promise.resolve({ ok: false, code: 'unsend.bad_id', reason: '这条消息编号格式不对', hint: '从当前会话的发送回执里拿编号' })
      }
      return call('delete_msg', { message_id: numericId }).then((result) => {
        if (result.ok) {
          const at = records.findIndex(record => record.messageId === messageId && record.chatKey === chatKey)
          if (at >= 0) records.splice(at, 1)
          syncSentIds()
          writeSentLedger(options.sentLedgerFile, records, now(), sendHistoryMax, sentLedgerKeepMs)
        }
        return result
      })
    },
    moderateDelete(messageId, chatKey) {
      const groupId = chatKey.startsWith('group:') ? Number(chatKey.slice('group:'.length)) : 0
      const numericId = Number(messageId)
      if (!Number.isSafeInteger(groupId) || groupId <= 0) {
        return Promise.resolve({ ok: false, code: 'manage.group_only', reason: '只能在群里管理消息', hint: '私聊只能撤回自己刚发的消息' })
      }
      if (messageId === '' || !Number.isSafeInteger(numericId)) {
        return Promise.resolve({ ok: false, code: 'manage.bad_id', reason: '消息编号格式不对', hint: '从群消息编号里拿' })
      }
      return call('delete_msg', { message_id: numericId })
    },
    status() {
      return { ...status, url: options.url }
    },
    sentIds() {
      pruneRecords(now(), true)
      return sentIds
    },
    recentSends(chatKey) {
      pruneRecords(now(), true)
      return takeLast(records.filter(record => record.chatKey === chatKey), recentSendMax)
    },
    selfInfo() {
      return selfInfo.read()
    },
    ask(action, params) {
      return ask(action, params)
    },
    useSendGuard(check) {
      sendGuard = check
    },
    useProactiveSendQuota(provide) {
      proactiveSendQuota = provide
    },
  }
}
