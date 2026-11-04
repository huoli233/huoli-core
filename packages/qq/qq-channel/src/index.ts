// 接 QQ 的装配入口：连上、把消息放进收件箱、把要发的送出去

import path from 'node:path'
import type { Context } from '@huoli/cordis'
import { resolveHuoliHome } from '@huoli/huoli-home-paths'
import { qqPacingOf, REPLY_DEFAULTS, speechGaps, splitByBudget } from '@huoli/huoli-qq-pacing'
import { DEFAULTS, type ActionKind } from '@huoli/huoli-qq-self'
import { createWsChannel, type WsChannel } from './ws.ts'
import { toIncoming, toPoke, type ChannelStatus, type IncomingMessage, type IncomingPoke, type OutboundEvent } from './events.ts'
import { createOutboundCheck, OUTBOUND_DEFAULTS, type OutboundTuning } from './outbound.ts'
import { ACTION_DEFAULTS, CONFIRM_DEFAULTS, POLICY_DEFAULTS, type ActionFacts, type ActionResult, type ActionTuning, type ActionTunings } from './actions.ts'
import { createActionGate } from './action-gate.ts'
import { createActionStore } from './action-store.ts'
import { registerChannelTools } from './tools.ts'

export type { ChannelStatus, IncomingMessage, IncomingPoke, Outgoing, OutboundEvent, SentResult } from './events.ts'
export { chatKeyOf, hasWords, mentionsSelf, repliesToSelf, textOf, toIncoming, toPoke } from './events.ts'
export type { OutboundCheck, OutboundInput, OutboundTuning, OutboundVerdict } from './outbound.ts'
export { createOutboundCheck, OUTBOUND_DEFAULTS } from './outbound.ts'
export type { ActionDelivery, ActionFacts, ActionGate, ActionKind, ActionResult, ActionTuning, ActionTunings } from './actions.ts'
export { ACTION_DEFAULTS, CONFIRM_DEFAULTS, CONFIRM_KINDS, POLICY_DEFAULTS } from './actions.ts'
export type { ActionGateOptions } from './action-gate.ts'
export { createActionGate } from './action-gate.ts'
export type { ActionFingerprint, ActionKindState, ActionState, ActionStore, ActionStoreOptions, PendingAction } from './action-store.ts'
export { ACTION_STATE_VERSION, createActionStore, emptyActionState } from './action-store.ts'
export type { WsChannel, WsHandlers, WsOptions } from './ws.ts'
export { createWsChannel } from './ws.ts'

/** 别处要往收件箱塞消息、要发东西，都从这儿拿 */
export interface QqChannelSeam {
  channel: WsChannel
  status(): ChannelStatus
  /** 收一条消息，返回注销函数 */
  onIncoming(handler: (message: IncomingMessage) => void): () => void
  /** 收一次戳一戳，返回注销函数 */
  onPoke(handler: (poke: IncomingPoke) => void): () => void
  /** 看发送这一路发生了什么，返回注销函数 */
  onOutbound(handler: (event: OutboundEvent) => void): () => void
  /** 发一次公共动作，先过级别与这一类动作自己的闸门，再走出站体检 */
  publish(kind: ActionKind, text: string, facts: ActionFacts): Promise<ActionResult>
  /** 把一段正文放进待确认队列，返回编号 */
  requestConfirm(kind: ActionKind, text: string, at: number): ActionResult
  /** 点头放行一条待确认的正文 */
  confirm(confirmId: string, at: number): ActionResult
  /** 丢掉一条待确认的正文 */
  reject(confirmId: string): ActionResult
  /** 接上停手开关，为真时一条动态都不发 */
  usePause(check: (() => boolean) | undefined): void
  /** 接上这一轮的条数上限，不接就只发一条 */
  useReplyCap(provide: (() => number) | undefined): void
  /** 接上自我层现在的阶段，三类公共动作都按它判能不能发 */
  useStage(provide: (() => string) | undefined): void
}

