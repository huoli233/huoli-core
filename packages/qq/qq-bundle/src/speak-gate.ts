// 开口前的关卡：只拦「这会儿不合适」，不拦「没人叫我」这类主动开口

import { shouldSpeak, shouldStop, type SpeakFacts } from '@huoli/huoli-qq-attention'

/** 会让主动开口等一等的场合；累与场面都由主动那一层自己判，不在这里重复 */
const BAD_MOMENT: readonly string[] = ['silenced', 'cooldown']

/** 判一次要看的现场，比关注层那份少几个字段 */
export interface SpeakInput {
  /** 这个会话是不是私聊 */
  isPrivate: boolean
  /** 场面：几个人、上一条隔了多久、最近一分钟多少条 */
  ambient: SpeakFacts['ambient']
  /** 累的程度 */
  fatigueLevel: number
  /** 上次开口离现在多久，没说过给 null */
  sinceSelfSpokeMs: number | null
}

/** 一篇收件箱记录里够判场面的一条 */
export interface RecentLine {
  /** 谁说的 */
  senderId: string
  /** 什么时候说的 */
  at: number
}

/**
 * 从最近的记录里算场面
 * @param recent - 收件箱最近若干条
 * @param at - 现在
 * @returns 几个人、上一条隔了多久、最近一分钟多少条
 */
export function ambientOf(recent: readonly RecentLine[], at: number): SpeakFacts['ambient'] {
  const humans = recent.filter(line => line.senderId !== '')
  const last = humans.reduce<number | null>((newest, line) => (newest === null || line.at > newest ? line.at : newest), null)
  const inMinute = humans.filter(line => at - line.at >= 0 && at - line.at <= 60_000).length
  return {
    humanCount: new Set(humans.map(line => line.senderId)).size,
    lastHumanAgeMs: last === null ? null : Math.max(0, at - last),
    speakingRate: inMinute,
  }
}

/**
 * 这会儿该不该让她主动开口
 * @param input - 现场
 * @returns 要等的话给出理由码，可以开口时给 undefined
 */
export function speakVetoOf(input: SpeakInput): string | undefined {
  const verdict = shouldSpeak({
    // 主动开口本身就没人在叫她，这两个字段按「没有」填
    directed: { at: false, poke: false, isPrivate: input.isPrivate, replyToBot: false },
    named: false,
    ambient: input.ambient,
    fatigueLevel: input.fatigueLevel,
    sinceSelfSpokeMs: input.sinceSelfSpokeMs,
    silenced: false,
  })
  if (verdict.speak) return undefined
  // 没人叫她不算拦：她本来就可以自己开一句
  if (verdict.why === 'notAddressed') return undefined
  return BAD_MOMENT.includes(verdict.why) ? verdict.why : undefined
}

/**
 * 判「发到第几条就停」的那个函数
 * @param budget - 这一轮最多几条
 * @param body - 当前身体，没接上就给 undefined
 * @returns 给定已经发了几条，回答要不要停
 */
export function stopNowOf(
  budget: number,
  body: { anger?: number; negative_heat?: number } | undefined,
): (sent: number) => boolean {
  // 张力只看火气与负面热度：这两样高的时候先闭嘴，不跟着对着吵
  const tension = body === undefined ? 0 : Math.min(1, (body.anger ?? 0) * 0.6 + (body.negative_heat ?? 0) * 0.4)
  return sent => shouldStop({ spoken: sent, budget: Math.max(1, budget), ignoredStreak: 0, tension, silenced: false }).stop
}
