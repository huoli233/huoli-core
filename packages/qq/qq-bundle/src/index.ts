// 把各个零件装到一起：规则、每天该做的事、收消息往哪放、每轮留下什么痕迹

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import '@huoli/huoli-system-prompt'
import '@huoli/huoli-agent'
import type { Agent, AgentHandle } from '@huoli/huoli-agent'
import { brandString } from '@huoli/huoli-brand'
import { createUserMessage } from '@huoli/huoli-llm'
import type { SessionId } from '@huoli/huoli-session'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { qqAttentionOf } from '@huoli/huoli-qq-attention'
import { ambientOf, speakVetoOf, stopNowOf } from './speak-gate.ts'
import { qqContinuityOf } from '@huoli/huoli-qq-continuity'
import { qqMaterialOf } from '@huoli/huoli-qq-material'
import { buildInjectBlock, injectIntoUserText, localDay, qqMemoryOf, shouldInject } from '@huoli/huoli-qq-memory'
import { hasWords, qqChannelOf, defaultFarewellSlotFile, type IncomingMessage } from '@huoli/huoli-qq-channel'
import { qqProactiveOf, type Candidate } from '@huoli/huoli-qq-proactive'
import { qqSubjectOf } from '@huoli/huoli-qq-subject'
import { momentPort, qqSelfOf } from '@huoli/huoli-qq-self'
import { qqVitalsOf, type VitalsState } from '@huoli/huoli-qq-vitals'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import { budgetLine, budgetOf, clockOf, defaultRulesPath, readRules, registerAttentionPrompt, registerMaterialPrompts, sleepFactsOf } from './facts.ts'
import { enqueueSaid, saidTextOf } from './memory-events.ts'
import { bodyEventText, registerBodyTools, WRAP_UP_LINE } from './body-tools.ts'
import { appendConsidered, createDecisionLog, type DecisionBlock, type Verdict } from './decisions.ts'
import { createLiveness } from './liveness.ts'
import { defaultMaintenanceLogFile, mirrorPortOf, runMaintenance } from './maintenance.ts'
import { registerMemoryEvents } from './memory-events.ts'
import { registerToolWhitelist } from './tool-whitelist.ts'
import { pendingSection, refusalOf, registerProactiveTools, type PendingLine } from './proactive-tools.ts'
import type { Config, QqBundleSeam } from './types.ts'

export type { Config, BundleDelivery, QqBundleSeam } from './types.ts'
export type { DecisionBlock, DecisionLog, DecisionRecord } from './decisions.ts'
export { createDecisionLog } from './decisions.ts'
export { BUNDLE_DEFAULTS } from './defaults.ts'
export { FAREWELL_NEUTRAL, farewellMetadata, farewellText, farewellWritten } from './farewell.ts'
export type { FarewellAuthor } from './farewell.ts'
export {
  appendMaintenanceLine,
  defaultMaintenanceLogFile,
  ledgerPart,
  maintenanceLine,
  mirrorPortOf,
  runMaintenance,
} from './maintenance.ts'
export type { MaintenanceFacts, MaintenanceInput } from './maintenance.ts'
export { registerToolWhitelist, TOOL_WHITELIST_OPEN } from './tool-whitelist.ts'

/** 插件的行名 */
export const name = 'qq-bundle'

/** 要用的内核接口 */
export const inject = ['systemPrompt', 'tools']

// 这一轮到目前为止的事实
interface RoundFacts {
  at: number
  chatKey: string
  awake: boolean
  reason: string | null
  attempted: boolean
  sent: number
  blocked: DecisionBlock | null
  /** 这一轮走到第几步 */
  steps: number
  /** 有没有给过收尾提醒 */
  wrapped: boolean
  /** 最后调的是哪个工具，没有就是空 */
  lastTool: string
  /** 这一轮她让我发出去的那句话，没调发送就是空 */
  said: string
}

const seams = new WeakMap<Context, QqBundleSeam>()

/**
 * 取轮次记录，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 排查用的接口
 */
export function qqBundleOf(ctx: Context): QqBundleSeam | undefined {
  return seams.get(ctx.root) ?? seams.get(ctx)
}

