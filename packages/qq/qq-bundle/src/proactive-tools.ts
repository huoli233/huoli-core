// 主动开口的两个出口：攒着的候选摆给模型看，投递也由模型点名

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'

/** 摆给模型看的一条候选 */
export interface PendingLine {
  id: string
  why: string
  text: string
}

/** 投递回来的结论，只把这几个字段给模型 */
export interface DeliverReply {
  ok: boolean
  code?: string
  reason?: string
  hint?: string
}

/** 装配层要交给这一层的三件事 */
export interface ProactivePorts {
  /** 当前活跃会话是哪一个 */
  activeChatKey(): string
  /** 这个会话攒着还没投的候选 */
  pending(chatKey: string): readonly PendingLine[]
  /** 按编号投一条，正文可由模型改写 */
  deliver(chatKey: string, id: string, body?: string): Promise<DeliverReply>
}

/**
 * 没有候选时这段整段不出现，别让模型对着空表空转
 * @param ports - 候选来源
 * @param chatKey - 当前会话
 * @returns 提示词那一段，没候选时是空串
 */
export function pendingSection(ports: ProactivePorts, chatKey: string): string {
  const lines = chatKey === '' ? [] : ports.pending(chatKey)
  if (lines.length === 0) return ''
  const body = lines.map(line => `- ${line.id}｜${line.why}｜${line.text === '' ? '正文还没写' : line.text}`).join('\n')
  return `【攒着想说的】这些是攒住的由头，投不投、写什么由你定；不投就放着，不要为了清空而硬说。\n${body}`
}

/** 取一段非空正文，空串按没给算 */
function bodyOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 把发送那一路的拒绝原样转成投递的拒绝，缺的字段不补默认值
 * @param result - 发送那一路的结果
 * @param fallbackHint - 它自己没给下一步时用哪句
 * @returns 投递的拒绝
 */
export function refusalOf(
  result: { code?: string; reason?: string; hint?: string },
  fallbackHint: string,
): { ok: false; code?: string; reason?: string; hint: string } {
  return {
    ok: false,
    ...result.code === undefined ? {} : { code: result.code },
    ...result.reason === undefined ? {} : { reason: result.reason },
    hint: result.hint ?? fallbackHint,
  }
}

/**
 * 挂上主动开口的投递工具
 * @param ctx - 运行环境
 * @param ports - 候选来源与投递出口
 * @returns 撤下函数
 */
export function registerProactiveTools(ctx: Context, ports: ProactivePorts): () => void {
  // 测试用的最小上下文没有工具服务，这时只记一行，不让整条装配塌掉
  const tools = ctx.get('tools')
  if (tools === undefined) {
    ctx.logger('qq-bundle').warn('工具服务没装上，主动开口的投递工具不注册')
    return () => {}
  }
  return tools.register(defineTool({
    name: 'qq_deliver_proactive',
    description: '把攒着的某一条由头投出去：先摆给你看过才能投，正文可以自己改写。不发就别调这个工具。',
    parameters: {
      id: { type: 'string', description: '候选编号，就是提示词里那一行的第一段。' },
      body: { type: 'string', description: '改写后的正文，不填就用攒着的那句。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args): Promise<Record<string, string | boolean>> {
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      const chatKey = ports.activeChatKey()
      if (id === '') return { ok: false, code: 'bundle.no_id', reason: '没说是哪一条由头', hint: '把提示词里那一行的编号抄过来' }
      if (chatKey === '') return { ok: false, code: 'bundle.no_chat', reason: '现在没有活跃会话', hint: '等这个群里有人说话再投' }
      const result = await ports.deliver(chatKey, id, bodyOf(args.body))
      return {
        ok: result.ok,
        ...result.code === undefined ? {} : { code: result.code },
        ...result.reason === undefined ? {} : { reason: result.reason },
        ...result.hint === undefined ? {} : { hint: result.hint },
      }
    },
  }))
}
