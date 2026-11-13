// 发出去之前先看一遍：名单、静默时段、内容里的路径与凭据、长度、敏感词、连发与围攻、每分钟条数，只拦不说该不该说

import { endOfQuiet, inQuietHours } from '@huoli/huoli-qq-proactive'
import { CONTENT_GUARD_DEFAULTS, secretKindOf, type ContentGuardTuning } from './content-guard.ts'
import { createFloodGuard, type FloodTrigger } from './flood-guard.ts'

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
  /** 同一个人连着触发到几条就算在刷：默认六条，连发六句以上是她被围攻的常见形态 */
  floodBurstCount: 6,
  /** 连发往回看多久：默认一分钟 */
  floodBurstWindowMs: 60_000,
  /** 同一个发送者已经回过几条：默认六条，正常一来一往很难在一段时间里回到第七条 */
  floodReplyPerSender: 6,
  /** 回条数往回看多久：默认三分钟 */
  floodReplyWindowMs: 180_000,
  /** 关掉就不管连发，别的关卡照旧；默认开 */
  floodGuardEnabled: true,
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

/**
 * 按小时与按天的配额由说话规矩一处判，体检只负责去问
 * 传进来的是正文：空正文不是文字消息，表情、戳一戳与语音各走各的账，不查这一档
 */
export interface OutboundQuotaPort {
  /** 这条正文现在还能不能发，不能就给码、原因与下次时刻 */
  allow(text: string, chatKey: string): { ok: boolean; code?: string; reason?: string; hint?: string; retryAt?: number }
}

/** 体检本身 */
export interface OutboundCheck {
  /** 检查普通出站消息，静默时段生效。 */
  check(input: OutboundInput): OutboundVerdict
  /** 检查入站消息触发的直接回复，跳过主动发送的时段、频率、刷屏与额度。 */
  checkReply(input: OutboundInput): OutboundVerdict
  /** 谁刚说过一句：只用来数连发，不带正文 */
  sawIncoming(trigger: FloodTrigger): void
  record(chatKey: string, at: number): void
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
 * @param guard - 内容闸参数，不给就用内容闸默认值表
 * @param quota - 按小时与按天配额的判据，不给就只查体检自己这一侧
 * @returns 体检
 */
export function createOutboundCheck(
  tuning: OutboundTuning = OUTBOUND_DEFAULTS,
  now: () => number = () => Date.now(),
  guard: ContentGuardTuning = CONTENT_GUARD_DEFAULTS,
  quota?: OutboundQuotaPort,
): OutboundCheck {
  const sent = new Map<string, number[]>()
  const flood = createFloodGuard(tuning, now)

  // 清掉过期记录，也移除已经没有记录的会话。
  const prune = (at: number): void => {
    const since = at - tuning.windowMs
    for (const [chatKey, records] of sent) {
      const kept = records.filter(stamp => stamp > since)
      if (kept.length === 0) sent.delete(chatKey)
      else if (kept.length !== records.length) sent.set(chatKey, kept)
    }
  }

  const inspect = (
    input: OutboundInput,
    enforceQuietHours: boolean,
    enforcePacing = true,
    enforceFlood = true,
    enforceQuota = true,
  ): OutboundVerdict => {
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
    if (enforceQuietHours && inQuietHours(at, tuning.quietStart, tuning.quietEnd)) {
      return { ok: false, code: 'outbound.quiet', reason: '现在是静默时段', hint: '等静默时段过去再说', retryAt: endOfQuiet(at, tuning.quietEnd) }
    }
    // 路径与凭据整条拦下：打码之后半句话更难解释，也说不清本来是什么
    const secret = secretKindOf(input.text, guard)
    if (secret !== undefined) {
      return {
        ok: false,
        code: 'outbound.secret',
        reason: `这句话里有${secret}，发给群里就收不回来了`,
        hint: '换个说法，别把路径或凭据带出来',
        retryAt: at + tuning.retryMs,
      }
    }
    if (input.text.length > tuning.maxChars) {
      const reason = `这句话超过 ${tuning.maxChars} 字`
      return { ok: false, code: 'outbound.too_long', reason, hint: '压短一点再发', retryAt: at + tuning.retryMs }
    }
    const hit = tuning.banned.find(word => word !== '' && input.text.includes(word))
    if (hit !== undefined) {
      return { ok: false, code: 'outbound.banned', reason: '这句话里有个词不能说', hint: '换个说法', retryAt: at + tuning.retryMs }
    }
    // 这一条挡在发送边界上：只挡这一次，理由只报条数，不带正文，也不判该不该说
    if (enforceFlood) {
      const flooded = flood.inspect({ chatKey: input.chatKey, at })
      if (flooded !== undefined) {
        return { ok: false, code: flooded.code, reason: flooded.reason, hint: flooded.hint, retryAt: flooded.retryAt }
      }
    }
    // 按小时与按天的配额只有说话规矩一处判，这里问一次就够，码与原因原样透传，不另算一遍
    if (enforceQuota && input.text !== '' && quota !== undefined) {
      const verdict = quota.allow(input.text, input.chatKey)
      if (!verdict.ok) {
        return {
          ok: false,
          ...verdict.code === undefined ? {} : { code: verdict.code },
          ...verdict.reason === undefined ? {} : { reason: verdict.reason },
          ...verdict.hint === undefined ? {} : { hint: verdict.hint },
          ...verdict.retryAt === undefined ? {} : { retryAt: verdict.retryAt },
        }
      }
    }
    if (enforcePacing) {
      prune(at)
      const records = sent.get(input.chatKey) ?? []
      if (records.length >= tuning.perMinute) {
        const oldest = records[0] ?? at
        return { ok: false, code: 'outbound.rate', reason: '这一分钟发得太密', hint: '歇一分钟再发', retryAt: oldest + tuning.windowMs }
      }
      // 上一条与这一条之间留一点空：连发几条像人在打字，不是一口气刷出来
      const last = records.at(-1)
      if (last !== undefined && tuning.sendGapMs > 0 && at - last < tuning.sendGapMs) {
        return {
          ok: false,
          code: 'outbound.too_soon',
          reason: '上一条刚发出去',
          hint: '隔一会儿再说，别一口气连着发',
          retryAt: last + tuning.sendGapMs,
        }
      }
    }
    return { ok: true }
  }

  return {
    check(input) {
      return inspect(input, true)
    },
    checkReply(input) {
      // 入站消息触发的直回只过安全与内容检查；主动开口的节奏由独立入口负责。
      return inspect(input, false, false, false, false)
    },
    sawIncoming(trigger) {
      flood.saw(trigger)
    },
    record(chatKey, at) {
      prune(at)
      sent.set(chatKey, [...sent.get(chatKey) ?? [], at])
      // 只有真的发出去了才记回他的条数，被拦下的那次不记账
      flood.noteReply(chatKey, at)
    },
  }
}
