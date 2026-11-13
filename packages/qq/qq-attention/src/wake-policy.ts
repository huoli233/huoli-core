// 唤醒规则：只执行模型自己设过的休息与收尾，现场事实交给提示词

import type { AttentionSignals } from './select.ts'
import type { AttentionState } from './types.ts'

/** 唤醒规则要用的组合设置 */
export interface GroupWakePolicy {
  /** 定时休息期间好友私聊是否仍能叫醒模型 */
  privateWakeWhileTimedRest?: boolean
  /** 完整自主模式仍把普通群消息交给模型判断 */
  ambientAll?: boolean
}

/** 当前消息的结构化字段 */
export interface WakeMessage {
  chatKey: string
  senderId: string
  text: string
  at: number
  atMe?: boolean
  replyToBot?: boolean
  isPoke?: boolean
}

/** 一次唤醒判断 */
export interface WakeDecision {
  allow: boolean
  reason: string
}

function hardDirect(message: WakeMessage): boolean {
  return message.chatKey.startsWith('private:')
    || message.atMe === true
    || message.replyToBot === true
    || message.isPoke === true
}

// 名字与问句只能由模型读懂，设了这两项就把判断交给模型
function triggerAllows(state: AttentionState, message: WakeMessage): boolean {
  const triggers = state.triggers
  if (triggers.anyMessage !== false) return true
  if (triggers.atMention === true && message.atMe === true) return true
  if (triggers.poke === true && message.isPoke === true) return true
  if (triggers.speakerIds?.includes(message.senderId) === true) return true
  return triggers.nameMention === true || triggers.question === true
}

/**
 * 判断这条消息是否应该进入会话
 * @param state 当前聊天的唤醒状态
 * @param message 当前消息
 * @param policy 组合设置
 * @param now 当前时刻
 * @returns 是否唤醒与原因
 */
export function shouldWake(
  state: AttentionState,
  message: WakeMessage,
  signals: AttentionSignals | undefined,
  policy: GroupWakePolicy = {},
  now = Date.now(),
  store?: { append(event: { type: 'reopen'; chatKey: string; at: number }): void },
): WakeDecision {
  void signals
  const directedGroup = message.chatKey.startsWith('group:')
    && (message.atMe === true || message.replyToBot === true || message.isPoke === true)
  if (state.wakeMode === 'timed' && state.wakeUntil !== null && now < state.wakeUntil) {
    const privateWake = message.chatKey.startsWith('private:') && policy.privateWakeWhileTimedRest === true
    if (!privateWake && !directedGroup) return { allow: false, reason: 'timed_rest' }
  }
  if (hardDirect(message)) return { allow: true, reason: 'direct' }
  if (state.closedAt !== null && policy.ambientAll === true && state.triggers.anyMessage !== false) {
    store?.append({ type: 'reopen', chatKey: message.chatKey, at: now })
    return { allow: true, reason: 'ambient_all' }
  }
  if (state.closedAt !== null) {
    return state.triggers.speakerIds?.includes(message.senderId) === true
      ? { allow: true, reason: 'closed_speaker' }
      : { allow: false, reason: 'conversation_closed' }
  }
  if (policy.ambientAll === true && state.triggers.anyMessage !== false) return { allow: true, reason: 'ambient_all' }
  const triggers = state.triggers
  if (state.wakeMode === 'infinite' && triggers.anyMessage === false
    && triggers.atMention === false && triggers.nameMention === false
    && triggers.question === false && triggers.poke === false
    && (triggers.speakerIds?.length ?? 0) === 0) {
    return { allow: false, reason: 'wake_trigger_required' }
  }
  return triggerAllows(state, message)
    ? { allow: true, reason: 'trigger' }
    : { allow: false, reason: 'wake_trigger_miss' }
}
