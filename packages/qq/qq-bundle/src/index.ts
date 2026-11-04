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
import { buildInjectBlock, injectIntoUserText, localDay, qqMemoryOf, shouldInject } from '@huoli/huoli-qq-memory'
import { hasWords, qqChannelOf, readFarewellSlot, defaultFarewellSlotFile, farewellTextAt, type ActionResult, type IncomingMessage } from '@huoli/huoli-qq-channel'
import { replyBudget, type ReplyFacts } from '@huoli/huoli-qq-pacing'
import { qqProactiveOf, type Candidate, type DeliverResult, type ProactiveDecision } from '@huoli/huoli-qq-proactive'
import { qqSubjectOf } from '@huoli/huoli-qq-subject'
import { momentPort, qqSelfOf } from '@huoli/huoli-qq-self'
import {
  qqVitalsOf, type DreamFact, type FarewellFact, type MealFact, type QqVitalsSeam, type ScarFact, type VitalsState,
} from '@huoli/huoli-qq-vitals'
import { BUNDLE_DEFAULTS } from './defaults.ts'
import { createDecisionLog, type DecisionBlock, type DecisionRecord } from './decisions.ts'
import { dreamImportance, dreamKey, dreamMetadata, dreamText, dreamWritten } from './dream.ts'
import { farewellMetadata, farewellText, farewellWritten } from './farewell.ts'
import { defaultMaintenanceLogFile, mirrorPortOf, runMaintenance } from './maintenance.ts'
import { mealMetadata, mealText, mealWritten } from './meal.ts'
import { SCAR_TEXT, scarImportance, scarMetadata, scarWritten } from './scar.ts'
import { registerToolWhitelist } from './tool-whitelist.ts'

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
  /** 每日维护日志放哪，不填就用主目录下的 data */
  maintenanceLogFile?: string
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
  /** 想发动态的读数高过这条线就攒一条动态候选 */
  addPostWantFrom?: number
  /** 同一个会话一天最多攒几条动态候选 */
  postCandidateDailyMax?: number
  /** 一顿饭写不写进记忆 */
  mealMemory?: boolean
  /** 一顿饭写成一条记忆时的重要度 */
  mealMemoryImportance?: number
  /** 遗书写不写进记忆 */
  farewellMemory?: boolean
  /** 遗书写成一条记忆时的重要度 */
  farewellMemoryImportance?: number
  /** 一场梦写不写进记忆 */
  dreamMemory?: boolean
  /** 美梦与噩梦发不发出去，平淡梦一律不发 */
  dreamPublish?: boolean
  /** 疤写不写进记忆 */
  scarMemory?: boolean
  /** 调用方给的模型文本，模型自己没写过时遗书正文用它，再没有就写一句中性的话 */
  farewellText?: string
  /** 遗书正文的暂存槽放哪，要与通道那一份是同一个文件 */
  farewellFile?: string
}

/** 一次投递的结论：没投出去的码与发布入口回来的那一段都摆在这里 */
export interface BundleDelivery extends DeliverResult {
  /** 走发布入口的结果，只有想发动态的那一条才有 */
  published?: ActionResult
}

