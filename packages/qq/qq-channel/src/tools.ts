// 说话、回应、发动态、公开评论、私信、两张确认票、遗书正文，再加三个读记录的工具

import type { Context } from '@huoli/cordis'
import { defineTool } from '@huoli/huoli-tools'
import { POST_LEVELS } from '@huoli/huoli-qq-self'
import type { ChannelStatus, OutboundEvent } from './events.ts'
import type { OutboundVerdict } from './outbound.ts'
import { CONFIRM_KINDS } from './actions.ts'
import type { ActionFacts, ActionKind, ActionResult } from './actions.ts'
import type { FarewellStage } from './farewell-slot.ts'
import type { ForwardNode } from './forward.ts'
import type { HistoryOutcome, MembersOutcome, MessageOutcome } from './read.ts'
import type { StickerListOutcome, StickerPickOutcome } from './stickers.ts'

/** 工具要用到的东西 */
export interface ChannelToolDeps {
  status: () => ChannelStatus
  send: (text: string, chatKey: string) => Promise<{ ok: boolean; messageId?: string; code?: string; reason?: string }>
  react: (messageId: string, emoji: string) => Promise<{ ok: boolean; code?: string; reason?: string }>
  /** 把几段合成一条合并转发发出去；没接上就退回一条一条发 */
  sendForward?: (
    nodes: readonly ForwardNode[],
    chatKey: string,
  ) => Promise<{ ok: boolean; messageId?: string; code?: string; reason?: string }>
  /** 合并转发的开关与卡片上显示的名字 */
  forward?: { enabled: boolean; name: string }
  /** 按这一轮的条数上限把一段话切成几条，连着条与条之间的间隔 */
  split: (text: string, maxParts: number) => { parts: string[]; gapsMs: number[] }
  /** 这一轮最多几条，拿不到上限时是最紧的一档 */
  cap: () => number
  /** 发到第几条时该不该停：给了就按它提前收口，不给按上限走 */
  stop?: (sentCount: number) => boolean
  spend: (text: string) => void
  allow: (text: string) => { ok: boolean; code?: string; reason?: string; hint?: string }
  /** 发之前过一遍出站体检 */
  inspect: (chatKey: string, text: string) => OutboundVerdict
  /** 真的发出去一条之后记一笔 */
  account: (at: number) => void
  /** 把这一路发生的事报给外面，只报事实 */
  report: (event: OutboundEvent) => void
  /** 三类公共动作都走这个入口：分级、体检、确认票、冷却与额度全由它判 */
  publish: (kind: ActionKind, text: string, facts: ActionFacts) => Promise<ActionResult>
  /** 把一段正文放进待确认队列，回票号与失效时刻 */
  requestConfirm: (kind: ActionKind, text: string, at: number) => ActionResult
  /** 给一张待确认的票盖章，一张票只认一次发送 */
  confirm: (confirmId: string, at: number) => ActionResult
  /** 把遗书正文收进暂存槽，同一天只收一次 */
  stageFarewell: (text: string, at: number) => FarewellStage
  /** 翻群里的记录、列群成员、看具体那一条；没接上就回一个能看懂的码 */
  read?: {
    history: (chatKey: string, count: number) => Promise<HistoryOutcome>
    members: (chatKey: string, limit: number) => Promise<MembersOutcome>
    message: (messageId: string) => Promise<MessageOutcome>
  }
  /** 表情包：按标签列、按编号取；没接上就回一个能看懂的码 */
  stickers?: {
    list: (tag: string, limit: number) => Promise<StickerListOutcome>
    pick: (id: string) => Promise<StickerPickOutcome>
    send: (file: string, chatKey: string) => Promise<{ ok: boolean; messageId?: string; code?: string; reason?: string }>
  }
  /** 戳一下某个人，参数是群号与被戳的人；没接上或没开就回一个码 */
  poke?: (chatKey: string, userId: string) => Promise<{ ok: boolean; code?: string; reason?: string }>
}

// 两把钥匙在这里只是这次调用的声明：用户那把由确认票背书，她自己那把由这次调用背书，放不放行仍由发布入口判
const PUBLISH_KEYS = { userOk: true, selfOk: true } as const

// 拒绝时抛错
function refuse(code: string, error: string, hint: string): never {
  throw new Error(`${code}: ${error}｜下一步: ${hint}`)
}

