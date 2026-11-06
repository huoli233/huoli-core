// 两个记忆工具：记一条、找几条

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import { initialImportance, type ImportanceInput } from '@huoli/huoli-qq-policy'
import { DEFAULTS, type Tuning } from './defaults.ts'
import { layerOr } from './guard.ts'
import type { MemoryStore } from './store.ts'
import { newId, type MemoryItem, type MemoryLayer } from './types.ts'
import { renderRecall, type RecallHit } from './recall.ts'
import { touch } from './sweep.ts'

/** 工具要用到的东西 */
export interface MemoryToolDeps {
  store: MemoryStore
  scopeOf: (chatKey: string) => string
  sceneOf: (layer: MemoryLayer, chatKey: string) => ImportanceInput['scene']
  /** 召回回升与保护线从配置读 */
  tuning: Tuning
  /** 找记忆：配了嵌入服务就是带向量的那条路 */
  findAsync: (query: string, chatKey: string, limit?: number) => Promise<RecallHit[]>
}

// 拒绝时抛错，交给内核当工具失败
function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

// 取这次调用属于哪个会话
function chatKeyOf(exec: { agent?: { id: string } }): string {
  const id = exec.agent?.id
  if (id === undefined || id === '') refuse('memory.no_chat', '这次调用没有会话身份', '从带会话的入口调用工具')
  return id
}

// 把传进来的层名换成正名，认不出就按这段经历算
function layerOf(raw: unknown): MemoryLayer {
  return layerOr(raw) ?? 'episodic'
}

/**
 * 挂上两个记忆工具
 * @param ctx - 运行环境
 * @param deps - 要用到的东西
 */
export function registerMemoryTools(ctx: Context, deps: MemoryToolDeps): void {
  const { store } = deps

  ctx.tools.register(defineTool({
    name: 'memory_append',
    description: '记一件事。写具体的一句话，别写标题。同一句话不重复记；想不起来就不用记。',
    parameters: {
      text: { type: 'string', description: '要记住的那句话。' },
      layer: { type: 'string', description: '放哪一层：ephemeral 刚发生、episodic 这段经历、semantic 长期印象、private 私下的事。' },
      personId: { type: 'string', description: '跟谁有关的，可不填。' },
      directed: { type: 'boolean', description: '这话是不是直接对她说的，是就填 true。' },
      emotional: { type: 'number', description: '这话里的情绪有多重，0 到 24，听着平常就填 0。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      if (text.length < 2) refuse('memory.too_short', '内容太短', '写清一件事，至少几个字')
      if (text.length > 500) refuse('memory.too_long', '一条最多 500 字', '长事拆成几条记')

      const scope = deps.scopeOf(chatKey)
      const duplicated = store.all().some(item => item.state !== 'forgotten' && item.scope === scope && item.text === text)
      if (duplicated) refuse('memory.duplicate', '这条已经记过了', '换一条新的事')

      const layer = layerOf(args.layer)
      const personId = typeof args.personId === 'string' ? args.personId.trim() : ''
      const directed = args.directed === true
      const rawEmotional = typeof args.emotional === 'number' && Number.isFinite(args.emotional) ? args.emotional : 0
      const emotional = Math.max(0, rawEmotional)
      const now = Date.now()
      const item: MemoryItem = {
        id: newId(now),
        text,
        layer,
        scope,
        importance: initialImportance({ scene: deps.sceneOf(layer, chatKey), directed, emotional }),
        emotional,
        clarity: 'vivid',
        recallCount: 0,
        recoverDay: 0,
        recoverTimes: 0,
        at: now,
        lastSeenAt: now,
        state: 'active',
        source: 'tool',
        ...personId !== '' ? { personId } : {},
      }
      store.add(item)
      return Promise.resolve({ id: item.id, layer: item.layer, importance: item.importance })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_query',
    description: '找以前记过的事。给关键词比较准；找不到就是真没记过，别编。',
    parameters: {
      query: { type: 'string', description: '想找的关键词，可不填。' },
      limit: { type: 'number', description: '最多几条，默认 3。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const now = Date.now()
      const limit = Number.isInteger(args.limit) && args.limit !== undefined
        ? Math.max(1, args.limit)
        : DEFAULTS.recallLimit
      const query = typeof args.query === 'string' ? args.query : ''
      const hits = await deps.findAsync(query, chatKey, limit)
      // 被找出来的记忆算被提起一次，可能重新变清楚
      for (const hit of hits) touch(store, hit.id, now, deps.tuning)
      return {
        count: hits.length,
        text: renderRecall(hits),
        items: hits.map(hit => ({ id: hit.id, text: hit.text, clarity: hit.clarity, at: hit.at })),
      }
    },
  }))

  // 看全文：提示词里只给了开头一小段，要细节时按编号把全文拿回来
  ctx.tools.register(defineTool({
    name: 'qq_memory_detail',
    description: '把一条记忆的全文取回来。提示词里只有开头一小段，想知道当时到底怎么回事就调它看全文。',
    parameters: {
      id: { type: 'string', description: '底稿后面括号里的那个编号。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const id = typeof args.id === 'string' ? args.id.replace(/^#/u, '').trim() : ''
      if (id === '') refuse('memory.no_id', '没给编号', '从注入里那条骨架后面的括号里抄一个过来')
      const item = store.byId(id)
      // 别人的、已经忘掉的、私密层但不在私密空间的，一律当取不到
      const scope = deps.scopeOf(chatKey)
      const privateOk = scope.startsWith('private:')
      if (item === undefined || item.scope !== scope) {
        refuse('memory.not_found', '这条取不到', '可能编号抄错了，或者它不在这个会话里')
      }
      if (item.state === 'forgotten' || item.clarity === 'forgotten') {
        refuse('memory.forgotten', '这条已经忘了', '换别的记忆问，别硬凑')
      }
      if ((item.layer === 'private' || item.secret === true) && !privateOk) {
        refuse('memory.private', '这条只在私密空间取得到', '在这个会话里换个话题')
      }
      return Promise.resolve({
        id: item.id,
        text: item.text,
        layer: item.layer,
        importance: item.importance,
        at: item.at,
      })
    },
  }))
}
