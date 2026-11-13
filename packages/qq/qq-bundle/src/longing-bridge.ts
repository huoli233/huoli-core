// QQ 只接项目内暗涌插件：状态、事件和提示都走服务，不复制它的计算

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import type { BodyEvent } from '@huoli/huoli-qq-vitals'
import type { EventName, QqLongingSeam } from '@huoli/huoli-qq-longing'
import { EVENT_NAMES } from '@huoli/huoli-qq-longing'

/** 插件状态块最多带多少字符 */
const MAX_BLOCK_CHARS = 1200

/** 可交给暗涌的事件名 */
export const LONGING_EVENTS = EVENT_NAMES

/**
 * 取私聊状态块
 * @param longing - 暗涌服务
 * @returns 没挂载或关着时为空串
 */
export function longingBlockOf(longing: QqLongingSeam | undefined): string {
  if (longing === undefined || !longing.active()) return ''
  return longing.render().slice(0, MAX_BLOCK_CHARS)
}

/**
 * 把一次私聊联系交给暗涌
 * @param longing - 暗涌服务
 * @param chatKey - 当前聊天键
 * @param text - 对方正文
 */
export function noteLongingContact(
  longing: QqLongingSeam | undefined,
  chatKey: string,
  text: string,
): void {
  if (longing === undefined || !chatKey.startsWith('private:')) return
  longing.contact(text)
}

// 身体事件里能直接对应的三种，其余由桥接工具明确上报
const BODY_EVENT_MAP: Partial<Record<BodyEvent['kind'], EventName>> = {
  praised: 'praise',
  apologized: 'apologize',
  scolded: 'blame',
}

/**
 * 把已经确认的身体事件同步给暗涌
 * @param longing - 暗涌服务
 * @param events - 身体事件
 * @param chatKey - 来源会话
 */
export function noteLongingBodyEvents(
  longing: QqLongingSeam | undefined,
  events: readonly BodyEvent[],
  chatKey: string,
): void {
  if (longing === undefined || !chatKey.startsWith('private:')) return
  for (const event of events) {
    const name = BODY_EVENT_MAP[event.kind]
    if (name !== undefined) longing.event(name)
  }
}

function isPrivate(context: { agent?: { id: string } }): boolean {
  return (context.agent?.id ?? '').startsWith('private:')
}

function isLongingEvent(name: string): name is EventName {
  return (EVENT_NAMES as readonly string[]).includes(name)
}

/**
 * 把状态块和唯一一个事件工具接到 QQ
 * @param ctx - 运行环境
 * @param longing - 暗涌服务
 */
export function registerLongingBridge(
  ctx: Context,
  longing: QqLongingSeam | undefined,
): () => void {
  ctx.systemPrompt.context({
    name: 'qq:longing',
    order: 3,
    text: context => isPrivate(context) ? longingBlockOf(longing) : '',
  })
  ctx.systemPrompt.section({
    name: 'qq:longing-control',
    order: 354,
    text: context => isPrivate(context) && longing?.active() === true
      ? '[SYSTEM_LOAD] QQ_LONGING_EVENT\nWHEN: a real private exchange changes closeness, desire, trust, anger or aftercare\nACTION: call_qq_longing_event with actual events only\nDO_NOT: invent events|use_in_group|repeat_event_to_force_a_value'
      : '',
  })
  const disposeTool = ctx.tools.register(defineTool({
    name: 'qq_longing_event',
    description: '私聊里把真实发生的亲密、亲近、冲突、拒绝、离开、安抚或结束事件交给暗涌状态层。只报确实发生的事，不靠重复事件刷数值。',
    parameters: {
      events: {
        type: 'array',
        description: '按发生顺序排列的一件或多件事，每件写 name 和可选的 detail。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', enum: [...LONGING_EVENTS], description: '暗涌事件名。' },
            detail: { type: 'string', description: '对方原话或这一件事的简短事实。' },
          },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      if (longing === undefined || !longing.active()) {
        throw new Error('longing.unavailable: 暗涌插件没有挂上; NEXT: check_qq_longing_entry')
      }
      const raw = args.events
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('longing.no_events: 这一趟什么都没报; NEXT: 真发生了再报')
      }
      const applied: Record<string, number> = {}
      for (const item of raw) {
        if (Array.isArray(item)) {
          throw new Error('longing.bad_event: 报上来的不是一件事; NEXT: 每件写成 { name } 这样')
        }
        const row = item as { name?: string }
        const name = typeof row.name === 'string' ? row.name : ''
        if (!isLongingEvent(name)) {
          throw new Error(`longing.unknown_event: 不认识这个事件 ${name || '(空)'}; NEXT: 从工具列出的名字里选`)
        }
        const outcome = longing.event(name)
        if (!outcome.ok) throw new Error(outcome.reason ?? 'longing.event_rejected')
        for (const [dim, value] of Object.entries(outcome.applied)) {
          applied[dim] = value
        }
      }
      return Promise.resolve({ ok: true, applied: Object.keys(applied).length, deltas: applied })
    },
  }))
  return disposeTool
}