/** 这一行接受的配置 */
export interface Config {
  /** QQ 那头连过来的地址 */
  url: string
  /** 机器人自己的 QQ 号 */
  selfId: string
  /** 连接口令，没设就不带 */
  accessToken?: string
  /** 断了之后隔多久重连 */
  reconnectMs?: number
  /** 允许发声的群编号，空表示不限制 */
  allowGroups?: readonly string[]
  /** 允许发声的人编号，空表示不限制 */
  allowPeople?: readonly string[]
  /** 一条最多几个字 */
  maxChars?: number
  /** 一分钟最多几条 */
  perMinute?: number
  /** 条数往回看的窗口 */
  windowMs?: number
  /** 静默时段从几点开始 */
  quietStart?: string
  /** 静默时段到几点结束 */
  quietEnd?: string
  /** 敏感词，命中就拦 */
  banned?: readonly string[]
  /** 白名单、长度、敏感词这三类拒绝给出的下次时间 */
  retryMs?: number
  /** 两条动态之间至少隔多久 */
  postCoolDownMs?: number
  /** 同一段正文隔多久才许再发 */
  postRepeatWindowMs?: number
  /** 一天最多发几条动态 */
  postDailyMax?: number
  /** 指纹表最多留几条 */
  postFingerprintMax?: number
  /** 预授权的话题类别，命中才算例行 */
  routineTopics?: readonly string[]
  /** 评论两条之间至少隔多久 */
  commentCoolDownMs?: number
  /** 同一段评论隔多久才许再发 */
  commentRepeatWindowMs?: number
  /** 一天最多发几条评论 */
  commentDailyMax?: number
  /** 评论指纹表最多留几条 */
  commentFingerprintMax?: number
  /** 私信两条之间至少隔多久 */
  privateCoolDownMs?: number
  /** 同一段私信隔多久才许再发 */
  privateRepeatWindowMs?: number
  /** 一天最多发几条私信 */
  privateDailyMax?: number
  /** 私信指纹表最多留几条 */
  privateFingerprintMax?: number
  /** 允许私信的对象，空表示谁都不行 */
  privateAllowPeers?: readonly string[]
  /** 待确认项多久没人点头就失效 */
  confirmTtlMs?: number
  /** 公开动态与公开评论最早从哪个阶段开始，不给就用自我层默认值表 */
  publicMinStage?: string
  /** 私信最早从哪个阶段开始，不给就用自我层默认值表 */
  privateMinStage?: string
  /** 三类动作的状态文件放哪，不填就落在数据根目录下的 data */
  actionsFile?: string
}

const seams = new WeakMap<Context, QqChannelSeam>()

/**
 * 取通道，未装配时为 undefined
 * @param ctx - 运行环境
 * @returns 处理结果
 */
export function qqChannelOf(ctx: Context): QqChannelSeam | undefined {
  return seams.get(ctx)
}

/** 插件的行名 */
export const name = 'qq-channel'

/** 要用的内核接口 */
export const inject = ['tools']

// 把配置摊成体检参数，没给的按默认值表走
function resolveOutbound(config: Config): OutboundTuning {
  return {
    allowGroups: config.allowGroups ?? OUTBOUND_DEFAULTS.allowGroups,
    allowPeople: config.allowPeople ?? OUTBOUND_DEFAULTS.allowPeople,
    maxChars: Math.max(1, config.maxChars ?? OUTBOUND_DEFAULTS.maxChars),
    perMinute: Math.max(1, config.perMinute ?? OUTBOUND_DEFAULTS.perMinute),
    windowMs: Math.max(1, config.windowMs ?? OUTBOUND_DEFAULTS.windowMs),
    quietStart: config.quietStart ?? OUTBOUND_DEFAULTS.quietStart,
    quietEnd: config.quietEnd ?? OUTBOUND_DEFAULTS.quietEnd,
    banned: config.banned ?? OUTBOUND_DEFAULTS.banned,
    retryMs: Math.max(0, config.retryMs ?? OUTBOUND_DEFAULTS.retryMs),
  }
}

// 一类动作允许从配置里覆盖的那几项
type ActionOverrides = Partial<Pick<ActionTuning, 'coolDownMs' | 'repeatWindowMs' | 'dailyMax' | 'fingerprintMax'>>

// 一类动作的参数按默认值表摊开，配置给了就覆盖，没给就用表里的
function tuneAction(base: ActionTuning, over: ActionOverrides): ActionTuning {
  return {
    ...base,
    coolDownMs: Math.max(0, over.coolDownMs ?? base.coolDownMs),
    repeatWindowMs: Math.max(0, over.repeatWindowMs ?? base.repeatWindowMs),
    dailyMax: Math.max(0, over.dailyMax ?? base.dailyMax),
    fingerprintMax: Math.max(1, over.fingerprintMax ?? base.fingerprintMax),
  }
}

