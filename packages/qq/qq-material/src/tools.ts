// 两个念头工具：写一条惦记的事、用完了就删

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import type { ThoughtStore } from './thought.ts'

// 工具要用到的东西
export interface MaterialToolDeps {
  thoughts: ThoughtStore
}

// 拒绝时抛错
function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

// 取这次调用属于哪个会话
function chatKeyOf(exec: { agent?: { id: string } }): string {
  const id = exec.agent?.id
  if (id === undefined || id === '') refuse('material.no_chat', '这次调用没有会话身份', '从带会话的入口调用工具')
  return String(id)
}

// 注册两个念头工具
export function registerMaterialTools(ctx: Context, deps: MaterialToolDeps): void {
  const { thoughts } = deps

  ctx.tools.register(defineTool({
    name: 'write_thought',
    description: '把"想说还没说"的那句话记下来。写具体的一句，别写概括。说出去以后记得删掉。',
    parameters: {
      text: { type: 'string', description: '惦记着的那句话。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const text = String(args.text ?? '').trim()
      if (text.length < 2) refuse('material.too_short', '太短了', '写清一句具体的话')
      if (text.length > 200) refuse('material.too_long', '一条最多 200 字', '挑最要紧的那句')
      const item = thoughts.add(text, chatKey)
      return { id: item.id, text: item.text, expiresAt: item.expiresAt }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'drop_thought',
    description: '这件事已经说过了，或者不再惦记了，就把它删掉。',
    parameters: {
      id: { type: 'string', description: '要删的那条编号。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const id = String(args.id ?? '').trim()
      if (id === '') refuse('material.no_id', '没给编号', '用 write_thought 返回的 id')
      const dropped = thoughts.drop(id)
      if (!dropped) refuse('material.not_found', '没找到这条', '先看看还有哪些惦记的事')
      return { dropped: true }
    },
  }))
}
