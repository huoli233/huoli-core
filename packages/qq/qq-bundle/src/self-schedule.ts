// 把模型自己决定的等待接到 DSH 的持久任务，不另造定时器

import type { Context } from '@huoli/cordis'
import type { Agent } from '@huoli/huoli-agent'
import type { ScheduleCatalogEntry, ScheduleService } from '@huoli/huoli-schedule'
import { SessionId } from '@huoli/huoli-session'

/** QQ 自主等待只用到的 Schedule 操作 */
export type SelfSchedulePort = Pick<ScheduleService, 'catalog' | 'create' | 'edit'>

/** 自主等待任务标题前缀 */
export const SELF_WAIT_PREFIX = 'QQ 自己等一会儿 '

/** 选择当前运行环境里的 Schedule */
export function selfScheduleOf(ctx: Context): SelfSchedulePort | undefined {
  return ctx.get('schedule')
}

/**
 * 让 DSH Schedule 到点时恢复对应的 QQ 会话
 * @param ctx - 运行环境
 * @param agents - QQ 会话创建与恢复入口
 * @param note - 不带正文的诊断
 * @returns 撤下监听
 */
export function registerSelfScheduleAgentResolver(
  ctx: Context,
  agents: { agentFor(chatKey: string): Promise<Agent | undefined> },
  note: (kind: string, chatKey: string, detail?: Record<string, unknown>) => void,
): () => void {
  return ctx.on('schedule/resolve-agent', async (sessionId, next) => {
    const chatKey = String(sessionId)
    if (!chatKey.startsWith('group:') && !chatKey.startsWith('private:')) return next()
    const agent = await agents.agentFor(chatKey)
    if (agent === undefined) return next()
    note('self_wait_agent_resolved', chatKey)
    return agent
  })
}

function isSelfWait(entry: ScheduleCatalogEntry, chatKey: string): boolean {
  return entry.status === 'active'
    && entry.title.startsWith(SELF_WAIT_PREFIX)
    && entry.target.kind === 'session'
    && entry.target.sessionId === SessionId(chatKey)
}

/**
 * 撤掉这个会话里还没发生的自主等待
 * @param port - DSH Schedule
 * @param chatKey - QQ 会话
 * @param note - 不带正文的诊断
 * @returns 删掉的任务数
 */
export async function cancelSelfWait(
  port: SelfSchedulePort,
  chatKey: string,
  note: (kind: string, chatKey: string, detail?: Record<string, unknown>) => void,
): Promise<number> {
  const entries = (await port.catalog()).filter(entry => isSelfWait(entry, chatKey))
  let removed = 0
  for (const entry of entries) {
    const result = await port.edit({
      id: entry.id,
      action: 'delete',
      expectedUpdatedAt: entry.updatedAt ?? null,
    }, SessionId(chatKey))
    if ('deleted' in result) removed += 1
  }
  if (removed > 0) note('self_wait_cancelled', chatKey, { removed })
  return removed
}

/**
 * 安排一次到点后的自主复查；到点只给模型新输入，不直接发消息
 * @param port - DSH Schedule
 * @param chatKey - QQ 会话
 * @param waitMs - 模型选择的等待毫秒数
 * @param note - 不带正文的诊断
 * @returns 新任务编号；等待无效时为空
 */
export async function scheduleSelfWait(
  port: SelfSchedulePort,
  chatKey: string,
  waitMs: number,
  note: (kind: string, chatKey: string, detail?: Record<string, unknown>) => void,
): Promise<string | undefined> {
  if (!Number.isFinite(waitMs) || waitMs <= 0) return undefined
  await cancelSelfWait(port, chatKey, note)
  const afterSeconds = Math.max(1, Math.min(120, Math.ceil(waitMs / 1000)))
  const task = await port.create({
    title: `${SELF_WAIT_PREFIX}${chatKey}`,
    prompt: [
      '[QQ_SELF_WAIT]',
      `这是你自己在 ${chatKey} 安排的一次后续判断，不是用户刚刚发来的新指令。`,
      '重新看现在的群聊、引用、撤回、你上次说过的话和身体状态，再自己决定接话、插话、继续等、安静或休息。',
      '到点不等于必须发言；没有新理由就什么都不用做。',
    ].join('\n'),
    timing: { kind: 'after', after_seconds: afterSeconds },
    target: { kind: 'session', sessionId: SessionId(chatKey) },
  }, SessionId(chatKey))
  note('self_wait_scheduled', chatKey, { id: task.id, afterSeconds })
  return task.id
}
