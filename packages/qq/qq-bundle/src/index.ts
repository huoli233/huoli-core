// 把各个零件装到一起：规则、每天该做的事、收消息往哪放、每轮留下什么痕迹

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@huoli/cordis'
import '@huoli/huoli-system-prompt'
import '@huoli/huoli-agent'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { qqAttentionOf } from '@huoli/huoli-qq-attention'
import { qqMaterialOf } from '@huoli/huoli-qq-material'
import { buildInjectBlock, injectIntoUserText, qqMemoryOf, shouldInject } from '@huoli/huoli-qq-memory'
import { hasWords, qqChannelOf, type IncomingMessage } from '@huoli/huoli-qq-channel'
import { replyBudget, type ReplyFacts } from '@huoli/huoli-qq-pacing'
import { qqProactiveOf, type Candidate, type ProactiveDecision } from '@huoli/huoli-qq-proactive'
import { qqSubjectOf } from '@huoli/huoli-qq-subject'
import { qqSelfOf } from '@huoli/huoli-qq-self'
import { qqVitalsOf, type QqVitalsSeam, type VitalsState } from '@huoli/huoli-qq-vitals'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import { createDecisionLog, type DecisionBlock, type DecisionRecord } from './decisions.ts'
import { registerToolWhitelist } from './tool-whitelist.ts'

export type { DecisionBlock, DecisionLog, DecisionRecord } from './decisions.ts'
export { createDecisionLog } from './decisions.ts'
export { BUNDLE_DEFAULTS } from './defaults.ts'
export { registerToolWhitelist, TOOL_WHITELIST_OPEN } from './tool-whitelist.ts'

/** 这一行接受的配置 */
export interface Config {
  /** 说话规矩那个文件放哪 */
  rulesFile?: string
  /** 每天几点整理记忆 */
  dailySweepHour?: number
  /** 一轮最多走几步 */
  maxSteps?: number
  /** 去重表最多留多少条 */
  seenMax?: number
  /** 轮次记录放哪，不填就用主目录下的 data */
  decisionsFile?: string
  /** 入站之后隔多久才再问一次要不要主动开口 */
  proactiveThrottleMs?: number
  /** 覆盖主目录，不填按 HUOLI_HOME 定 */
  home?: string
  /** 允许调用的工具名，空表示不限制 */
  allowedTools?: readonly string[]
  /** 每轮是否把召回到的记忆接在用户原话之后，关掉就一次都不召回 */
  memoryInject?: boolean
  /** 注入整串的字数上限 */
  memoryInjectMaxChars?: number
  /** 一次注入最多几条 */
  memoryInjectMaxItems?: number
  /** 同一段在最近多少轮内不重复注入 */
  memoryInjectRepeatTurns?: number
}

/** 排查用的接口，不进模型可见上下文 */
export interface QqBundleSeam {
  /** 从某一时刻起的轮次记录 */
  decisions(sinceAt: number, limit: number): DecisionRecord[]
}

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
}

const seams = new WeakMap<Context, QqBundleSeam>()

/**
 * 取轮次记录，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 排查用的接口
 */
export function qqBundleOf(ctx: Context): QqBundleSeam | undefined {
  return seams.get(ctx)
}

// 规则文件的位置
function defaultRulesPath(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    return path.join(here, '..', 'prompts', 'rules.md')
  } catch {
    return path.join(process.cwd(), 'prompts', 'rules.md')
  }
}

// 读规则，读不到就用一句兜底
function readRules(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return '你是群里的一个人，说话简短，说完就停。'
  }
}

// 条数上限看的事实：都从身体那唯一一份状态里取，不在这里另算
function replyFactsOf(state: VitalsState): ReplyFacts {
  return {
    tired: state.adenosine,
    annoyed: state.irritability,
    energy: state.energy,
    clingy: state.clinginess,
    lonely: state.loneliness,
  }
}

// 身体没接上时按中性的身体算，上限照样是一个数
const NEUTRAL_FACTS: ReplyFacts = { tired: 0.5, annoyed: 0.5, energy: 0.5, clingy: 0.5, lonely: 0.5 }

// 这一段只说这一轮最多几句，不说该不该回；动态那一路也照这条走
function budgetLine(vitals: QqVitalsSeam | undefined): string {
  const facts = vitals === undefined ? NEUTRAL_FACTS : replyFactsOf(vitals.read())
  return `【这一轮的条数】这一轮最多说 ${replyBudget(facts)} 条，说完就停，不追问，也不凑满。想发动态时把这条交给发布入口。`
}

