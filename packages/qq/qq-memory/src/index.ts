// 记忆装配入口：两个工具 + 往上挪 + 每天变淡

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { createMemoryStore, type MemoryStore } from './store.ts'
import { promoteAll, sweepOnce } from './sweep.ts'
import { recall, type RecallHit } from './recall.ts'
import { registerMemoryTools } from './tools.ts'
import { CLARITY_LABEL, LAYER_LABEL, type MemoryItem } from './types.ts'

export type { MemoryItem, MemoryLayer, RememberInput } from './types.ts'
export { CLARITY_LABEL, LAYER_LABEL, LAYER_ORDER } from './types.ts'
export type { MemoryStore, MemoryStoreOptions } from './store.ts'
export type { RecallHit, RecallInput } from './recall.ts'
export { recall, renderRecall } from './recall.ts'
export { promoteAll, sweepOnce, touch } from './sweep.ts'

// 一个应用里的记忆仓
export interface QqMemorySeam {
  store: MemoryStore
  remember(text: string, chatKey: string, layer?: MemoryItem['layer']): MemoryItem
  find(query: string, chatKey: string, limit?: number): RecallHit[]
  promote(): number
  sweep(): { stepped: number; forgotten: number }
  outline(chatKey: string): string
}

// 这一行接受的配置
export interface Config {
  file?: string
}

const seams = new WeakMap<Context, QqMemorySeam>()

// 取记忆仓，未装配时为 undefined
export function qqMemoryOf(ctx: Context): QqMemorySeam | undefined {
  return seams.get(ctx)
}

// 插件的行名
export const name = 'qq-memory'

// 要用的内核接口
export const inject = ['tools']

// 装配记忆仓与两个工具
export function apply(ctx: Context, config: Config = {}): void {
  const file = config.file ?? path.join(process.cwd(), 'data', 'qq-memory.json')
  const store = createMemoryStore({ file })
  const scopeOf = (chatKey: string): string => chatKey

  const seam: QqMemorySeam = {
    store,
    remember(text, chatKey, layer) {
      const now = Date.now()
      const item: MemoryItem = {
        id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        layer: layer ?? 'episodic',
        scope: scopeOf(chatKey),
        importance: 40,
        emotional: 0,
        clarity: 'vivid',
        recallCount: 0,
        at: now,
        lastSeenAt: now,
        forgotten: false,
        source: 'chat',
      }
      store.add(item)
      return item
    },
    find(query, chatKey, limit) {
      return recall(store, { query, scope: scopeOf(chatKey), ...limit !== undefined ? { limit } : {} })
    },
    promote() {
      return promoteAll(store, Date.now())
    },
    sweep() {
      return sweepOnce(store, Date.now())
    },
    outline(chatKey) {
      const items = store.all().filter((item) => !item.forgotten && item.scope === scopeOf(chatKey))
      if (items.length === 0) return '还没有记下什么。'
      const lines = items
        .slice(-8)
        .map((item) => `- ${new Date(item.at).toISOString().slice(0, 10)} [${CLARITY_LABEL[item.clarity]}] ${item.text}`)
      const byLayer = new Map<string, number>()
      for (const item of items) byLayer.set(LAYER_LABEL[item.layer], (byLayer.get(LAYER_LABEL[item.layer]) ?? 0) + 1)
      const summary = [...byLayer.entries()].map(([label, count]) => `${label} ${count} 条`).join('，')
      return `记下了 ${items.length} 条（${summary}）\n${lines.join('\n')}`
    },
  }
  seams.set(ctx, seam)

  registerMemoryTools(ctx, { store, scopeOf })

  // 卸载时落一次盘
  ctx.effect(() => () => {
    store.flush()
    seams.delete(ctx)
  })
}
