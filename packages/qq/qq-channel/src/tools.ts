// 三个发送工具：说一句、给个表情回应、发一条动态

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import { POST_LEVELS } from '@huoli/huoli-qq-self'
import type { ChannelStatus, OutboundEvent } from './events.ts'
import type { OutboundVerdict } from './outbound.ts'
import type { PostFacts, PostResult } from './post.ts'

/** 工具要用到的东西 */
export interface ChannelToolDeps {
  status: () => ChannelStatus
  send: (text: string, chatKey: string) => Promise<{ ok: boolean; messageId?: string; code?: string; reason?: string }>
  react: (messageId: string, emoji: string) => Promise<{ ok: boolean; code?: string; reason?: string }>
  /** 按这一轮的条数上限把一段话切成几条，连着条与条之间的间隔 */
  split: (text: string, maxParts: number) => { parts: string[]; gapsMs: number[] }
  /** 这一轮最多几条，拿不到上限时是最紧的一档 */
  cap: () => number
  spend: (text: string) => void
  allow: (text: string) => { ok: boolean; code?: string; reason?: string; hint?: string }
  /** 发之前过一遍出站体检 */
  inspect: (chatKey: string, text: string) => OutboundVerdict
  /** 真的发出去一条之后记一笔 */
  account: (at: number) => void
  /** 把这一路发生的事报给外面，只报事实 */
  report: (event: OutboundEvent) => void
  /** 发一条动态，级别、体检、冷却与额度全由发布入口那边判 */
  publish: (text: string, facts: PostFacts) => Promise<PostResult>
}

// 拒绝时抛错
function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

// 把下次什么时候说进提示里
function nextStep(verdict: { hint?: string; retryAt?: number }): string {
  const hint = verdict.hint ?? '过一会儿再说'
  if (verdict.retryAt === undefined) return hint
  const date = new Date(verdict.retryAt)
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${hint}（${clock} 之后再来）`
}

// 取这次调用属于哪个会话
function chatKeyOf(exec: { agent?: { id: string } }): string {
  const id = exec.agent?.id
  if (id === undefined || id === '') refuse('channel.no_chat', '这次调用没有会话身份', '从带会话的入口调用工具')
  return id
}

// 停一会儿
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms))
    timer.unref()
  })
}

// 取工具参数里的文本，空串或缺失都拒绝
function textArg(value: unknown, emptyCode: string, emptyReason: string, emptyHint: string): string {
  if (typeof value !== 'string' || value.trim() === '') refuse(emptyCode, emptyReason, emptyHint)
  return value.trim()
}

/**
 * 注册发送工具
 * @param ctx - 运行环境
 * @param deps - 要用到的东西
 */
export function registerChannelTools(ctx: Context, deps: ChannelToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'qq_send_message',
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
      const openedAt = Date.now()
      deps.report({ kind: 'attempt', at: openedAt, chatKey, count: 1 })
      const text = textArg(args.text, 'channel.empty', '没话可说', '要发就写点东西，不说就别调这个工具')
      if (!deps.status().connected) refuse('channel.offline', '现在没连上 QQ', '等连上再发，或者先不发作罢')

      const inspection = deps.inspect(chatKey, text)
      if (!inspection.ok) {
        deps.report({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...inspection.code === undefined ? {} : { code: inspection.code }, ...inspection.retryAt === undefined ? {} : { retryAt: inspection.retryAt } })
        refuse(inspection.code ?? 'outbound.blocked', inspection.reason ?? '现在不能发', nextStep(inspection))
      }

      const verdict = deps.allow(text)
      if (!verdict.ok) {
        const code = verdict.code ?? 'channel.blocked'
        deps.report({ kind: 'blocked', at: Date.now(), chatKey, count: 0, code })
        refuse(code, verdict.reason ?? '现在不能发', nextStep(verdict))
      }

      const planned = deps.split(text, deps.cap())
      const sent: string[] = []
      for (const [at, part] of planned.parts.entries()) {
        const result = await deps.send(part, chatKey)
        if (!result.ok) {
          // 已经发出去的不撤也不再发一遍，只把发了几条、卡在第几条报出去
          if (sent.length > 0) deps.report({ kind: 'sent', at: Date.now(), chatKey, count: sent.length })
          deps.report({ kind: 'blocked', at: Date.now(), chatKey, count: 0, code: result.code ?? 'channel.send_failed' })
          const stuck = `已发 ${sent.length} 条，卡在第 ${at + 1} 条：${result.reason ?? '发送失败'}`
          refuse(result.code ?? 'channel.send_failed', stuck, '换一句短点的，或者等一下再发')
        }
        const moment = Date.now()
        deps.spend(part)
        deps.account(moment)
        sent.push(result.messageId ?? '')
        const gap = planned.gapsMs[at]
        if (gap !== undefined) await sleep(gap)
      }
      deps.report({ kind: 'sent', at: Date.now(), chatKey, count: planned.parts.length })
      return { parts: planned.parts.length, messageIds: sent }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_send_reaction',
    description: '给某条消息一个表情回应，不用说整句。想表示看到了、笑一下、赞一下的时候用。',
    parameters: {
      messageId: { type: 'string', description: '要回应的那条消息编号。' },
      emoji: { type: 'string', description: '表情编号，比如 128077 是赞。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      deps.report({ kind: 'attempt', at: Date.now(), chatKey, count: 1 })
      const messageId = textArg(args.messageId, 'channel.no_target', '没说是哪条消息', '从消息列表里拿编号')
      if (!deps.status().connected) refuse('channel.offline', '现在没连上 QQ', '等连上再说')
      const emoji = textArg(args.emoji, 'channel.no_emoji', '没给表情', '给一个表情编号')
      const result = await deps.react(messageId, emoji)
      if (!result.ok) refuse(result.code ?? 'channel.react_failed', result.reason ?? '回应失败', '当作没看到，继续聊别的')
      return { ok: true, messageId }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_publish_post',
    description: '发一条动态，群里的人都看得见，比在这个会话里说一句更公开。既定话题的日常、吃喝这类用 routine；新话题、想公开讲的用 public。级别、体检、冷却与当天额度都由发布入口判，被拒就照它给的码与下一步办，别换个说法重发同一条。只想回一句，或者拿不准该不该公开，就别用它。',
    parameters: {
      text: { type: 'string', description: '要发出去的正文，空的不发。' },
      kind: { type: 'string', enum: POST_LEVELS, description: 'routine 是既定话题的日常动态，public 是要公开讲的新内容。' },
      topic: { type: 'string', description: '例行动态要说清属于哪一类话题，比如日常、吃喝；公开的新内容可以不填。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const text = typeof args.text === 'string' ? args.text : ''
      const kind = typeof args.kind === 'string' ? args.kind : ''
      const topic = typeof args.topic === 'string' && args.topic !== '' ? args.topic : undefined
      // 话题没报就不带这个字段，让发布入口按"缺话题"拒
      const facts = topic === undefined ? { chatKey, level: kind } : { chatKey, level: kind, topic }
      const result = await deps.publish(text, facts)
      if (!result.ok) refuse(result.code ?? 'post.blocked', result.reason ?? '这条动态没发出去', nextStep(result))
      return { ok: true, at: result.at ?? 0, messageId: result.delivery?.messageId ?? '' }
    },
  }))
}
