// 关系工具：只按稳定用户编号查改，不凭昵称猜人

import type { Context } from '@huoli/cordis'
import { defineTool, type ToolRunContext } from '@huoli/huoli-tools'
import { RELATION_EVENT_KINDS, relationLabel, type RelationEventKind, type RelationStore } from './relations.ts'

function chatOf(exec: ToolRunContext): string {
  return String(exec.agent?.id ?? '')
}

function personFrom(exec: ToolRunContext, value: unknown): string {
  const explicit = typeof value === 'string' ? value.trim() : ''
  if (explicit !== '') return explicit
  const chatKey = chatOf(exec)
  return chatKey.startsWith('private:') ? chatKey.slice('private:'.length) : ''
}

function fail(code: string, reason: string, hint: string): never {
  throw new Error(`${code}: ${reason}｜下一步: ${hint}`)
}

function eventKindOf(value: unknown): RelationEventKind {
  const kind = typeof value === 'string' ? value : ''
  if (!(RELATION_EVENT_KINDS as readonly string[]).includes(kind)) {
    fail('relation.bad_kind', `不认识这种关系事件：${kind}`, `只能填 ${RELATION_EVENT_KINDS.join('、')}`)
  }
  return kind as RelationEventKind
}

/**
 * 挂上关系工具
 * @param ctx - 运行环境
 * @param relations - 关系仓
 * @returns 撤下函数
 */
export function registerRelationTools(ctx: Context, relations: RelationStore): () => void {
  const tools = ctx.get('tools')
  if (tools === undefined) {
    ctx.logger('qq-subject').warn('工具服务没装上，关系工具不注册')
    return () => {}
  }
  const disposers = [
    tools.register(defineTool({
      name: 'qq_relation_get',
      description: '查当前私聊对象或指定用户的关系、称呼、最近事件和纪念日。群聊里必须给用户编号。',
      parameters: {
        personId: { type: 'string', description: '稳定用户编号；私聊可以省略。' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute(args, exec) {
        const personId = personFrom(exec, args.personId)
        if (personId === '') fail('relation.person_required', '群聊里没给用户编号', '从当前发言人或成员列表拿编号')
        const person = relations.get(personId)
        if (person === undefined) return Promise.resolve({ ok: true, found: false, personId })
        return Promise.resolve({
          ok: true,
          found: true,
          result: JSON.stringify({
            person: { ...person, label: relationLabel(person) },
            events: relations.events(personId, 10),
            anniversaries: relations.anniversaries(personId, 10),
          }),
        })
      },
    })),
    tools.register(defineTool({
      name: 'qq_relation_record',
      description: '记一条真实发生过的关系事件。只写事实摘要，不复述聊天原话。群聊里必须给用户编号。',
      parameters: {
        personId: { type: 'string', description: '稳定用户编号；私聊可以省略。' },
        kind: { type: 'string', description: `事件种类：${RELATION_EVENT_KINDS.join('、')}。` },
        summary: { type: 'string', description: '一句事实摘要，最多二百四十字。' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute(args, exec) {
        const personId = personFrom(exec, args.personId)
        if (personId === '') fail('relation.person_required', '群聊里没给用户编号', '从当前发言人或成员列表拿编号')
        const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
        if (summary === '') fail('relation.summary_required', '没写发生了什么', '用一句事实摘要说明')
        const event = relations.recordEvent({
          personId,
          chatKey: chatOf(exec),
          kind: eventKindOf(args.kind),
          summary,
        })
        return Promise.resolve({ ok: true, eventId: event.id, result: JSON.stringify(event) })
      },
    })),
    tools.register(defineTool({
      name: 'qq_relation_name',
      description: '给一个稳定用户设置偏好称呼。只是改叫法，不合并任何用户。',
      parameters: {
        personId: { type: 'string', description: '稳定用户编号；私聊可以省略。' },
        name: { type: 'string', description: '以后怎么称呼这个人。' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute(args, exec) {
        const personId = personFrom(exec, args.personId)
        if (personId === '') fail('relation.person_required', '群聊里没给用户编号', '从当前发言人或成员列表拿编号')
        const name = typeof args.name === 'string' ? args.name.trim() : ''
        if (name === '') fail('relation.name_required', '没写新的称呼', '给一个正常称呼')
        const person = relations.setPreferredName(personId, name)
        return Promise.resolve({ ok: true, result: JSON.stringify(person), label: relationLabel(person) })
      },
    })),
    tools.register(defineTool({
      name: 'qq_relation_anniversary',
      description: '记一个和某个稳定用户有关的纪念日。群聊里必须给用户编号。',
      parameters: {
        personId: { type: 'string', description: '稳定用户编号；私聊可以省略。' },
        label: { type: 'string', description: '纪念日名称。' },
        month: { type: 'number', description: '月份，一到十二。' },
        day: { type: 'number', description: '日期，一到三十一。' },
        year: { type: 'number', description: '年份；不确定就不填。' },
        repeatYearly: { type: 'boolean', description: '是否每年重复，默认是。' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute(args, exec) {
        const personId = personFrom(exec, args.personId)
        if (personId === '') fail('relation.person_required', '群聊里没给用户编号', '从当前发言人或成员列表拿编号')
        const label = typeof args.label === 'string' ? args.label.trim() : ''
        if (label === '') fail('relation.label_required', '没写纪念日名称', '写清这是什么日子')
        const anniversary = relations.addAnniversary({
          personId,
          chatKey: chatOf(exec),
          label,
          month: Number(args.month),
          day: Number(args.day),
          ...typeof args.year === 'number' ? { year: args.year } : {},
          ...typeof args.repeatYearly === 'boolean' ? { repeatYearly: args.repeatYearly } : {},
        })
        return Promise.resolve({ ok: true, anniversaryId: anniversary.id, result: JSON.stringify(anniversary) })
      },
    })),
    tools.register(defineTool({
      name: 'qq_relation_remove',
      description: '删除一条记错的关系事件或纪念日。事件和纪念日二选一。',
      parameters: {
        eventId: { type: 'string', description: '要删的关系事件编号。' },
        anniversaryId: { type: 'string', description: '要删的纪念日编号。' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute(args) {
        const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : ''
        const anniversaryId = typeof args.anniversaryId === 'string' ? args.anniversaryId.trim() : ''
        if ((eventId === '') === (anniversaryId === '')) {
          fail('relation.remove_one', '要删的项不明确', '事件编号和纪念日编号只填一个')
        }
        return Promise.resolve(eventId !== ''
          ? { ok: relations.removeEvent(eventId) }
          : { ok: relations.removeAnniversary(anniversaryId) })
      },
    })),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
