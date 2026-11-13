// 自主行为只从身体、念头和具体现场里取事实，不产出行动结论

import type { Context } from '@huoli/cordis'
import type { QqAttentionSeam, QqMessage } from '@huoli/huoli-qq-attention'
import type { QqChannelSeam } from '@huoli/huoli-qq-channel'
import type { QqContinuitySeam } from '@huoli/huoli-qq-continuity'
import { localDay, type QqMemorySeam } from '@huoli/huoli-qq-memory'
import type { Candidate, QqProactiveSeam } from '@huoli/huoli-qq-proactive'
import type { VitalsState, QqVitalsSeam } from '@huoli/huoli-qq-vitals'
import type { QqMaterialSeam } from '@huoli/huoli-qq-material'
import type { QqSubjectSeam } from '@huoli/huoli-qq-subject'
import { complaintCandidateOf, complaintVerdictOf, resolveComplaintSettings, type ComplaintPromptDeps, type ComplaintVerdict } from './complaint.ts'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import { appendConsidered, type DecisionLog, type Verdict } from './decisions.ts'
import { createAutonomousNudger, createProactiveTicker, humanActiveOf, postWantRule } from './proactive-tools.ts'
import type { RoundRuntime } from './rounds.ts'
import type { AutonomousNudgeInput, DeliveredHistory } from './runtime.ts'
import { restCapOf } from './speak-gate.ts'
import type { Config } from './types.ts'

/** 当前会话的念头、身体动机与具体话头只作为候选事实 */
export function selfCandidates(input: {
  chatKey: string
  material: QqMaterialSeam | undefined
  vitals: { read(): VitalsState } | undefined
  attention: QqAttentionSeam | undefined
  continuity: QqContinuitySeam | undefined
  subject: QqSubjectSeam | undefined
  complaint?: ComplaintVerdict
  now: number
}): Candidate[] {
  const thoughts = input.material === undefined ? [] : input.material.thoughts.live(input.chatKey).map(thought => ({
    id: thought.id,
    kind: 'share' as const,
    why: '有一件事一直惦记着',
    text: thought.text,
    source: 'thought',
    at: thought.at,
  }))
  const body = input.vitals?.read()
  const motive = body === undefined ? undefined : selfMomentCandidate({
    chatKey: input.chatKey,
    body,
    attention: input.attention,
    continuity: input.continuity,
    thoughts,
    lastActive: input.subject?.store.read().lastActive ?? '',
    now: input.now,
  })
  const complaint = input.complaint === undefined
    ? undefined
    : complaintCandidateOf(input.complaint, input.chatKey, input.now)
  return [
    ...thoughts,
    ...motive === undefined ? [] : [motive],
    ...complaint === undefined ? [] : [complaint],
  ]
}

/** 自主时刻只把身体、念头和具体话头作为事实，不替模型决定行动 */
export function selfMomentForTurn(input: {
  body?: VitalsState
  material: QqMaterialSeam | undefined
  continuity: QqContinuitySeam | undefined
  chatKey: string
}): AutonomousNudgeInput {
  return selfMomentFacts({
    ...input.body === undefined ? {} : { body: input.body },
    ...input.material === undefined ? {} : {
      thoughts: input.material.thoughts.live(input.chatKey).map(thought => thought.text),
    },
    ...input.continuity === undefined ? {} : { focus: input.continuity.resume(input.chatKey) },
  })
}

/** 从身体读数与具体话头里拼一段自主事实：只摆数值，不把读数翻成「想开口/惦记吃的」这类假念头 */
export function selfMomentFacts(input: {
  body?: VitalsState
  thoughts?: readonly string[]
  focus?: string
}): AutonomousNudgeInput {
  const body = input.body
  const round = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
  const lines: string[] = []
  if (body !== undefined) lines.push(`BODY_READINGS: proactive_bias=${round(body.proactive_bias)} loneliness=${round(body.loneliness)} hunger=${round(body.hunger)} thirst=${round(body.thirst)} adenosine=${round(body.adenosine)} dopamine=${round(body.dopamine)}`)
  for (const text of (input.thoughts ?? []).slice(-2)) lines.push(`心里留着：${text.slice(0, 60)}`)
  return {
    chatKey: '',
    busy: false,
    asleep: body?.asleep === true,
    hasCandidate: false,
    waitingForReason: false,
    ...lines.length === 0 ? {} : { internalMotive: lines.join('；') },
    ...input.focus === undefined ? {} : { focus: input.focus.slice(0, 120) },
  }
}

