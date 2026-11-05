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

/** 一分钟的毫秒数，单位换算，不随配置改 */
export const MS_PER_MINUTE = 60_000

/** 一段对话至少聊多久才算数 */
export const MIN_RUN_MS = MS_PER_MINUTE

/** 只按输入截出一条收尾事实，不碰落盘 */
export type CloseFactsInput = Omit<CloseInput, 'at'> & { at: number }

/** 渲染收尾事实要用的东西 */
export interface ContinuityFactsInput {
  note?: CloseNote
  outcome?: Outcome
  reflections?: readonly Reflection[]
}

/**
 * 截出一条收尾事实，装配层可直接拿它渲染
 * @param input - 会话、结束点、下次接法、水位与时刻
 * @returns 只含事实的一条收尾
 */
export function closeFacts(input: CloseFactsInput): CloseNote {
  return {
    chatKey: input.chatKey,
    closedAt: input.at,
    summary: input.summary.slice(0, NOTE_MAX_CHARS),
    nextOpening: input.nextOpening.slice(0, NOTE_MAX_CHARS),
    throughSeq: Number(input.throughSeq) || 0,
  }
}

/**
 * 把收尾、成色与事后想法写成一段中文事实
 * @param input - 收尾、成色与回想，都可以不给
 * @returns 一段中文事实，什么都没有时返回空串
 */
export function renderContinuityFacts(input: ContinuityFactsInput = {}): string {
  const lines: string[] = []
  if (input.note !== undefined) {
    lines.push(`上次聊到 ${new Date(input.note.closedAt).toLocaleString('zh-CN', { hour12: false })}`)
    if (input.note.summary !== '') lines.push(`收在：${input.note.summary}`)
    if (input.note.nextOpening !== '') lines.push(`下次可以：${input.note.nextOpening}`)
  }
  if (input.outcome !== undefined) lines.push(describeOutcome(input.outcome))
  for (const item of input.reflections ?? []) lines.push(`事后想过：${item.text}`)
  return lines.join('\n')
}

/**
 * 把聊天记录算成一个粗略成色
 * @param messages - 消息
 * @param now - 现在的时间
 * @returns 处理结果
 */
export function evaluateOutcome(messages: Array<{ self?: boolean; at: number }>, now: number): Outcome {
  const humans = messages.filter(item => item.self !== true)
  const selves = messages.filter(item => item.self === true)
  const first = messages[0]
  const last = messages[messages.length - 1]
  const runMinutes = first !== undefined && last !== undefined ? Math.max(0, Math.round((last.at - first.at) / MS_PER_MINUTE)) : 0
  const lastSelfAt = selves.reduce((acc, item) => Math.max(acc, item.at), 0)
  const gotReply = lastSelfAt > 0 && humans.some(item => item.at > lastSelfAt)
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