// 把下次什么时候说进提示里
function nextStep(verdict: { hint?: string; retryAt?: number }): string {
  const hint = verdict.hint ?? '过一会儿再说'
  if (verdict.retryAt === undefined) return hint
  const date = new Date(verdict.retryAt)
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${hint}（${clock} 之后再来）`
}

// 要票的那两类动作被拒时，下一步得指名调哪个工具，模型才知道往哪儿走
function hintOf(result: ActionResult): string {
  if ((result.code ?? '').endsWith('.needs_confirm')) return '先调 qq_request_confirm 拿票号，再调 qq_confirm_action 盖章，然后原样重发这一段'
  return nextStep(result)
}

// 公共动作的拒绝原样抛出，工具自己不改写、不重试、不判该不该发
function refuseAction(result: ActionResult, fallback: string): never {
  refuse(result.code ?? fallback, result.reason ?? '这一条没发出去', hintOf(result))
}

// 取这次调用属于哪个会话：一个群一条会话，会话身份就是聊天键
function chatKeyOf(exec: { agent?: { id: string } }): string {
  const id = exec.agent?.id
  if (id === undefined || id === '') refuse('channel.no_chat', '这次调用没有会话身份', '从带会话的入口调用工具')
  return id
}

// 停一会儿
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms))
    timer.unref()
  })
}

// 取工具参数里的文本，空串或缺失都拒绝
function textArg(value: unknown, emptyCode: string, emptyReason: string, emptyHint: string): string {
  if (typeof value !== 'string' || value.trim() === '') refuse(emptyCode, emptyReason, emptyHint)
  return value.trim()
}

// 没报就当作没填，交给下游按缺这一项拒
function filled(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 挂上发送工具
 * @param ctx - 运行环境
 * @param deps - 要用到的东西
 */
export function registerChannelTools(ctx: Context, deps: ChannelToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'qq_send_message',
    description: '在这个会话里说一句。长话会自动拆成几条发，中间隔一下。说完就结束这一轮，不用再补充说明。',
    parameters: {
      text: { type: 'string', description: '要说的话。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const openedAt = Date.now()
      deps.report({ kind: 'attempt', at: openedAt, chatKey, count: 1 })
      const text = textArg(args.text, 'channel.empty', '没话可说', '要发就写点东西，不说就别调这个工具')
      if (!deps.status().connected) refuse('channel.offline', '现在没连上 QQ', '等连上再发，或者先不发作罢')

      const inspection = deps.inspect(chatKey, text)
      if (!inspection.ok) {
        deps.report({ kind: 'blocked', at: Date.now(), chatKey, count: 0, ...inspection.code === undefined ? {} : { code: inspection.code }, ...inspection.retryAt === undefined ? {} : { retryAt: inspection.retryAt } })
        refuse(inspection.code ?? 'outbound.blocked', inspection.reason ?? '现在不能发', nextStep(inspection))
      }

      const verdict = deps.allow(text)
      if (!verdict.ok) {
        const code = verdict.code ?? 'channel.blocked'
        deps.report({ kind: 'blocked', at: Date.now(), chatKey, count: 0, code })
        refuse(code, verdict.reason ?? '现在不能发', nextStep(verdict))
      }

      const planned = deps.split(text, deps.cap())
      // 分成两段以上又开着合并转发：一条发出去，别让对面收一串碎片
      if (deps.forward?.enabled === true && planned.parts.length > 1 && deps.sendForward !== undefined) {
        const forwarded = await deps.sendForward(planned.parts.map(content => ({ name: deps.forward?.name ?? '', content })), chatKey)
        if (!forwarded.ok) {
          deps.report({ kind: 'blocked', at: Date.now(), chatKey, count: 0, code: forwarded.code ?? 'channel.send_failed' })
          refuse(forwarded.code ?? 'channel.send_failed', forwarded.reason ?? '合并转发没发出去', '等一下再发，或者把这一段说短些')
        }
        const moment = Date.now()
        for (const part of planned.parts) deps.spend(part)
        deps.account(moment)
        deps.report({ kind: 'sent', at: moment, chatKey, count: planned.parts.length })
        return { parts: planned.parts.length, messageIds: [forwarded.messageId ?? ''] }
      }
      const sent: string[] = []
      for (const [at, part] of planned.parts.entries()) {
        // 已经发了一条之后再看要不要停：对方要她别说、或者场面太紧，剩下的就不发了
        if (at > 0 && deps.stop?.(sent.length) === true) break
        const result = await deps.send(part, chatKey)
        if (!result.ok) {
          // 已经发出去的不撤也不再发一遍，只把发了几条、卡在第几条报出去
          if (sent.length > 0) deps.report({ kind: 'sent', at: Date.now(), chatKey, count: sent.length })
          deps.report({ kind: 'blocked', at: Date.now(), chatKey, count: 0, code: result.code ?? 'channel.send_failed' })
          const stuck = `已发 ${sent.length} 条，卡在第 ${at + 1} 条：${result.reason ?? '发送失败'}`
          refuse(result.code ?? 'channel.send_failed', stuck, '换一句短点的，或者等一下再发')
        }
        const moment = Date.now()
        deps.spend(part)
        deps.account(moment)
        sent.push(result.messageId ?? '')
        const gap = planned.gapsMs[at]
        if (gap !== undefined) await sleep(gap)
      }
      deps.report({ kind: 'sent', at: Date.now(), chatKey, count: sent.length })
      return { parts: sent.length, messageIds: sent }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_send_reaction',
    description: '给某条消息一个表情回应，不用说整句。想表示看到了、笑一下、赞一下的时候用。',
    parameters: {
      messageId: { type: 'string', description: '要回应的那条消息编号。' },
      emoji: { type: 'string', description: '表情编号，比如 128077 是赞。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      deps.report({ kind: 'attempt', at: Date.now(), chatKey, count: 1 })
      const messageId = textArg(args.messageId, 'channel.no_target', '没说是哪条消息', '从消息列表里拿编号')
      if (!deps.status().connected) refuse('channel.offline', '现在没连上 QQ', '等连上再说')
      const emoji = textArg(args.emoji, 'channel.no_emoji', '没给表情', '给一个表情编号')
      const result = await deps.react(messageId, emoji)
      if (!result.ok) refuse(result.code ?? 'channel.react_failed', result.reason ?? '回应失败', '当作没看到，继续聊别的')
      return { ok: true, messageId }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_publish_post',
    description: '发一条动态，群里的人都看得见，比在这个会话里说一句更公开。既定话题的日常、吃喝这类用 routine；新话题、想公开讲的用 public。级别、体检、冷却与当天额度都由发布入口判，被拒就照它给的码与下一步办，别换个说法重发同一条。只想回一句，或者拿不准该不该公开，就别用它。',
    parameters: {
      text: { type: 'string', description: '要发出去的正文，空的不发。' },
      kind: { type: 'string', enum: POST_LEVELS, description: 'routine 是既定话题的日常动态，public 是要公开讲的新内容。' },
      topic: { type: 'string', description: '例行动态要说清属于哪一类话题，比如日常、吃喝；公开的新内容可以不填。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const text = typeof args.text === 'string' ? args.text : ''
      const kind = typeof args.kind === 'string' ? args.kind : ''
      const topic = filled(args.topic)
      // 话题没报就不带这个字段，让发布入口按"缺话题"拒
      const facts = topic === undefined ? { chatKey, level: kind } : { chatKey, level: kind, topic }
      const result = await deps.publish('post', text, facts)
      if (!result.ok) refuse(result.code ?? 'post.blocked', result.reason ?? '这条动态没发出去', nextStep(result))
      return { ok: true, at: result.at ?? 0, messageId: result.delivery?.messageId ?? '' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_comment_post',
    description: '在这个群公开评论一条，群里的人都看得见。要把话说给所有人听才用它；只想让某一个人知道，改用 qq_send_private。评论要先有确认票：先调 qq_request_confirm 拿票号，再调 qq_confirm_action 盖章，最后才调这个工具，没票会回 comment.needs_confirm。话题得落在预授权清单里；被拒就照回给你的码与下一步办，别换个说法重发同一条。',
    parameters: {
      text: { type: 'string', description: '评论正文，空的不发。' },
      topic: { type: 'string', description: '这条评论挂在哪一类话题上，比如日常、吃喝，要落在预授权清单里。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const text = typeof args.text === 'string' ? args.text : ''
      const topic = filled(args.topic)
      const facts = topic === undefined ? { chatKey, ...PUBLISH_KEYS } : { chatKey, topic, ...PUBLISH_KEYS }
      const result = await deps.publish('comment', text, facts)
      if (!result.ok) refuseAction(result, 'comment.blocked')
      return { ok: true, at: result.at ?? 0, messageId: result.delivery?.messageId ?? '' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_send_private',
    description: '给一个人发私信，只有对方看得见，群里其他人都看不到。有话只对他说、不愿第三个人看见才用它；想让大家都看见，改用 qq_comment_post。私信要先有确认票：先调 qq_request_confirm 拿票号，再调 qq_confirm_action 盖章，最后才调这个工具，没票会回 private.needs_confirm。对方编号得在允许名单里；被拒就照码与下一步办，别换个说法重发。',
    parameters: {
      peer: { type: 'string', description: '对方的编号，也就是私信的收件人。' },
      text: { type: 'string', description: '私信正文，空的不发。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const peer = filled(args.peer)
      const text = typeof args.text === 'string' ? args.text : ''
      // 没报对象就带一个空号的会话键，让发布入口按"缺对象"拒，这里不自己判
      const chatKey = `private:${peer ?? ''}`
      const facts = peer === undefined ? { chatKey, ...PUBLISH_KEYS } : { chatKey, peer, ...PUBLISH_KEYS }
      const result = await deps.publish('private', text, facts)
      if (!result.ok) refuseAction(result, 'private.blocked')
      return { ok: true, at: result.at ?? 0, peer: peer ?? '', messageId: result.delivery?.messageId ?? '' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_request_confirm',
    description: '把一段正文放进待确认队列，换一张确认票。要发评论或私信之前先调它：拿到票号后调 qq_confirm_action 盖章，再调 qq_comment_post 或 qq_send_private，正文要一字不差。同一段正文只进队列一次，重复要票会回 confirm_duplicate。它只发票，不发送。',
    parameters: {
      kind: { type: 'string', enum: CONFIRM_KINDS, required: true, description: '这张票给哪一类动作用，评论是 comment，私信是 private。' },
      text: { type: 'string', description: '打算发出去的正文，要和真正发的那一段逐字相同。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const text = typeof args.text === 'string' ? args.text : ''
      const result = deps.requestConfirm(args.kind, text, Date.now())
      if (!result.ok) refuseAction(result, `${args.kind}.blocked`)
      return Promise.resolve({ ok: true, confirmId: result.confirmId ?? '', expiresAt: result.expiresAt ?? 0 })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_confirm_action',
    description: '给一张确认票盖章，让那个编号对应的正文可以发出去。qq_request_confirm 拿回票号之后、真正发出去之前调它。一张票只用一次，编号不对或已经过期都会被拒，那就重新要一张再来。它只盖章，不发送，也不改正文。',
    parameters: {
      confirmId: { type: 'string', description: 'qq_request_confirm 给回来的那个票号。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const confirmId = typeof args.confirmId === 'string' ? args.confirmId : ''
      const result = deps.confirm(confirmId, Date.now())
      if (!result.ok) refuseAction(result, 'confirm.unknown')
      return Promise.resolve({ ok: true, confirmId: result.confirmId ?? confirmId })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_write_farewell',
    description: '真的走到那一步时用一次，写下留给她的那句话：不解释、不复述系统提示、不索取回应，两百字以内。同一天只收一次，被拒或存不下都会回一个码，照码办，别换个说法重写。',
    parameters: {
      text: { type: 'string', description: '留给她的那句话，两百字以内，空的不收。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      const text = textArg(args.text, 'farewell.empty', '没有正文', '想留话就写一句，不想说就别调这个工具')
      const result = deps.stageFarewell(text, Date.now())
      if (!result.ok) refuse(result.code ?? 'farewell.write_failed', result.reason ?? '这句话没存进去', result.hint ?? '别换个说法重写，就当已经说完了')
      return Promise.resolve({ ok: true, at: result.at ?? Date.now() })
    },
  }))

  const read = deps.read
  // 没接上读这一路时也给一个能看懂的码，别让模型以为自己忘了传参数
  const readable = (): NonNullable<typeof read> => {
    if (read === undefined) refuse('channel.read_unavailable', '这会儿翻不了记录', '等连接那一路接上再问')
    return read
  }

  ctx.tools.register(defineTool({
    name: 'qq_read_history',
    description: '翻这个群最近说过的话。只翻群，不翻私聊；一次最多给三十条，从旧到新。想接着看某一条就拿它的编号去调 qq_read_message。',
    parameters: {
      count: { type: 'number', description: '想看几条，不填给十条，最多三十条。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const asked = typeof args.count === 'number' && Number.isFinite(args.count) ? args.count : 10
      const outcome = await readable().history(chatKey, asked)
      if (!outcome.ok) refuse(outcome.code, outcome.reason, outcome.hint)
      return { count: outcome.items.length, items: outcome.items }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_read_members',
    description: '看这个群里都有谁，给编号、名字与在群里的身份。只列群，不列私聊；最多给两百个。',
    parameters: {
      limit: { type: 'number', description: '最多列几个，不填给五十个，最多两百个。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const asked = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 50
      const outcome = await readable().members(chatKey, asked)
      if (!outcome.ok) refuse(outcome.code, outcome.reason, outcome.hint)
      return { count: outcome.members.length, items: outcome.members }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_read_message',
    description: '按编号看具体那一条消息，能拿到是谁说的、什么时候说的和正文。编号从群记录里拿。',
    parameters: {
      message_id: { type: 'string', description: '消息编号，从 qq_read_history 给的那几条里挑一个。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const messageId = textArg(args.message_id, 'channel.read_no_id', '没给编号', '从群记录里拿一个编号再问')
      const outcome = await readable().message(messageId)
      if (!outcome.ok) refuse(outcome.code, outcome.reason, outcome.hint)
      return { item: outcome.message }
    },
  }))

  // 表情包没接上时给个能看懂的码，别让模型以为是自己少传了参数
  const stickerBox = (): NonNullable<typeof deps.stickers> => {
    if (deps.stickers === undefined) refuse('sticker.unavailable', '这会儿翻不了表情包', '等装配时把表情包库接上再问')
    return deps.stickers
  }

  ctx.tools.register(defineTool({
    name: 'qq_list_stickers',
    description: '看看手上有哪些表情图，给编号、标签与放哪。可以按标签找，比如「困」「开心」；不填标签就列全部。挑中哪张，把它的编号交给 qq_send_sticker。',
    parameters: {
      tag: { type: 'string', description: '想找哪个标签，不填就列全部。' },
      limit: { type: 'number', description: '最多列几张，不填给十张。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const tag = typeof args.tag === 'string' ? args.tag : ''
      const asked = typeof args.limit === 'number' && Number.isFinite(args.limit) ? args.limit : 10
      const outcome = await stickerBox().list(tag, asked)
      if (!outcome.ok) refuse(outcome.code, outcome.reason, outcome.hint)
      return { count: outcome.stickers.length, items: outcome.stickers }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_send_sticker',
    description: '在这个会话里发一张表情图。编号从 qq_list_stickers 给的那几张里挑，别自己编。发之前照样过发言那一道体检。',
    parameters: {
      sticker_id: { type: 'string', description: '图的编号，从列出来的几张里挑一个。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const id = textArg(args.sticker_id, 'sticker.no_id', '没给编号', '先用 qq_list_stickers 列一遍，照它给的编号挑')
      const inspection = deps.inspect(chatKey, '')
      if (!inspection.ok) refuse(inspection.code ?? 'outbound.blocked', inspection.reason ?? '现在不能发', nextStep(inspection))
      const picked = await stickerBox().pick(id)
      if (!picked.ok) refuse(picked.code, picked.reason, picked.hint)
      const sent = await stickerBox().send(picked.sticker.file, chatKey)
      if (!sent.ok) refuse(sent.code ?? 'channel.send_failed', sent.reason ?? '这张没发出去', '等一下再试，别连着发同一张')
      return { ok: true, ...sent.messageId === undefined ? {} : { messageId: sent.messageId } }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qq_send_poke',
    description: '轻轻戳一下群里的某个人。只在群里用，私聊不戳；没开这个动作时会回一个码，照码办，别换个说法重试。',
    parameters: {
      user_id: { type: 'string', description: '要戳的人的编号，从群成员里拿。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const chatKey = chatKeyOf(exec)
      const userId = textArg(args.user_id, 'poke.no_id', '没给要戳谁', '先用 qq_read_members 拿编号')
      const inspection = deps.inspect(chatKey, '')
      if (!inspection.ok) refuse(inspection.code ?? 'outbound.blocked', inspection.reason ?? '现在不能戳', nextStep(inspection))
      if (deps.poke === undefined) refuse('poke.unavailable', '这会儿不准戳人', '把 pokeEnabled 打开再来')
      const sent = await deps.poke(chatKey, userId)
      if (!sent.ok) refuse(sent.code ?? 'poke.failed', sent.reason ?? '没戳成', '等一下再试，别连着戳同一个人')
      return { ok: true }
    },
  }))
}
