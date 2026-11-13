// 发牢骚只摆身体读数与真实事由，不替模型判断该不该开口

import type { Context } from '@huoli/cordis'
import type { AssembleContext } from '@huoli/huoli-system-prompt'
import type { QqAttentionSeam, QqMessage } from '@huoli/huoli-qq-attention'
import type { Candidate } from '@huoli/huoli-qq-proactive'
import type { NameTagView, QqSubjectSeam } from '@huoli/huoli-qq-subject'
import type { QqVitalsSeam, VitalsState } from '@huoli/huoli-qq-vitals'

/** 窗口再小也按一分钟算，太短的时间窗取不到真实事由 */
const MIN_WINDOW_MS = 60_000
/** 最多摆几条事由，多了就像控诉 */
const MAX_GROUNDS = 3
/** 只看最近这些条消息，够攒事由就行 */
const RECENT_MAX = 30

/** 这一行认下的门槛，缺了哪项都按这里的默认值 */
export const COMPLAINT_DEFAULTS = {
  /** 关掉就一整段都不出现 */
  enabled: true,
  /** 低于这条线的读数不单独列出来，只是减少提示噪声；不是开口许可 */
  driveThreshold: 0.25,
  /** 至少攒够几条具体事由才放行 */
  minGrounds: 1,
  /** 事由只认真实发生的近期消息，毫秒 */
  windowMs: 10 * 60_000,
  /** 自己连着说到这么多条就不再算场合合适 */
  maxRecentOwn: 3,
  /** 同一个外号被连着叫几回才算事由 */
  repeatedNameHits: 3,
  /** 同一个人连着喊你几回才算事由 */
  repeatedCallHits: 3,
  /** 你上一条说完之后要有几条在聊，才谈得上没人接 */
  ignoredAfter: 2,
  /** 允许把不满指向具体某个人，默认关，只许指向现象 */
  allowNamedTarget: false,
  /** 只有自己的身体状态也能发一句，但不许把情绪算到别人头上 */
  allowSelfStateGround: true,
  /** 候选只提供由头，不使用更高的驱力门槛 */
  soloDriveFloor: 0.25,
  /** 隔多久没跟这个人说话算一条具体事实，分钟 */
  idleGroundMinutes: 120,
} as const

/** 配置里能改的那几项 */
export interface ComplaintSettingsInput {
  /** 要不要发牢骚这回事，关掉就整段不出现 */
  enabled?: boolean
  /** 低于这条线的读数不单独列出来，零到一 */
  driveThreshold?: number
  /** 至少要有几条具体事由才放行 */
  minGrounds?: number
  /** 事由只认这段时间内的真实消息，毫秒 */
  windowMs?: number
  /** 自己刚连发到这么多条，就不再允许抱怨没人理 */
  maxRecentOwn?: number
  /** 同一个外号被叫够几回算一条事由 */
  repeatedNameHits?: number
  /** 同一个人冲你说够几句算一条事由 */
  repeatedCallHits?: number
  /** 你说完以后有几句在聊却没回你，算一条事由 */
  ignoredAfter?: number
  /** 允不允许把不满指向具体某个人，默认只指向现象 */
  allowNamedTarget?: boolean
  /** 允不允许只拿自己的身体状态当事由 */
  allowSelfStateGround?: boolean
  /** 候选只提供由头时使用的读数下限 */
  soloDriveFloor?: number
  /** 隔多久没跟这个人说话算一条具体事实，分钟 */
  idleGroundMinutes?: number
}

/** 认下来的那一份门槛，所有项都齐 */
export interface ComplaintSettings {
  enabled: boolean
  driveThreshold: number
  minGrounds: number
  windowMs: number
  maxRecentOwn: number
  repeatedNameHits: number
  repeatedCallHits: number
  ignoredAfter: number
  allowNamedTarget: boolean
  allowSelfStateGround: boolean
  soloDriveFloor: number
  idleGroundMinutes: number
}

/** 能当驱力的负向读数，取的都在身体那一份状态里 */
export type ComplaintDriveKey =
  | 'irritability'
  | 'anger'
  | 'resentment'
  | 'cortisol'
  | 'loneliness'
  | 'adenosine'
  | 'sadness'
  | 'pain'
  | 'energy'
  | 'hunger'
  | 'thirst'
  | 'fever'

