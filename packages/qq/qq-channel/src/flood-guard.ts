// 同一个人连着刷、她被一条条带着回：这里只在发送边界上加一层物理保护，不替模型判断该不该说

/** 刷屏保护的参数 */
export interface FloodTuning {
  /** 同一人连续触发到几条就算连着刷 */
  floodBurstCount: number
  /** 连发往回看多久 */
  floodBurstWindowMs: number
  /** 同一个发送者已经回过几条 */
  floodReplyPerSender: number
  /** 回条数往回看多久 */
  floodReplyWindowMs: number
  /** 关掉就不管连发，别的关卡照旧 */
  floodGuardEnabled: boolean
}

/** 这一条该挡还是照发：挡只挡这一次，原因只说条数 */
export interface FloodVerdict {
  /** 哪一类：连发还是回太多 */
  code: string
  /** 说清是多少条 */
  reason: string
  /** 下一步怎么办 */
  hint: string
  /** 到这一刻就可以再发 */
  retryAt: number
}

/** 一条入站触发，只带会话、发送者与时刻，不带正文 */
export interface FloodTrigger {
  chatKey: string
  senderId: string
  at: number
  /** 自己发出去的不算别人触发 */
  selfSent?: boolean
}

/** 刷屏保护 */
export interface FloodGuard {
  /** 记一条入站触发 */
  saw(trigger: FloodTrigger): void
  /** 这一条能不能发；能发给 undefined */
  inspect(input: { chatKey: string; at: number; senderId?: string }): FloodVerdict | undefined
  /** 确实发出去了才记一笔 */
  noteReply(chatKey: string, at: number): void
  /** 这个会话最近说话的是谁 */
  lastSenderOf(chatKey: string): string | undefined
}

/** 被挡下时给的那句下一步 */
export const FLOOD_HINT = '先接一句最要紧的，或者等他停一下'

/** 一个发送者在某个会话里的两条记录 */
interface SenderLog {
  /** 他连着说了几句的时刻 */
  triggers: number[]
  /** 她回过他几条的时刻 */
  replies: number[]
}

// 只留窗口里的那些时刻
function keepAfter(stamps: number[], floor: number): number[] {
  const kept = stamps.filter(stamp => stamp > floor)
  stamps.splice(0, stamps.length, ...kept)
  return stamps
}

/**
 * 建一个刷屏保护
 * @param tuning - 参数，只认条数与窗口
 * @param now - 现在的时间
 * @returns 刷屏保护
 */
export function createFloodGuard(tuning: FloodTuning, now: () => number = Date.now): FloodGuard {
  const logs = new Map<string, Map<string, SenderLog>>()
  const lastSenders = new Map<string, string>()

  const logOf = (chatKey: string, senderId: string): SenderLog => {
    const kept = logs.get(chatKey)
    const perSender = kept ?? new Map<string, SenderLog>()
    if (kept === undefined) logs.set(chatKey, perSender)
    const found = perSender.get(senderId)
    if (found !== undefined) return found
    const created: SenderLog = { triggers: [], replies: [] }
    perSender.set(senderId, created)
    return created
  }

  // 两条都空了就把这个人从表里拿掉，长时间跑不会越攒越多
  const compact = (chatKey: string, senderId: string, log: SenderLog): void => {
    if (log.triggers.length > 0 || log.replies.length > 0) return
    const perSender = logs.get(chatKey)
    if (perSender === undefined) return
    perSender.delete(senderId)
    if (perSender.size === 0) logs.delete(chatKey)
  }

  const senderOf = (chatKey: string, senderId?: string): string | undefined => {
    if (senderId !== undefined && senderId !== '') return senderId
    const last = lastSenders.get(chatKey)
    return last === undefined || last === '' ? undefined : last
  }

  return {
    saw(trigger) {
      if (trigger.selfSent === true || trigger.senderId === '') return
      lastSenders.set(trigger.chatKey, trigger.senderId)
      const log = logOf(trigger.chatKey, trigger.senderId)
      log.triggers.push(trigger.at)
      keepAfter(log.triggers, now() - tuning.floodBurstWindowMs)
      keepAfter(log.replies, now() - tuning.floodReplyWindowMs)
      compact(trigger.chatKey, trigger.senderId, log)
    },
    inspect(input) {
      if (!tuning.floodGuardEnabled) return undefined
      const senderId = senderOf(input.chatKey, input.senderId)
      if (senderId === undefined) return undefined
      const log = logs.get(input.chatKey)?.get(senderId)
      if (log === undefined) return undefined
      const triggers = keepAfter(log.triggers, input.at - tuning.floodBurstWindowMs)
      if (triggers.length >= tuning.floodBurstCount) {
        const oldest = triggers[triggers.length - tuning.floodBurstCount] ?? input.at
        return {
          code: 'outbound.flood_burst',
          reason: `这个人刚连发了 ${triggers.length} 条`,
          hint: FLOOD_HINT,
          retryAt: oldest + tuning.floodBurstWindowMs,
        }
      }
      const replies = keepAfter(log.replies, input.at - tuning.floodReplyWindowMs)
      if (replies.length >= tuning.floodReplyPerSender) {
        const oldest = replies[replies.length - tuning.floodReplyPerSender] ?? input.at
        return {
          code: 'outbound.flood_reply',
          reason: `你已经回过他 ${replies.length} 条`,
          hint: FLOOD_HINT,
          retryAt: oldest + tuning.floodReplyWindowMs,
        }
      }
      compact(input.chatKey, senderId, log)
      return undefined
    },
    noteReply(chatKey, at) {
      const senderId = senderOf(chatKey)
      if (senderId === undefined) return
      const log = logOf(chatKey, senderId)
      log.replies.push(at)
      keepAfter(log.triggers, at - tuning.floodBurstWindowMs)
      keepAfter(log.replies, at - tuning.floodReplyWindowMs)
    },
    lastSenderOf(chatKey) {
      return senderOf(chatKey)
    },
  }
}
