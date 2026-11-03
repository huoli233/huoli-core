// 两个发送工具：说一句、给个表情回应

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import type { ChannelStatus } from './events.ts'

// 工具要用到的东西
export interface ChannelToolDeps {
  status: () => ChannelStatus
  send: (text: string, chatKey: string) => Promise<{ ok: boolean; messageId?: string; code?: string; reason?: string }>
  react: (messageId: string, emoji: string) => Promise<{ ok: boolean; code?: string; reason?: string }>
  split: (text: string) => { parts: string[]; gapsMs: number[] }
  spend: (text: string) => void
  allow: (text: string) => { ok: boolean; code?: string; reason?: string; hint?: string }
}

// 拒绝时抛错
function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

// 取这次调用属于哪个会话
function chatKeyOf(exec: { agent?: { id: string } }): string {
  const id = exec.agent?.id
  if (id === undefined || id === '') refuse('channel.no_chat', '这次调用没有会话身份', '从带会话的入口调用工具')
  return String(id)
}

// 停一会儿
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms))
    timer.unref?.()
  })
}

// 注册发送工具
export function registerChannelTools(ctx: Context, deps: ChannelToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'send_message',
    description: '在这个会话里说一句。长话会自动拆成几条发，中间隔一下。说完就结束这一轮，不用再补充说明。',
    parameters: {
      text: { type: 'string', description: '要说的话。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const text = String(args.text ?? '').trim()
      if (text === '') refuse('channel.empty', '没话可说', '要发就写点东西，不说就别调这个工具')
      if (!deps.status().connected) refuse('channel.offline', '现在没连上 QQ', '等连上再发，或者先不发作罢')

      const verdict = deps.allow(text)
      if (!verdict.ok) refuse(String(verdict.code ?? 'channel.blocked'), String(verdict.reason ?? '现在不能发'), String(verdict.hint ?? '过一会儿再说'))

      const planned = deps.split(text)
      const sent: string[] = []
      for (let at = 0; at < planned.parts.length; at += 1) {
        const part = planned.parts[at]!
        const result = await deps.send(part, chatKey)
        if (!result.ok) {
          refuse(String(result.code ?? 'channel.send_failed'), String(result.reason ?? '发送失败'), '换一句短点的，或者等一下再发')
        }
        deps.spend(part)
        sent.push(result.messageId ?? '')
        const gap = planned.gapsMs[at]
        if (gap !== undefined) await sleep(gap)
      }
      return { parts: planned.parts.length, messageIds: sent }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'send_reaction',
    description: '给某条消息一个表情回应，不用说整句。想表示看到了、笑一下、赞一下的时候用。',
    parameters: {
      messageId: { type: 'string', description: '要回应的那条消息编号。' },
      emoji: { type: 'string', description: '表情编号，比如 128077 是赞。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const messageId = String(args.messageId ?? '').trim()
      if (messageId === '') refuse('channel.no_target', '没说是哪条消息', '从消息列表里拿编号')
      if (!deps.status().connected) refuse('channel.offline', '现在没连上 QQ', '等连上再说')
      const emoji = String(args.emoji ?? '').trim()
      if (emoji === '') refuse('channel.no_emoji', '没给表情', '给一个表情编号')
      const result = await deps.react(messageId, emoji)
      if (!result.ok) refuse(String(result.code ?? 'channel.react_failed'), String(result.reason ?? '回应失败'), '当作没看到，继续聊别的')
      return { ok: true, messageId }
    },
  }))
}