/** 从身体和现场挑一条有具体由头的自主候选，不凭空编正文 */
export function selfMomentCandidate(input: {
  chatKey: string
  body: VitalsState
  attention: QqAttentionSeam | undefined
  continuity: QqContinuitySeam | undefined
  thoughts: readonly Candidate[]
  lastActive: string
  now: number
}): Candidate | undefined {
  const last = [...input.attention?.inbox.recent(input.chatKey, 8) ?? []].reverse()
    .find((message: QqMessage) => message.text.trim().length >= 2)
  const thought = input.thoughts.at(-1)
  const close = input.continuity?.store.lastClose(input.chatKey)
  const round = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
  // 只摆可观察的现场，不再用阈值把身体读数翻成「想找人说话」「肚子空了」这类替模型写好的念头
  const parts = [
    `身体读数：dopamine=${round(input.body.dopamine)} loneliness=${round(input.body.loneliness)} hunger=${round(input.body.hunger)} thirst=${round(input.body.thirst)} proactive_bias=${round(input.body.proactive_bias)}`,
    last === undefined ? '' : `最近有人说过：${last.text.slice(0, 60)}`,
    thought === undefined ? '' : `心里惦记：${thought.text.slice(0, 60)}`,
    close?.nextOpening === undefined || close.nextOpening.trim() === '' ? '' : `上次留了话头：${close.nextOpening.slice(0, 60)}`,
    input.lastActive === input.chatKey ? '这是最近聊过的会话' : '',
  ].filter(part => part !== '')
  if (parts.length < 2) return undefined
  return {
    id: `self:${input.chatKey}:${Math.floor(input.now / 300_000)}`,
    kind: 'share',
    why: parts.slice(0, 4).join('；'),
    text: '',
    source: 'self_state',
    at: input.now,
  }
}

interface LimitsRuntime {
  state(): { proactiveAllowed: boolean; sleepFrom: number; sleepUntil: number; proactivePerHour: number }
  proactiveSentThisHour(chatKey: string, at: number): number
}

interface EmergencyRuntime {
  state(): { active: boolean }
}

interface QuietRuntime {
  remainingMs(): number
}

interface BalanceRuntime {
  status(): { blocked?: boolean }
}

/** 装配主动判断要用的现场 */
export interface ProactiveRuntimeOptions {
  ctx: Context
  config: Config
  ownerChatKey: string
  activeChatKey: ComplaintPromptDeps['activeChatKey']
  decisions: DecisionLog
  noteWake(kind: string, chatKey: string, detail?: Record<string, unknown>): void
  emergency: EmergencyRuntime
  quiet: QuietRuntime
  balance: BalanceRuntime | undefined
  proactive: QqProactiveSeam | undefined
  vitals: QqVitalsSeam | undefined
  subject: QqSubjectSeam | undefined
  attention: QqAttentionSeam | undefined
  material: QqMaterialSeam | undefined
  continuity: QqContinuitySeam | undefined
  memory: QqMemorySeam | undefined
  limits: LimitsRuntime
  deliveredHistory: DeliveredHistory
  rounds: Pick<RoundRuntime, 'awake'>
  channel: QqChannelSeam | undefined
  /** 入站附件还在准备时，不给同一会话排自主时刻 */
  incomingPending(chatKey: string): boolean
  humanActiveWindowMs: number
  attentionSleeping(chatKey: string, at: number): boolean
  wake(
    chatKey: string,
    text: string,
    reason: string,
    media?: readonly unknown[],
    traceIds?: readonly string[],
    recordedText?: string,
  ): boolean
}

/** 主动判断的对外入口 */
export interface ProactiveRuntime {
  consider(chatKey: string, at: number, busy: boolean, throttled: boolean): void
  addChat(chatKey: string): void
  nudgeMs: number
}

/**
 * 装配主动候选、定时检查和会话事件
 * @param options - 现场、发送出口与运行限制
 * @returns 给轮次收尾和每日维护复用的判断入口
 */
