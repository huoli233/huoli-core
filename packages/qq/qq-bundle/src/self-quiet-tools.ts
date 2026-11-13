// 安静与恢复：模型自己决定，工具落状态，发送层再兜底硬拦

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import type { SelfQuiet } from './self-quiet.ts'

/** 挂工具要用到的东西 */
export interface SelfQuietToolOptions {
  quiet: SelfQuiet
  minMinutes: number
  maxMinutes: number
  /** 当前会话能不能主动进入安静；私聊默认不允许 */
  canDeclare?: (chatKey: string) => boolean
  /** 声明真的送达后才落状态：发告知失败就不算安静 */
  announce(chatKey: string, text: string): Promise<{ ok: boolean }>
  note?: (event: string, chatKey: string, detail?: Record<string, unknown>) => void
}

function chatKeyOf(exec: { agent?: { id: string } }): string {
  const id = exec.agent?.id
  if (id === undefined || id === '') throw new Error('quiet.no_chat: 这次调用没有会话｜下一步: 从带会话的入口调用')
  return id
}

/**
 * 挂上安静与恢复两个工具
 * @param ctx 运行环境
 * @param options 安静状态、时长范围与告知出口
 * @returns 撤下工具的函数
 */
export function registerSelfQuietTools(ctx: Context, options: SelfQuietToolOptions): () => void {
  const offQuiet = ctx.tools.register(defineTool({
    name: 'qq_declare_quiet',
    description: `只有群里有人明确要你闭嘴、安静一阵或别说了才调用。私聊必须继续回应，不能拿安静逃避消息。先写一句自然告知，再进入跨群跨私聊的安静；期间所有消息都不回，只有对方直接说「可以说话了/回来吧/取消安静」才提前结束。时长 ${options.minMinutes}~${options.maxMinutes} 分钟，到期自动恢复。不要拿普通吐槽、玩笑、疲惫或低精力当闭嘴。`,
    parameters: {
      minutes: { type: 'number', description: `安静多少分钟，${options.minMinutes}~${options.maxMinutes}。` },
      reason: { type: 'string', description: '为什么安静，只给自己看，不发出去。' },
      announcement: { type: 'string', description: '发出去的那一句自然告知，短、像本人说话。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      if (options.canDeclare?.(chatKey) === false) {
        throw new Error('quiet.private_needs_reply: 私聊不能主动进入安静｜下一步: 用短句回应这条消息')
      }
      const minutes = typeof args.minutes === 'number' && Number.isFinite(args.minutes) ? args.minutes : options.minMinutes
      const reason = typeof args.reason === 'string' ? args.reason : ''
      const announcement = typeof args.announcement === 'string' ? args.announcement.trim() : ''
      if (announcement === '') {
        throw new Error('quiet.announcement_required: 进入安静前要写一句自己的告知｜下一步: announcement 填一句准备发出去的话，或者不进入安静')
      }
      const delivered = await options.announce(chatKey, announcement)
      if (!delivered.ok) {
        options.note?.('self_quiet_announce_failed', chatKey)
        return { ok: false, quiet: false, reason: '告知没发出去，这次不进入安静' }
      }
      const state = options.quiet.quiet(minutes, reason, chatKey)
      options.note?.('self_quiet_declared', chatKey, { minutes, until: state.until })
      return { ok: true, quiet: true, until: state.until, announcement }
    },
  }))

  const offResume = ctx.tools.register(defineTool({
    name: 'qq_resume_speaking',
    description: '只有在对方直接说「可以说话了/回来吧/取消安静」时才调用，提前结束安静。普通闲聊、别人转述、玩笑都不算。',
    parameters: {
      reason: { type: 'string', description: '为什么恢复，只给自己看。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const state = options.quiet.state()
      if (!state.active) return Promise.resolve({ ok: false, resumed: false, reason: '本来就没在安静' })
      options.quiet.resume()
      options.note?.('self_quiet_resumed_by_tool', chatKey, { reason: typeof args.reason === 'string' ? args.reason : '' })
      return Promise.resolve({ ok: true, resumed: true })
    },
  }))

  return () => { offQuiet(); offResume() }
}
