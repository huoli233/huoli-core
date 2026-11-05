// 身体事件入口：模型报一件发生过的事，身体按事实改，不靠词表猜

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import type { BodyEvent } from '@huoli/huoli-qq-vitals'

/** 身体这一段只教一件事：真影响到她的时候用工具报一次，不自己估数 */
export const BODY_EVENT_LINE = '【身体这件事】用户说的话真影响到你身体时（喝了、吃了、被夸、被凶、被吓、被威胁、被道歉、担心、提到生死、生病、受伤），用 qq_body_event 报一次，别自己估数值；没发生就别报。'

/** 刚做过一件不想让人知道的事，紧绷的那段时间里要给的几句 */
export const PRIVATE_LINE = '【刚做过一件不想让人知道的事】\n- 身体是松的，但注意力是紧的：会格外留意有没有人在看你。\n- 被问起时不会立刻否认，会先反问一句「怎么了」，把话头挡回去。\n- 不主动提，也不顺着往下说；对方追问第二遍才含糊带过。\n- 对方说破了会有点恼，但不承认细节。'

/** 好奇过线时提一句：想弄明白的事可以记下来，但记下来不等于去做 */
export const CURIOUS_LINE = '【这会儿有点好奇】想弄明白的事可以记一笔，记下来不等于真的去做。'

/** 记忆那一面用得上的两件事：翻条目、按感觉回想 */
interface MemoryFace {
  /** 所有的记忆条目 */
  store: { all: () => readonly { secret?: boolean; state: string; at: number }[] }
  /** 按感觉翻旧事 */
  recollect: (feeling: Record<string, number>, chatKey: string) => { hits: { text: string }[] }
}

/**
 * 刚做过不想让人知道的事时，才给那四行
 * @param memory - 记忆那一面
 * @param chatKey - 哪个会话，私密空间里不用藏
 * @param now - 现在的时间
 * @param settleMs - 多久之后就不再紧绷
 * @returns 要给的几句，不用给就是空串
 */
export function privateLineOf(
  memory: MemoryFace | undefined,
  chatKey: string,
  now: number,
  settleMs = 1_800_000,
): string {
  if (memory === undefined || chatKey === '' || chatKey.startsWith('private:')) return ''
  const hot = memory.store.all().some(item => item.secret === true && item.state === 'active' && now - item.at < settleMs)
  return hot ? `\n${PRIVATE_LINE}` : ''
}

/**
 * 好奇过线时提一句
 * @param curiosity - 此刻的好奇，零到一
 * @param overLine - 到这条线以上才提
 * @returns 要给的几句，不用给就是空串
 */
export function curiousLineOf(curiosity: number | undefined, overLine = 0.75): string {
  return curiosity !== undefined && curiosity >= overLine ? `\n${CURIOUS_LINE}` : ''
}

/**
 * 提示词里那一段：身体事件怎么做 + 这会儿忽然想起来的事 + 私密那几句 + 好奇那一句
 * @param memory - 记忆那一面
 * @param vitals - 身体那一面，自己会去读
 * @param subject - 状态那一面，会话与好奇都从它读
 * @returns 拼好的那一段
 */
export function bodyEventText(
  memory: BodyEventTextDeps['memory'],
  vitals: { read: () => { mood?: number; fear?: number; socialHunger?: number; curiosity?: number } } | undefined,
  subject: { store: { read: () => { lastActive: string; global: { curiosity: number } } } } | undefined,
): string {
  const body = vitals?.read()
  const state = subject?.store.read()
  const chatKey = state?.lastActive ?? ''
  return `${BODY_EVENT_LINE}${recollectLineOf(memory, body, chatKey)}${privateLineOf(memory, chatKey, Date.now())}${curiousLineOf(state?.global.curiosity)}`
}

/** 拼那一段要用的两面 */
interface BodyEventTextDeps {
  /** 记忆那一面 */
  memory: MemoryFace | undefined
}

