// 安静的运行时接线：发送硬闸、工具注册与入站唤醒判定

import type { Context } from '@huoli/cordis'
import type { QqChannelSeam } from '@huoli/huoli-qq-channel'
import { isQuietWakeUp, type SelfQuiet } from './self-quiet.ts'
import { registerSelfQuietTools } from './self-quiet-tools.ts'

/** 接线要用的东西 */
export interface SelfQuietRuntimeDeps {
  ctx: Context
  quiet: SelfQuiet
  channel: QqChannelSeam | undefined
  minMinutes: number
  maxMinutes: number
  ownerChatKey?: string
  ownerUnrestricted?: boolean
  note(event: string, chatKey: string, detail?: Record<string, unknown>): void
}

/**
 * 把安静状态接到发送硬闸与工具上。
 * @param deps 上下文、安静状态、通道与时长
 */
export function installSelfQuietRuntime(deps: SelfQuietRuntimeDeps): void {
  const { ctx, quiet } = deps
  // 安静期间所有外发都硬拦：不靠模型自觉，也不靠提示词
  if (typeof ctx.tools.guard === 'function') {
    ctx.effect(() => ctx.tools.guard((exec) => {
      if (quiet.remainingMs() === 0 || exec.name === 'qq_resume_speaking') return undefined
      const chatKey = String(exec.agent?.id ?? '')
      if (deps.ownerUnrestricted === true && deps.ownerChatKey !== undefined
        && deps.ownerChatKey !== '' && chatKey === deps.ownerChatKey) return undefined
      if (!/^qq_(send|reply|publish|comment|deliver|write_farewell|request_confirm|confirm_action)/u.test(exec.name)) return undefined
      const left = Math.max(1, Math.round(quiet.remainingMs() / 60_000))
      return `QQ_SELF_QUIET: 还在安静，剩 ${left} 分钟；NEXT: end_turn|qq_stay_quiet|do_not_call_any_send_tool`
    }))
  }
  ctx.effect(() => registerSelfQuietTools(ctx, {
    quiet,
    minMinutes: deps.minMinutes,
    maxMinutes: deps.maxMinutes,
    canDeclare: chatKey => chatKey.startsWith('group:'),
    note: (event, chatKey, detail) => { deps.note(event, chatKey, detail) },
    announce: async (chatKey, text) => {
      if (deps.channel === undefined) return { ok: false }
      const sent = await deps.channel.send(text, chatKey, true)
      return { ok: sent.ok }
    },
  }))
}

/**
 * 安静期间一条入站消息该不该跳过模型，或者明确唤醒。
 * @param quiet 安静状态
 * @param message 入站消息
 * @param note 诊断出口
 * @returns 该跳过时返回真；唤醒时顺手解除安静但仍让消息进模型
 */
export function shouldSkipForSelfQuiet(
  quiet: SelfQuiet,
  message: { chatKey: string; text: string; atMe?: boolean; replyToBot?: boolean },
  note: (event: string, chatKey: string, detail?: Record<string, unknown>) => void,
): boolean {
  if (quiet.remainingMs() === 0) return false
  const directed = message.atMe === true || message.replyToBot === true || message.chatKey.startsWith('private:')
  if (directed) quiet.noteDirected()
  if (isQuietWakeUp(message.text, directed)) {
    quiet.resume()
    note('self_quiet_wake_up', message.chatKey, { text: message.text.slice(0, 60) })
    return false
  }
  note('self_quiet_incoming_skipped', message.chatKey, { directed })
  return true
}