/**
 * 把零件装到一起
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const rules = readRules(config.rulesFile ?? defaultRulesPath())
  const postLevel = config.postLevel ?? BUNDLE_DEFAULTS.postLevel
  const humanActiveWindowMs = Math.max(0, config.humanActiveWindowMs ?? BUNDLE_DEFAULTS.humanActiveWindowMs)
  const deliveredHistoryMax = Math.max(1, config.deliveredHistoryMax ?? BUNDLE_DEFAULTS.deliveredHistoryMax)
  // 已发过的正文只留最近这几条，给候选去重比对用，不落盘
  const deliveredHistory = new Map<string, string[]>()
  const rememberDelivered = (chatKey: string, text: string): void => {
    const kept = deliveredHistory.get(chatKey) ?? []
    const fingerprint = text.trim()
    if (fingerprint === '') return
    deliveredHistory.set(chatKey, [...kept, fingerprint].slice(-deliveredHistoryMax))
  }
  const historyOf = (chatKey: string): string[] => deliveredHistory.get(chatKey) ?? []

  // 规则放在提示词靠后的位置，压住前面那些通用话术
  ctx.systemPrompt.section({ name: 'qq:rules', order: 500, text: rules })

  // 身体先说话，条数紧跟着：这一轮最多几句排在身体之后、规矩之前
  const vitals = qqVitalsOf(ctx)
  // 余额只有外部系统知道，没配就是没有来源，死亡威胁一动不动也不自己回弹
  vitals?.setBalance(config.balanceLevel)
  // 活了多久问得出来；重启次数要有人给记录表才数，不给就只报活多久
  const livenessFile = config.livenessFile
  const liveness = createLiveness(livenessFile === undefined ? {} : { file: livenessFile })
  vitals?.setExistence(liveness.facts(Date.now()))
  ctx.systemPrompt.section({ name: 'qq:reply-budget', order: 350, text: () => budgetLine(vitals) })
  ctx.systemPrompt.section({ name: 'qq:body-events', order: 355, text: () => bodyEventText(memory, vitals, subject) })
  if (vitals !== undefined) ctx.effect(() => registerBodyTools(ctx, vitals))

  // 名单里没有的工具一律不许调，名单空着就不限制
  registerToolWhitelist(ctx, config.allowedTools ?? BUNDLE_DEFAULTS.allowedTools)

  const decisionsFile = config.decisionsFile ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-decisions.jsonl')
  const decisions = createDecisionLog({ file: decisionsFile })
  const rounds = new Map<string, RoundFacts>()
  const wakes = new Map<string, string>()
  const lastSpokeAt = new Map<string, number>()

  const seam: QqBundleSeam = {
    decisions(sinceAt, limit) {
      return decisions.read(sinceAt, limit)
    },
    async deliver(chatKey, id, body) {
      if (proactive === undefined) {
        return { ok: false, code: 'bundle.proactive_off', reason: '主动开口没装上', hint: '先把那一行挂起来再投' }
      }
      // 先预览再投递这条规矩由主动性把着，这里不另判一遍
      const delivered = proactive.deliver(chatKey, id)
      if (!delivered.ok || delivered.item === undefined) return delivered
      const text = (body ?? delivered.item.text).trim()
      if (text === '') {
        return { ok: false, code: 'bundle.no_body', reason: '这一条还没有正文', hint: '先把想发的那段写出来再投' }
      }
      if (channel === undefined) {
        return { ok: false, code: 'bundle.no_channel', reason: '没有能发出去的通道', hint: '装上通道那一行再来' }
      }
      // 不是想发动态的那一条就发到当前群：公开动态一律不碰，这是定下来的说法
      if (delivered.item.facts.postWant === undefined) {
        const sent = await channel.send(text, chatKey)
        if (!sent.ok) return refusalOf(sent, '等连上再说，或者换一句短点的')
        rememberDelivered(chatKey, text)
        return delivered
      }
      // 级别由配置给，发布入口拿它去过阶段与两把钥匙，缺级别只会撞上看不懂的 post.level
      const published = await channel.publish('post', text, { chatKey, level: postLevel })
      if (published.ok) return { ...delivered, published }
      return { ...refusalOf(published, '过一会儿再发'), published }
    },
  }
  seams.set(ctx.root, seam)

  // 记忆那一头：收尾时把她真说出去的话攒进队列，攒够再合成一条
  const memory = qqMemoryOf(ctx)

  // 收一轮：追加一行，收完就从表里拿掉，同一轮不会写两次
  const flush = (chatKey: string): void => {
    const round = rounds.get(chatKey)
    if (round === undefined) return
    rounds.delete(chatKey)
    if (round.sent > 0) enqueueSaid(ctx, memory, chatKey, round)
    try {
      const { at, awake, reason, attempted, sent, blocked, steps, wrapped, lastTool } = round
      decisions.append({ at, chatKey, awake, reason, attempted, sent, blocked, steps, wrapped, lastTool })
    } catch (error) {
      ctx.logger('qq-bundle').warn('轮次记录写不进去：%s', String(error))
    }
  }

  // 开一轮的空壳：唤醒理由给空就是没被叫醒
  const blankRound = (at: number, chatKey: string, reason: string | null): RoundFacts =>
    ({ at, chatKey, awake: reason !== null, reason, attempted: false, sent: 0, blocked: null, steps: 0, wrapped: false, lastTool: '', said: '' })

  const roundOf = (chatKey: string, at: number): RoundFacts => {
    const kept = rounds.get(chatKey) ?? blankRound(at, chatKey, null)
    rounds.set(chatKey, kept)
    return kept
  }

  // 开一轮：把攒着的唤醒事实收进来，收完就清掉
  const openRound = (chatKey: string, at: number): void => {
    rounds.set(chatKey, blankRound(at, chatKey, wakes.get(chatKey) ?? null))
    wakes.delete(chatKey)
  }
  // 每轮最多走几步；离上限还差 wrapUpSteps 步时提醒一次收尾，不提醒模型能一直调工具
  const maxSteps = Math.max(1, config.maxSteps ?? BUNDLE_DEFAULTS.maxSteps)
  const wrapUpAt = maxSteps - Math.min(BUNDLE_DEFAULTS.wrapUpSteps, Math.max(1, Math.floor(maxSteps / 2)))
  ctx.on('agent/pre-step', async (payload, next) => {
    const chatKey = payload.agent.id
    if (payload.step === 1) openRound(chatKey, Date.now())
    const round = roundOf(chatKey, Date.now())
    round.steps = payload.step
    if (payload.step === wrapUpAt) {
      round.wrapped = true
      const nudge = createUserMessage({ content: [{ type: 'text', text: WRAP_UP_LINE }], source: { kind: 'user' } })
      return { kind: 'enter' as const, messages: [...payload.messages, nudge] }
    }
    if (payload.step <= maxSteps) return next()
    round.blocked = { code: 'bundle.step_cap', retryAt: null, hint: '这一轮已经走到步数上限，下一轮再说' }
    flush(chatKey)
    return { kind: 'reject' as const }
  })

  // 记下最后调的是哪个工具、以及她让我发出去的那句话
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'tool/call') return
    const round = rounds.get(String(session.id))
    if (round === undefined) return
    round.lastTool = event.data.name
    if (event.data.name === 'qq_send_message') round.said = saidTextOf(event.data.arguments)
  })

  // 队列每轮走一拍：到点排空、到点反思；失手只记一行，不拦这一轮
  const tickQueue = (): void => {
    try {
      memory?.tick(Date.now())
    } catch (error) {
      ctx.logger('qq-bundle').warn('队列节拍没走完：%s', String(error))
    }
  }

  // 一轮结束就把这一轮的事实落成一行，队列节拍也在同一个收尾点上走一拍
  ctx.on('agent/turn-stopping', ({ agent }) => {
    flush(agent.id)
    tickQueue()
  })

  // 收消息：先记进身体，再放进注意力收件箱，顺便把当前会话记成活跃的那个
  const attention = qqAttentionOf(ctx)
  const subject = qqSubjectOf(ctx)
  const channel = qqChannelOf(ctx)
  // 注意力只把事实写进提示词，判不判由模型定
  registerAttentionPrompt(ctx, { attention, activeChatKey: () => subject?.store.read().lastActive ?? '' })
  // 一个群一条会话：会话编号就是聊天键，各聊各的，谁也不会串到别人那句上
  const agentSink = ctx.get('agents')
  const sessions = new Map<string, AgentHandle>()
  const opening = new Map<string, Promise<Agent | undefined>>()
  if (channel !== undefined && agentSink === undefined) {
    ctx.logger('qq-bundle').warn('没有 agent 注册表，入站消息唤不醒任何会话')
  }

  // 取这个群的会话，没有就现开一条；同一个群同时来两句也只开一次
  const agentFor = async (chatKey: string): Promise<Agent | undefined> => {
    const kept = sessions.get(chatKey)
    if (kept !== undefined) return kept.agent
    const pending = opening.get(chatKey)
    if (pending !== undefined) return pending
    if (agentSink === undefined) return undefined
    const creating = agentSink.create({ sessionId: brandString<SessionId>(chatKey) })
      .then((handle: AgentHandle) => {
        sessions.set(chatKey, handle)
        return handle.agent
      })
      .catch((error: unknown) => {
        ctx.logger('qq-bundle').warn('这个群的会话没开起来：%s', String(error))
        return undefined
      })
      .finally(() => {
        opening.delete(chatKey)
      })
    opening.set(chatKey, creating)
    return creating
  }

  // 一句话交给它自己那个群唤醒；开不起来就这一句不叫醒，也不假装叫过
  const wake = (chatKey: string, text: string): void => {
    void agentFor(chatKey).then((agent) => {
      if (agent === undefined) return
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    }).catch((error: unknown) => {
      ctx.logger('qq-bundle').warn('这一句没叫醒：%s', String(error))
    })
  }

  // 卸载时把开过的会话都收掉，不留一条在跑
  ctx.effect(() => () => {
    for (const handle of sessions.values()) void handle.dispose()
    sessions.clear()
    opening.clear()
  })
  if (channel !== undefined) {
    // 同一条消息只认一次：按会话加编号留住最近这一段
    const seenMax = Math.max(1, config.seenMax ?? BUNDLE_DEFAULTS.seenMax)
    const seen: string[] = []
    const seenKeys = new Set<string>()
    const firstTime = (message: IncomingMessage): boolean => {
      if (message.messageId === '') return true
      const key = `${message.chatKey}:${message.messageId}`
      if (seenKeys.has(key)) return false
      seenKeys.add(key)
      seen.push(key)
      if (seen.length > seenMax) {
        const oldest = seen.shift()
        if (oldest !== undefined) seenKeys.delete(oldest)
      }
      return true
    }

    const offIncoming = channel.onIncoming((message) => {
      // 自己发出去的那条会作为 message_sent 推回来，认出来就不再当别人说话叫醒自己
      if (message.selfSent) return
      if (!firstTime(message)) return
      wakes.set(message.chatKey, 'incoming')
      if (hasWords(message.text)) {
        // 先刷新运行环境那两条事实，结算时读到的才是这一刻的
        vitals?.setExistence(liveness.facts(message.at))
        vitals?.react(message.text, message.at)
      }
      attention?.inbox.push(message.chatKey, {
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        at: message.at,
        atMe: message.atMe,
        replyToBot: message.replyToBot,
      })
      subject?.store.setActive(message.chatKey)
      if (attention?.signals(message.chatKey).novelty.newTopic === true) subject?.noteNovelty(message.at)
      // 有人说话就开一轮：这个群有自己的会话，就叫它自己那一条醒来
      if (hasWords(message.text)) wake(message.chatKey, message.text)
    })
    const offPoke = channel.onPoke((poke) => {
      wakes.set(poke.chatKey, 'poke')
      attention?.inbox.push(poke.chatKey, {
        senderId: poke.userId,
        senderName: poke.userId,
        text: '戳了戳我',
        at: poke.at,
        isPoke: true,
      })
      subject?.store.setActive(poke.chatKey)
    })
    // 发送那一路只记事实：调没调、发了几条、被哪条关卡拦下
    const offOutbound = channel.onOutbound((event) => {
      const round = rounds.get(event.chatKey)
      if (round === undefined) return
      if (event.kind === 'attempt') round.attempted = true
      else if (event.kind === 'sent') {
        round.sent += event.count
        if (event.count > 0) lastSpokeAt.set(event.chatKey, event.at)
      } else if (round.blocked === null) round.blocked = { code: event.code ?? 'outbound.blocked', retryAt: event.retryAt ?? null }
    })
    ctx.effect(() => () => {
      offIncoming()
      offPoke()
      offOutbound()
    })
  }

  registerMemoryEvents(ctx, {
    config,
    defaults: BUNDLE_DEFAULTS,
    memory,
    subject,
    vitals,
    channel,
    selfLayer: qqSelfOf(ctx),
    postLevel,
    farewellFile: config.farewellFile ?? defaultFarewellSlotFile(config.home),
  })

  // 主动开口：每轮收尾与每次入站后（按节流）问一次要不要开口，它关着就一次都不问
  const proactive = qqProactiveOf(ctx)
  const material = qqMaterialOf(ctx)
  const continuity = qqContinuityOf(ctx)
  // 现场素材与上次的话头也只当事实说给模型，接不接由它定
  const activeChatKey = (): string => subject?.store.read().lastActive ?? ''
  registerMaterialPrompts(ctx, {
    activeChatKey,
    material,
    continuity,
    recent: chatKey => attention?.inbox.recent(chatKey, 30) ?? [],
  })

  // 攒着的由头要真的进提示词，模型才看得见；投递也做成工具，别让它只停在接缝上
  const proactivePorts = {
    activeChatKey: (): string => subject?.store.read().lastActive ?? '',
    pending: (chatKey: string): readonly PendingLine[] => proactive === undefined
      ? []
      : proactive.pending.live(chatKey).map(item => ({ id: item.id, why: item.why, text: item.text })),
    deliver: async (chatKey: string, id: string, body?: string) => {
      const result = await seam.deliver(chatKey, id, body)
      return {
        ok: result.ok,
        ...result.code === undefined ? {} : { code: result.code },
        ...result.reason === undefined ? {} : { reason: result.reason },
        ...result.hint === undefined ? {} : { hint: result.hint },
      }
    },
  }
  ctx.systemPrompt.section({
    name: 'qq:proactive-pending',
    order: 360,
    text: () => pendingSection(proactivePorts, proactivePorts.activeChatKey()),
  })
  ctx.effect(() => registerProactiveTools(ctx, proactivePorts))

  const throttleMs = Math.max(0, config.proactiveThrottleMs ?? BUNDLE_DEFAULTS.proactiveThrottleMs)
  const lastConsidered = new Map<string, number>()
  const addPostWantFrom = config.addPostWantFrom ?? BUNDLE_DEFAULTS.addPostWantFrom
  const postCandidateDailyMax = Math.max(0, config.postCandidateDailyMax ?? BUNDLE_DEFAULTS.postCandidateDailyMax)
  const postCandidateDays = new Map<string, { day: string; count: number }>()

  // 今天这个会话已经攒过几条动态候选：读数一直在变，同一天不因此反复攒
  const postGathered = (chatKey: string, day: string): number => {
    const kept = postCandidateDays.get(chatKey)
    return kept?.day === day ? kept.count : 0
  }

  // 想发动态的劲高过阈值才攒一条：正文还没有，发不发、发什么由模型定
  const postWantCandidateOf = (chatKey: string, at: number, body: VitalsState): Candidate | undefined => {
    if (!(body.post_want > addPostWantFrom)) return undefined
    if (postGathered(chatKey, localDay(at)) >= postCandidateDailyMax) return undefined
    return {
      id: `post-want:${localDay(at)}`,
      kind: 'share',
      why: `想发一条动态的劲压不住了，眼下${body.emotion_level}`,
      text: '',
      postWant: body.post_want,
      source: 'post_want',
      at,
    }
  }

  // 心里惦记着的事就是她想开口的由头，攒候选时只带原话与来源，不添任何分数
  const candidatesOf = (chatKey: string): Candidate[] => {
    if (material === undefined) return []
    return material.thoughts.live(chatKey).map(thought => ({
      id: thought.id,
      kind: 'share' as const,
      why: '有一件事一直惦记着',
      text: thought.text,
      source: 'thought',
      at: thought.at,
    }))
  }

  const noteConsidered = (chatKey: string, at: number, decision: { verdict: Verdict }): void => {
    appendConsidered(decisions, ctx.logger('qq-bundle'), chatKey, at, decision.verdict)
  }
  // 群里正热闹只是一条事实：收件箱里这一段时间有人说过话，判不判交给关卡
  const humanActiveOf = (chatKey: string, at: number): boolean => {
    if (attention === undefined) return false
    return attention.inbox.recent(chatKey, 40).some(message =>
      message.senderId !== '' && at - message.at >= 0 && at - message.at < humanActiveWindowMs)
  }

  const ambientOfChat = (chatKey: string, at: number) =>
    ambientOf(attention === undefined ? [] : attention.inbox.recent(chatKey, 60), at)

  const considerProactive = (chatKey: string, at: number, busy: boolean, throttled: boolean): void => {
    if (proactive === undefined || !proactive.enabled) return
    const last = lastConsidered.get(chatKey) ?? 0
    if (throttled && at - last < throttleMs) return
    lastConsidered.set(chatKey, at)
    const body = vitals?.read()
    const veto = speakVetoOf({
      isPrivate: chatKey.startsWith('private:'),
      ambient: ambientOfChat(chatKey, at),
      fatigueLevel: body === undefined ? 0 : Math.max(1 - body.energy, body.adenosine),
      sinceSelfSpokeMs: lastSpokeAt.get(chatKey) === undefined ? null : at - (lastSpokeAt.get(chatKey) as number),
    })
    const postWant = body === undefined ? undefined : postWantCandidateOf(chatKey, at, body)
    const decision = proactive.consider({
      chatKey,
      candidates: candidatesOf(chatKey),
      ...postWant === undefined ? {} : { external: [postWant] },
      history: historyOf(chatKey),
      humanActive: humanActiveOf(chatKey, at),
      botBusy: busy,
      hasChannel: channel !== undefined,
      ...body !== undefined ? { proactiveBias: body.proactive_bias, ...sleepFactsOf(body) } : {},
    })
    // 本来攒不成就保留原理由，只有本来要开口时才轮到上面那道关卡
    if (decision.verdict.ok && veto !== undefined) {
      noteConsidered(chatKey, at, { verdict: { ok: false, code: `attention.${veto}` } })
      return
    }
    // 攒成了才记一笔「今天攒过」：被关卡拦下时不算，同一天还有机会
    if (postWant !== undefined && decision.verdict.ok && veto === undefined) {
      const day = localDay(at)
      postCandidateDays.set(chatKey, { day, count: postGathered(chatKey, day) + 1 })
    }
    // 攒住的当场摆出来，投递只认摆过的那几条
    if (decision.pending.length > 0) proactive.preview(chatKey)
    noteConsidered(chatKey, at, decision)
    try { memory?.wander(at) } catch { /* 想不出来就算了，不影响这一轮开口 */ }
  }

  // 一轮刚收尾，人和机器都没在说，这正是问她要不要开口的时候
  ctx.on('agent/turn-stopping', ({ agent }) => {
    considerProactive(agent.id, Date.now(), false, false)
  })

  // 入站之后按节流再问一次：消息密的时候不必每条都问
  if (channel !== undefined) {
    const offIncomingProactive = channel.onIncoming((message) => {
      // 自己发出去的那条不算“有人刚说完话”，不然会拿它当开口的由头
      if (message.selfSent) return
      considerProactive(message.chatKey, Date.now(), rounds.has(message.chatKey), true)
    })
    ctx.effect(() => () => {
      offIncomingProactive()
    })
  }

  // 每天一次：先核对镜像前的记录，再掉重要度、定清晰度、清正文、补记录，接着镜像、记进记录表、再核一次
  const self = qqSelfOf(ctx)
  // 镜像只往记忆库写，证据回查要用的现役编号也从记忆仓取，接上以后每日整理才会带上它
  if (self !== undefined) self.useMemory(memory === undefined ? undefined : mirrorPortOf(memory))
  // 面板的此刻只问身体：身体那几行压成一句再交过去
  if (self !== undefined && vitals !== undefined) self.useVitals(momentPort(vitals))
  const maintenanceLogFile = config.maintenanceLogFile ?? defaultMaintenanceLogFile(config.home)
  const sweepAt = clockOf(config.dailySweepAt, BUNDLE_DEFAULTS.dailySweepAt, ctx)
  // 每分钟看一眼：到点那一次做整理与例行开口，同一天只做一次
  let lastSweepDay = ''
  const idle = setInterval(() => {
    const now = new Date()
    if (now.getHours() !== sweepAt.hour || now.getMinutes() !== sweepAt.minute) return
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
    if (day === lastSweepDay) return
    lastSweepDay = day
    try {
      runMaintenance({ at: Date.now(), memory, self, logFile: maintenanceLogFile })
    } catch (error) {
      // 每天这一步失手就记一行，别让定时器把整个进程带走
      ctx.logger('qq-bundle').warn('每天整理没做完：%s', String(error))
    }
    // 每天这一次也是例行时刻：想发动态的劲攒够了就在这里交给她
    const active = subject?.store.read().lastActive ?? ''
    if (active !== '') considerProactive(active, Date.now(), false, false)
  }, 60_000)
  idle.unref()
  ctx.effect(() => () => {
    clearInterval(idle)
  })

  // 停手时动态一条都不发：发布入口只认这一句
  channel?.usePause(() => self?.isPaused() ?? false)
  // 阶段只由自我层说：私信那一档按它判能不能发，没接上就按那一层默认值表里最保守的一档
  if (self !== undefined) channel?.useStage(() => self.stage())
  channel?.useReplyCap(() => budgetOf(vitals))
  channel?.useStop(stopNowOf(budgetOf(vitals), vitals?.read()))

  // 记忆这一路：每轮带原话的那一步找一次，命中就接在用户原话之后，系统提示词一个字不动
  if (config.memoryInject ?? BUNDLE_DEFAULTS.memoryInject) {
    const maxChars = Math.max(0, config.memoryInjectMaxChars ?? BUNDLE_DEFAULTS.memoryInjectMaxChars)
    const maxItems = Math.max(1, config.memoryInjectMaxItems ?? BUNDLE_DEFAULTS.memoryInjectMaxItems)
    const repeatTurns = Math.max(1, config.memoryInjectRepeatTurns ?? BUNDLE_DEFAULTS.memoryInjectRepeatTurns)
    const lastInjected = new Map<string, number>()

    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (memory === undefined || decision.kind !== 'enter') return decision
      const chatKey = payload.agent.id
      if (!shouldInject(payload.turn, lastInjected.get(chatKey), repeatTurns)) return decision
      // 运行环境那一段也挂在 user 上，但不是用户问的话，只接在用户自己说的那条后面
      const asked = decision.messages.filter(message => message.source.kind === 'user')
      const query = asked
        .flatMap(message => message.content.flatMap(part => part.type === 'text' ? [part.text] : []))
        .join('\n')
        .trim()
      if (query === '') return decision
      const block = buildInjectBlock(memory.find(query, chatKey, maxItems), maxChars, maxItems)
      if (block === '') return decision
      const tail = asked.at(-1)
      if (tail === undefined) return decision
      const content = [...tail.content]
      for (let at = content.length - 1; at >= 0; at -= 1) {
        const part = content.at(at)
        if (part?.type !== 'text') continue
        content[at] = { ...part, text: injectIntoUserText(part.text, block) }
        break
      }
      lastInjected.set(chatKey, payload.turn)
      return { ...decision, messages: decision.messages.map(message => message === tail ? { ...message, content } : message) }
    })
  }

  // 卸载时把手上这一轮也落下去，别丢
  ctx.effect(() => () => {
    for (const chatKey of [...rounds.keys()]) flush(chatKey)
    seams.delete(ctx.root)
  })
}