/** 过线的驱力：哪一项、平常怎么说、现在多少 */
export interface ComplaintDrive {
  key: ComplaintDriveKey
  label: string
  /** 只有自己状态时用的那句，只说自己 */
  quote: string
  /** 折算到两位小数的读数 */
  value: number
}

/** 具体事由的种类 */
export type ComplaintGroundKind = 'called_out_repeatedly' | 'ordered_around' | 'ignored' | 'own_state' | 'idle'

/** 一条能指得出来的事由 */
export interface ComplaintGround {
  kind: ComplaintGroundKind
  /** 这一条具体到能对上哪件事 */
  quote: string
  /** 落在窗口里的条数 */
  count: number
  lastAt: number
  /** 只有允许指名时才带，不然只留现象 */
  personId?: string
  personName?: string
}

/** 关系里记下的外号加上是谁叫的 */
export interface ComplaintNameCall extends NameTagView {
  personId: string
  personName: string
}

/** 场合到底合不合适 */
export interface ComplaintRoom {
  ok: boolean
  /** 原因码，只给记录与测试看 */
  reason: 'room_ok' | 'asleep' | 'just_spoke_repeatedly'
  /** 给模型看的那句 */
  text: string
}

/** 逐条过门的结论 */
export interface ComplaintVerdict {
  /** 现在能不能发牢骚 */
  allowed: boolean
  /** 能不能只因为这件事主动起一句 */
  solo: boolean
  /** 过线的驱力，没过线就没有这一项 */
  drive?: ComplaintDrive
  /** 能给模型看的几句具体事由，不放行时只在记录里 */
  grounds: readonly ComplaintGround[]
  /** 场合是否合适 */
  room: ComplaintRoom
  /** 自己在这个会话里连着说了几条，只作为事实 */
  selfStreak?: number
  gates: { drive: boolean; grounds: boolean; room: boolean; solo: boolean }
}

/** 逐条过门要看的东西 */
export interface ComplaintInput {
  now: number
  /** 身体那一份状态，只用其中几项负向读数 */
  body?: Partial<VitalsState>
  /** 自己在这个会话里连着说了几条 */
  selfStreak?: number
  /** 最近一次自己发言的时刻 */
  lastSelfSpokeAt?: number
  /** 收件箱里这个会话最近的消息 */
  recent?: readonly QqMessage[]
  /** 关系里这个会话记下的外号 */
  nameCalls?: readonly ComplaintNameCall[]
  /** 最近一条真人消息时刻 */
  lastHumanAt?: number
}

/** 驱力读数与它那句平常说法 */
const DRIVE_READINGS: ReadonlyArray<{ key: ComplaintDriveKey; label: string; quote: string }> = [
  { key: 'irritability', label: '有点上火', quote: '你心里有点闷，话会变短' },
  { key: 'anger', label: '还在生气', quote: '你还在生气，说话不软' },
  { key: 'resentment', label: '心里记着这事', quote: '这事你心里还没过去' },
  { key: 'cortisol', label: '绷得有点紧', quote: '你绷得有点紧，耐心不多' },
  { key: 'loneliness', label: '有点闷', quote: '你有点闷，一直没人跟你说话' },
  { key: 'adenosine', label: '困得难受', quote: '你困得脑子发木，还得撑着' },
  { key: 'sadness', label: '情绪有点低', quote: '你情绪有点低，提不起劲' },
  { key: 'pain', label: '身上不舒服', quote: '你身上不舒服，不太想动' },
  { key: 'energy', label: '没什么力气', quote: '你累得快没力气了，脑子也转得慢' },
  { key: 'hunger', label: '肚子空得难受', quote: '你饿得难受，已经很难装作没事' },
  { key: 'thirst', label: '渴得难受', quote: '你渴得嗓子发干，心思全在喝水上' },
  { key: 'fever', label: '身上发烫', quote: '你身上发烫，整个人都没精神' },
]