/** 排查用的接口，不进模型可见上下文 */
export interface QqBundleSeam {
  /** 从某一时刻起的轮次记录 */
  decisions(sinceAt: number, limit: number): DecisionRecord[]
  /** 把待发里的一条投出去：先预览再投递由主动性把着，动态那一路再交发布入口 */
  deliver(chatKey: string, id: string, body?: string): Promise<BundleDelivery>
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
  return seams.get(ctx.root) ?? seams.get(ctx)
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

// 睡眠那三项事实原样转述：睡着、预计醒来的时刻、刚被吵醒，判不判由被动那一边的闸门定
function sleepFactsOf(state: VitalsState): { asleep: boolean; wakeAfter: number; waking: boolean } {
  return { asleep: state.asleep, wakeAfter: state.wake_after, waking: state.sleep_state === 'waking' }
}

// 身体没接上时按中性的身体算，上限照样是一个数
const NEUTRAL_FACTS: ReplyFacts = { tired: 0.5, annoyed: 0.5, energy: 0.5, clingy: 0.5, lonely: 0.5 }

// 这一段只说这一轮最多几句，不说该不该回；动态那一路也照这条走
function budgetOf(vitals: QqVitalsSeam | undefined): number {
  const facts = vitals === undefined ? NEUTRAL_FACTS : replyFactsOf(vitals.read())
  return replyBudget(facts)
}

// 提示词里那一句与发送路径读的是同一个数，两处不会对不上
function budgetLine(vitals: QqVitalsSeam | undefined): string {
  return `【这一轮的条数】这一轮最多说 ${budgetOf(vitals)} 条，说完就停，不追问，也不凑满。想发动态时把这条交给发布入口。`
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
    async deliver(chatKey, id, body) {
      if (proactive === undefined) {
        return { ok: false, code: 'bundle.proactive_off', reason: '主动开口没装上', hint: '先把那一行挂起来再投' }
      }
      // 先预览再投递这条规矩由主动性把着，这里不另判一遍
      const delivered = proactive.deliver(chatKey, id)
      if (!delivered.ok || delivered.item === undefined) return delivered
      // 不是想发动态的那一条就到此为止：投递这一步本身已经完成
      if (delivered.item.facts.postWant === undefined) return delivered
      const text = (body ?? delivered.item.text).trim()
      if (text === '') {
        return { ok: false, code: 'bundle.no_body', reason: '这一条还没有正文', hint: '先把想发的那段写出来再投' }
      }
      if (channel === undefined) {
        return { ok: false, code: 'bundle.no_channel', reason: '没有能发出去的通道', hint: '装上通道那一行再来' }
      }
      // 分级与放行都归发布入口，这里只给类别与正文
      const published = await channel.publish('post', text, { chatKey })
      if (published.ok) return { ...delivered, published }
      return {
        ok: false,
        ...published.code === undefined ? {} : { code: published.code },
        ...published.reason === undefined ? {} : { reason: published.reason },
        ...published.hint === undefined ? {} : { hint: published.hint },
        published,
      }
    },
  }
  seams.set(ctx.root, seam)

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

  // 记忆那头要用的东西先拿到手：每轮收尾与每天整理都要用
  const memory = qqMemoryOf(ctx)

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

  // 一顿饭写一条记忆：会话取当前活跃的那个，同一天同一顿只写一条
  const mealImportance = config.mealMemoryImportance ?? BUNDLE_DEFAULTS.mealMemoryImportance

  // 这一顿写成一条记忆：去重看记忆里已有的条，不另建文件；写不进去只抛给上面那层记一行
  const writeMeal = (fact: MealFact): void => {
    if (memory === undefined) return
    const chatKey = subject?.store.read().lastActive ?? ''
    if (chatKey === '') {
      ctx.logger('qq-bundle').warn('进食记忆没有落点：还没有活跃会话')
      return
    }
    if (mealWritten(memory.store.all(), chatKey, fact.at)) return
    memory.write(mealText(fact), chatKey, {
      layer: 'episodic',
      source: 'chat',
      importance: mealImportance,
      at: fact.at,
      metadata: mealMetadata(fact),
    })
  }

  // 关着时一个监听都不注册，一顿饭连回调都不会进来
  if ((config.mealMemory ?? BUNDLE_DEFAULTS.mealMemory) && vitals !== undefined) {
    // 记不住这一顿不影响这一轮：写记忆失手只记一行，回调照常返回
    const offMeal = vitals.onMeal((fact) => {
      try {
        writeMeal(fact)
      } catch (error) {
        ctx.logger('qq-bundle').warn('进食记忆没写进去：%s', String(error))
      }
    })
    ctx.effect(() => () => {
      offMeal()
    })
  }

  // 遗书写一条记忆：会话取当前活跃的那个，同一天同一个人只写一条
  const farewellImportance = config.farewellMemoryImportance ?? BUNDLE_DEFAULTS.farewellMemoryImportance
  const farewellFile = config.farewellFile ?? defaultFarewellSlotFile(config.home)

  // 模型自己在暂存槽里写过的那一句：槽在却读不动只记一行，接着按没写过办
  const modelWords = (fact: FarewellFact): string | undefined => {
    try {
      return farewellTextAt(readFarewellSlot(farewellFile), fact.at)
    } catch (error) {
      ctx.logger('qq-bundle').warn('遗书的暂存槽没读出来：%s', String(error))
      return undefined
    }
  }