/**
 * 把零件装到一起
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config = {}): void {
  const rules = readRules(config.rulesFile ?? defaultRulesPath())

  // 规则放在提示词靠后的位置，压住前面那些通用话术
  ctx.systemPrompt.section({
    name: 'qq:rules',
    order: 500,
    text: rules,
  })

  // 身体先说话，条数紧跟着：这一轮最多几句排在身体之后、规矩之前
  const vitals = qqVitalsOf(ctx)
  ctx.systemPrompt.section({
    name: 'qq:reply-budget',
    order: 350,
    text: () => budgetLine(vitals),
  })

  // 名单里没有的工具一律不许调，名单空着就不限制
  registerToolWhitelist(ctx, config.allowedTools ?? BUNDLE_DEFAULTS.allowedTools)

  // 每轮一条痕迹：只留事实与理由码，不碰原文
  const decisionsFile = config.decisionsFile ?? path.join(resolveHuoliHome(config.home), 'data', 'qq-decisions.jsonl')
  const decisions = createDecisionLog({ file: decisionsFile })
  const rounds = new Map<string, RoundFacts>()
  const wakes = new Map<string, string>()

  const seam: QqBundleSeam = {
    decisions(sinceAt, limit) {
      return decisions.read(sinceAt, limit)
    },
  }
  seams.set(ctx, seam)

  // 收一轮：追加一行，收完就从表里拿掉，同一轮不会写两次
  const flush = (chatKey: string): void => {
    const round = rounds.get(chatKey)
    if (round === undefined) return
    rounds.delete(chatKey)
    try {
      decisions.append({
        at: round.at,
        chatKey: round.chatKey,
        awake: round.awake,
        reason: round.reason,
        attempted: round.attempted,
        sent: round.sent,
        blocked: round.blocked,
      })
    } catch (error) {
      ctx.logger('qq-bundle').warn('轮次记录写不进去：%s', String(error))
    }
  }

  // 手上没有这一轮就补一条空白，闸门拦下时也要能落一行
  const roundOf = (chatKey: string, at: number): RoundFacts => {
    const existing = rounds.get(chatKey)
    if (existing !== undefined) return existing
    const opened: RoundFacts = { at, chatKey, awake: false, reason: null, attempted: false, sent: 0, blocked: null }
    rounds.set(chatKey, opened)
    return opened
  }

  // 开一轮：把攒着的唤醒事实收进来，收完就清掉
  const openRound = (chatKey: string, at: number): void => {
    const reason = wakes.get(chatKey)
    wakes.delete(chatKey)
    rounds.set(chatKey, {
      at,
      chatKey,
      awake: reason !== undefined,
      reason: reason ?? null,
      attempted: false,
      sent: 0,
      blocked: null,
    })
  }

  // 每轮最多走几步：走太多就是在空转，停掉比继续烧钱好
  const maxSteps = Math.max(1, config.maxSteps ?? BUNDLE_DEFAULTS.maxSteps)
  ctx.on('agent/pre-step', async (payload, next) => {
    const chatKey = payload.agent.id
    if (payload.step === 1) openRound(chatKey, Date.now())
    if (payload.step > maxSteps) {
      roundOf(chatKey, Date.now()).blocked = { code: 'bundle.step_cap', retryAt: null }
      flush(chatKey)
      return { kind: 'reject' as const }
    }
    return next()
  })

  // 一轮结束就把这一轮的事实落成一行
  ctx.on('agent/turn-stopping', ({ agent }) => {
    flush(agent.id)
  })

  // 收消息：先记进身体，再放进注意力收件箱，顺便把当前会话记成活跃的那个
  const attention = qqAttentionOf(ctx)
  const subject = qqSubjectOf(ctx)
  const channel = qqChannelOf(ctx)
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
      if (!firstTime(message)) return
      wakes.set(message.chatKey, 'incoming')
      if (hasWords(message.text)) vitals?.react(message.text, message.at)
      attention?.inbox.push(message.chatKey, {
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        at: message.at,
      })
      subject?.store.setActive(message.chatKey)
    })
    const offPoke = channel.onPoke((poke) => {
      wakes.set(poke.chatKey, 'poke')
      attention?.inbox.push(poke.chatKey, {
        senderId: poke.userId,
        senderName: poke.userId,
        text: '戳了戳我',
        at: poke.at,
      })
      subject?.store.setActive(poke.chatKey)
    })
    // 发送那一路只记事实：调没调、发了几条、被哪条闸门拦下
    const offOutbound = channel.onOutbound((event) => {
      const round = rounds.get(event.chatKey)
      if (round === undefined) return
      if (event.kind === 'attempt') round.attempted = true
      else if (event.kind === 'sent') round.sent += event.count
      else if (round.blocked === null) round.blocked = { code: event.code ?? 'outbound.blocked', retryAt: event.retryAt ?? null }
    })
    ctx.effect(() => () => {
      offIncoming()
      offPoke()
      offOutbound()
    })
  }

  // 主动开口：每轮收尾与每次入站后（按节流）问一次要不要开口，它关着就一次都不问
  const proactive = qqProactiveOf(ctx)
  const material = qqMaterialOf(ctx)
  const throttleMs = Math.max(0, config.proactiveThrottleMs ?? BUNDLE_DEFAULTS.proactiveThrottleMs)
  const lastConsidered = new Map<string, number>()

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

  // 结果码进记录时写成 proactive:<原因>，点只留在代码里
  const reasonOf = (code: string): string => {
    const cut = code.indexOf('.')
    return `proactive:${cut < 0 ? code : code.slice(cut + 1)}`
  }

  // 每考虑一次落一条：攒到、拦下、没攒到都落，事后都答得出为什么没开口
  const noteConsidered = (chatKey: string, at: number, decision: ProactiveDecision): void => {
    const code = decision.verdict.code ?? 'proactive.no_candidate'
    try {
      decisions.append({
        at,
        chatKey,
        awake: false,
        reason: reasonOf(code),
        attempted: false,
        sent: 0,
        blocked: decision.verdict.ok ? null : { code, retryAt: decision.verdict.retryAt ?? null },
      })
    } catch (error) {
      ctx.logger('qq-bundle').warn('主动开口的记录写不进去：%s', String(error))
    }
  }

  const considerProactive = (chatKey: string, at: number, busy: boolean, throttled: boolean): void => {
    if (proactive === undefined || !proactive.enabled) return
    const last = lastConsidered.get(chatKey) ?? 0
    if (throttled && at - last < throttleMs) return
    lastConsidered.set(chatKey, at)
    const body = vitals?.read()
    const decision = proactive.consider({
      chatKey,
      candidates: candidatesOf(chatKey),
      history: [],
      humanActive: false,
      botBusy: busy,
      hasChannel: channel !== undefined,
      ...body !== undefined ? { proactiveBias: body.proactive_bias } : {},
    })
    // 攒住的当场摆出来，投递只认摆过的那几条
    if (decision.pending.length > 0) proactive.preview(chatKey)
    noteConsidered(chatKey, at, decision)
  }

  // 一轮刚收尾，人和机器都没在说，这正是问她要不要开口的时候
  ctx.on('agent/turn-stopping', ({ agent }) => {
    considerProactive(agent.id, Date.now(), false, false)
  })

  // 入站之后按节流再问一次：消息密的时候不必每条都问
  if (channel !== undefined) {
    const offIncomingProactive = channel.onIncoming((message) => {
      considerProactive(message.chatKey, Date.now(), rounds.has(message.chatKey), true)
    })
    ctx.effect(() => () => {
      offIncomingProactive()
    })
  }

  // 每天一次：先掉重要度，再按保留度定清晰度，淡到底的清正文，最后补账；自我层没镜过的记录一并镜像
  const memory = qqMemoryOf(ctx)
  const self = qqSelfOf(ctx)
  // 镜像只往记忆库写，接上以后每日整理才会带上它
  if (self !== undefined) self.useMemory(memory)
  const hour = Math.max(0, Math.min(23, config.dailySweepHour ?? BUNDLE_DEFAULTS.dailySweepHour))
  const idle = setInterval(() => {
    if (new Date().getHours() !== hour) return
    try {
      memory?.maintain(Date.now())
      // 关着的那一层不写，镜像入口自己会返回没写
      const mirrored = self?.mirror()
      // 镜像写入立刻入账，下一次核对才不会把它当成正文被改
      if ((mirrored?.written ?? 0) > 0) memory?.ledger('sync')
    } catch (error) {
      // 每天这一步失手就记一行，别让定时器把整个进程带走
      ctx.logger('qq-bundle').warn('每天整理没做完：%s', String(error))
    }
  }, 60 * 60_000)
  idle.unref()
  ctx.effect(() => () => {
    clearInterval(idle)
  })

  // 停手时动态一条都不发：发布入口只认这一句
  channel?.usePause(() => self?.isPaused() ?? false)

  // 记忆注入：每轮带原话的那一步召回一次，命中就接在用户原话之后，系统提示词一个字不动
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
      // 运行环境那一段也挂在 user 上，但不是用户问的话，注入只接在用户自己说的那条后面
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
    seams.delete(ctx)
  })
}
