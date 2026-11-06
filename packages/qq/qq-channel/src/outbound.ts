// 发出去之前先看一遍：允许的名单、静默时段、长度、敏感词、每分钟条数，只拦不说该不该说

import { endOfQuiet, inQuietHours } from '@huoli/huoli-qq-proactive'

/** 出站体检的默认值表 */
export const OUTBOUND_DEFAULTS = {
  /** 允许发声的群编号，空表示不限制 */
  allowGroups: [] as readonly string[],
  /** 允许发声的人编号，空表示不限制 */
  allowPeople: [] as readonly string[],
  /** 一条最多几个字 */
  maxChars: 300,
  /** 一分钟最多几条 */
  perMinute: 6,
  /** 条数往回看的窗口 */
  windowMs: 60_000,
  /** 上一条与这一条之间至少隔多久，毫秒，默认 0 不拦 */
  sendGapMs: 0,
  /** 静默时段从几点开始 */
  quietStart: '23:30',
  /** 静默时段到几点结束 */
  quietEnd: '07:30',
  /** 敏感词，命中就拦，只用来拦 */
  banned: [] as readonly string[],
  /** 没命中就必定放行、命中后给的下次时间 */
  retryMs: 60_000,
}

/** 体检要用的参数 */
export type OutboundTuning = typeof OUTBOUND_DEFAULTS

/** 这次能不能发出去，不行就带码、可读原因与下次时间 */
export interface OutboundVerdict {
  ok: boolean
  code?: string
  reason?: string
  hint?: string
  /** 下次可以再试的时刻 */
  retryAt?: number
}

/** 体检要看的东西 */
export interface OutboundInput {
  /** 要发去哪个会话 */
  chatKey: string
  /** 要发的话 */
  text: string
}

/** 体检本身 */
export interface OutboundCheck {
  check(input: OutboundInput): OutboundVerdict
  record(at: number): void
}

// 会话键拆成哪一类、谁的号
function splitChatKey(chatKey: string): { kind: 'group' | 'private'; id: string } | null {
  const at = chatKey.indexOf(':')
  if (at <= 0) return null
  const kind = chatKey.slice(0, at)
  const id = chatKey.slice(at + 1)
  if (id === '') return null
  if (kind === 'group' || kind === 'private') return { kind, id }
  return null
}

/**
 * 建一个出站体检
 * @param tuning - 参数，不给就用默认值表
 * @param now - 现在的时间
 * @returns 体检
 */
export function createOutboundCheck(
  tuning: OutboundTuning = OUTBOUND_DEFAULTS,
  now: () => number = () => Date.now(),
): OutboundCheck {
  let sent: number[] = []

  // 窗口外的记一笔不再算数
  const prune = (at: number): void => {
    const since = at - tuning.windowMs
    const kept = sent.filter(stamp => stamp > since)
    if (kept.length !== sent.length) sent = kept
  }

  return {
    check(input) {
      const at = now()
      const where = splitChatKey(input.chatKey)
      if (where === null) {
        return { ok: false, code: 'outbound.bad_chat', reason: '这个会话键认不出来', hint: '用 group:编号 或 private:编号', retryAt: at + tuning.retryMs }
      }
      const listed = where.kind === 'group' ? tuning.allowGroups : tuning.allowPeople
      if (listed.length > 0 && !listed.includes(where.id)) {
        const reason = where.kind === 'group' ? '这个群不在名单里' : '这个人不在名单里'
        return { ok: false, code: 'outbound.not_allowed', reason, hint: '等名单加上这个编号再来', retryAt: at + tuning.retryMs }
      }
      if (inQuietHours(at, tuning.quietStart, tuning.quietEnd)) {
        return { ok: false, code: 'outbound.quiet', reason: '现在是静默时段', hint: '等静默时段过去再说', retryAt: endOfQuiet(at, tuning.quietEnd) }
      }
      if (input.text.length > tuning.maxChars) {
        const reason = `这句话超过 ${tuning.maxChars} 字`
        return { ok: false, code: 'outbound.too_long', reason, hint: '压短一点再发', retryAt: at + tuning.retryMs }
      }
      const hit = tuning.banned.find(word => word !== '' && input.text.includes(word))
      if (hit !== undefined) {
        return { ok: false, code: 'outbound.banned', reason: '这句话里有个词不能说', hint: '换个说法', retryAt: at + tuning.retryMs }
      }
      prune(at)
      if (sent.length >= tuning.perMinute) {
        const oldest = sent[0] ?? at
        return { ok: false, code: 'outbound.rate', reason: '这一分钟发得太密', hint: '歇一分钟再发', retryAt: oldest + tuning.windowMs }
      }
      // 上一条与这一条之间留一点空：连发几条像人在打字，不是一口气刷出来
      const last = sent.at(-1)
      if (last !== undefined && tuning.sendGapMs > 0 && at - last < tuning.sendGapMs) {
        return {
          ok: false,
          code: 'outbound.too_soon',
          reason: '上一条刚发出去',
          hint: '隔一会儿再说，别一口气连着发',
          retryAt: last + tuning.sendGapMs,
        }
      }
      return { ok: true }
    },
    record(at) {
      prune(at)
      sent = [...sent, at]
    },
  }
}