/** 把配置认成一份齐全的门槛，写坏的数按默认那一档 */
export function resolveComplaintSettings(input?: ComplaintSettingsInput): ComplaintSettings {
  const base = COMPLAINT_DEFAULTS
  const given = input ?? {}
  return {
    enabled: given.enabled !== false,
    driveThreshold: clamp01(given.driveThreshold, base.driveThreshold),
    minGrounds: Math.max(1, Math.floor(given.minGrounds ?? base.minGrounds)),
    windowMs: Math.max(MIN_WINDOW_MS, Math.floor(given.windowMs ?? base.windowMs)),
    maxRecentOwn: Math.max(1, Math.floor(given.maxRecentOwn ?? base.maxRecentOwn)),
    repeatedNameHits: Math.max(1, Math.floor(given.repeatedNameHits ?? base.repeatedNameHits)),
    repeatedCallHits: Math.max(1, Math.floor(given.repeatedCallHits ?? base.repeatedCallHits)),
    ignoredAfter: Math.max(1, Math.floor(given.ignoredAfter ?? base.ignoredAfter)),
    allowNamedTarget: given.allowNamedTarget === true,
    allowSelfStateGround: given.allowSelfStateGround !== false,
    soloDriveFloor: clamp01(given.soloDriveFloor, base.soloDriveFloor),
    idleGroundMinutes: Math.max(1, Math.floor(given.idleGroundMinutes ?? base.idleGroundMinutes)),
  }
}

/**
 * 把身体读数与现场事实整理出来，不替模型判断能否开口
 * @param input - 身体读数、连发条数、最近消息与外号记录
 * @param settings - 事实收口参数
 * @returns 当前身体读数、真实事由与场合事实
 */
export function complaintVerdict(input: ComplaintInput, settings: ComplaintSettings): ComplaintVerdict {
  const drive = strongestDrive(input.body, settings.driveThreshold)
  const external = externalGrounds(input, settings)
  const idleMinutes = settings.idleGroundMinutes * 60_000
  const idle = drive === undefined && input.lastHumanAt !== undefined && input.now - input.lastHumanAt >= idleMinutes
    ? [{ kind: 'idle' as const, quote: '隔了有一阵没跟这个人说话', count: 1, lastAt: input.lastHumanAt }]
    : []
  let grounds: ComplaintGround[] = external
  if (grounds.length === 0) grounds = idle
  if (grounds.length === 0 && drive !== undefined && settings.allowSelfStateGround) {
    grounds = [{ kind: 'own_state' as const, quote: drive.quote, count: 1, lastAt: input.now }]
  }
  const room = roomOf(input, settings)
  const gates = {
    drive: drive !== undefined,
    grounds: grounds.length >= settings.minGrounds,
    room: room.ok,
    solo: drive !== undefined && drive.value >= settings.soloDriveFloor,
  }
  // 只摆事实：身体读数、真实事由、连发条数都不再当成开口许可或否决
  const allowed = true
  return {
    allowed,
    solo: gates.drive && gates.grounds,
    ...drive === undefined ? {} : { drive },
    grounds: settings.allowNamedTarget ? grounds : grounds.map(withoutName),
    room,
    ...input.selfStreak === undefined ? {} : { selfStreak: input.selfStreak },
    gates,
  }
}

/**
 * 把结论写成给模型看的一段事实：只有读数与真发生过的事，没有 ALLOWED / SOLO_OPEN / STOP 这类代码许可。
 * 谈不谈、主动起不起一句、同一件事要不要放下，全由模型自己看着办。
 * @param verdict - 只用来取读数、事由与现场
 * @returns 事实段，没有过线读数时整段不出现
 */
export function complaintLineOf(verdict: ComplaintVerdict): string {
  const drive = verdict.drive
  if (drive === undefined) return ''
  const lines = [
    '[DATA] QQ_COMPLAINT',
    `DRIVE_READING: ${drive.label}（${drive.value}）`,
    'GROUNDS:',
  ]
  for (const ground of verdict.grounds) lines.push(`- ${groundText(ground)}`)
  lines.push(`RECENT_OWN_LINES: ${verdict.selfStreak ?? 0}`)
  lines.push('RULE: these_are_observable_facts_and_things_that_really_happened; you_decide_whether_to_mention_them_whether_to_let_them_go_and_whether_you_were_wrong; no_code_permission; no_forced_grumble; do_not_read_this_section_aloud')
  return lines.join('\n')
}

/** 发牢骚这一段要看的东西 */
export interface ComplaintPromptDeps {
  /** 当前会话，概率闲聊模式给空串 */
  activeChatKey(context: AssembleContext): string
  vitals: QqVitalsSeam | undefined
  attention: QqAttentionSeam | undefined
  subject: QqSubjectSeam | undefined
  /** 机器人自己的 QQ 号，用来排除最近消息里的自发记录 */
  selfId?: string | undefined
  /** 这一行给的发牢骚配置 */
  config: ComplaintSettingsInput | undefined
}