  // 这一条写成一条记忆：正文先用模型自己写的，没写才用配置或中性那句，去重看记忆里已有的条
  const writeFarewell = (fact: FarewellFact): void => {
    if (memory === undefined) return
    const chatKey = subject?.store.read().lastActive ?? ''
    if (chatKey === '') {
      ctx.logger('qq-bundle').warn('遗书没有落点：还没有活跃会话')
      return
    }
    if (farewellWritten(memory.store.all(), chatKey, fact.at)) return
    const authored = modelWords(fact)
    memory.write(farewellText(authored ?? config.farewellText), chatKey, {
      layer: 'semantic',
      source: 'chat',
      importance: farewellImportance,
      at: fact.at,
      metadata: farewellMetadata(fact, authored === undefined ? 'fallback' : 'model'),
    })
  }

  // 关着时一个监听都不注册，到线那天连回调都不会进来
  if ((config.farewellMemory ?? BUNDLE_DEFAULTS.farewellMemory) && vitals !== undefined) {
    // 写不进去不影响消息路径：只记一行，回调照常返回
    const offFarewell = vitals.onFarewell((fact) => {
      try {
        writeFarewell(fact)
      } catch (error) {
        ctx.logger('qq-bundle').warn('遗书没写进去：%s', String(error))
      }
    })
    ctx.effect(() => () => {
      offFarewell()
    })
  }

  // 一场梦写一条记忆，美梦与噩梦再发一次：会话取当前活跃的那个，同一天同一场只写一条、只发一次
  const dreamMemory = config.dreamMemory ?? BUNDLE_DEFAULTS.dreamMemory
  const dreamPublish = config.dreamPublish ?? BUNDLE_DEFAULTS.dreamPublish
  // 已经试过的那几场：事实本身一辈子只产一次，进程里记一份就够，同一条不会连发两遍
  const publishedDreams = new Set<string>()

  // 这一场写成一条记忆：正文与重要度都取事实里的，去重看记忆里已有的条
  const writeDream = (fact: DreamFact, chatKey: string): void => {
    if (memory === undefined) return
    if (dreamWritten(memory.store.all(), chatKey, fact)) return
    memory.write(dreamText(fact), chatKey, {
      layer: 'episodic',
      source: 'chat',
      importance: dreamImportance(fact),
      at: fact.at,
      metadata: dreamMetadata(fact),
    })
  }

  // 发出去这一步：正文原样交给发布入口，分级、体检、冷却与额度都归它判
  const publishDream = async (fact: DreamFact, chatKey: string): Promise<void> => {
    if (channel === undefined) {
      ctx.logger('qq-bundle').warn('梦境没有发布入口：通道那一行没装上')
      return
    }
    const key = dreamKey(fact)
    if (publishedDreams.has(key)) return
    publishedDreams.add(key)
    try {
      await channel.publish('post', dreamText(fact), { chatKey })
    } catch (error) {
      ctx.logger('qq-bundle').warn('梦境没发出去：%s', String(error))
    }
  }

  // 两个开关都关着时一个监听都不注册，一场梦连回调都不会进来
  if ((dreamMemory || dreamPublish) && vitals !== undefined) {
    // 写与发各走各的：一条失手只记一行，另一条与别的订阅者都不受影响
    const offDream = vitals.onDream((fact) => {
      const chatKey = subject?.store.read().lastActive ?? ''
      if (chatKey === '') {
        ctx.logger('qq-bundle').warn('梦境没有落点：还没有活跃会话')
        return
      }
      if (dreamMemory) {
        try {
          writeDream(fact, chatKey)
        } catch (error) {
          ctx.logger('qq-bundle').warn('梦境记忆没写进去：%s', String(error))
        }
      }
      // 平淡梦一律不发，只有事实说可发布的那两档才走发布入口
      if (dreamPublish && fact.publishable) void publishDream(fact, chatKey)
    })
    ctx.effect(() => () => {
      offDream()
    })
  }