export function installProactiveRuntime(options: ProactiveRuntimeOptions): ProactiveRuntime {
  const throttleMs = Math.max(0, options.config.proactiveThrottleMs ?? BUNDLE_DEFAULTS.proactiveThrottleMs)
  const nudgeMs = Math.max(60_000, options.config.nudgeMs ?? BUNDLE_DEFAULTS.nudgeMs)
  const lastConsidered = new Map<string, number>()
  const nudgeAutonomous = createAutonomousNudger({
    intervalMs: nudgeMs,
    note: (kind, chatKey, detail) => { options.noteWake(kind, chatKey, detail) },
    wake: (chatKey, text, reason, media, traceIds, recordedText) => {
      return options.wake(chatKey, text, reason, media, traceIds, recordedText)
    },
  })
  const postCandidateDays = new Map<string, { day: string; count: number }>()
  const addPostWantFrom = options.config.addPostWantFrom ?? BUNDLE_DEFAULTS.addPostWantFrom
  const postCandidateDailyMax = Math.max(0, options.config.postCandidateDailyMax ?? BUNDLE_DEFAULTS.postCandidateDailyMax)
  const postGathered = (chatKey: string, day: string): number => postCandidateDays.get(chatKey)?.day === day
    ? postCandidateDays.get(chatKey)?.count ?? 0
    : 0
  const postWantOf = postWantRule(addPostWantFrom, postCandidateDailyMax, (chatKey, at) => postGathered(chatKey, localDay(at)))
  const candidatesOf = (chatKey: string): Candidate[] => {
    const now = Date.now()
    const complaintDeps = {
      activeChatKey: options.activeChatKey,
      vitals: options.vitals,
      attention: options.attention,
      subject: options.subject,
      selfId: options.channel?.selfId,
      config: options.config.complaint,
    }
    const complaint = complaintVerdictOf(complaintDeps, resolveComplaintSettings(options.config.complaint), chatKey, now)
    return selfCandidates({
      chatKey,
      material: options.material,
      vitals: options.vitals,
      attention: options.attention,
      continuity: options.continuity,
      subject: options.subject,
      complaint,
      now,
    })
  }
  const noteConsidered = (chatKey: string, at: number, decision: { verdict: Verdict }): void => {
    appendConsidered(options.decisions, options.ctx.logger('qq-bundle'), chatKey, at, decision.verdict)
  }
  const consider = (chatKey: string, at: number, busy: boolean, throttled: boolean): void => {
    if (options.emergency.state().active || options.quiet.remainingMs() > 0) return
    if (options.incomingPending(chatKey)) return
    if (options.balance?.status().blocked === true || !options.limits.state().proactiveAllowed) return
    const proactive = options.proactive
    if (proactive === undefined || !proactive.enabled) return
    if (throttled && at - (lastConsidered.get(chatKey) ?? 0) < throttleMs) return
    lastConsidered.set(chatKey, at)
    const body = options.vitals?.read()
    options.subject?.store.tick(at)
    const postWant = body === undefined ? undefined : postWantOf(chatKey, at, body)
    const humanActive = humanActiveOf(options.attention, options.humanActiveWindowMs, chatKey, at)
    const decision = proactive.consider({
      chatKey,
      candidates: candidatesOf(chatKey),
      ...postWant === undefined ? {} : { external: [postWant] },
      history: options.deliveredHistory.history(chatKey),
      botBusy: busy,
      hasChannel: options.channel !== undefined,
      ...body === undefined ? {} : { proactiveBias: body.proactive_bias },
      ...body === undefined ? {} : { asleep: body.asleep, wakeAfter: body.wake_after },
      resting: restCapOf(options.vitals) === 1,
      humanActive,
      config: {
        enabled: true,
        quietStart: `${String(options.limits.state().sleepFrom).padStart(2, '0')}:00`,
        quietEnd: `${String(options.limits.state().sleepUntil).padStart(2, '0')}:00`,
      },
    })
    if (postWant !== undefined && decision.verdict.ok) {
      const day = localDay(at)
      postCandidateDays.set(chatKey, { day, count: postGathered(chatKey, day) + 1 })
    }
    if (decision.pending.length > 0) proactive.preview(chatKey)
    noteConsidered(chatKey, at, decision)
    const moment = selfMomentForTurn({
      ...body === undefined ? {} : { body },
      material: options.material,
      continuity: options.continuity,
      chatKey,
    })
    nudgeAutonomous({
      at,
      chatKey,
      humanActive,
      busy,
      asleep: body?.asleep === true,
      attentionSleeping: options.attentionSleeping(chatKey, at),
      resting: restCapOf(options.vitals) === 1,
      hasCandidate: decision.pending.length > 0,
      waitingForReason: decision.verdict.code === 'proactive.no_candidate',
      selfTalkStreak: options.attention?.store.of(chatKey).selfTalkStreak ?? 0,
      proactiveThisHour: options.limits.proactiveSentThisHour(chatKey, at),
      proactivePerHour: options.limits.state().proactivePerHour,
      ...moment.internalMotive === undefined ? {} : { internalMotive: moment.internalMotive },
      ...moment.activity === undefined ? {} : { activity: moment.activity },
      ...moment.focus === undefined ? {} : { focus: moment.focus },
    })
    try {
      options.memory?.wander(at)
    } catch {
      // 想不出来就算了，不影响这一轮开口
    }
  }
  const ticker = createProactiveTicker({
    intervalMs: nudgeMs,
    tick: (chatKey) => { consider(chatKey, Date.now(), options.rounds.awake(chatKey), true) },
    warn: (error) => { options.ctx.logger('qq-bundle').warn('主动会话定时检查失败', error) },
  })
  ticker.add(options.ownerChatKey)
  options.ctx.effect(() => () => { ticker.close() })
  options.ctx.on('agent/turn-stopping', ({ agent }) => {
    ticker.add(agent.id)
    consider(agent.id, Date.now(), false, false)
  })
  if (options.channel !== undefined) {
    const off = options.channel.onIncoming((message) => {
      if (message.selfSent || options.emergency.state().active) return
      ticker.add(message.chatKey)
      consider(message.chatKey, Date.now(), options.rounds.awake(message.chatKey), true)
    })
    options.ctx.effect(() => () => { off() })
  }
  return {
    consider,
    addChat: (chatKey) => { ticker.add(chatKey) },
    nudgeMs,
  }
}