/**
 * 把发牢骚那一段挂成提示词
 * @param ctx - 运行环境
 * @param deps - 身体、注意力、关系与当前会话
 */
export function registerComplaintPrompt(ctx: Context, deps: ComplaintPromptDeps): void {
  const settings = resolveComplaintSettings(deps.config)
  if (!settings.enabled) return
  ctx.systemPrompt.section({
    name: 'qq:complaint',
    order: 345,
    text: (context) => {
      const chatKey = deps.activeChatKey(context)
      if (chatKey === '') return ''
      const now = Date.now()
      const verdict = complaintVerdictOf(deps, settings, chatKey, now)
      return complaintLineOf(verdict)
    },
  })
}

/**
 * 把当前身体与现场里真正成立的牢骚事由变成一个主动候选。
 * @param verdict - 当前会话已经算出的牢骚事实
 * @param chatKey - 准备主动开口的会话
 * @param now - 本次判断时刻
 * @returns 只带事实、不带成句正文的候选；没有身体读数或具体事由时为 undefined
 */
export function complaintCandidateOf(
  verdict: ComplaintVerdict,
  chatKey: string,
  now = Date.now(),
): Candidate | undefined {
  if (chatKey === '') return undefined
  if (verdict.grounds.length === 0) return undefined
  return {
    id: `complaint:${chatKey}:${Math.floor(now / 60_000)}`,
    kind: 'share',
    why: [...new Set([...(verdict.drive === undefined ? [] : [verdict.drive.quote]), ...verdict.grounds.map(ground => ground.quote)])].join('；'),
    text: '',
    source: 'self_state',
    at: now,
  }
}

/**
 * 当前会话的牢骚判断只在这里组装，提示词和主动候选共用同一份事实。
 * @param deps - 身体、注意力、关系与当前会话
 * @param settings - 已经解析的门槛
 * @param chatKey - 当前会话
 * @param now - 本次判断时刻
 * @returns 这一轮的完整牢骚判断
 */
export function complaintVerdictOf(
  deps: ComplaintPromptDeps,
  settings: ComplaintSettings,
  chatKey: string,
  now: number,
): ComplaintVerdict {
  const body = deps.vitals?.read()
  const state = deps.attention?.store.of(chatKey)
  const streak = state?.selfTalkStreak
  const spokeAt = state?.lastSelfSpokeAt
  const lastHuman = [...(deps.attention?.inbox.recent(chatKey, RECENT_MAX) ?? [])].reverse()
    .find(message => message.senderId !== '' && message.senderId !== deps.selfId && message.at <= now)
  return complaintVerdict({
    now,
    ...body === undefined ? {} : { body },
    ...streak === undefined ? {} : { selfStreak: streak },
    ...spokeAt === undefined ? {} : { lastSelfSpokeAt: spokeAt },
    ...deps.attention === undefined ? {} : { recent: deps.attention.inbox.recent(chatKey, RECENT_MAX) },
    nameCalls: nameCallsOf(deps.subject, chatKey, now),
    ...lastHuman === undefined ? {} : { lastHumanAt: lastHuman.at },
  }, settings)
}