// 阶段下限只在自我层的默认值表里定，这里只做逐项覆盖
function resolveStageFloors(config: Config): { publicMinStage: string; privateMinStage: string } {
  return {
    publicMinStage: config.publicMinStage ?? DEFAULTS.publicMinStage,
    privateMinStage: config.privateMinStage ?? DEFAULTS.privateMinStage,
  }
}

// 三类动作各摊一套参数，三类之间的数互不影响
function resolveActions(config: Config): ActionTunings {
  return {
    post: tuneAction(ACTION_DEFAULTS.post, {
      ...config.postCoolDownMs === undefined ? {} : { coolDownMs: config.postCoolDownMs },
      ...config.postRepeatWindowMs === undefined ? {} : { repeatWindowMs: config.postRepeatWindowMs },
      ...config.postDailyMax === undefined ? {} : { dailyMax: config.postDailyMax },
      ...config.postFingerprintMax === undefined ? {} : { fingerprintMax: config.postFingerprintMax },
    }),
    comment: tuneAction(ACTION_DEFAULTS.comment, {
      ...config.commentCoolDownMs === undefined ? {} : { coolDownMs: config.commentCoolDownMs },
      ...config.commentRepeatWindowMs === undefined ? {} : { repeatWindowMs: config.commentRepeatWindowMs },
      ...config.commentDailyMax === undefined ? {} : { dailyMax: config.commentDailyMax },
      ...config.commentFingerprintMax === undefined ? {} : { fingerprintMax: config.commentFingerprintMax },
    }),
    private: tuneAction(ACTION_DEFAULTS.private, {
      ...config.privateCoolDownMs === undefined ? {} : { coolDownMs: config.privateCoolDownMs },
      ...config.privateRepeatWindowMs === undefined ? {} : { repeatWindowMs: config.privateRepeatWindowMs },
      ...config.privateDailyMax === undefined ? {} : { dailyMax: config.privateDailyMax },
      ...config.privateFingerprintMax === undefined ? {} : { fingerprintMax: config.privateFingerprintMax },
    }),
  }
}


/**
 * 装配通道与发送工具
 * @param ctx - 运行环境
 * @param config - 配置
 */
