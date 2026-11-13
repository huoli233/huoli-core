// 用同一个 DSH 回合做一次由模型主动选择的复核

import type { Context } from '@huoli/cordis'
import { createUserMessage, type ContextFormed } from '@huoli/huoli-llm'
import { defineTool, type ToolExecution } from '@huoli/huoli-tools'

declare module '@huoli/huoli-llm' {
  interface MessageSourceMap {
    'qq-reflection': { kind: 'qq-reflection' } & ContextFormed
  }
}

/** 反思之后要给模型的一次性复核要求 */
export const REFLECTION_PASS_LINE = [
  '现在重新判断刚才那条消息，不要替第一反应找理由。',
  '先确认说话人、回复对象、引用、玩笑和上下文；再找一个最有力的相反解释及其证据。',
  '检查自己是否顺着错误前提、误把别人的话当成对你说，或忽略了群里正在接话的人。',
  '结合这次复核，重新选择回应、追问、插话、旁听、安静或休息；不必坚持第一次的结论。',
  '下一次对外动作的 mind.review 写复核结论，不要把这段内心判断放进正文。',
].join('\n')

const OUTBOUND_WITH_MIND = new Set([
  'qq_send_message',
  'qq_send_burst',
  'qq_send_messy',
  'qq_send_forward',
  'qq_reply',
  'qq_correct',
  'qq_stay_quiet',
])

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function reviewedMind(exec: ToolExecution): boolean {
  const args = recordOf(exec.arguments)
  const mind = recordOf(args?.mind)
  return typeof mind?.review === 'string' && mind.review.trim() !== ''
}

/** 注册可选复核工具；返回值用于卸载时清理工具、守卫和轮次状态 */
export function registerReflectionPass(
  ctx: Context,
  note: (kind: string, chatKey: string) => void,
): () => void {
  if (typeof ctx.tools.register !== 'function' || typeof ctx.tools.guard !== 'function') return () => {}
  const passes = new Map<string, { requested: boolean; reviewed: boolean }>()
  // 反思也要有冷却：同一会话十分钟内只让复核一次，别把每轮都变成自我检讨
  const lastReflectAt = new Map<string, number>()
  const REFLECT_COOLDOWN_MS = 10 * 60_000
  const disposeTool = ctx.tools.register(defineTool({
    name: 'qq_reflect',
    description: '觉得第一反应可能误读、顺着错误前提、看错说话对象，或群里有人正接着聊时，才在发送前调用一次。它会让同一轮 DSH 再想一遍，不会发消息；普通清楚的闲聊不要调用；同一会话 10 分钟内最多一次，刚复核过就按结果行动，不要连着两轮反思。',
    parameters: {
      reason: { type: 'string', description: '这次为什么觉得值得再看一眼，只写具体疑点；没有具体疑点就不要调用。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(_args, exec) {
      const chatKey = exec.agent?.id ?? ''
      if (!chatKey.startsWith('group:') && !chatKey.startsWith('private:')) {
        return Promise.resolve({ started: false, reason: 'chat_scope_unavailable' })
      }
      const kept = passes.get(chatKey)
      if (kept?.requested === true) return Promise.resolve({ started: false, reason: 'already_used_this_turn' })
      const last = lastReflectAt.get(chatKey) ?? 0
      if (last > 0 && Date.now() - last < REFLECT_COOLDOWN_MS) {
        return Promise.resolve({ started: false, reason: 'cooldown' })
      }
      passes.set(chatKey, { requested: true, reviewed: false })
      lastReflectAt.set(chatKey, Date.now())
      exec.deferContext(createUserMessage({
        content: [{ type: 'text', text: REFLECTION_PASS_LINE }],
        source: { kind: 'qq-reflection', form: 'instructions' },
      }))
      note('reflection_pass_started', chatKey)
      return Promise.resolve({ started: true, next: '重新判断后再选择动作；外发时在 mind.review 留下复核结论。' })
    },
  }))
  const disposeGuard = ctx.tools.guard((exec) => {
    const chatKey = exec.agent?.id ?? ''
    const kept = passes.get(chatKey)
    if (kept === undefined || kept.reviewed || !OUTBOUND_WITH_MIND.has(exec.name)) return undefined
    if (!reviewedMind(exec)) {
      return 'QQ_REFLECTION_REVIEW_REQUIRED: 你刚才主动要求复核；先重新检查原话与相反解释，再在 mind.review 写下新的判断后行动。'
    }
    kept.reviewed = true
    return undefined
  })
  const disposeSession = ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') passes.delete(String(session.id))
  })
  const disposeStopping = ctx.on('agent/turn-stopping', ({ agent }) => {
    passes.delete(agent.id)
  })
  return () => {
    disposeTool()
    disposeGuard()
    disposeSession()
    disposeStopping()
    passes.clear()
  }
}
