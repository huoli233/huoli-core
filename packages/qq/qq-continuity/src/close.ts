// 收尾与事后想想：这段聊到哪、下次怎么接、今天聊成了什么样

/** 一段聊完留下的东西 */
export interface CloseNote {
  chatKey: string
  closedAt: number
  summary: string
  nextOpening: string
  throughSeq: number
}

/** 事后想一想记下的一条 */
export interface Reflection {
  id: string
  chatKey: string
  at: number
  kind: 'good' | 'awkward' | 'missed' | 'neutral'
  text: string
}

/** 一段对话的粗略成色 */
export interface Outcome {
  humanMessages: number
  selfMessages: number
  gotReply: boolean
  runMinutes: number
}

/** 留一条收尾 */
export interface CloseInput {
  chatKey: string
  summary: string
  nextOpening: string
  throughSeq?: number
  at?: number
}

/** 收尾时留的话最多几个字 */
export const NOTE_MAX_CHARS = 200

/** 一段对话至少聊多久才算数 */
export const MIN_RUN_MS = 60_000

/**
 * 把聊天记录算成一个粗略成色
 * @param messages - 消息
 * @param now - 现在的时间
 * @returns 处理结果
 */
export function evaluateOutcome(messages: Array<{ self?: boolean; at: number }>, now: number): Outcome {
  const humans = messages.filter((item) => item.self !== true)
  const selves = messages.filter((item) => item.self === true)
  const first = messages[0]
  const last = messages[messages.length - 1]
  const runMinutes = first !== undefined && last !== undefined ? Math.max(0, Math.round((last.at - first.at) / 60_000)) : 0
  const lastSelfAt = selves.reduce((acc, item) => Math.max(acc, item.at), 0)
  const gotReply = lastSelfAt > 0 && humans.some((item) => item.at > lastSelfAt)
  void now
  return { humanMessages: humans.length, selfMessages: selves.length, gotReply, runMinutes }
}

/**
 * 成色换一句话
 * @param outcome - 聊成什么样
 * @returns 拼好的话
 */
export function describeOutcome(outcome: Outcome): string {
  if (outcome.selfMessages === 0) return '这段我没说话'
  if (outcome.gotReply) return `说了 ${outcome.selfMessages} 句，有人接`
  if (outcome.humanMessages === 0) return '说了几句，但没人接'
  return `说了 ${outcome.selfMessages} 句，没人接往下说`
}

/**
 * 收尾时该留下什么，给一句建议
 * @param outcome - 聊成什么样
 * @returns 处理结果
 */
export function suggestNote(outcome: Outcome): { summary: string; nextOpening: string } {
  if (outcome.gotReply) {
    return { summary: '聊得还算顺，有人接话', nextOpening: '下次接着这个话题往下问' }
  }
  if (outcome.humanMessages === 0) {
    return { summary: '这段基本是我在说', nextOpening: '下次等有人开口再接' }
  }
  return { summary: '这段没聊起来', nextOpening: '换个由头再说' }
}