  // 疤写成一条长期印象：同一小时里只写一次，写不进去只记一行
  const writeScar = (fact: ScarFact): void => {
    if (memory === undefined) return
    const chatKey = subject?.store.read().lastActive ?? ''
    if (chatKey === '') {
      ctx.logger('qq-bundle').warn('疤痕记忆没有落点：还没有活跃会话')
      return
    }
    if (scarWritten(memory.store.all(), chatKey, fact.at)) return
    memory.write(SCAR_TEXT, chatKey, {
      layer: 'semantic',
      source: 'chat',
      importance: scarImportance(fact),
      at: fact.at,
      metadata: scarMetadata(fact),
    })
  }

  // 关着时一个监听都不注册，抬起来的疤连回调都不会进来
  if ((config.scarMemory ?? BUNDLE_DEFAULTS.scarMemory) && vitals !== undefined) {
    // 记不住这道疤不影响这一拍：写记忆失手只记一行，回调照常返回
    const offScar = vitals.onScar((fact) => {
      try {
        writeScar(fact)
      } catch (error) {
        ctx.logger('qq-bundle').warn('疤痕没写进去：%s', String(error))
      }
    })
    ctx.effect(() => () => {
      offScar()
    })
  }

  // 主动开口：每轮收尾与每次入站后（按节流）问一次要不要开口，它关着就一次都不问
  const proactive = qqProactiveOf(ctx)
  const material = qqMaterialOf(ctx)
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
    const postWant = body === undefined ? undefined : postWantCandidateOf(chatKey, at, body)
    const decision = proactive.consider({
      chatKey,
      candidates: candidatesOf(chatKey),
      ...postWant === undefined ? {} : { external: [postWant] },
      history: [],
      humanActive: false,
      botBusy: busy,
      hasChannel: channel !== undefined,
      ...body !== undefined ? { proactiveBias: body.proactive_bias, ...sleepFactsOf(body) } : {},
    })
    // 攒成了才记一笔「今天攒过」：被闸门拦下时不算，同一天还有机会
    if (postWant !== undefined && decision.verdict.ok) {
      const day = localDay(at)
      postCandidateDays.set(chatKey, { day, count: postGathered(chatKey, day) + 1 })
    }
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

  // 每天一次：先核定镜像前那一次账，再掉重要度、定清晰度、清正文、补账，接着镜像、入账、再核一次
  const self = qqSelfOf(ctx)
  // 镜像只往记忆库写，证据回查要用的现役编号也从记忆仓取，接上以后每日整理才会带上它
  if (self !== undefined) self.useMemory(memory === undefined ? undefined : mirrorPortOf(memory))
  // 面板的此刻只问身体：身体那几行压成一句再交过去
  if (self !== undefined && vitals !== undefined) self.useVitals(momentPort(vitals))
  const maintenanceLogFile = config.maintenanceLogFile ?? defaultMaintenanceLogFile(config.home)
  const hour = Math.max(0, Math.min(23, config.dailySweepHour ?? BUNDLE_DEFAULTS.dailySweepHour))
  const idle = setInterval(() => {
    if (new Date().getHours() !== hour) return
    try {
      runMaintenance({ at: Date.now(), memory, self, logFile: maintenanceLogFile })
    } catch (error) {
      // 每天这一步失手就记一行，别让定时器把整个进程带走
      ctx.logger('qq-bundle').warn('每天整理没做完：%s', String(error))
    }
    // 每天这一次也是例行时刻：想发动态的劲攒够了就在这里交给她
    const active = subject?.store.read().lastActive ?? ''
    if (active !== '') considerProactive(active, Date.now(), false, false)
  }, 60 * 60_000)
  idle.unref()
  ctx.effect(() => () => {
    clearInterval(idle)
  })

  // 停手时动态一条都不发：发布入口只认这一句
  channel?.usePause(() => self?.isPaused() ?? false)
  // 阶段只由自我层说：私信那一档按它判能不能发，没接上就按那一层默认值表里最保守的一档
  if (self !== undefined) channel?.useStage(() => self.stage())
  // 提示词里那条条数上限同时交给发送路径，按它把一段话切成几条发
  channel?.useReplyCap(() => budgetOf(vitals))

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
    seams.delete(ctx.root)
  })
}