export function apply(ctx: Context, config: Config): void {
  const incoming: Array<(message: IncomingMessage) => void> = []
  const pokes: Array<(poke: IncomingPoke) => void> = []
  const outboundEvents: Array<(event: OutboundEvent) => void> = []

  // 注销就是把这一条从表里拿掉，卸载之后再来消息不会再找到它
  const listen = <T>(list: Array<(value: T) => void>, handler: (value: T) => void): (() => void) => {
    list.push(handler)
    return () => {
      const at = list.indexOf(handler)
      if (at >= 0) list.splice(at, 1)
    }
  }

  const channel = createWsChannel(
    {
      url: config.url,
      selfId: config.selfId,
      ...config.accessToken !== undefined ? { accessToken: config.accessToken } : {},
      ...config.reconnectMs !== undefined ? { reconnectMs: config.reconnectMs } : {},
    },
    {
      onMessage(raw) {
        const now = Date.now()
        const message = toIncoming(raw, config.selfId, now)
        if (message !== null && message.text !== '') {
          for (const handler of incoming) handler(message)
          return
        }
        const poke = toPoke(raw, now)
        if (poke !== null) for (const handler of pokes) handler(poke)
      },
      onStatus() {
        // 状态变化给控制台看，这里不额外做事
      },
      log(message) {
        void message
      },
    },
  )

  const tuning = resolveOutbound(config)
  const outbound = createOutboundCheck(tuning)

  // 三类动作共用一份状态与一个入口，账不与发言额度共用
  let pauseCheck: () => boolean = () => false
  // 条数上限由组合包每轮给一次，没接上就按分档表的下限发一条
  let replyCap: (() => number) | undefined
  // 自我层现在的阶段由组合包接进来，没接上就按那一层默认值表里最保守的一档判
  let stageCheck: (() => string) | undefined
  const capNow = (): number => {
    const cap = replyCap?.()
    return cap === undefined ? REPLY_DEFAULTS.minCap : Math.max(REPLY_DEFAULTS.minCap, Math.floor(cap))
  }
  const actionsFile = config.actionsFile ?? path.join(resolveHuoliHome(), 'data', 'qq-actions.json')
  const actions = createActionGate({
    tunings: resolveActions(config),
    confirmTtlMs: Math.max(0, config.confirmTtlMs ?? CONFIRM_DEFAULTS.ttlMs),
    topics: config.routineTopics ?? POLICY_DEFAULTS.routineTopics,
    allowPeers: config.privateAllowPeers ?? POLICY_DEFAULTS.allowPeers,
    ...resolveStageFloors(config),
    store: createActionStore({ file: actionsFile }),
    outbound,
    send: (text, chatKey) => channel.send(text, chatKey),
    paused: () => pauseCheck(),
    stage: () => stageCheck?.(),
  })

  const seam: QqChannelSeam = {
    channel,
    status() {
      return channel.status()
    },
    onIncoming(handler) {
      return listen(incoming, handler)
    },
    onPoke(handler) {
      return listen(pokes, handler)
    },
    onOutbound(handler) {
      return listen(outboundEvents, handler)
    },
    async publish(kind, text, facts) {
      const openedAt = Date.now()
      for (const handler of outboundEvents) handler({ kind: 'attempt', at: openedAt, chatKey: facts.chatKey, count: 0 })
      const result = await actions.publish(kind, text, facts)
      for (const handler of outboundEvents) {
        if (result.ok) handler({ kind: 'sent', at: result.at ?? openedAt, chatKey: facts.chatKey, count: 1 })
        else handler({ kind: 'blocked', at: Date.now(), chatKey: facts.chatKey, count: 0, ...result.code === undefined ? {} : { code: result.code }, ...result.retryAt === undefined ? {} : { retryAt: result.retryAt } })
      }
      return result
    },
    requestConfirm(kind, text, at) {
      return actions.requestConfirm(kind, text, at)
    },
    confirm(confirmId, at) {
      return actions.confirm(confirmId, at)
    },
    reject(confirmId) {
      return actions.reject(confirmId)
    },
    usePause(check) {
      pauseCheck = check ?? (() => false)
    },
    useReplyCap(provide) {
      replyCap = provide
    },
    useStage(provide) {
      stageCheck = provide
    },
  }
  seams.set(ctx, seam)

  // 名单空着等于不管，但要说一次，免得以为已经在管了
  if (tuning.allowGroups.length === 0) ctx.logger('qq-channel').info('群白名单为空，所有群都能发')
  if (tuning.allowPeople.length === 0) ctx.logger('qq-channel').info('人白名单为空，所有人都能发')

  // 拆句直接用说话规矩里的纯函数，不依赖它有没有先装好
  const pacing = qqPacingOf(ctx)

  registerChannelTools(ctx, {
    status: () => channel.status(),
    send: (text, chatKey) => channel.send(text, chatKey),
    react: (messageId, emoji) => channel.react(messageId, emoji),
    // 单条的字数口径与出站体检的长度闸取同一个数，切出来的每条都过得了那道闸
    split: (text, maxParts) => {
      const parts = splitByBudget(text, { maxParts, maxCharsPerPart: tuning.maxChars })
      return { parts, gapsMs: speechGaps(parts) }
    },
    cap: () => capNow(),
    spend: (text) => {
      pacing?.spend(text)
    },
    allow: (text) => {
      const verdict = pacing?.allow(text)
      return verdict !== undefined ? verdict : { ok: true }
    },
    inspect: (chatKey, text) => outbound.check({ chatKey, text }),
    account: (at) => {
      outbound.record(at)
    },
    report: (event) => {
      for (const handler of outboundEvents) handler(event)
    },
    publish: (kind, text, facts) => seam.publish(kind, text, facts),
    requestConfirm: (kind, text, at) => seam.requestConfirm(kind, text, at),
    confirm: (confirmId, at) => seam.confirm(confirmId, at),
  })

  channel.start()

  // 卸载时断开
  ctx.effect(() => () => {
    channel.stop()
    seams.delete(ctx)
  })
}
