// 两个记忆工具：记一条、找几条

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import { initialImportance } from '@huoli/huoli-qq-policy'
import type { MemoryStore } from './store.ts'
import { newId, type MemoryItem, type MemoryLayer } from './types.ts'
import { recall, renderRecall } from './recall.ts'
import { touch } from './sweep.ts'

// 工具要用到的东西
export interface MemoryToolDeps {
  store: MemoryStore
  scopeOf: (chatKey: string) => string
}

// 拒绝时抛错，交给内核当工具失败
function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

// 取这次调用属于哪个会话
function chatKeyOf(exec: { agent?: { id: string } }): string {
  const id = exec.agent?.id
  if (id === undefined || id === '') refuse('memory.no_chat', '这次调用没有会话身份', '从带会话的入口调用工具')
  return String(id)
}

// 把传进来的层名换成正名
function layerOf(raw: unknown): MemoryLayer {
  const value = String(raw ?? '').trim()
  if (value === 'ephemeral' || value === 'episodic' || value === 'semantic' || value === 'private') return value
  return 'episodic'
}

// 注册两个记忆工具
export function registerMemoryTools(ctx: Context, deps: MemoryToolDeps): void {
  const { store } = deps

  ctx.tools.register(defineTool({
    name: 'memory_append',
    description: '记一件事。写具体的一句话，别写标题。同一句话不重复记；想不起来就不用记。',
    parameters: {
      text: { type: 'string', description: '要记住的那句话。' },
      layer: { type: 'string', description: '放哪一层：ephemeral 刚发生、episodic 这段经历、semantic 长期印象、private 私下的事。' },
      personId: { type: 'string', description: '跟谁有关的，可不填。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const text = String(args.text ?? '').trim()
      if (text.length < 2) refuse('memory.too_short', '内容太短', '写清一件事，至少几个字')
      if (text.length > 500) refuse('memory.too_long', '一条最多 500 字', '长事拆成几条记')

      const scope = deps.scopeOf(chatKey)
      const duplicated = store.all().some((item) => !item.forgotten && item.scope === scope && item.text === text)
      if (duplicated) refuse('memory.duplicate', '这条已经记过了', '换一条新的事')

      const layer = layerOf(args.layer)
      const now = Date.now()
      const item: MemoryItem = {
        id: newId(now),
        text,
        layer,
        scope,
        importance: initialImportance({
          scene: layer === 'private' ? 'private' : chatKey.startsWith('private:') ? 'private' : 'group',
          directed: false,
          emotional: 0,
        }),
        emotional: 0,
        clarity: 'vivid',
        recallCount: 0,
        at: now,
        lastSeenAt: now,
        forgotten: false,
        source: 'tool',
        ...args.personId !== undefined && String(args.personId).trim() !== '' ? { personId: String(args.personId).trim() } : {},
      }
      store.add(item)
      return { id: item.id, layer: item.layer, importance: item.importance }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_query',
    description: '找以前记过的事。给关键词比较准；找不到就是真没记过，别编。',
    parameters: {
      query: { type: 'string', description: '想找的关键词，可不填。' },
      limit: { type: 'number', description: '最多几条，默认 5。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const now = Date.now()
      const scope = deps.scopeOf(chatKey)
      const limit = Number.isInteger(args.limit) && args.limit !== undefined ? Math.max(1, args.limit) : 5
      const hits = recall(store, { query: String(args.query ?? ''), scope, limit, now })
      // 被找出来的记忆算被提起一次，可能重新变清楚
      for (const hit of hits) touch(store, hit.item.id, now)
      return {
        count: hits.length,
        text: renderRecall(hits),
        items: hits.map((hit) => ({ id: hit.item.id, text: hit.item.text, clarity: hit.item.clarity, at: hit.item.at })),
      }
    },
  }))
}
