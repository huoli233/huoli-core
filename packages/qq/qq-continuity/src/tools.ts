// 一个工具：聊完之后想一想这段怎么样

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import type { Reflection } from './close.ts'
import type { ContinuityStore } from './store.ts'

/** 工具要用到的东西 */
export interface ContinuityToolDeps {
  store: ContinuityStore
}

// 拒绝时抛错
function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

// 取这次调用属于哪个会话
function chatKeyOf(exec: { agent?: { id: string } }): string {
  const id = exec.agent?.id
  if (id === undefined || id === '') refuse('continuity.no_chat', '这次调用没有会话身份', '从带会话的入口调用工具')
  return String(id)
}

// 想法的几种说法
function kindOf(raw: unknown): Reflection['kind'] {
  const value = String(raw ?? '').trim()
  if (value === 'good' || value === 'awkward' || value === 'missed' || value === 'neutral') return value
  return 'neutral'
}

/**
 * 注册事后想想的工具
 * @param ctx - 运行环境
 * @param deps - 要用到的东西
 */
export function registerContinuityTools(ctx: Context, deps: ContinuityToolDeps): void {
  const { store } = deps

  ctx.tools.register(defineTool({
    name: 'note_reflection',
    description: '聊完之后想一想：这段怎么样，下次注意什么。写一句话就够，别写成总结。',
    parameters: {
      kind: { type: 'string', description: 'good 顺、awkward 别扭、missed 没接住、neutral 一般。' },
      text: { type: 'string', description: '想到的那句话。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const text = String(args.text ?? '').trim()
      if (text.length < 2) refuse('continuity.too_short', '太短了', '写一句具体的话')
      if (text.length > 300) refuse('continuity.too_long', '一条最多 300 字', '挑最要紧的那句')
      const item = store.addReflection(chatKey, kindOf(args.kind), text)
      return { id: item.id, kind: item.kind, text: item.text }
    },
  }))
}