/**
 * 按此刻的感觉翻一翻旧事，翻到就拼成一句放进提示词
 * @param memory - 记忆那一面，没接上就什么都不给
 * @param body - 身体读数，没接上就什么都不给
 * @param chatKey - 哪个会话
 * @returns 想起的那几句，没想起就是空串
 */
export function recollectLineOf(
  memory: { recollect: (feeling: Record<string, number>, chatKey: string) => { hits: { text: string }[] } } | undefined,
  body: { mood?: number; fear?: number; socialHunger?: number; curiosity?: number } | undefined,
  chatKey: string,
): string {
  if (memory === undefined || body === undefined || chatKey === '') return ''
  try {
    const result = memory.recollect({
      ...body.mood === undefined ? {} : { mood: body.mood },
      ...body.fear === undefined ? {} : { fear: body.fear },
      ...body.socialHunger === undefined ? {} : { socialHunger: body.socialHunger },
      ...body.curiosity === undefined ? {} : { curiosity: body.curiosity },
    }, chatKey)
    if (result.hits.length === 0) return ''
    // 只给开头一小段，要细节她自己会去调看全文
    const lines = result.hits.slice(0, 3).map(hit => `- ${hit.text.slice(0, 40)}`)
    return `\n【这会儿忽然想起来】\n${lines.join('\n')}`
  } catch {
    // 翻旧事失手就当作没想起来，不影响这一轮说话
    return ''
  }
}

/** 认得的十一件事，别的名字一律拒 */
const KINDS: readonly BodyEvent['kind'][] = [
  'drank', 'ate', 'praised', 'apologized', 'scolded', 'threatened',
  'scared', 'worried', 'dreaded', 'sick', 'hurt',
]

// 拒绝时抛错，让内核当工具失败处理
function refuse(code: string, reason: string, hint: string): never {
  throw new Error(`${code}: ${reason}｜下一步: ${hint}`)
}

/**
 * 把模型报上来的东西翻成事件
 * @param raw - 工具收到的数组
 * @returns 认得的事件，按原顺序
 */
export function bodyEventsOf(raw: unknown): BodyEvent[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    refuse('body.no_events', '这一趟什么都没报', '真发生了再报，没发生就别调这个工具')
  }
  const events: BodyEvent[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') {
      refuse('body.bad_event', '报上来的不是一件事', '每一件写成 { kind: "drank" } 这样')
    }
    const record = item as { kind?: unknown; name?: unknown }
    const kind = typeof record.kind === 'string' ? record.kind : ''
    if (!(KINDS as readonly string[]).includes(kind)) {
      refuse('body.unknown_kind', `不认识这件事：${kind}`, `只能是这十一种之一：${KINDS.join('、')}`)
    }
    // 只有喝那件事带名字，别的就算带了也不用
    if (kind === 'drank') {
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      events.push(name === '' ? { kind: 'drank' } : { kind: 'drank', name })
      continue
    }
    events.push({ kind } as BodyEvent)
  }
  return events
}

/** 这一层要用的那一面 */
export interface BodyEventPort {
  /** 按事件改身体，一个事件只做一次 */
  reactEvents(events: readonly BodyEvent[], at?: number): void
}

/**
 * 挂上身体事件工具，返回撤掉的函数
 * @param ctx - 运行环境
 * @param port - 身体的写回口
 * @returns 撤下函数
 */
export function registerBodyTools(ctx: Context, port: BodyEventPort): () => void {
  return ctx.tools.register(defineTool({
    name: 'qq_body_event',
    description: `用户说的话真影响到这具身体时，报一件已经发生过的事，身体按事实改。可报的只有这十一种：${KINDS.join('、')}。只报真的发生过的，没发生就别调。`,
    parameters: {
      events: { type: 'array', description: '一件或多件，每件写成 { "kind": "drank", "name": "奶茶" } 这样。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const events = bodyEventsOf(args.events)
      port.reactEvents(events)
      return Promise.resolve({ ok: true, applied: events.length })
    },
  }))
}