/** 把读数夹在零到一之间，写坏了用默认那一档 */
function clamp01(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

/** 挑过线的负向读数里最强的那一项 */
function strongestDrive(body: Partial<VitalsState> | undefined, threshold: number): ComplaintDrive | undefined {
  if (body === undefined) return undefined
  const hot: ComplaintDrive[] = []
  for (const reading of DRIVE_READINGS) {
    const value = reading.key === 'energy'
      ? body.energy === undefined ? undefined : 1 - body.energy
      : body[reading.key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < threshold) continue
    hot.push({ ...reading, value: Math.round(value * 100) / 100 })
  }
  hot.sort((left, right) => right.value - left.value)
  return hot[0]
}

/** 从近期消息与关系记录里攒外部事由，最近的排前面 */
function externalGrounds(input: ComplaintInput, settings: ComplaintSettings): ComplaintGround[] {
  const recent = input.recent ?? []
  const ignored = ignoredGroundOf(input, recent, settings)
  return [
    ...callGroundsOf(recent, input.now, settings),
    ...nameGroundsOf(input.nameCalls ?? [], input.now, settings),
    ...ignored === undefined ? [] : [ignored],
  ].sort((left, right) => right.lastAt - left.lastAt).slice(0, MAX_GROUNDS)
}

/** 同一个外号被连叫了几回 */
function nameGroundsOf(calls: readonly ComplaintNameCall[], now: number, settings: ComplaintSettings): ComplaintGround[] {
  const grounds: ComplaintGround[] = []
  for (const call of calls) {
    if (now - call.lastAt > settings.windowMs) continue
    const hits = Math.max(call.hits, Math.round(call.effectiveHits))
    if (hits < settings.repeatedNameHits) continue
    grounds.push({
      kind: 'called_out_repeatedly',
      quote: `同一个外号连着叫了 ${hits} 回：${call.label}`,
      count: hits,
      lastAt: call.lastAt,
      personId: call.personId,
      personName: call.personName,
    })
  }
  return grounds
}

/** 同一个人反复使唤：窗口里冲自己来的消息按人计数 */
function callGroundsOf(recent: readonly QqMessage[], now: number, settings: ComplaintSettings): ComplaintGround[] {
  const byPerson = new Map<string, { count: number; lastAt: number; name: string }>()
  for (const message of recent) {
    if (now - message.at > settings.windowMs) continue
    if (message.atMe !== true && message.replyToBot !== true) continue
    if (message.senderId === '') continue
    const seen = byPerson.get(message.senderId)
    byPerson.set(message.senderId, {
      count: (seen?.count ?? 0) + 1,
      lastAt: Math.max(seen?.lastAt ?? 0, message.at),
      name: seen?.name !== undefined && seen.name !== '' ? seen.name : message.senderName ?? '',
    })
  }
  const grounds: ComplaintGround[] = []
  for (const [personId, row] of byPerson) {
    if (row.count < settings.repeatedCallHits) continue
    grounds.push({
      kind: 'ordered_around',
      quote: `同一个人最近连着喊你 ${row.count} 次`,
      count: row.count,
      lastAt: row.lastAt,
      personId,
      personName: row.name,
    })
  }
  return grounds
}

/** 自己说完别人接着聊、没有一条是回你的 */
function ignoredGroundOf(
  input: ComplaintInput,
  recent: readonly QqMessage[],
  settings: ComplaintSettings,
): ComplaintGround | undefined {
  const spokeAt = input.lastSelfSpokeAt ?? 0
  if (spokeAt <= 0 || input.now - spokeAt > settings.windowMs) return undefined
  const after = recent.filter(message => message.at > spokeAt)
  if (after.length < settings.ignoredAfter) return undefined
  if (after.some(message => message.atMe === true || message.replyToBot === true)) return undefined
  return {
    kind: 'ignored',
    quote: `你上一条说完之后有 ${after.length} 条在聊，没有一条是回你的`,
    count: after.length,
    lastAt: after[after.length - 1]?.at ?? input.now,
  }
}

/** 场合：睡着、刚连发都不合适 */
function roomOf(input: ComplaintInput, settings: ComplaintSettings): ComplaintRoom {
  if (input.body?.sleep_state === 'sleeping') {
    return { ok: false, reason: 'asleep', text: '你现在睡着了，这会儿不发牢骚' }
  }
  const streak = Math.max(0, input.selfStreak ?? 0)
  if (streak >= settings.maxRecentOwn) {
    return {
      ok: false,
      reason: 'just_spoke_repeatedly',
      text: `你刚连着说了 ${streak} 条，这会儿不适合再抱怨`,
    }
  }
  return { ok: true, reason: 'room_ok', text: '场合合适' }
}

/** 一条事由给模型看的样子 */
function groundText(ground: ComplaintGround): string {
  const who = ground.personName === undefined || ground.personName === '' ? '' : `（${ground.personName}）`
  return `${ground.quote}${who}`
}

/** 去掉指向某个人那两项，只留现象 */
function withoutName(ground: ComplaintGround): ComplaintGround {
  return { kind: ground.kind, quote: ground.quote, count: ground.count, lastAt: ground.lastAt }
}

/** 关系里这个会话记下的外号，带上是谁叫的 */
function nameCallsOf(subject: QqSubjectSeam | undefined, chatKey: string, now: number): ComplaintNameCall[] {
  if (subject === undefined) return []
  const calls: ComplaintNameCall[] = []
  for (const person of subject.relations.forChat(chatKey)) {
    for (const tag of subject.relations.nameTags(person.personId, chatKey, now)) {
      calls.push({ ...tag, personId: person.personId, personName: person.displayName })
    }
  }
  return calls
}
